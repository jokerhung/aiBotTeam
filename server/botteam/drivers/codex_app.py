"""Codex driver over `codex app-server` (JSON-RPC on stdio): approvals and file-change requests go to the same broker as Claude's."""
from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from typing import Any, Optional

from .base import Capabilities, Emitter, SendTurnInput, new_turn_id, preview
from .proc import kill_tree, spawn

# approval level -> (Codex approvalPolicy, sandbox). Requests Codex raises are answered by the broker.
POLICY = {
    "ask": ("untrusted", "workspace-write"),
    "edits": ("on-request", "workspace-write"),
    "auto": ("on-request", "workspace-write"),
    "full": ("never", "danger-full-access"),
}


def policy_for(mode: str) -> tuple[str, str]:
    return POLICY.get(mode, POLICY["ask"])


@dataclass
class Session:
    proc: Any
    cwd: str
    mode: str
    thread_id: Optional[str] = None  # Codex's own thread id (the resume cursor)
    turn_id: Optional[str] = None  # our turn id
    codex_turn: Optional[str] = None
    settled: bool = True
    stop_requested: bool = False
    explained: bool = False
    next_id: int = 0
    waiting: dict[int, asyncio.Future] = field(default_factory=dict)
    tasks: list[asyncio.Task] = field(default_factory=list)
    stderr_tail: list[str] = field(default_factory=list)
    tools: dict[str, dict] = field(default_factory=dict)


