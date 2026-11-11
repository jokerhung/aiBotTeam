"""A small MCP client: stdio, streamable HTTP and the older SSE transport. Used to test a server and by the proxy a turn talks through.

Messages are JSON-RPC 2.0. `request` returns the whole response object ({"result": ...} or {"error": ...}) so a relay can pass it on
unchanged; `tools()` and `call()` are the conveniences the rest of the app uses.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
from typing import Any, Optional

import httpx

PROTOCOL = "2025-03-26"
TIMEOUT = 30.0
CLIENT_INFO = {"name": "botteam", "version": "0.1.0"}


class McpError(RuntimeError):
    pass


def _jsonrpc(method: str, params: Optional[dict], id_: Optional[int]) -> dict:
    m: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        m["params"] = params
    if id_ is not None:
        m["id"] = id_
    return m


class Conn:
    """One connection to one server."""

    def __init__(self) -> None:
        self._next = 0

    def next_id(self) -> int:
        self._next += 1
        return self._next

    async def open(self) -> None: ...
    async def request(self, method: str, params: Optional[dict] = None, timeout: float = TIMEOUT) -> dict: ...
    async def notify(self, method: str, params: Optional[dict] = None) -> None: ...
    async def close(self) -> None: ...

    async def initialize(self) -> dict:
        r = await self.request("initialize", {"protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": CLIENT_INFO})
        if "error" in r:
            raise McpError(str(r["error"].get("message", r["error"])))
        await self.notify("notifications/initialized")
        return r.get("result", {})

    async def tools(self) -> list[dict]:
        out: list[dict] = []
        cursor: Optional[str] = None
        for _ in range(20):
            r = await self.request("tools/list", {"cursor": cursor} if cursor else {})
            if "error" in r:
                raise McpError(str(r["error"].get("message", r["error"])))
            res = r.get("result", {})
            out += res.get("tools", [])
            cursor = res.get("nextCursor")
            if not cursor:
                break
        return out

    async def call(self, name: str, arguments: Optional[dict] = None, timeout: float = 120.0) -> dict:
        r = await self.request("tools/call", {"name": name, "arguments": arguments or {}}, timeout=timeout)
        if "error" in r:
            raise McpError(str(r["error"].get("message", r["error"])))
        return r.get("result", {})


class StdioConn(Conn):
    def __init__(self, command: str, args: list[str], env: dict[str, str], cwd: Optional[str] = None) -> None:
        super().__init__()
        self.command, self.args, self.env, self.cwd = command, args, env, cwd
        self.proc: Optional[asyncio.subprocess.Process] = None
        self._waiting: dict[int, asyncio.Future] = {}
        self._reader: Optional[asyncio.Task] = None
        self.stderr_tail = ""

    async def open(self) -> None:
        exe = shutil.which(self.command) or self.command
        env = {**os.environ, **self.env}
        try:
            self.proc = await asyncio.create_subprocess_exec(exe, *self.args, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                                                             stderr=asyncio.subprocess.PIPE, env=env, cwd=self.cwd or None)
        except (OSError, ValueError) as e:
            raise McpError(f"could not start {self.command}: {e}") from e
        self._reader = asyncio.create_task(self._read())
        asyncio.create_task(self._drain_stderr())

    async def _drain_stderr(self) -> None:
        assert self.proc and self.proc.stderr
        while chunk := await self.proc.stderr.read(4096):
            self.stderr_tail = (self.stderr_tail + chunk.decode("utf8", "replace"))[-2000:]

    async def _read(self) -> None:
        assert self.proc and self.proc.stdout
        try:
            while line := await self.proc.stdout.readline():
                try:
                    msg = json.loads(line)
                except ValueError:
                    continue
                fut = self._waiting.pop(msg.get("id"), None) if isinstance(msg, dict) and ("result" in msg or "error" in msg) else None
                if fut and not fut.done():
                    fut.set_result(msg)
        finally:
            for fut in self._waiting.values():
                if not fut.done():
                    fut.set_exception(McpError("the server closed the connection" + (f": {self.stderr_tail.strip()[-300:]}" if self.stderr_tail.strip() else "")))
            self._waiting.clear()

    async def _send(self, msg: dict) -> None:
        assert self.proc and self.proc.stdin
        self.proc.stdin.write((json.dumps(msg) + "\n").encode("utf8"))
        await self.proc.stdin.drain()

    async def request(self, method: str, params: Optional[dict] = None, timeout: float = TIMEOUT) -> dict:
        id_ = self.next_id()
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._waiting[id_] = fut
        try:
            await self._send(_jsonrpc(method, params, id_))
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError as e:
            self._waiting.pop(id_, None)
            raise McpError(f"{method} timed out after {int(timeout)}s") from e
        except (BrokenPipeError, ConnectionResetError) as e:
            raise McpError("the server closed the connection") from e

    async def notify(self, method: str, params: Optional[dict] = None) -> None:
        try:
            await self._send(_jsonrpc(method, params, None))
        except (BrokenPipeError, ConnectionResetError):
            pass

    async def close(self) -> None:
        if self.proc and self.proc.returncode is None:
            try:
                if self.proc.stdin:
                    self.proc.stdin.close()
                await asyncio.wait_for(self.proc.wait(), 2)
            except Exception:
                try:
                    self.proc.kill()
                except ProcessLookupError:
                    pass
        if self._reader:
            self._reader.cancel()


class HttpConn(Conn):
    """Streamable HTTP: every message is a POST; the answer is JSON or a short event stream."""

    def __init__(self, url: str, headers: dict[str, str]) -> None:
        super().__init__()
        self.url, self.headers = url, headers
        self.session: Optional[str] = None
        self.client = httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False)

    async def open(self) -> None:
        return None

    def _headers(self) -> dict[str, str]:
        h = {"content-type": "application/json", "accept": "application/json, text/event-stream", **self.headers}
        if self.session:
            h["mcp-session-id"] = self.session
        return h

    async def _post(self, msg: dict, timeout: float) -> Optional[dict]:
        try:
            r = await self.client.post(self.url, content=json.dumps(msg), headers=self._headers(), timeout=timeout)
        except httpx.HTTPError as e:
            raise McpError(f"could not reach {self.url}: {e}") from e
        if r.headers.get("mcp-session-id"):
            self.session = r.headers["mcp-session-id"]
        if r.status_code in (202, 204):
            return None
        if r.status_code >= 400:
            raise McpError(f"{self.url} answered {r.status_code}")
        want = msg.get("id")
        if "text/event-stream" in r.headers.get("content-type", ""):
            for block in r.text.split("\n\n"):
                data = "\n".join(l[5:].strip() for l in block.splitlines() if l.startswith("data:"))
                if not data:
                    continue
                try:
                    m = json.loads(data)
                except ValueError:
                    continue
                if isinstance(m, dict) and m.get("id") == want and ("result" in m or "error" in m):
                    return m
            raise McpError("the server answered without a result")
        try:
            return r.json()
        except ValueError as e:
            raise McpError("the server did not answer with JSON") from e

    async def request(self, method: str, params: Optional[dict] = None, timeout: float = TIMEOUT) -> dict:
        out = await self._post(_jsonrpc(method, params, self.next_id()), timeout)
        if out is None:
            raise McpError("the server gave no answer")
        return out

    async def notify(self, method: str, params: Optional[dict] = None) -> None:
        try:
            await self._post(_jsonrpc(method, params, None), TIMEOUT)
        except McpError:
            pass

    async def close(self) -> None:
        await self.client.aclose()


class SseConn(Conn):
    """The older transport: a long GET stream that announces where to POST, and carries the answers."""

    def __init__(self, url: str, headers: dict[str, str]) -> None:
        super().__init__()
        self.url, self.headers = url, headers
        self.client = httpx.AsyncClient(timeout=None, follow_redirects=False)
        self.endpoint: Optional[str] = None
        self._ready = asyncio.Event()
        self._waiting: dict[int, asyncio.Future] = {}
        self._task: Optional[asyncio.Task] = None
        self.failure: Optional[str] = None

    async def open(self) -> None:
        self._task = asyncio.create_task(self._stream())
        try:
            await asyncio.wait_for(self._ready.wait(), TIMEOUT)
        except asyncio.TimeoutError as e:
            raise McpError(self.failure or "the server did not announce an endpoint") from e
        if self.failure:
            raise McpError(self.failure)

    async def _stream(self) -> None:
        from urllib.parse import urljoin

        try:
            async with self.client.stream("GET", self.url, headers={"accept": "text/event-stream", **self.headers}) as r:
                if r.status_code >= 400:
                    self.failure = f"{self.url} answered {r.status_code}"
                    self._ready.set()
                    return
                event, data = "message", []
                async for line in r.aiter_lines():
                    if line == "":
                        text = "\n".join(data)
                        if event == "endpoint":
                            self.endpoint = urljoin(self.url, text.strip())
                            self._ready.set()
                        elif text:
                            try:
                                m = json.loads(text)
                            except ValueError:
                                m = None
                            fut = self._waiting.pop(m.get("id"), None) if isinstance(m, dict) else None
                            if fut and not fut.done():
                                fut.set_result(m)
                        event, data = "message", []
                    elif line.startswith("event:"):
                        event = line[6:].strip()
                    elif line.startswith("data:"):
                        data.append(line[5:].strip())
        except httpx.HTTPError as e:
            self.failure = f"could not reach {self.url}: {e}"
            self._ready.set()
        finally:
            for fut in self._waiting.values():
                if not fut.done():
                    fut.set_exception(McpError("the stream closed"))

    async def _post(self, msg: dict) -> None:
        if not self.endpoint:
            raise McpError("no endpoint yet")
        try:
            r = await self.client.post(self.endpoint, content=json.dumps(msg), headers={"content-type": "application/json", **self.headers}, timeout=TIMEOUT)
        except httpx.HTTPError as e:
            raise McpError(f"could not reach {self.endpoint}: {e}") from e
        if r.status_code >= 400:
            raise McpError(f"{self.endpoint} answered {r.status_code}")

    async def request(self, method: str, params: Optional[dict] = None, timeout: float = TIMEOUT) -> dict:
        id_ = self.next_id()
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._waiting[id_] = fut
        await self._post(_jsonrpc(method, params, id_))
        try:
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError as e:
            self._waiting.pop(id_, None)
            raise McpError(f"{method} timed out after {int(timeout)}s") from e

    async def notify(self, method: str, params: Optional[dict] = None) -> None:
        try:
            await self._post(_jsonrpc(method, params, None))
        except McpError:
            pass

    async def close(self) -> None:
        if self._task:
            self._task.cancel()
        await self.client.aclose()


def connect(spec: dict) -> Conn:
    """A connection for a stored spec (secrets already filled in)."""
    kind = spec.get("transport", "stdio")
    if kind == "stdio":
        return StdioConn(spec["command"], list(spec.get("args") or []), dict(spec.get("env") or {}), spec.get("cwd"))
    if kind == "sse":
        return SseConn(spec["url"], dict(spec.get("headers") or {}))
    return HttpConn(spec["url"], dict(spec.get("headers") or {}))


async def probe(spec: dict) -> dict:
    """Connect, initialize, list the tools, close. {"ok": True, "server": {...}, "tools": [...]} or {"ok": False, "error": "..."}."""
    conn = connect(spec)
    try:
        await asyncio.wait_for(conn.open(), TIMEOUT)
        info = await asyncio.wait_for(conn.initialize(), TIMEOUT)
        tools = await asyncio.wait_for(conn.tools(), TIMEOUT)
        return {"ok": True, "server": info.get("serverInfo", {}), "tools": [{"name": t.get("name", ""), "description": (t.get("description") or "")[:200]} for t in tools]}
    except (McpError, asyncio.TimeoutError, OSError) as e:
        return {"ok": False, "error": str(e) or e.__class__.__name__}
    finally:
        try:
            await conn.close()
        except Exception:
            pass
