"""Permission broker: the CLI's approval and question requests come in over a local socket, wait for a person, and fail closed."""
from __future__ import annotations

import asyncio
import json
import os
import secrets
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional

from .approval import EDIT_TOOLS, OWN_PREFIX, OWN_TOOLS, command_of, is_readonly_command, needs_explicit_approval
from .config import ConfigStore
from .store import new_id, now_ms

EXPIRE_AFTER = 15 * 60  # seconds a request waits for a person
UNREACHABLE = "The approval service could not reach a person for this step. Skip it, and say in your reply what you wanted to do and why."


@dataclass
class Policy:
    mode: str
    cwd: Optional[str]
    instance: str = ""
    allow_prefixes: tuple = ()  # tools of an app the person chose to let send without asking (Connected apps: write + allow)


PolicyFn = Callable[[str], Awaitable[Optional[Policy]]]
Hook = Callable[[str, dict], Awaitable[None]]


def summarize(tool: str, inp: Any) -> str:
    if isinstance(inp, dict):
        for k in ("command", "file_path", "path", "pattern", "url", "question"):
            if isinstance(inp.get(k), str):
                return inp[k][:300]
    return tool


class Broker:
    def __init__(self, config: ConfigStore, policy: PolicyFn, on_open: Hook, on_resolved: Hook, expire_after: float = EXPIRE_AFTER) -> None:
        self.config, self.policy = config, policy
        self.on_open, self.on_resolved = on_open, on_resolved
        self.expire_after = expire_after
        self.token = secrets.token_hex(16)
        self.port = 0
        self._server: Optional[asyncio.AbstractServer] = None
        self.open: dict[str, dict] = {}  # request id -> request
        self._futures: dict[str, asyncio.Future] = {}
        self._thread_of: dict[str, str] = {}
        self._ctx: dict[str, tuple[Optional[tuple[str, str]], str]] = {}
        self.agent_call: Optional[Callable[[str, str, dict], Awaitable[dict]]] = None  # the team tools (agents.py)
        self.read_dirs: list[str] = []  # folders whose files a bot may read without asking (the attachment store)

    # ---- lifecycle ---------------------------------------------------------
    async def start(self) -> int:
        self._server = await asyncio.start_server(self._client, "127.0.0.1", 0)
        self.port = self._server.sockets[0].getsockname()[1]
        return self.port

    async def stop(self) -> None:
        for rid in list(self.open):
            await self.resolve_system(rid, "unavailable")
        if self._server:
            self._server.close()

    def all_open(self) -> list[tuple[str, dict]]:
        return [(self._thread_of.get(rid, ""), r) for rid, r in self.open.items()]

    def open_for(self, thread_id: str) -> list[dict]:
        return [r for rid, r in self.open.items() if self._thread_of.get(rid) == thread_id]

    # ---- rules -------------------------------------------------------------
    @property
    def rules(self) -> list[dict]:
        return self.config.data.setdefault("allowRules", [])

    def rule_matches(self, command: str, cwd: str, instance: str) -> bool:
        return any(r["command"] == command and r["cwd"] == cwd and r["instance"] == instance for r in self.rules)

    def add_rule(self, command: str, cwd: str, instance: str) -> None:
        if not self.rule_matches(command, cwd, instance):
            self.rules.append({"id": new_id("rule"), "command": command, "cwd": cwd, "instance": instance})
            self.config.save()

    def remove_rule(self, rule_id: str) -> bool:
        before = len(self.rules)
        self.config.data["allowRules"] = [r for r in self.rules if r["id"] != rule_id]
        self.config.save()
        return len(self.rules) < before

    # ---- asking ------------------------------------------------------------
    async def ask(self, thread_id: str, req_id: str, kind: str, tool: str, inp: Any) -> dict:
        """Returns {behavior, message, source, always, answers}. A failure is a denial, never an allow."""
        if req_id in self.open:  # a duplicate id is refused; the first stays open
            return {"behavior": "deny", "message": "Duplicate request id.", "source": "system"}
        pol = await self.policy(thread_id) or Policy("ask", None)
        if isinstance(inp, dict) and isinstance(inp.get("cwd"), str) and os.path.isabs(inp["cwd"]):
            pol = Policy(pol.mode, inp["cwd"], pol.instance)  # an engine that names the folder it runs in (Codex) is believed
        auto = None if kind == "question" else self._auto(pol, tool, inp)
        if auto:
            return auto
        cmd = command_of(tool, inp, pol.cwd) if kind == "permission" else None
        raw_cmd = inp.get("command") if isinstance(inp, dict) and isinstance(inp.get("command"), str) else None
        req: dict[str, Any] = {
            "id": req_id, "type": kind, "tool": tool, "summary": summarize(tool, inp),
            "command": cmd[0] if cmd else raw_cmd, "cwd": cmd[1] if cmd else pol.cwd,
            "canAlways": bool(cmd), "status": "open", "openedAt": now_ms(),
            "choices": [], "questions": [], "behavior": None, "source": None, "answer": None,
        }
        if kind == "question" and isinstance(inp, dict):
            req["choices"] = [str(c) for c in (inp.get("choices") or [])][:8]
            qs = inp.get("questions")
            req["questions"] = qs if isinstance(qs, list) else []
            first = qs[0].get("question") if qs and isinstance(qs[0], dict) else ""
            req["summary"] = str(inp.get("question") or first or "Question")
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self.open[req_id], self._futures[req_id], self._thread_of[req_id] = req, fut, thread_id
        self._ctx[req_id] = (cmd, pol.instance)
        await self.on_open(thread_id, dict(req))
        try:
            return await asyncio.wait_for(asyncio.shield(fut), self.expire_after)
        except asyncio.TimeoutError:
            await self.resolve_system(req_id, "expired")
            return fut.result()
        except asyncio.CancelledError:
            await self.resolve_system(req_id, "unavailable")
            raise

    def _auto(self, pol: Policy, tool: str, inp: Any) -> Optional[dict]:
        def allow(source: str) -> dict:
            return {"behavior": "allow", "source": source}

        if tool in OWN_TOOLS or tool.startswith(OWN_PREFIX) or pol.mode == "full":
            return allow("auto")
        if pol.allow_prefixes and any(tool.startswith(p) for p in pol.allow_prefixes):
            return allow("auto")
        if tool == "Read" and isinstance(inp, dict) and isinstance(inp.get("file_path"), str) and self._in_read_dirs(inp["file_path"]):
            return allow("auto")
        if needs_explicit_approval(inp):  # leaving the sandbox: only Full access answers that alone
            return None
        cmd = command_of(tool, inp, pol.cwd)
        if cmd and self.rule_matches(cmd[0], cmd[1], pol.instance):
            return allow("rule")
        if pol.mode in ("edits", "auto") and tool in EDIT_TOOLS:
            return allow("auto")
        if pol.mode in ("edits", "auto") and cmd and is_readonly_command(cmd[0]):
            return allow("auto")
        return None

    def _in_read_dirs(self, path: str) -> bool:
        try:
            real = os.path.realpath(path)
            return any(os.path.commonpath([real, os.path.realpath(d)]) == os.path.realpath(d) for d in self.read_dirs)
        except (ValueError, OSError):
            return False

    # ---- resolving ---------------------------------------------------------
    async def resolve(self, req_id: str, behavior: str, message: Optional[str] = None, always: bool = False,
                      answers: Optional[dict] = None, source: str = "user", by: Optional[str] = None) -> bool:
        req, fut = self.open.get(req_id), self._futures.get(req_id)
        if not req or not fut or fut.done():
            return False
        behavior = "allow" if behavior == "allow" else "deny"
        cmd, instance = self._ctx.get(req_id, (None, ""))
        if behavior == "allow" and always and cmd and source == "user":
            self.add_rule(cmd[0], cmd[1], instance)  # the exact command + directory the CLI sent, never a display string
        req.update(status="resolved", behavior=behavior, source=source, answer=message, answeredBy=by)
        thread_id = self._thread_of.pop(req_id, "")
        self.open.pop(req_id, None)
        self._futures.pop(req_id, None)
        self._ctx.pop(req_id, None)
        fut.set_result({"behavior": behavior, "message": message, "source": source,
                        "always": bool(always and behavior == "allow"), "answers": answers})
        await self.on_resolved(thread_id, dict(req))
        return True

    async def resolve_system(self, req_id: str, source: str) -> None:
        """Nobody answered (timeout, client gone, turn over, shutdown): deny. `source` says why."""
        msg = "No answer was given in time." if source == "expired" else UNREACHABLE
        await self.resolve(req_id, "deny", msg, source=source)

    async def cancel_thread(self, thread_id: str, source: str = "unavailable") -> None:
        for rid in [r for r, t in self._thread_of.items() if t == thread_id]:
            await self.resolve_system(rid, source)

    # ---- socket protocol (JSON lines) ---------------------------------------
    async def _client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        mine: set[str] = set()
        tasks: set[asyncio.Task] = set()
        try:
            hello = json.loads(await asyncio.wait_for(reader.readline(), 10) or b"{}")
            if hello.get("t") != "hello" or not secrets.compare_digest(str(hello.get("token", "")), self.token):
                return
            thread_id = str(hello.get("thread", ""))

            async def one(msg: dict) -> None:
                rid = str(msg.get("id") or new_id("req"))
                if rid not in self.open:
                    mine.add(rid)
                ans = await self.ask(thread_id, rid, "question" if msg.get("kind") == "question" else "permission",
                                     str(msg.get("tool", "")), msg.get("input"))
                try:
                    writer.write((json.dumps({"t": "answer", "id": rid, **ans}) + "\n").encode())
                    await writer.drain()
                except (ConnectionError, OSError):
                    pass

            async def agent(msg: dict) -> None:
                rid = str(msg.get("id") or new_id("req"))
                try:
                    out = await self.agent_call(thread_id, str(msg.get("tool", "")), msg.get("args") or {}) if self.agent_call else {"ok": False, "reason": "unavailable"}
                except Exception as e:  # a tool failure is an answer, never a crash of the bridge
                    out = {"ok": False, "reason": "internal", "detail": f"{type(e).__name__}: {e}"}
                try:
                    writer.write((json.dumps({"t": "answer", "id": rid, "agent": out}) + "\n").encode())
                    await writer.drain()
                except (ConnectionError, OSError):
                    pass

            while line := await reader.readline():
                try:
                    msg = json.loads(line)
                except ValueError:
                    continue
                if msg.get("t") == "agent":
                    t = asyncio.create_task(agent(msg))
                    tasks.add(t)
                    t.add_done_callback(tasks.discard)
                elif msg.get("t") == "ask":
                    t = asyncio.create_task(one(msg))
                    tasks.add(t)
                    t.add_done_callback(tasks.discard)
        except (asyncio.TimeoutError, ConnectionError, OSError, ValueError):
            pass
        finally:  # the client went away: whatever it still waits for is unanswerable
            for rid in mine:
                if rid in self.open:
                    await self.resolve_system(rid, "unavailable")
            for t in tasks:
                t.cancel()
            writer.close()
