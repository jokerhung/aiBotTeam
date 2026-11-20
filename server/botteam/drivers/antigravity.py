"""Antigravity driver over `agy acp` (Agent Client Protocol, JSON-RPC on stdio): one process and one ACP session per thread.

Permission requests the agent raises (`session/request_permission`) go to the same broker as Claude's and Codex's."""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from dataclasses import dataclass, field
from typing import Any, Optional

from ..approval import antigravity_mode
from .base import Capabilities, Emitter, SendTurnInput, new_turn_id, preview
from .proc import kill_tree, spawn

AUTH_FAILURE = re.compile(r"sign in|log ?in|authenticat|unauthori[sz]ed|credentials", re.I)
USAGE_LIMIT = re.compile(r"quota|usage limit|rate limit|resource.?exhausted|too many requests", re.I)
# Variables that would make `agy` use another credential than the signed-in account.
REMOVED_ENV = ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT", "GOOGLE_GENAI_USE_VERTEXAI")
AUTH_LINK = re.compile(r"(?i)(authenticat|sign.?in|log.?in).*?(https?://\S+)")
MAX_IMAGE_BYTES = 8 * 1024 * 1024  # a bigger image is not sent inline: the agent is told its path and reads it with its own tools
START_TIMEOUT = 90  # seconds for `initialize` + `session/new`; the first start after an update can be slow
CANCEL_GRACE = 3  # seconds a cancelled turn gets to end before the process is killed


def parse_models(out: str) -> list[dict]:
    """`agy models` prints `<id>\\t<name>` per line (after a progress line)."""
    models: list[dict] = []
    for line in out.splitlines():
        if "\t" not in line:
            continue
        mid, name = line.split("\t", 1)
        if mid.strip() and not mid.startswith("Fetching"):
            models.append({"id": mid.strip(), "label": name.strip() or mid.strip()})
    return models


def antigravity_default_models() -> list[dict]:
    return [{"id": "default", "label": "Antigravity (account default)", "default": True}]


def acp_mcp_servers(entries: dict) -> list[dict]:
    """MCP servers (our `{name: {command, args, env}}` form) in the ACP `mcpServers` form."""
    out: list[dict] = []
    for name, ent in (entries or {}).items():
        if not isinstance(ent, dict) or not ent.get("command"):
            continue
        out.append({"name": re.sub(r"[^A-Za-z0-9_-]", "_", name), "command": ent["command"], "args": list(ent.get("args") or []),
                    "env": [{"name": k, "value": str(v)} for k, v in (ent.get("env") or {}).items()]})
    return out


@dataclass
class Session:
    proc: Any
    cwd: str
    mode: str
    model: Optional[str]
    effort: Optional[str]
    mcp: tuple = ()
    servers: tuple = ()  # names of the MCP servers given to the session, as the agent sees them
    acp_id: Optional[str] = None  # the agent's session id (our resume cursor)
    turn_id: Optional[str] = None
    settled: bool = True
    stop_requested: bool = False
    explained: bool = False
    next_id: int = 0
    waiting: dict[int, asyncio.Future] = field(default_factory=dict)
    tasks: list[asyncio.Task] = field(default_factory=list)
    stderr_tail: list[str] = field(default_factory=list)
    text: str = ""  # the assistant text of the running turn
    started: set = field(default_factory=set)  # tool call ids already announced
    prompt_task: Optional[asyncio.Task] = None
    asked: set = field(default_factory=set)
    auth_url: Optional[str] = None  # the sign-in link `agy` printed on stderr


