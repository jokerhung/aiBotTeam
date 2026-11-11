"""The stdio MCP server a turn talks to in place of a custom server.

It relays everything to the real server (stdio, HTTP or SSE) and does two things on the way: a tool result longer than the server's
character budget is cut, the full text going to a file the bot can read; and the server's secrets (environment values, header values)
never appear on a command line, because the spec comes from a private file named in BT_MCP_SPEC_FILE.

stdout is the MCP channel: nothing else may print to it.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path

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


def send(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


async def main() -> None:
    spec = json.loads(Path(os.environ["BT_MCP_SPEC_FILE"]).read_text(encoding="utf8"))
    budget = int(spec.get("outputBudget") or DEFAULT_BUDGET)
    out_dir = Path(spec.get("outputDir") or ".")
    read_only = bool(spec.get("readOnly"))
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
            if read_only and method == "tools/call":
                await learn()
            if read_only and method == "tools/call" and (msg.get("params") or {}).get("name") not in allowed:
                send({"jsonrpc": "2.0", "id": id_, "result": {"isError": True, "content": [{"type": "text", "text": "This app is connected read-only for this bot, so this action is not available."}]}})
                return
            r = await conn.request(method or "", msg.get("params"), timeout=300.0)
            if read_only and method == "tools/list" and "result" in r:  # only the tools that declare themselves read-only are shown, and callable
                shown = [t for t in r["result"].get("tools", []) if (t.get("annotations") or {}).get("readOnlyHint") is True]
                r = {**r, "result": {**r["result"], "tools": shown}}
            if method == "tools/call" and "result" in r:
                r = {**r, "result": cut(r["result"], budget, out_dir, str((msg.get("params") or {}).get("name", "tool")))}
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
