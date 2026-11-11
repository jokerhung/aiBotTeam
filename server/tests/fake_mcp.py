"""A tiny stdio MCP server for tests: tools `echo`, `big` (a long result) and `secret_env` (reports whether an env value is set)."""
import json
import os
import sys

TOOLS = [
    {"name": "echo", "description": "Echo the text back", "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}}, "annotations": {"readOnlyHint": True}},
    {"name": "send", "description": "Send something out", "inputSchema": {"type": "object"}},
    {"name": "big", "description": "A very long result", "inputSchema": {"type": "object", "properties": {"n": {"type": "integer"}}}},
    {"name": "secret_env", "description": "Is FAKE_TOKEN set", "inputSchema": {"type": "object"}},
]

for line in sys.stdin:
    try:
        m = json.loads(line)
    except ValueError:
        continue
    if "id" not in m:
        continue
    method, params = m.get("method"), m.get("params") or {}
    if method == "initialize":
        res = {"protocolVersion": "2025-03-26", "capabilities": {"tools": {}}, "serverInfo": {"name": "fake", "version": "1"}}
    elif method == "tools/list":
        res = {"tools": TOOLS}
    elif method == "tools/call":
        name, args = params.get("name"), params.get("arguments") or {}
        if name == "echo":
            res = {"content": [{"type": "text", "text": f"echo: {args.get('text', '')}"}]}
        elif name == "send":
            res = {"content": [{"type": "text", "text": "sent"}]}
        elif name == "big":
            res = {"content": [{"type": "text", "text": "x" * int(args.get("n", 50000))}]}
        else:
            res = {"content": [{"type": "text", "text": "set" if os.environ.get("FAKE_TOKEN") else "unset"}]}
    else:
        sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": m["id"], "error": {"code": -32601, "message": "no such method"}}) + "\n")
        sys.stdout.flush()
        continue
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": res}) + "\n")
    sys.stdout.flush()