class CodexAppDriver(Emitter):
    provider = "codex"
    engine_caps = {"edits": False, "nativeReviewer": True, "agentsMcp": False, "resume": True}
    capabilities = Capabilities(images=True, effortLevels=["low", "medium", "high"], strictResume=True)

    def __init__(self, binary: str | list[str], extra_env: dict[str, str] | None = None, broker=None) -> None:
        super().__init__()
        self.cmd = [binary] if isinstance(binary, str) else list(binary)
        self.env = extra_env if extra_env is not None else {}
        self.broker = broker
        self.sessions: dict[str, Session] = {}

    # ---- turn entry points -------------------------------------------------
    async def send_turn(self, inp: SendTurnInput) -> str:
        turn_id = new_turn_id()
        cwd = inp.cwd or os.getcwd()
        s = self.sessions.get(inp.thread_id)
        if s and (inp.session_reset or s.proc.returncode is not None or s.mode != inp.approval_mode or s.cwd != cwd):
            await self._close(inp.thread_id)
            s = None
        self.emit("turn.started", inp.thread_id, turn_id)
        try:
            if s is None:
                s = await self._start(inp, cwd)
            s.turn_id, s.settled, s.explained, s.stop_requested, s.tools = turn_id, False, False, False, {}
            prompt = inp.text
            if inp.system and not inp.resume_cursor:
                prompt = f"{inp.system}\n\n---\n\n{inp.text}"
            others = [p for p in inp.attachments if p not in inp.image_attachments]
            if others:
                prompt += "\n\nAttached files:\n" + "\n".join(f"- {p}" for p in others)
            items: list[dict] = [{"type": "text", "text": prompt}]
            items += [{"type": "localImage", "path": p} for p in inp.image_attachments]
            approval, sandbox = policy_for(inp.approval_mode)
            params: dict[str, Any] = {"threadId": s.thread_id, "input": items, "approvalPolicy": approval,
                                      "sandboxPolicy": self._sandbox_policy(sandbox, cwd)}
            if inp.model and inp.model != "default":
                params["model"] = inp.model
            if inp.effort:
                params["effort"] = inp.effort
            res = await self._request(s, "turn/start", params)
            s.codex_turn = ((res or {}).get("turn") or {}).get("id")
        except (OSError, RuntimeError, asyncio.TimeoutError) as e:
            self.emit("runtime.error", inp.thread_id, turn_id, message=f"Could not start Codex: {e}", setup=True, terminal=True)
            self.emit("turn.completed", inp.thread_id, turn_id, ok=False)
            if s:
                s.settled = True
        return turn_id

    @staticmethod
    def _sandbox_policy(sandbox: str, cwd: str) -> dict:
        if sandbox == "danger-full-access":
            return {"type": "dangerFullAccess"}
        if sandbox == "read-only":
            return {"type": "readOnly"}
        return {"type": "workspaceWrite", "writableRoots": [cwd], "networkAccess": False}

    async def interrupt_turn(self, thread_id: str) -> None:
        s = self.sessions.get(thread_id)
        if not s or s.settled:
            return
        s.stop_requested = True
        if s.thread_id and s.codex_turn:
            try:
                await asyncio.wait_for(self._request(s, "turn/interrupt", {"threadId": s.thread_id, "turnId": s.codex_turn}), 3)
                return
            except (asyncio.TimeoutError, RuntimeError, OSError):
                pass
        await self._close(thread_id)

    async def stop_all(self) -> None:
        for tid in list(self.sessions):
            await self._close(tid, settle=False)

    # ---- process + JSON-RPC ----------------------------------------------------
    def _write(self, s: Session, obj: dict) -> None:
        assert s.proc.stdin is not None
        s.proc.stdin.write((json.dumps(obj) + "\n").encode("utf8"))

    async def _request(self, s: Session, method: str, params: dict, timeout: float = 60) -> Any:
        s.next_id += 1
        rid = s.next_id
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        s.waiting[rid] = fut
        self._write(s, {"id": rid, "method": method, "params": params})
        await s.proc.stdin.drain()
        return await asyncio.wait_for(fut, timeout)

    async def _start(self, inp: SendTurnInput, cwd: str) -> Session:
        proc = await spawn([*self.cmd, "app-server"], cwd=cwd, env=self.env)
        s = Session(proc=proc, cwd=cwd, mode=inp.approval_mode)
        self.sessions[inp.thread_id] = s
        s.tasks = [asyncio.create_task(self._read(inp.thread_id, s)), asyncio.create_task(self._drain_stderr(s))]
        await self._request(s, "initialize", {"clientInfo": {"name": "botteam", "title": "BotTeam", "version": "0.3.0"}})
        self._write(s, {"method": "initialized"})
        approval, sandbox = policy_for(inp.approval_mode)
        base: dict[str, Any] = {"cwd": cwd, "approvalPolicy": approval, "sandbox": sandbox}
        if inp.model and inp.model != "default":
            base["model"] = inp.model
        if inp.resume_cursor and not inp.session_reset:
            try:
                res = await self._request(s, "thread/resume", {"threadId": inp.resume_cursor, **base})
            except RuntimeError:
                res = await self._request(s, "thread/start", base)
        else:
            res = await self._request(s, "thread/start", base)
        s.thread_id = ((res or {}).get("thread") or {}).get("id")
        self.emit("session.started", inp.thread_id, None, sessionId=s.thread_id, model=inp.model)
        return s

    async def _close(self, thread_id: str, settle: bool = True) -> None:
        s = self.sessions.pop(thread_id, None)
        if not s:
            return
        await kill_tree(s.proc)
        for fut in s.waiting.values():
            if not fut.done():
                fut.set_exception(RuntimeError("Codex closed"))
        for t in s.tasks:
            if t is not asyncio.current_task():
                t.cancel()
        if settle and not s.settled:
            s.settled = True
            self.emit("turn.completed", thread_id, s.turn_id, ok=False, stopReason="interrupted" if s.stop_requested else "closed")

    async def _drain_stderr(self, s: Session) -> None:
        try:
            async for raw in s.proc.stderr:
                s.stderr_tail = (s.stderr_tail + [raw.decode("utf8", "replace").rstrip()])[-6:]
        except asyncio.CancelledError:
            pass

    async def _read(self, thread_id: str, s: Session) -> None:
        try:
            async for raw in s.proc.stdout:
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if "method" in msg and "id" in msg:  # a request from Codex: answer it (approvals go to the broker)
                    asyncio.create_task(self._server_request(thread_id, s, msg))
                elif "method" in msg:
                    self.handle_notification(thread_id, s, msg["method"], msg.get("params") or {})
                elif "id" in msg:
                    fut = s.waiting.pop(msg["id"], None)
                    if fut and not fut.done():
                        if "error" in msg:
                            fut.set_exception(RuntimeError(str((msg["error"] or {}).get("message", "request failed"))))
                        else:
                            fut.set_result(msg.get("result"))
        except asyncio.CancelledError:
            return
        await s.proc.wait()
        if self.sessions.get(thread_id) is s:
            self.sessions.pop(thread_id, None)
        for fut in s.waiting.values():
            if not fut.done():
                fut.set_exception(RuntimeError("Codex exited"))
        if not s.settled:
            s.settled = True
            if not s.explained and not s.stop_requested:
                tail = " ".join(s.stderr_tail).strip()
                self.emit("runtime.error", thread_id, s.turn_id,
                          message=f"Codex exited unexpectedly{': ' + tail if tail else ''}", retryable=True)
            self.emit("turn.completed", thread_id, s.turn_id, ok=False, stopReason="interrupted" if s.stop_requested else "exited")

    # ---- requests Codex makes of us ------------------------------------------------
    async def _server_request(self, thread_id: str, s: Session, msg: dict) -> None:
        method, params, rid = msg["method"], msg.get("params") or {}, msg["id"]
        decision = "decline"
        if self.broker is not None and method in ("item/commandExecution/requestApproval", "item/fileChange/requestApproval"):
            if method.startswith("item/commandExecution"):
                tool, inp = "Bash", {"command": params.get("command") or "", "cwd": params.get("cwd") or s.cwd}
            else:
                tool, inp = "Edit", {"file_path": params.get("grantRoot") or params.get("reason") or "files", "reason": params.get("reason")}
            req_id = f"cx_{thread_id}_{rid}"
            try:
                ans = await self.broker.ask(thread_id, req_id, "permission", tool, inp)
                decision = "accept" if ans.get("behavior") == "allow" else "decline"
            except asyncio.CancelledError:
                decision = "cancel"
            except Exception:  # a broker failure is a refusal, never an allow
                decision = "decline"
        try:
            self._write(s, {"id": rid, "result": {"decision": decision}})
            await s.proc.stdin.drain()
        except (OSError, ConnectionError):
            pass

    # ---- notification mapping (app-server -> RuntimeEvent) ------------------------------
    def handle_notification(self, thread_id: str, s: Session, method: str, p: dict) -> None:
        tid = s.turn_id
        if method == "item/agentMessage/delta":
            self.emit("content.delta", thread_id, tid, streamKind="assistant_text", delta=p.get("delta", ""))
        elif method in ("item/reasoning/textDelta", "item/reasoning/summaryTextDelta"):
            self.emit("content.delta", thread_id, tid, streamKind="reasoning_text", delta=p.get("delta", ""))
        elif method == "item/started":
            it = p.get("item") or {}
            kind = it.get("type")
            if kind == "commandExecution":
                self.emit("item.started", thread_id, tid, itemType="tool", itemId=it.get("id"), title="Shell",
                          summary=preview(it.get("command"), 200), input=preview(it.get("command")))
            elif kind == "fileChange":
                self.emit("item.started", thread_id, tid, itemType="tool", itemId=it.get("id"), title="Edit",
                          summary=preview(", ".join(c.get("path", "") for c in it.get("changes") or []), 200), input="")
            elif kind == "mcpToolCall":
                self.emit("item.started", thread_id, tid, itemType="tool", itemId=it.get("id"),
                          title=str(it.get("tool") or "tool"), summary="", input=preview(it.get("arguments")))
        elif method == "item/completed":
            it = p.get("item") or {}
            kind = it.get("type")
            if kind == "agentMessage" and (it.get("text") or "").strip():
                self.emit("item.completed", thread_id, tid, itemType="assistant_text", text=it["text"])
            elif kind in ("commandExecution", "fileChange", "mcpToolCall"):
                ok = it.get("status") in ("completed", "success") and it.get("exitCode") in (None, 0)
                self.emit("item.completed", thread_id, tid, itemType="tool", itemId=it.get("id"), ok=ok,
                          output=preview(it.get("aggregatedOutput") or it.get("result") or it.get("status") or ""))
        elif method == "turn/completed":
            turn = p.get("turn") or {}
            status = turn.get("status")
            err = turn.get("error")
            if status == "failed" and not s.explained:
                s.explained = True
                self.emit("runtime.error", thread_id, tid, message=str((err or {}).get("message") if isinstance(err, dict) else err or "The turn failed."))
            s.settled = True
            interrupted = status == "interrupted" or s.stop_requested
            self.emit("turn.completed", thread_id, tid, ok=status == "completed",
                      stopReason="interrupted" if interrupted else status)
        elif method == "error":
            if not s.explained:
                s.explained = True
                e = p.get("error") or {}
                self.emit("runtime.error", thread_id, tid, message=str(e.get("message") if isinstance(e, dict) else e or "Codex reported an error."),
                          terminal=True)
        elif method == "thread/tokenUsage/updated":
            u = ((p.get("tokenUsage") or {}).get("last")) or {}
            self.emit("thread.token-usage.updated", thread_id, tid, input=u.get("inputTokens", 0), output=u.get("outputTokens", 0),
                      contextTokens=u.get("totalTokens", 0))
