"""The stdio MCP server a turn talks to in place of a custom server.

It relays everything to the real server (stdio, HTTP or SSE) and does two things on the way: a tool result longer than the server's
character budget is cut, the full text going to a file the bot can read; and the server's secrets (environment values, header values)
never appear on a command line, because the spec comes from a private file named in BT_MCP_SPEC_FILE.

stdout is the MCP channel: nothing else may print to it.
"""
from __future__ import annotations

import asyncio
import fnmatch
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Optional

from .mcp_client import McpError, connect

DEFAULT_BUDGET = 20_000


def cut(result: dict, budget: int, out_dir: Path, name: str) -> dict:
    """The tool result with its text capped at `budget` characters; the full text saved under out_dir when it was cut."""
    content = result.get("content")
    if not isinstance(content, list):
        return result
    texts = [(i, c.get("text", "")) for i, c in enumerate(content) if isinstance(c, dict) and c.get("type") == "text" and isinstance(c.get("text"), str)]
    total = sum(len(t) for _, t in texts)
    if total <= budget:
        return result
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{''.join(ch if ch.isalnum() else '_' for ch in name)[:40]}-{int(time.time() * 1000)}.txt"
    path.write_text("\n".join(t for _, t in texts), encoding="utf8")
    left = budget
    cut_content = list(content)
    for i, t in texts:
        keep = t[: max(left, 0)]
        left -= len(t)
        cut_content[i] = {**content[i], "text": keep}
    note = f"[Output cut: {total} characters, only the first {budget} are shown. The full output is in {path}]"
    cut_content.append({"type": "text", "text": note})
    return {**result, "content": cut_content}


# With an allowlist the bot reaches an app only through these three Composio meta-tools (never its shell, workbench or connection management),
# and every tool a MULTI_EXECUTE call names must match one of the patterns.
COMPOSIO_SAFE_META = {"COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS", "COMPOSIO_MULTI_EXECUTE_TOOL"}
COMPOSIO_RUN = "COMPOSIO_MULTI_EXECUTE_TOOL"


def refusal(allow: list[str], params: dict) -> Optional[str]:
    """Why a tool call is not allowed for a bot with an allowlist of tool patterns; None when it is."""
    name = str(params.get("name", ""))
    args = params.get("arguments") or {}

    def ok(slug: str) -> bool:
        return any(fnmatch.fnmatchcase(slug.upper(), pat.upper()) for pat in allow)

    if name == COMPOSIO_RUN:
        slugs = [str((t or {}).get("tool_slug", "")) for t in (args.get("tools") or []) if isinstance(t, dict)] if isinstance(args, dict) else []
        bad = [x for x in slugs if not ok(x)]
        if not slugs or bad:
            return f"This bot may only use: {', '.join(allow)}. {'Not allowed: ' + ', '.join(bad) + '.' if bad else ''}".strip()
        return None
    if name in COMPOSIO_SAFE_META:
        return None
    if name.startswith("COMPOSIO_") or not ok(name):
        return f"This bot may only use: {', '.join(allow)}."
    return None


# ---- answers kept for a while ----------------------------------------------------------------------------------------------------------
# A bot with an allowlist (so, only reads) may have its tool answers kept for `cacheSeconds`: the same call within that time gets the saved
# answer instead of asking the server again. The time runs from when the answer was fetched, never from when it was last used, so after the
# time the next call fetches again. The files are shared by every turn of every bot that uses the server (each turn has its own proxy).

def cache_key(params: dict) -> str:
    name, args = str(params.get("name", "")), params.get("arguments") or {}
    if not isinstance(args, dict):
        args = {}
    if name == COMPOSIO_RUN:  # the call's own notes (thought, session, memory) differ every time and do not change the answer
        material = ["run", [{"tool": (t or {}).get("tool_slug"), "arguments": (t or {}).get("arguments")} for t in args.get("tools") or [] if isinstance(t, dict)]]
    elif name == "COMPOSIO_SEARCH_TOOLS":
        material = ["search", args.get("queries")]
    elif name == "COMPOSIO_GET_TOOL_SCHEMAS":
        material = ["schemas", args.get("tool_slugs") or args.get("tools")]
    else:
        material = [name, args]
    return hashlib.sha256(json.dumps(material, sort_keys=True, ensure_ascii=False, default=str).encode("utf8")).hexdigest()


def cacheable(result: dict) -> bool:
    """Only an answer that worked is kept (an error, or a Composio run with a failed step, is asked again next time)."""
    if not isinstance(result, dict) or result.get("isError"):
        return False
    for part in result.get("content") or []:
        if isinstance(part, dict) and part.get("type") == "text":
            try:
                body = json.loads(part.get("text") or "")
            except ValueError:
                continue
            if isinstance(body, dict) and body.get("successful") is False:
                return False
            for r in ((body.get("data") or {}).get("results") or []) if isinstance(body, dict) and isinstance(body.get("data"), dict) else []:
                if isinstance(r, dict) and isinstance(r.get("response"), dict) and r["response"].get("successful") is False:
                    return False
    return True


