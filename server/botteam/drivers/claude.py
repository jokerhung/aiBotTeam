"""Claude Code CLI driver: one long-lived `claude -p` stream-json process per thread."""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from dataclasses import dataclass, field
from typing import Any

from ..approval import claude_permission_mode
from .base import Capabilities, Emitter, SendTurnInput, SteerOutcome, new_turn_id, preview
from .proc import kill_tree, spawn

AUTH_FAILURE = re.compile(r"not logged in|please run /login|invalid api key", re.I)
USAGE_LIMIT = re.compile(r"usage limit|limit reached|rate limit", re.I)

CLAUDE_MODELS = [
    {"id": "default", "label": "Claude (account default)", "default": True},
    {"id": "opus", "label": "Claude Opus"},
    {"id": "sonnet", "label": "Claude Sonnet"},
    {"id": "haiku", "label": "Claude Haiku"},
]


@dataclass
class Session:
    proc: Any
    model: str | None
    system: str | None
    mode: str = "full"
    mcp: tuple = ()  # the custom servers this process was started with
    turn_id: str | None = None
    cursor: str | None = None
    saw_stream_delta: bool = False
    explained: bool = False
    settled: bool = True
    stop_requested: bool = False
    stderr_tail: list[str] = field(default_factory=list)
    tasks: list[asyncio.Task] = field(default_factory=list)


def with_attachments(inp: SendTurnInput) -> str:
    if not inp.attachments:
        return inp.text
    listing = "\n".join(f"- {p}" for p in inp.attachments)
    return f"{inp.text}\n\nAttached files (read them with your tools):\n{listing}"


