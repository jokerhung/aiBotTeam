"""BotTeam as an MCP server (stdio), for Claude Desktop, Cursor and the like: look at the team, read and search transcripts, make bots,
rooms and tasks, hand work out, wait for it, change a model, stop a turn.

It talks to a running BotTeam through its API and exposes no way to answer an approval, delete anything, change settings, read a key
or touch connections: what an outside tool may do is only what is listed here.

    BOTTEAM_URL   where BotTeam listens (default http://127.0.0.1:8899)
"""
from __future__ import annotations

import json
import os
import sys
import time
from typing import Any

import httpx

URL = os.environ.get("BOTTEAM_URL", "http://127.0.0.1:8899").rstrip("/")


def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or []}


S = {"type": "string"}
TOOLS: list[dict] = [
    {"name": "list_bots", "description": "The bots on this team: id, name, title, whether each is busy or waiting for the person.", "inputSchema": _obj({})},
    {"name": "list_rooms", "description": "The rooms (group chats) and their members.", "inputSchema": _obj({})},
    {"name": "read_transcript", "description": "The latest messages of a bot's or room's conversation.", "inputSchema": _obj({"target": S, "thread": S, "limit": {"type": "integer"}}, ["target"])},
    {"name": "search", "description": "Search the text of every conversation.", "inputSchema": _obj({"query": S}, ["query"])},
    {"name": "create_bot", "description": "Make a new bot (it starts at the Ask approval level).", "inputSchema": _obj({"name": S, "title": S, "description": S}, ["name"])},
    {"name": "create_room", "description": "Make a room with these bots (names or ids) as members.", "inputSchema": _obj({"name": S, "members": {"type": "array", "items": S}}, ["name", "members"])},
    {"name": "create_task", "description": "Open a new conversation (task) on a bot; returns its thread id.", "inputSchema": _obj({"bot": S, "title": S}, ["bot"])},
    {"name": "send", "description": "Send work to a bot or room and return at once; use wait to get the result.", "inputSchema": _obj({"target": S, "text": S, "thread": S}, ["target", "text"])},
    {"name": "wait", "description": "Wait until a bot or room has finished its turn (up to timeout_s seconds) and return its last reply.", "inputSchema": _obj({"target": S, "timeout_s": {"type": "integer"}}, ["target"])},
    {"name": "set_model", "description": "Change the model a bot uses.", "inputSchema": _obj({"bot": S, "instance_id": S, "model": S}, ["bot", "instance_id", "model"])},
    {"name": "interrupt", "description": "Stop the turn a bot or room is running.", "inputSchema": _obj({"target": S}, ["target"])},
]


class Api:
    def __init__(self, url: str = URL) -> None:
        self.c = httpx.Client(base_url=url, timeout=60)

    def call(self, method: str, path: str, body: dict | None = None) -> Any:
        r = self.c.request(method, path, json=body)
        if r.status_code >= 400:
            try:
                detail = r.json().get("detail")
            except ValueError:
                detail = r.text[:200]
            raise RuntimeError(f"{detail or r.status_code}")
        return r.json() if r.content else {}


def find(api: Api, ref: str) -> tuple[str, dict]:
    """("bot" | "room", record) by id or name."""
    ref = (ref or "").strip()
    for b in api.call("GET", "/api/bots")["bots"]:
        if ref in (b["id"], ) or b["name"].lower() == ref.lower():
            return "bot", b
    for g in api.call("GET", "/api/groups")["groups"]:
        if ref in (g["id"], ) or g["name"].lower() == ref.lower():
            return "room", g
    raise RuntimeError(f"no bot or room called {ref!r}")


def _path(kind: str, rec: dict, tail: str) -> str:
    return f"/api/{'bots' if kind == 'bot' else 'groups'}/{rec['id']}/{tail}"


def last_reply(api: Api, kind: str, rec: dict, thread: str | None = None) -> str:
    msgs = api.call("GET", _path(kind, rec, "messages") + (f"?thread={thread}" if thread else ""))["messages"]
    for m in reversed(msgs):
        if m["role"] == "bot" and m["kind"] == "text" and m["text"]:
            return m["text"]
    return ""