class AntigravityDriver(Emitter):
    provider = "antigravity"
    engine_caps = {"edits": True, "nativeReviewer": False, "agentsMcp": True, "resume": True}
    capabilities = Capabilities(sessionModelSwitch="in-session", images=True, effortLevels=[], strictResume=False)

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
        model = None if inp.model in (None, "", "default") else inp.model
        mcp = tuple(sorted(inp.custom_mcp)) + (("bt",) if inp.mount_agents else ())
        s = self.sessions.get(inp.thread_id)
        if s and (inp.session_reset or s.proc.returncode is not None or s.mode != inp.approval_mode or s.cwd != cwd or s.mcp != mcp):
            await self._close(inp.thread_id)
            s = None
        self.emit("turn.started", inp.thread_id, turn_id)
        try:
            if s is None:
                s = await asyncio.wait_for(self._start(inp, cwd, model, mcp), START_TIMEOUT)
            if s.model != model and model:
                await self._request(s, "session/set_model", {"sessionId": s.acp_id, "modelId": model}, 20)
                s.model = model
            if inp.effort and inp.effort != s.effort:
                try:
                    await self._request(s, "session/set_config_option", {"sessionId": s.acp_id, "configId": "thought_level", "value": inp.effort}, 20)
                except RuntimeError:
                    pass  # the model has no thinking level
                s.effort = inp.effort
        except (OSError, RuntimeError, asyncio.TimeoutError) as e:
            failed = self.sessions.get(inp.thread_id)
            link = failed.auth_url if failed else None
            await self._close(inp.thread_id, settle=False)
            self._start_failed(inp.thread_id, turn_id, e, link)
            return turn_id
        s.turn_id, s.settled, s.explained, s.stop_requested, s.text, s.started, s.asked = turn_id, False, False, False, "", set(), set()
        prompt = inp.text
        if inp.system and not inp.resume_cursor:  # a resumed session already has it
            prompt = f"{inp.system}\n\n---\n\n{inp.text}"
        others = [p for p in inp.attachments if p not in inp.image_attachments]
        if others:
            prompt += "\n\nAttached files (read them with your tools):\n" + "\n".join(f"- {p}" for p in others)
        images = [(p, self._image_block(p)) for p in inp.image_attachments]
        big = [p for p, b in images if b is None]
        if big:  # too large (or unreadable) to send inline: say where it is
            prompt += "\n\nImages too large to attach here (open them with your tools):\n" + "\n".join(f"- {p}" for p in big)
        blocks: list[dict] = [{"type": "text", "text": prompt}]
        blocks += [b for _, b in images if b]
        s.prompt_task = asyncio.create_task(self._run_prompt(inp.thread_id, s, blocks))
        return turn_id

    def _start_failed(self, thread_id: str, turn_id: str, e: Exception, link: Optional[str] = None) -> None:
        msg = str(e) or type(e).__name__
        setup = bool(AUTH_FAILURE.search(msg)) or isinstance(e, OSError) or bool(link)
        if isinstance(e, asyncio.TimeoutError):
            msg = "Antigravity did not start in time"
        if link:
            msg += f". Sign in at {link} (or run `agy` once)"
        self.emit("runtime.error", thread_id, turn_id, message=f"Could not start Antigravity: {msg}", setup=setup, terminal=True)
        self.emit("turn.completed", thread_id, turn_id, ok=False)

    @staticmethod
    def _image_block(path: str) -> Optional[dict]:
        import base64
        import mimetypes

        mime = mimetypes.guess_type(path)[0] or "image/png"
        try:
            with open(path, "rb") as f:
                data = f.read()
        except OSError:
            return None
        if len(data) > MAX_IMAGE_BYTES:
            return None
        return {"type": "image", "mimeType": mime, "data": base64.b64encode(data).decode()}

    async def interrupt_turn(self, thread_id: str) -> None:
        s = self.sessions.get(thread_id)
        if not s or s.settled:
            return
        s.stop_requested = True
        if self.broker is not None:
            await self.broker.cancel_thread(thread_id)
        try:
            self._write(s, {"jsonrpc": "2.0", "method": "session/cancel", "params": {"sessionId": s.acp_id}})
            await s.proc.stdin.drain()
            if s.prompt_task:
                await asyncio.wait_for(asyncio.shield(s.prompt_task), CANCEL_GRACE)
            return
        except (asyncio.TimeoutError, OSError, ConnectionError):
            pass
        await self._close(thread_id)

    async def stop_all(self) -> None:
        for tid in list(self.sessions):
            await self._close(tid, settle=False)

    def has_session(self, thread_id: str) -> bool:
        s = self.sessions.get(thread_id)
        return bool(s and s.proc.returncode is None)

    # ---- process + JSON-RPC ----------------------------------------------------
    def _write(self, s: Session, obj: dict) -> None:
        assert s.proc.stdin is not None
        s.proc.stdin.write((json.dumps(obj) + "\n").encode("utf8"))

    async def _request(self, s: Session, method: str, params: dict, timeout: Optional[float] = None) -> Any:
        s.next_id += 1
        rid = s.next_id
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        s.waiting[rid] = fut
        self._write(s, {"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        await s.proc.stdin.drain()
        try:
            return await asyncio.wait_for(fut, timeout) if timeout else await fut
        finally:
            s.waiting.pop(rid, None)

    def _args(self, inp: SendTurnInput) -> list[str]:
        args = [*self.cmd, "acp", "--disable-telemetry"]
        if antigravity_mode(inp.approval_mode) == "auto":
            args.append("--dangerously-skip-permissions")
        if inp.skills_dir:
            args += ["--add-dir", inp.skills_dir]
        return args

    def _env(self) -> dict[str, str]:
        env = {k: "" for k in REMOVED_ENV}  # empty overrides the inherited value
        env.update(self.env)
        return env

    def _mcp(self, inp: SendTurnInput) -> list[dict]:
        entries = dict(inp.custom_mcp)
        if inp.mount_agents and self.broker is not None and self.broker.port:  # the team tools, as the Claude driver mounts them
            server_dir = str(__import__("pathlib").Path(__file__).resolve().parents[2])
            entries["bt"] = {"command": sys.executable, "args": ["-m", "botteam.mcp_bridge"],
                             "env": {"PYTHONPATH": server_dir, "BT_AGENTS": "1", "BT_BROKER_PORT": str(self.broker.port),
                                     "BT_BROKER_TOKEN": self.broker.token, "BT_THREAD_ID": inp.thread_id}}
        return acp_mcp_servers(entries)

    async def _start(self, inp: SendTurnInput, cwd: str, model: Optional[str], mcp: tuple) -> Session:
        proc = await spawn(self._args(inp), cwd=cwd, env=self._env())
        s = Session(proc=proc, cwd=cwd, mode=inp.approval_mode, model=None, effort=None, mcp=mcp)
        self.sessions[inp.thread_id] = s
        s.tasks = [asyncio.create_task(self._read(inp.thread_id, s)), asyncio.create_task(self._drain_stderr(s))]
        await self._request(s, "initialize", {"protocolVersion": 1, "clientCapabilities": {}, "clientInfo": {"name": "botteam", "version": "0.3.0"}})
        servers = self._mcp(inp)
        s.servers = tuple(x["name"] for x in servers)
        params = {"cwd": cwd, "mcpServers": servers}
        res = None
        if inp.resume_cursor and not inp.session_reset:
            try:
                res = await self._request(s, "session/resume", {"sessionId": inp.resume_cursor, **params})
                s.acp_id = inp.resume_cursor
            except RuntimeError:
                res = None  # the old session is gone: start a new one
        if res is None:
            res = await self._request(s, "session/new", params)
            s.acp_id = (res or {}).get("sessionId")
        if not s.acp_id:
            raise RuntimeError("Antigravity returned no session id")
        mode = antigravity_mode(inp.approval_mode)
        if mode == "accept-edits":
            await self._request(s, "session/set_mode", {"sessionId": s.acp_id, "modeId": "accept-edits"}, 20)
        if model:
            await self._request(s, "session/set_model", {"sessionId": s.acp_id, "modelId": model}, 20)
            s.model = model
        self.emit("session.started", inp.thread_id, None, sessionId=s.acp_id, model=model)
        return s

    async def _close(self, thread_id: str, settle: bool = True) -> None:
        s = self.sessions.pop(thread_id, None)
        if not s:
            return
        await kill_tree(s.proc)
        for fut in list(s.waiting.values()):
            if not fut.done():
                fut.set_exception(RuntimeError("Antigravity closed"))
        for t in s.tasks:
            if t is not asyncio.current_task():
                t.cancel()
        if s.prompt_task and s.prompt_task is not asyncio.current_task():
            s.prompt_task.cancel()
        if self.broker is not None:
            await self.broker.cancel_thread(thread_id)
        if settle and not s.settled:
            s.settled = True
            self.emit("turn.completed", thread_id, s.turn_id, ok=False, stopReason="interrupted" if s.stop_requested else "closed")

    async def _drain_stderr(self, s: Session) -> None:
        try:
            async for raw in s.proc.stderr:
                line = raw.decode("utf8", "replace").rstrip()
                s.stderr_tail = (s.stderr_tail + [line])[-8:]
                m = AUTH_LINK.search(line)
                if m:
                    s.auth_url = m.group(2)
        except asyncio.CancelledError:
            pass

    async def _read(self, thread_id: str, s: Session) -> None:
        try:
            async for raw in s.proc.stdout:
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(msg, dict):
                    continue
                if "method" in msg and "id" in msg:  # a request from the agent
                    asyncio.create_task(self._server_request(thread_id, s, msg))
                elif "method" in msg:
                    self.handle_notification(thread_id, s, msg["method"], msg.get("params") or {})
                elif "id" in msg:
                    fut = s.waiting.pop(msg["id"], None)
                    if fut and not fut.done():
                        if "error" in msg:
                            e = msg["error"] or {}
                            fut.set_exception(RuntimeError(str(e.get("message", "request failed") if isinstance(e, dict) else e)))
                        else:
                            fut.set_result(msg.get("result"))
        except asyncio.CancelledError:
            return
        await s.proc.wait()
        if self.sessions.get(thread_id) is s:
            self.sessions.pop(thread_id, None)
        for fut in list(s.waiting.values()):
            if not fut.done():
                fut.set_exception(RuntimeError(self._exit_message(s)))
        if self.broker is not None:
            await self.broker.cancel_thread(thread_id)

    def _exit_message(self, s: Session) -> str:
        if s.auth_url:
            return f"Antigravity is not signed in. Sign in at {s.auth_url} (or run `agy` once)"
        tail = " ".join(s.stderr_tail).strip()
        return f"Antigravity exited unexpectedly{': ' + tail if tail else ''}"

    # ---- one prompt ---------------------------------------------------------------
    async def _run_prompt(self, thread_id: str, s: Session, blocks: list[dict]) -> None:
        tid = s.turn_id
        stop = "end_turn"
        usage: dict = {}
        ok = True
        try:
            res = await self._request(s, "session/prompt", {"sessionId": s.acp_id, "prompt": blocks}) or {}
            stop = str(res.get("stopReason") or "end_turn")
            usage = res.get("usage") or {}
            ok = stop in ("end_turn", "max_tokens") and not s.stop_requested
        except asyncio.CancelledError:
            return
        except RuntimeError as e:
            ok = False
            if not s.explained and not s.stop_requested:
                s.explained = True
                msg = str(e)
                if s.auth_url and AUTH_FAILURE.search(msg):
                    msg += f". Sign in at {s.auth_url} (or run `agy` once)"
                self.emit("runtime.error", thread_id, tid, message=msg, setup=bool(AUTH_FAILURE.search(msg)),
                          limit="engine" if USAGE_LIMIT.search(msg) else None,
                          retryable=msg.startswith("Antigravity exited"), terminal=bool(AUTH_FAILURE.search(msg)) or None)
            stop = "interrupted" if s.stop_requested else "error"
        if s.settled:
            return
        s.settled = True
        if s.text.strip():
            self.emit("item.completed", thread_id, tid, itemType="assistant_text", text=s.text)
        if s.stop_requested:
            stop, ok = "interrupted", False
        self.emit("turn.completed", thread_id, tid, ok=ok, stopReason=stop,
                  usage={"input": usage.get("inputTokens") or 0, "output": usage.get("outputTokens") or 0,
                         "cachedInput": usage.get("cachedReadTokens") or 0})

    # ---- requests the agent makes of us ----------------------------------------------
    async def _server_request(self, thread_id: str, s: Session, msg: dict) -> None:
        method, params, rid = msg["method"], msg.get("params") or {}, msg["id"]
        result: dict = {}
        if method == "session/request_permission":
            result = {"outcome": {"outcome": "cancelled"}}
            options = params.get("options") or []
            tc = params.get("toolCall") or {}
            allow = next((o for o in options if o.get("kind") == "allow_once"), None)
            deny = next((o for o in options if str(o.get("kind", "")).startswith("reject")), None)
            decision = "deny"
            if self.broker is not None:
                tool, inp = self._permission_input(tc, s)
                try:
                    ans = await self.broker.ask(thread_id, f"ag_{thread_id}_{rid}", "permission", tool, inp)
                    decision = "allow" if ans.get("behavior") == "allow" else "deny"
                except asyncio.CancelledError:
                    decision = "cancel"
                except Exception:  # a broker failure is a refusal, never an allow
                    decision = "deny"
            if decision == "allow" and allow:
                result = {"outcome": {"outcome": "selected", "optionId": allow["optionId"]}}
            elif decision == "deny" and deny:
                result = {"outcome": {"outcome": "selected", "optionId": deny["optionId"]}}
            elif decision == "deny":
                result = {"outcome": {"outcome": "cancelled"}}
        else:
            try:
                self._write(s, {"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": f"Method not supported: {method}"}})
                await s.proc.stdin.drain()
            except (OSError, ConnectionError):
                pass
            return
        try:
            self._write(s, {"jsonrpc": "2.0", "id": rid, "result": result})
            await s.proc.stdin.drain()
        except (OSError, ConnectionError):
            pass

    @staticmethod
    def _permission_input(tc: dict, s: Session) -> tuple[str, dict]:
        """The broker's (tool, input) for an ACP tool call: shell and edit calls look like Claude's so its rules apply."""
        raw = tc.get("rawInput") or tc.get("args") or {}
        raw = raw if isinstance(raw, dict) else {}
        name, kind = str(tc.get("name") or ""), tc.get("kind")
        if kind == "execute" or name == "run_command":
            return "Bash", {"command": str(raw.get("CommandLine") or raw.get("command") or tc.get("title") or ""), "cwd": raw.get("Cwd") or s.cwd}
        if kind == "edit":
            return "Edit", {"file_path": str(raw.get("Path") or raw.get("path") or raw.get("TargetFile") or tc.get("title") or "files")}
        for srv in s.servers:  # the agent calls an MCP tool `mcp_<server>_<tool>`; the broker knows it as `mcp__<server>__<tool>`
            if name.startswith(f"mcp_{srv}_"):
                return f"mcp__{srv}__{name[len(srv) + 5:]}", raw
        return name or "tool", raw

    # ---- notification mapping (session/update -> RuntimeEvent) -----------------------------
    def handle_notification(self, thread_id: str, s: Session, method: str, p: dict) -> None:
        if method != "session/update":
            return
        u = p.get("update") or {}
        kind, tid = u.get("sessionUpdate"), s.turn_id
        if kind == "agent_message_chunk":
            text = (u.get("content") or {}).get("text") or ""
            if text:
                s.text += text
                self.emit("content.delta", thread_id, tid, streamKind="assistant_text", delta=text)
        elif kind == "agent_thought_chunk":
            text = (u.get("content") or {}).get("text") or ""
            if text:
                self.emit("content.delta", thread_id, tid, streamKind="reasoning_text", delta=text)
        elif kind in ("tool_call", "tool_call_update"):
            cid = str(u.get("toolCallId") or "")
            raw = u.get("rawInput") if u.get("rawInput") is not None else u.get("args")
            if cid not in s.started:
                s.started.add(cid)
                if s.text.strip():  # text before a tool is its own message
                    self.emit("item.completed", thread_id, tid, itemType="assistant_text", text=s.text)
                    s.text = ""
                self.emit("item.started", thread_id, tid, itemType="tool", itemId=cid, title=str(u.get("name") or u.get("title") or "tool"),
                          summary=preview(u.get("title") or "", 200), input=preview(raw))
            status = u.get("status")
            if status in ("completed", "failed"):
                out = u.get("rawOutput")
                if isinstance(out, dict):
                    out = out.get("output") or out
                self.emit("item.completed", thread_id, tid, itemType="tool", itemId=cid, ok=status == "completed", output=preview(out or ""))
                s.started.discard(cid)
        elif kind == "usage_update":
            self.emit("thread.token-usage.updated", thread_id, tid, input=0, output=0, contextTokens=u.get("used") or 0)
