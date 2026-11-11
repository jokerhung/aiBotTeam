"""Codex CLI driver: one `codex exec --json` process per turn, continued with `exec resume <thread id>`."""
from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from ..approval import codex_sandbox
from .base import Capabilities, Emitter, SendTurnInput, new_turn_id, preview
from .proc import kill_tree, spawn


def codex_models() -> list[dict]:
    """The models the CLI itself lists (its own cache), falling back to its configured default."""
    cache = Path.home() / ".codex" / "models_cache.json"
    models: list[dict] = []
    try:
        for m in json.loads(cache.read_text(encoding="utf8")).get("models", []):
            if m.get("visibility") == "list":
                models.append({"id": m["slug"], "label": m.get("display_name") or m["slug"]})
    except (OSError, ValueError, KeyError):
        pass
    models.insert(0, {"id": "default", "label": "Codex (account default)", "default": True})
    return models


@dataclass
class Run:
    proc: object
    turn_id: str
    stop_requested: bool = False
    settled: bool = False
    explained: bool = False
    stderr_tail: list[str] = field(default_factory=list)


class CodexDriver(Emitter):
    provider = "codex"
    capabilities = Capabilities(images=True, effortLevels=["low", "medium", "high"], strictResume=True)

    def __init__(self, binary: str | list[str], extra_env: dict[str, str] | None = None) -> None:
        super().__init__()
        self.env = extra_env if extra_env is not None else {}
        self.cmd = [binary] if isinstance(binary, str) else list(binary)
        self.runs: dict[str, Run] = {}

    def build_args(self, inp: SendTurnInput) -> list[str]:
        args = [*self.cmd, "exec"]
        if inp.resume_cursor and not inp.session_reset:
            args += ["resume"]
        args += ["--json", "--skip-git-repo-check", "-c", f'sandbox_mode="{codex_sandbox(inp.approval_mode)}"']
        if inp.model and inp.model != "default":
            args += ["-m", inp.model]
        if inp.effort:
            args += ["-c", f'model_reasoning_effort="{inp.effort}"']
        for path in inp.image_attachments:
            args += ["-i", path]
        if inp.resume_cursor and not inp.session_reset:
            args += [inp.resume_cursor]
        args += ["-"]
        return args

    async def send_turn(self, inp: SendTurnInput) -> str:
        turn_id = new_turn_id()
        self.emit("turn.started", inp.thread_id, turn_id)
        prompt = inp.text
        others = [p for p in inp.attachments if p not in inp.image_attachments]
        if others:
            prompt += "\n\nAttached files:\n" + "\n".join(f"- {p}" for p in others)
        if inp.system and not (inp.resume_cursor and not inp.session_reset):
            prompt = f"{inp.system}\n\n---\n\n{inp.text}"
        try:
            proc = await spawn(self.build_args(inp), cwd=inp.cwd or os.getcwd(), env=self.env)
        except OSError as e:
            self.emit("runtime.error", inp.thread_id, turn_id, message=f"Could not start Codex: {e}", setup=True, terminal=True)
            self.emit("turn.completed", inp.thread_id, turn_id, ok=False)
            return turn_id
        run = Run(proc=proc, turn_id=turn_id)
        self.runs[inp.thread_id] = run
        assert proc.stdin is not None
        proc.stdin.write(prompt.encode("utf8"))
        await proc.stdin.drain()
        proc.stdin.close()
        asyncio.create_task(self._read(inp.thread_id, run))
        asyncio.create_task(self._drain_stderr(run))
        return turn_id

    async def interrupt_turn(self, thread_id: str) -> None:
        run = self.runs.get(thread_id)
        if run and not run.settled:
            run.stop_requested = True
            await kill_tree(run.proc)  # the reader sees EOF and settles the turn

    async def stop_all(self) -> None:
        for r in list(self.runs.values()):
            r.stop_requested = True
            await kill_tree(r.proc)

    async def _drain_stderr(self, run: Run) -> None:
        try:
            async for raw in run.proc.stderr:
                run.stderr_tail = (run.stderr_tail + [raw.decode("utf8", "replace").rstrip()])[-6:]
        except asyncio.CancelledError:
            pass

    async def _read(self, thread_id: str, run: Run) -> None:
        async for raw in run.proc.stdout:
            try:
                self.handle_line(thread_id, run, json.loads(raw))
            except ValueError:
                continue
        await run.proc.wait()
        if self.runs.get(thread_id) is run:
            self.runs.pop(thread_id, None)
        if not run.settled:
            run.settled = True
            if not run.explained and not run.stop_requested:
                self.emit("runtime.error", thread_id, run.turn_id, retryable=True,
                          message=f"Codex exited unexpectedly: {' '.join(run.stderr_tail)}".strip())
            self.emit("turn.completed", thread_id, run.turn_id, ok=False,
                      stopReason="interrupted" if run.stop_requested else "exited")

    def handle_line(self, thread_id: str, run: Run, o: dict) -> None:
        t, tid = o.get("type"), run.turn_id
        if t == "thread.started":
            self.emit("session.started", thread_id, tid, sessionId=o.get("thread_id"))
        elif t in ("item.started", "item.completed"):
            self._item(thread_id, run, t, o.get("item") or {})
        elif t == "turn.completed":
            u = o.get("usage") or {}
            run.settled = True
            self.emit("turn.completed", thread_id, tid, ok=True, usage={
                "input": u.get("input_tokens") or 0, "output": u.get("output_tokens") or 0,
                "cachedInput": u.get("cached_input_tokens") or 0})
        elif t in ("turn.failed", "error"):
            run.explained = True
            err = o.get("error") or {}
            self.emit("runtime.error", thread_id, tid, message=str(err.get("message") if isinstance(err, dict) else o.get("message") or err))
            if t == "turn.failed":
                run.settled = True
                self.emit("turn.completed", thread_id, tid, ok=False)

    def _item(self, thread_id: str, run: Run, kind: str, item: dict) -> None:
        tid, typ, iid = run.turn_id, item.get("type"), item.get("id")
        if typ == "agent_message" and kind == "item.completed":
            text = item.get("text") or ""
            self.emit("content.delta", thread_id, tid, streamKind="assistant_text", delta=text)
            self.emit("item.completed", thread_id, tid, itemType="assistant_text", text=text)
        elif typ == "reasoning":
            if item.get("text"):
                self.emit("content.delta", thread_id, tid, streamKind="reasoning_text", delta=item["text"])
        elif typ == "command_execution":
            if kind == "item.started":
                self.emit("item.started", thread_id, tid, itemType="tool", itemId=iid, title="shell",
                          summary=preview(item.get("command"), 200), input=preview(item.get("command")))
            else:
                self.emit("item.completed", thread_id, tid, itemType="tool", itemId=iid,
                          ok=item.get("exit_code") in (0, None) and item.get("status") != "failed",
                          output=preview(item.get("aggregated_output")))
        elif typ in ("mcp_tool_call", "file_change", "web_search"):
            title = item.get("tool") or typ
            if kind == "item.started":
                self.emit("item.started", thread_id, tid, itemType="tool", itemId=iid, title=title,
                          summary=preview(item.get("query") or item.get("arguments") or "", 200), input=preview(item))
            else:
                self.emit("item.completed", thread_id, tid, itemType="tool", itemId=iid,
                          ok=item.get("status") != "failed", output=preview(item.get("result") or item.get("changes")))
