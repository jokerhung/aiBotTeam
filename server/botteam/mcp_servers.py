"""Custom MCP servers: stored specs, their secrets, a connection test, and the entries a turn gets for the servers a bot uses.

A server is stdio (a command) or remote (streamable HTTP, or the older SSE). Environment values and header values are secrets: they are
stored, never returned (the UI sees a mask), and never put on a command line: a turn reaches the server through `botteam.mcp_proxy`,
which reads the spec from a private file.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from . import mcp_client
from .netguard import BlockedAddress, check_url
from .store import new_id, now_ms

MASK = "********"
DEFAULT_BUDGET = 20_000
TRANSPORTS = ("stdio", "http", "sse")
SERVER_DIR = str(Path(__file__).resolve().parents[1])


class SpecError(ValueError):
    pass


def _strings(value: Any, what: str) -> dict[str, str]:
    if value is None:
        return {}
    if not isinstance(value, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in value.items()):
        raise SpecError(f"{what} must be a map of text to text")
    if len(value) > 50:
        raise SpecError(f"{what} has too many entries")
    return dict(value)


def clean(body: dict, current: Optional[dict] = None) -> dict:
    """A valid spec from what the UI sent. Values equal to the mask keep what is stored."""
    cur = current or {}
    name = str(body.get("name", cur.get("name", ""))).strip()
    if not name or len(name) > 60:
        raise SpecError("a server needs a name of up to 60 characters")
    transport = body.get("transport", cur.get("transport", "stdio"))
    if transport not in TRANSPORTS:
        raise SpecError("transport must be stdio, http or sse")
    spec: dict[str, Any] = {"name": name, "transport": transport, "enabled": bool(body.get("enabled", cur.get("enabled", True)))}
    app_id = body.get("appId", cur.get("appId"))
    if app_id:
        spec["appId"] = str(app_id)[:40]  # the catalog entry this server was connected from
    budget = body.get("outputBudget", cur.get("outputBudget", DEFAULT_BUDGET))
    if not isinstance(budget, int) or not 1000 <= budget <= 500_000:
        raise SpecError("the output budget is between 1000 and 500000 characters")
    spec["outputBudget"] = budget
    if transport == "stdio":
        command = str(body.get("command", cur.get("command", ""))).strip()
        if not command or "\0" in command or len(command) > 500:
            raise SpecError("a stdio server needs a command")
        args = body.get("args", cur.get("args", []))
        if not isinstance(args, list) or not all(isinstance(a, str) for a in args) or len(args) > 100:
            raise SpecError("args must be a list of text")
        env = _strings(body.get("env", cur.get("env")), "env")
        old = cur.get("env", {})
        spec.update(command=command, args=args, env={k: (old.get(k, "") if v == MASK else v) for k, v in env.items()})
        cwd = body.get("cwd", cur.get("cwd"))
        if cwd:
            spec["cwd"] = str(cwd)
    else:
        url = str(body.get("url", cur.get("url", ""))).strip()
        try:
            check_url(url, allow_loopback=True, allow_private=True)  # a server of your own may be on this machine or your network
        except BlockedAddress as e:
            raise SpecError(f"that address cannot be used: {e}") from e
        headers = _strings(body.get("headers", cur.get("headers")), "headers")
        old = cur.get("headers", {})
        spec.update(url=url, headers={k: (old.get(k, "") if v == MASK else v) for k, v in headers.items()})
    return spec


def public(server_id: str, spec: dict, status: Optional[dict] = None) -> dict:
    """What the UI may see: every secret value replaced by the mask."""
    out = {k: v for k, v in spec.items() if k not in ("env", "headers")}
    out["id"] = server_id
    if "env" in spec:
        out["env"] = {k: MASK for k in spec["env"]}
    if "headers" in spec:
        out["headers"] = {k: MASK for k in spec["headers"]}
    out["status"] = status or {"state": "unknown"}
    return out


def from_desktop_json(text: Any) -> list[dict]:
    """Specs from the JSON people copy out of Claude Desktop: {"mcpServers": {name: {command, args, env} | {url, headers}}}."""
    try:
        data = json.loads(text) if isinstance(text, str) else text
    except ValueError as e:
        raise SpecError("that is not valid JSON") from e
    servers = data.get("mcpServers", data) if isinstance(data, dict) else None
    if not isinstance(servers, dict) or not servers:
        raise SpecError('expected {"mcpServers": {"name": {...}}}')
    out = []
    for name, d in servers.items():
        if not isinstance(d, dict):
            raise SpecError(f"{name}: expected an object")
        if "url" in d:
            kind = str(d.get("type") or d.get("transport") or "http")
            out.append({"name": name, "transport": "sse" if kind == "sse" else "http", "url": d["url"], "headers": d.get("headers") or {}})
        else:
            out.append({"name": name, "transport": "stdio", "command": d.get("command", ""), "args": d.get("args") or [], "env": d.get("env") or {}})
    return out


class McpServers:
    def __init__(self, store, bus, data_dir: Path) -> None:
        self.store, self.bus, self.dir = store, bus, data_dir
        self.status: dict[str, dict] = {}

    # ---- storage ---------------------------------------------------------------------------------------------------------
    async def list(self) -> list[tuple[str, dict]]:
        cur = await self.store.db.execute("SELECT id, spec FROM mcp_servers ORDER BY created_at")
        return [(r[0], json.loads(r[1])) for r in await cur.fetchall()]

    async def get(self, server_id: str) -> Optional[dict]:
        cur = await self.store.db.execute("SELECT spec FROM mcp_servers WHERE id=?", (server_id,))
        r = await cur.fetchone()
        return json.loads(r[0]) if r else None

    async def create(self, body: dict) -> tuple[str, dict]:
        spec = clean(body)
        sid = new_id("mcp")
        await self.store.db.execute("INSERT INTO mcp_servers(id, name, spec, created_at) VALUES(?,?,?,?)", (sid, spec["name"], json.dumps(spec), now_ms()))
        await self.store.db.commit()
        self.changed(sid)
        return sid, spec

    async def update(self, server_id: str, body: dict) -> Optional[dict]:
        cur = await self.get(server_id)
        if cur is None:
            return None
        spec = clean(body, cur)
        if spec["transport"] != cur["transport"]:  # a different kind of server starts from its own fields
            spec = clean({**body, "env": body.get("env", {}), "headers": body.get("headers", {})}, {"name": cur["name"]})
        await self.store.db.execute("UPDATE mcp_servers SET name=?, spec=? WHERE id=?", (spec["name"], json.dumps(spec), server_id))
        await self.store.db.commit()
        self.status.pop(server_id, None)
        self.changed(server_id)
        return spec

    async def delete(self, server_id: str) -> bool:
        cur = await self.store.db.execute("DELETE FROM mcp_servers WHERE id=?", (server_id,))
        await self.store.db.commit()
        if not cur.rowcount:
            return False
        for bot in await self.store.list_bots():  # no bot keeps using a server that is gone
            if server_id in bot.mcpServers:
                bot.mcpServers = [s for s in bot.mcpServers if s != server_id]
                await self.store.save_bot(bot)
        self.status.pop(server_id, None)
        self.changed(server_id, deleted=True)
        return True

    def changed(self, server_id: str, deleted: bool = False) -> None:
        self.bus.publish({"kind": "mcp.changed", "serverId": server_id, "deleted": deleted})

    # ---- testing ---------------------------------------------------------------------------------------------------------
    async def test(self, spec: dict, server_id: Optional[str] = None) -> dict:
        r = await mcp_client.probe(spec)
        status = {"state": "ok" if r["ok"] else "failed", "at": now_ms(), "tools": r.get("tools", []), "error": r.get("error"), "server": r.get("server", {})}
        if server_id:
            self.status[server_id] = status
            self.changed(server_id)
        return status

    # ---- what a turn gets ------------------------------------------------------------------------------------------------
    @staticmethod
    def key_of(server_id: str, spec: dict) -> str:
        return "x_" + re.sub(r"[^A-Za-z0-9]+", "_", spec["name"]).strip("_")[:24] + "_" + server_id[-4:]

    async def allowed_prefixes(self, bot) -> tuple:
        """Tool prefixes the person let this bot use without asking: an app connected with write access and the send-out policy `allow`."""
        out = []
        for sid in bot.mcpServers:
            acc = bot.mcpAccess.get(sid) or {}
            spec = await self.get(sid)
            if spec and acc.get("scope") == "write" and acc.get("outbound") == "allow":
                out.append(f"mcp__{self.key_of(sid, spec)}__")
        return tuple(out)

    async def entries_for(self, server_ids: list[str], thread_id: str, access: Optional[dict] = None) -> dict[str, dict]:
        """mcpServers entries for the enabled servers among `server_ids`: each is the proxy, reading its spec from a private file."""
        entries: dict[str, dict] = {}
        for sid in server_ids:
            spec = await self.get(sid)
            if not spec or not spec.get("enabled", True):
                continue
            run = self.dir / "mcp-run" / re.sub(r"[^\w-]", "_", thread_id)
            run.mkdir(parents=True, exist_ok=True)
            path = run / f"{sid}.json"
            scope = ((access or {}).get(sid) or {}).get("scope")
            body = {**spec, "outputDir": str(self.dir / "mcp-output"), "readOnly": scope == "read"}
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf8") as f:
                json.dump(body, f)
            key = self.key_of(sid, spec)
            entries[key] = {"command": sys.executable, "args": ["-m", "botteam.mcp_proxy"], "env": {"PYTHONPATH": SERVER_DIR, "BT_MCP_SPEC_FILE": str(path)}}
        return entries

    def cleanup(self, thread_id: str) -> None:
        run = self.dir / "mcp-run" / re.sub(r"[^\w-]", "_", thread_id)
        if run.exists():
            for f in run.iterdir():
                try:
                    f.unlink()
                except OSError:
                    pass
            try:
                run.rmdir()
            except OSError:
                pass

    def sweep_output(self, older_than_days: int = 14) -> int:
        """Cut-off outputs are kept for a while, then removed."""
        out = self.dir / "mcp-output"
        if not out.exists():
            return 0
        gone = 0
        for f in out.iterdir():
            if time.time() - f.stat().st_mtime > older_than_days * 86400:
                f.unlink(missing_ok=True)
                gone += 1
        return gone