class ClaudeDriver(Emitter):
    provider = "claude"
    engine_caps = {"edits": True, "nativeReviewer": True, "agentsMcp": True, "resume": True}
    capabilities = Capabilities(queueing=True, images=True, effortLevels=["low", "medium", "high"], strictResume=True)

    def __init__(self, binary: str | list[str], extra_env: dict[str, str] | None = None, broker=None) -> None:
        super().__init__()
        self.cmd = [binary] if isinstance(binary, str) else list(binary)
        self.env = extra_env or {}
        self.broker = broker  # supplies the port and token the MCP bridge connects back to
        self.sessions: dict[str, Session] = {}

    # ---- turn entry points -------------------------------------------------
    async def send_turn(self, inp: SendTurnInput) -> str:
        turn_id = new_turn_id()
        model = None if inp.model in (None, "", "default") else inp.model
        s = self.sessions.get(inp.thread_id)
        if s and (inp.session_reset or s.proc.returncode is not None or s.model != model or s.system != inp.system or s.mode != inp.approval_mode or s.mcp != tuple(sorted(inp.custom_mcp))):
            await self._close(inp.thread_id)
            s = None
        if s is None:
            try:
                s = await self._start(inp, model)
            except OSError as e:
                self.emit("turn.started", inp.thread_id, turn_id)
                self.emit("runtime.error", inp.thread_id, turn_id, message=f"Could not start Claude Code: {e}", setup=True, terminal=True)
                self.emit("turn.completed", inp.thread_id, turn_id, ok=False)
                return turn_id
        s.turn_id, s.settled, s.explained, s.stop_requested, s.saw_stream_delta = turn_id, False, False, False, False
        self.emit("turn.started", inp.thread_id, turn_id)
        await self._write(s, with_attachments(inp))
        return turn_id

    async def steer(self, thread_id: str, text: str) -> SteerOutcome:
        s = self.sessions.get(thread_id)
        if not s or s.settled or s.proc.returncode is not None:
            return "refused"
        try:
            await self._write(s, text)
        except (OSError, ConnectionError):
            return "indeterminate"
        return "steered"

    async def interrupt_turn(self, thread_id: str) -> None:
        s = self.sessions.get(thread_id)
        if not s or s.settled:
            return
        s.stop_requested = True
        await self._close(thread_id)

    async def stop_all(self) -> None:
        for tid in list(self.sessions):
            await self._close(tid, settle=False)

    def has_session(self, thread_id: str) -> bool:
        s = self.sessions.get(thread_id)
        return bool(s and s.proc.returncode is None)

    # ---- process management ------------------------------------------------
    def build_args(self, inp: SendTurnInput, model: str | None) -> list[str]:
        args = [
            *self.cmd, "-p",
            "--output-format", "stream-json", "--input-format", "stream-json",
            "--verbose",  # required by stream-json output
            "--include-partial-messages",
            "--permission-mode", claude_permission_mode(inp.approval_mode),
            "--strict-mcp-config",
        ]
        if self.broker is not None and self.broker.port:
            server_dir = str(__import__("pathlib").Path(__file__).resolve().parents[2])
            cfg = {"mcpServers": {"bt": {
                "command": sys.executable, "args": ["-m", "botteam.mcp_bridge"],
                "env": {"PYTHONPATH": server_dir, "BT_AGENTS": "1", "BT_BROKER_PORT": str(self.broker.port),
                        "BT_BROKER_TOKEN": self.broker.token, "BT_THREAD_ID": inp.thread_id},
            }, **inp.custom_mcp}}
            args += ["--mcp-config", self._config_file(inp.thread_id, cfg), "--permission-prompt-tool", "mcp__bt__approve"]
        if model:
            args += ["--model", model]
        if inp.effort:
            args += ["--effort", inp.effort]
        if inp.resume_cursor and not inp.session_reset:
            args += ["--resume", inp.resume_cursor]
        if inp.skills_dir:
            args += ["--add-dir", inp.skills_dir]  # its .claude/skills holds the skills of this bot
        if inp.system:
            args += ["--append-system-prompt", inp.system]
        return args

    def _config_file(self, thread_id: str, cfg: dict) -> str:
        """The MCP configuration in a file only this user can read (it holds the broker token and the custom servers' paths), not on argv."""
        import os
        import tempfile

        d = __import__("pathlib").Path(tempfile.gettempdir()) / "botteam-mcp"
        d.mkdir(parents=True, exist_ok=True)
        path = d / (re.sub(r"[^\w-]", "_", thread_id) + ".json")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf8") as f:
            json.dump(cfg, f)
        return str(path)

    async def _start(self, inp: SendTurnInput, model: str | None) -> Session:
        proc = await spawn(self.build_args(inp, model), cwd=inp.cwd, env=self.env)
        s = Session(proc=proc, model=model, system=inp.system, mode=inp.approval_mode, cursor=inp.resume_cursor, mcp=tuple(sorted(inp.custom_mcp)))
        self.sessions[inp.thread_id] = s
        s.tasks = [
            asyncio.create_task(self._read(inp.thread_id, s)),
            asyncio.create_task(self._drain_stderr(s)),
        ]
        return s

    async def _write(self, s: Session, text: str) -> None:
        line = json.dumps({"type": "user", "message": {"role": "user", "content": text}}) + "\n"
        assert s.proc.stdin is not None
        s.proc.stdin.write(line.encode("utf8"))
        await s.proc.stdin.drain()

    async def _close(self, thread_id: str, settle: bool = True) -> None:
        s = self.sessions.pop(thread_id, None)
        if not s:
            return
        await kill_tree(s.proc)
        for t in s.tasks:
            if t is not asyncio.current_task():
                t.cancel()
        if settle and not s.settled:
            s.settled = True
            self.emit("turn.completed", thread_id, s.turn_id, ok=False, stopReason="interrupted" if s.stop_requested else "closed")

    async def _drain_stderr(self, s: Session) -> None:
        assert s.proc.stderr is not None
        try:
            async for raw in s.proc.stderr:
                s.stderr_tail = (s.stderr_tail + [raw.decode("utf8", "replace").rstrip()])[-8:]
        except asyncio.CancelledError:
            pass

    async def _read(self, thread_id: str, s: Session) -> None:
        assert s.proc.stdout is not None
        try:
            async for raw in s.proc.stdout:
                try:
                    frame = json.loads(raw)
                except ValueError:
                    continue
                self.handle_frame(thread_id, s, frame)
        except asyncio.CancelledError:
            return
        await s.proc.wait()
        if self.sessions.get(thread_id) is s:
            self.sessions.pop(thread_id, None)
        if not s.settled:
            s.settled = True
            if not s.explained and not s.stop_requested:
                tail = " ".join(s.stderr_tail).strip()
                self.emit("runtime.error", thread_id, s.turn_id,
                          message=f"Claude Code exited unexpectedly{': ' + tail if tail else ''}", retryable=True)
            self.emit("turn.completed", thread_id, s.turn_id, ok=False, stopReason="interrupted" if s.stop_requested else "exited")

    # ---- frame mapping (stream-json -> RuntimeEvent) ------------------------
    def handle_frame(self, thread_id: str, s: Session, o: dict) -> None:
        t, tid = o.get("type"), s.turn_id
        if t == "system" and o.get("subtype") == "compact_boundary":
            self.emit("context.compacted", thread_id, tid, trigger=(o.get("compact_metadata") or {}).get("trigger"))
        elif t == "system" and o.get("subtype") == "init":
            s.cursor = o.get("session_id") or s.cursor
            self.emit("session.started", thread_id, tid, sessionId=s.cursor, model=o.get("model"))
        elif t == "stream_event":
            if o.get("parent_tool_use_id"):
                return
            ev = o.get("event") or {}
            d = ev.get("delta") or {}
            if ev.get("type") != "content_block_delta":
                return
            if d.get("type") == "text_delta" and d.get("text"):
                s.saw_stream_delta = True
                self.emit("content.delta", thread_id, tid, streamKind="assistant_text", delta=d["text"])
            elif d.get("type") == "thinking_delta" and d.get("thinking"):
                self.emit("content.delta", thread_id, tid, streamKind="reasoning_text", delta=d["thinking"])
        elif t == "assistant":
            self._assistant(thread_id, s, o)
        elif t == "user":
            if o.get("isReplay"):
                return
            content = (o.get("message") or {}).get("content")
            for b in content if isinstance(content, list) else []:
                if b.get("type") == "tool_result":
                    self.emit("item.completed", thread_id, tid, itemType="tool", itemId=b.get("tool_use_id"),
                              ok=not b.get("is_error"), output=preview(b.get("content")))
        elif t == "tool_progress":
            self.emit("item.updated", thread_id, tid, itemType="tool")
        elif t == "result":
            self._result(thread_id, s, o)

    def _assistant(self, thread_id: str, s: Session, o: dict) -> None:
        tid = s.turn_id
        msg = o.get("message") or {}
        content = msg.get("content") if isinstance(msg.get("content"), list) else []
        text = "".join(b.get("text", "") for b in content if b.get("type") == "text")
        if AUTH_FAILURE.search(text) and (o.get("error") or msg.get("model") == "<synthetic>" or o.get("is_api_error_message")):
            s.explained = True
            self.emit("runtime.error", thread_id, tid, message=text, setup=True, terminal=True)
            return
        if (o.get("is_api_error_message") or isinstance(o.get("error"), str)) and text.strip():
            s.explained = True
            limited = bool(USAGE_LIMIT.search(text))
            self.emit("runtime.error", thread_id, tid, message=text, limit="engine" if limited else None, terminal=True)
            return
        if text.strip():
            if not s.saw_stream_delta:
                self.emit("content.delta", thread_id, tid, streamKind="assistant_text", delta=text)
            s.saw_stream_delta = False
            self.emit("item.completed", thread_id, tid, itemType="assistant_text", text=text)
        for b in content:
            if b.get("type") == "tool_use":
                inp = b.get("input") or {}
                self.emit("item.started", thread_id, tid, itemType="tool", itemId=b.get("id"), title=b.get("name"),
                          summary=preview(inp.get("command") or inp.get("file_path") or inp.get("pattern") or inp.get("url") or "", 200),
                          input=preview(inp))
        usage = msg.get("usage")
        if usage:
            self.emit("thread.token-usage.updated", thread_id, tid,
                      input=(usage.get("input_tokens") or 0) + (usage.get("cache_read_input_tokens") or 0),
                      output=usage.get("output_tokens") or 0,
                      contextTokens=(usage.get("input_tokens") or 0) + (usage.get("cache_read_input_tokens") or 0)
                      + (usage.get("cache_creation_input_tokens") or 0))

    def _result(self, thread_id: str, s: Session, o: dict) -> None:
        tid = s.turn_id
        if o.get("origin", {}).get("kind") == "task-notification" if isinstance(o.get("origin"), dict) else False:
            return
        is_error = bool(o.get("is_error"))
        if is_error and not s.explained and not s.stop_requested:
            s.explained = True
            self.emit("runtime.error", thread_id, tid, message=str(o.get("result") or "The turn failed."))
        s.settled = True
        u = o.get("usage") or {}
        self.emit("turn.completed", thread_id, tid, ok=not is_error, stopReason=o.get("stop_reason"),
                  cost=o.get("total_cost_usd"),
                  usage={"input": (u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0),
                         "output": u.get("output_tokens") or 0, "cachedInput": u.get("cache_read_input_tokens") or 0})