def tool(api: Api, name: str, a: dict) -> Any:
    if name == "list_bots":
        return [{"id": b["id"], "name": b["name"], "title": b["title"], "busy": b["busy"], "needsYou": b["activity"] == "waiting-on-you"} for b in api.call("GET", "/api/bots")["bots"]]
    if name == "list_rooms":
        return [{"id": g["id"], "name": g["name"], "members": [m["name"] for m in g["memberInfo"]], "busy": g["busy"]} for g in api.call("GET", "/api/groups")["groups"]]
    if name == "read_transcript":
        kind, rec = find(api, a["target"])
        msgs = api.call("GET", _path(kind, rec, "messages") + (f"?thread={a['thread']}" if a.get("thread") else ""))["messages"]
        return [{"role": m["role"], "kind": m["kind"], "text": m["text"], "at": m["at"]} for m in msgs[-int(a.get("limit") or 30):] if m["text"]]
    if name == "search":
        return api.c.get("/api/search", params={"q": a["query"]}).json().get("results", [])[:30]
    if name == "create_bot":
        b = api.call("POST", "/api/bots", {"name": a["name"], "title": a.get("title", ""), "description": a.get("description", ""), "approvalMode": "ask"})
        return {"id": b["id"], "name": b["name"]}
    if name == "create_room":
        ids = [find(api, m)[1]["id"] for m in a["members"]]
        g = api.call("POST", "/api/groups", {"name": a["name"], "members": ids})
        return {"id": g["id"], "name": g["name"]}
    if name == "create_task":
        kind, rec = find(api, a["bot"])
        t = api.call("POST", f"/api/bots/{rec['id']}/tasks", {"title": a.get("title", "")})
        return {"threadId": t["threadId"]}
    if name == "send":
        kind, rec = find(api, a["target"])
        api.call("POST", _path(kind, rec, "messages"), {"text": a["text"], **({"threadId": a["thread"]} if a.get("thread") else {})})
        return {"sent": True, "target": rec["name"]}
    if name == "wait":
        kind, rec = find(api, a["target"])
        deadline = time.time() + max(1, min(int(a.get("timeout_s") or 120), 3600))
        time.sleep(0.5)
        while time.time() < deadline:
            cur = find(api, rec["id"])[1]
            if cur.get("activity") == "waiting-on-you":
                return {"done": False, "waitingForPerson": True, "reply": last_reply(api, kind, rec)}
            if not cur["busy"]:
                return {"done": True, "reply": last_reply(api, kind, rec)}
            time.sleep(0.5)
        return {"done": False, "timedOut": True}
    if name == "set_model":
        _, rec = find(api, a["bot"])
        api.call("PATCH", f"/api/bots/{rec['id']}", {"modelSelection": {"instanceId": a["instance_id"], "model": a["model"]}})
        return {"ok": True}
    if name == "interrupt":
        kind, rec = find(api, a["target"])
        api.call("POST", _path(kind, rec, "interrupt"))
        return {"ok": True}
    raise RuntimeError(f"no tool {name}")


def handle(api: Api, msg: dict) -> dict | None:
    method, mid = msg.get("method"), msg.get("id")
    if method == "initialize":
        return {"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": (msg.get("params") or {}).get("protocolVersion", "2024-11-05"), "capabilities": {"tools": {}},
                                                       "serverInfo": {"name": "botteam", "version": "0.1.0"}}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": mid, "result": {"tools": TOOLS}}
    if method == "tools/call":
        p = msg.get("params") or {}
        try:
            out = tool(api, str(p.get("name")), p.get("arguments") or {})
            return {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": json.dumps(out, ensure_ascii=False)}]}}
        except (RuntimeError, httpx.HTTPError, KeyError) as e:
            return {"jsonrpc": "2.0", "id": mid, "result": {"isError": True, "content": [{"type": "text", "text": f"{e.__class__.__name__}: {e}" if isinstance(e, KeyError) else str(e)}]}}
    if mid is not None and not str(method or "").startswith("notifications/"):
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}}
    return None


def main() -> None:
    api = Api()
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        out = handle(api, msg)
        if out is not None:
            sys.stdout.write(json.dumps(out) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