def cache_read(directory: Path, key: str, seconds: int, now: Optional[float] = None) -> Optional[dict]:
    try:
        entry = json.loads((directory / f"{key}.json").read_text(encoding="utf8"))
    except (OSError, ValueError):
        return None
    if not isinstance(entry, dict) or (now if now is not None else time.time()) - float(entry.get("at", 0)) >= seconds:
        return None
    return entry.get("result") if isinstance(entry.get("result"), dict) else None


def cache_write(directory: Path, key: str, result: dict, now: Optional[float] = None) -> None:
    try:
        directory.mkdir(parents=True, exist_ok=True)
        tmp = directory / f".{key}.{os.getpid()}.tmp"
        tmp.write_text(json.dumps({"at": now if now is not None else time.time(), "result": result}, ensure_ascii=False), encoding="utf8")
        os.replace(tmp, directory / f"{key}.json")
    except OSError:
        pass  # a cache that cannot be written is just a cache that is empty


def send(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


async def main() -> None:
    spec = json.loads(Path(os.environ["BT_MCP_SPEC_FILE"]).read_text(encoding="utf8"))
    budget = int(spec.get("outputBudget") or DEFAULT_BUDGET)
    out_dir = Path(spec.get("outputDir") or ".")
    read_only = bool(spec.get("readOnly"))
    allow = [str(x) for x in (spec.get("allowTools") or []) if isinstance(x, str)]
    cache_secs = int(spec.get("cacheSeconds") or 0) if allow and spec.get("cacheDir") else 0  # only a bot that can only read keeps answers
    cache_dir = Path(spec["cacheDir"]) if cache_secs else None
    conn = connect(spec)
    await conn.open()
    allowed: set[str] = set()  # tool names a read-only connection may call (those that declare themselves read-only)
    learned = asyncio.Lock()
    known = {"done": False}

    async def learn() -> None:
        """The read-only tool names, from the server itself: a call may arrive before (or without) the client listing the tools."""
        async with learned:
            if not known["done"]:
                r = await conn.request("tools/list", {})
                allowed.update(t.get("name", "") for t in r.get("result", {}).get("tools", []) if (t.get("annotations") or {}).get("readOnlyHint") is True)
                known["done"] = True
    loop = asyncio.get_running_loop()
    tasks: set[asyncio.Task] = set()

    async def handle(msg: dict) -> None:
        id_, method = msg.get("id"), msg.get("method")
        try:
            if id_ is None:
                await conn.notify(method or "", msg.get("params"))
                return
            if allow and method == "tools/call":
                why = refusal(allow, msg.get("params") or {})
                if why:
                    send({"jsonrpc": "2.0", "id": id_, "result": {"isError": True, "content": [{"type": "text", "text": why}]}})
                    return
            if read_only and method == "tools/call":
                await learn()
            if read_only and method == "tools/call" and (msg.get("params") or {}).get("name") not in allowed:
                send({"jsonrpc": "2.0", "id": id_, "result": {"isError": True, "content": [{"type": "text", "text": "This app is connected read-only for this bot, so this action is not available."}]}})
                return
            key = cache_key(msg.get("params") or {}) if cache_secs and method == "tools/call" else None
            if key and cache_dir:
                kept = cache_read(cache_dir, key, cache_secs)
                if kept is not None:
                    send({"jsonrpc": "2.0", "id": id_, "result": kept})
                    return
            r = await conn.request(method or "", msg.get("params"), timeout=300.0)
            if read_only and method == "tools/list" and "result" in r:  # only the tools that declare themselves read-only are shown, and callable
                shown = [t for t in r["result"].get("tools", []) if (t.get("annotations") or {}).get("readOnlyHint") is True]
                r = {**r, "result": {**r["result"], "tools": shown}}
            if allow and method == "tools/list" and "result" in r:  # only what the bot may use is shown
                shown = [t for t in r["result"].get("tools", []) if t.get("name") in COMPOSIO_SAFE_META or (not str(t.get("name", "")).startswith("COMPOSIO_") and refusal(allow, {"name": t.get("name")}) is None)]
                r = {**r, "result": {**r["result"], "tools": shown}}
            if method == "tools/call" and "result" in r:
                r = {**r, "result": cut(r["result"], budget, out_dir, str((msg.get("params") or {}).get("name", "tool")))}
                if key and cache_dir and cacheable(r["result"]):
                    cache_write(cache_dir, key, r["result"])
            send({"jsonrpc": "2.0", "id": id_, **{k: v for k, v in r.items() if k in ("result", "error")}})
        except McpError as e:
            if id_ is not None:
                send({"jsonrpc": "2.0", "id": id_, "error": {"code": -32000, "message": str(e)}})

    try:
        while line := await loop.run_in_executor(None, sys.stdin.buffer.readline):  # a thread: stdin is not an asyncio pipe on every platform
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if isinstance(msg, dict):
                t = asyncio.create_task(handle(msg))
                tasks.add(t)
                t.add_done_callback(tasks.discard)
    finally:
        if tasks:  # the client has gone: answer what was already asked before closing
            await asyncio.wait(tasks, timeout=60)
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
