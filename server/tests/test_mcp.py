"""Custom MCP servers: specs and their secrets, the connection test, the proxy a turn talks through, and what a bot is given."""
import json
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

from botteam.drivers.base import SendTurnInput
from botteam.drivers.claude import ClaudeDriver
from botteam.mcp_servers import MASK, SpecError, clean, from_desktop_json
from botteam.netguard import BlockedAddress, check_url

from .test_api import ctx, make_bot  # noqa: F401  (fixture)

FAKE = str(Path(__file__).with_name("fake_mcp.py"))
SECRET = "sk-very-secret-value"


def stdio_body(**extra):
    return {"name": "Fake", "transport": "stdio", "command": sys.executable, "args": [FAKE], "env": {"FAKE_TOKEN": SECRET}, **extra}


async def test_a_server_is_stored_and_its_secrets_are_never_returned(ctx):
    c, app = ctx
    made = (await c.post("/api/mcp/servers", json=stdio_body())).json()
    assert made["env"] == {"FAKE_TOKEN": MASK} and made["status"]["state"] == "unknown"
    assert SECRET not in (await c.get("/api/mcp/servers")).text and SECRET not in json.dumps(made)
    row = await app.state.mcp.get(made["id"])
    assert row["env"]["FAKE_TOKEN"] == SECRET  # stored for the turn
    # editing with the mask in place keeps the stored value; a new value replaces it
    kept = (await c.patch(f"/api/mcp/servers/{made['id']}", json={"name": "Renamed", "env": {"FAKE_TOKEN": MASK}})).json()
    assert kept["name"] == "Renamed" and (await app.state.mcp.get(made["id"]))["env"]["FAKE_TOKEN"] == SECRET
    await c.patch(f"/api/mcp/servers/{made['id']}", json={"env": {"FAKE_TOKEN": "new"}})
    assert (await app.state.mcp.get(made["id"]))["env"]["FAKE_TOKEN"] == "new"
    assert (await c.delete(f"/api/mcp/servers/{made['id']}")).status_code == 200
    assert (await c.delete(f"/api/mcp/servers/{made['id']}")).status_code == 404


async def test_the_connection_test_lists_the_tools_and_reports_failures(ctx):
    c, _ = ctx
    made = (await c.post("/api/mcp/servers", json=stdio_body())).json()
    ok = (await c.post(f"/api/mcp/servers/{made['id']}/test")).json()
    assert ok["state"] == "ok" and {t["name"] for t in ok["tools"]} == {"echo", "send", "big", "secret_env"} and ok["server"]["name"] == "fake"
    listed = (await c.get("/api/mcp/servers")).json()["servers"][0]
    assert listed["status"]["state"] == "ok"  # remembered for the list
    bad = (await c.post("/api/mcp/test", json={"name": "Nope", "transport": "stdio", "command": "definitely-not-a-command-xyz"})).json()
    assert bad["state"] == "failed" and bad["error"]


def test_specs_are_validated_and_remote_addresses_are_checked():
    with pytest.raises(SpecError):
        clean({"name": "", "transport": "stdio", "command": "x"})
    with pytest.raises(SpecError):
        clean({"name": "A", "transport": "stdio", "command": ""})
    with pytest.raises(SpecError):
        clean({"name": "A", "transport": "ftp", "command": "x"})
    with pytest.raises(SpecError):
        clean({"name": "A", "transport": "http", "url": "http://169.254.169.254/latest/meta-data"})  # cloud metadata
    with pytest.raises(SpecError):
        clean({"name": "A", "transport": "http", "url": "file:///etc/passwd"})
    with pytest.raises(SpecError):
        clean({"name": "A", "transport": "http", "url": "https://user:pw@example.com/mcp"})
    ok = clean({"name": "A", "transport": "http", "url": "http://127.0.0.1:9000/mcp", "headers": {"Authorization": "Bearer x"}})  # a server on this machine
    assert ok["headers"] == {"Authorization": "Bearer x"}
    with pytest.raises(BlockedAddress):
        check_url("http://127.0.0.1/x")  # an import may not reach the machine itself
    with pytest.raises(BlockedAddress):
        check_url("http://10.0.0.5/x")


async def test_pasted_claude_desktop_json_makes_every_server_or_none(ctx):
    c, _ = ctx
    good = {"mcpServers": {"files": {"command": "npx", "args": ["-y", "server-filesystem", "."], "env": {"A": "1"}}, "web": {"url": "https://example.com/mcp", "headers": {"X-Key": "k"}}}}
    made = (await c.post("/api/mcp/import", json={"json": json.dumps(good)})).json()["servers"]
    assert {m["name"]: m["transport"] for m in made} == {"files": "stdio", "web": "http"}
    assert made[1]["headers"] == {"X-Key": MASK}
    bad = {"mcpServers": {"ok": {"command": "x"}, "broken": {"url": "http://169.254.169.254/"}}}
    assert (await c.post("/api/mcp/import", json={"json": json.dumps(bad)})).status_code == 400
    assert len((await c.get("/api/mcp/servers")).json()["servers"]) == 2  # nothing from the bad paste
    assert (await c.post("/api/mcp/import", json={"json": "not json"})).status_code == 400
    assert from_desktop_json({"x": {"command": "c"}})[0]["name"] == "x"


async def test_a_bot_picks_servers_and_losing_one_unpicks_it(ctx):
    c, _ = ctx
    bot = await make_bot(c)
    made = (await c.post("/api/mcp/servers", json=stdio_body())).json()
    assert (await c.patch(f"/api/bots/{bot['id']}", json={"mcpServers": ["mcp_nope"]})).status_code == 404
    assert (await c.patch(f"/api/bots/{bot['id']}", json={"mcpServers": [made["id"]]})).json()["mcpServers"] == [made["id"]]
    await c.delete(f"/api/mcp/servers/{made['id']}")
    mine = next(b for b in (await c.get("/api/bots")).json()["bots"] if b["id"] == bot["id"])
    assert mine["mcpServers"] == []


async def test_a_turn_gets_the_proxy_with_its_spec_in_a_private_file(ctx):
    c, app = ctx
    made = (await c.post("/api/mcp/servers", json=stdio_body())).json()
    entries = await app.state.mcp.entries_for([made["id"]], "th_1")
    (key, entry), = entries.items()
    assert key.startswith("x_Fake_") and entry["args"] == ["-m", "botteam.mcp_proxy"]
    assert SECRET not in json.dumps(entry), "a secret must not be on a command line or in the environment block"
    spec_path = Path(entry["env"]["BT_MCP_SPEC_FILE"])
    assert json.loads(spec_path.read_text())["env"]["FAKE_TOKEN"] == SECRET
    if os.name != "nt":
        assert stat.S_IMODE(spec_path.stat().st_mode) == 0o600
    await c.patch(f"/api/mcp/servers/{made['id']}", json={"enabled": False})
    assert await app.state.mcp.entries_for([made["id"]], "th_1") == {}  # a switched-off server is not given
    app.state.mcp.cleanup("th_1")
    assert not spec_path.exists()


def run_proxy(spec_file: Path, messages: list[dict]) -> list[dict]:
    env = {**os.environ, "BT_MCP_SPEC_FILE": str(spec_file), "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
    out = subprocess.run([sys.executable, "-m", "botteam.mcp_proxy"], input="\n".join(json.dumps(m) for m in messages) + "\n", capture_output=True, text=True, env=env, timeout=60)
    return [json.loads(l) for l in out.stdout.splitlines() if l.strip()]


async def test_the_proxy_relays_the_server_cuts_long_results_and_keeps_the_full_text(ctx, tmp_path):
    c, app = ctx
    made = (await c.post("/api/mcp/servers", json=stdio_body(outputBudget=1000))).json()
    (_, entry), = (await app.state.mcp.entries_for([made["id"]], "th_2")).items()
    spec_file = Path(entry["env"]["BT_MCP_SPEC_FILE"])
    init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}}
    replies = {r["id"]: r for r in run_proxy(spec_file, [
        init, {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "echo", "arguments": {"text": "hi"}}},
        {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "big", "arguments": {"n": 50000}}},
        {"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "secret_env"}},
    ])}
    assert {t["name"] for t in replies[2]["result"]["tools"]} == {"echo", "send", "big", "secret_env"}
    assert replies[3]["result"]["content"][0]["text"] == "echo: hi"  # a short result passes through untouched
    assert replies[5]["result"]["content"][0]["text"] == "set"  # the secret reached the server's environment
    big = replies[4]["result"]["content"]
    assert len(big[0]["text"]) == 1000 and "Output cut: 50000 characters" in big[1]["text"]
    saved = Path(big[1]["text"].rsplit(" in ", 1)[1].rstrip("]"))
    assert saved.read_text() == "x" * 50000 and saved.parent == tmp_path / "mcp-output"


def test_claude_gets_the_servers_through_a_config_file_not_the_command_line():
    class Broker:
        port, token = 4321, "broker-token-xyz"

    d = ClaudeDriver("claude", broker=Broker())
    inp = SendTurnInput(thread_id="th_9", bot_id="b", text="hi", custom_mcp={"x_Fake_1": {"command": "python", "args": ["-m", "botteam.mcp_proxy"], "env": {"BT_MCP_SPEC_FILE": "f"}}})
    args = d.build_args(inp, None)
    assert "--strict-mcp-config" in args
    path = args[args.index("--mcp-config") + 1]
    assert not path.lstrip().startswith("{"), "the configuration is a file, not an inline string"
    assert "broker-token-xyz" not in " ".join(args)
    cfg = json.loads(Path(path).read_text())
    assert set(cfg["mcpServers"]) == {"bt", "x_Fake_1"}
    assert args[args.index("--permission-prompt-tool") + 1] == "mcp__bt__approve"  # their tools are asked about like any other


async def test_a_remote_server_is_reached_with_its_headers_and_a_wrong_header_fails(ctx):
    import asyncio
    import socket

    import uvicorn
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse

    remote = FastAPI()

    @remote.post("/mcp")
    async def mcp_endpoint(request: Request):
        if request.headers.get("authorization") != "Bearer remote-secret":
            return JSONResponse({"error": "nope"}, status_code=401)
        m = await request.json()
        if "id" not in m:
            return JSONResponse({}, status_code=202)
        res = {"initialize": {"protocolVersion": "2025-03-26", "capabilities": {}, "serverInfo": {"name": "remote", "version": "2"}},
               "tools/list": {"tools": [{"name": "ping", "description": "p", "inputSchema": {"type": "object"}}]}}.get(m["method"], {})
        return JSONResponse({"jsonrpc": "2.0", "id": m["id"], "result": res}, headers={"mcp-session-id": "s1"})

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(remote, host="127.0.0.1", port=port, log_level="error", loop="asyncio"))
    task = asyncio.create_task(server.serve())
    for _ in range(100):
        if server.started:
            break
        await asyncio.sleep(0.05)
    try:
        c, _ = ctx
        url = f"http://127.0.0.1:{port}/mcp"
        good = (await c.post("/api/mcp/test", json={"name": "R", "transport": "http", "url": url, "headers": {"Authorization": "Bearer remote-secret"}})).json()
        assert good["state"] == "ok" and good["tools"][0]["name"] == "ping" and good["server"]["name"] == "remote"
        bad = (await c.post("/api/mcp/test", json={"name": "R", "transport": "http", "url": url, "headers": {"Authorization": "Bearer wrong"}})).json()
        assert bad["state"] == "failed" and "401" in bad["error"]
    finally:
        server.should_exit = True
        await task


async def test_connected_apps_have_a_read_or_write_scope_and_a_send_out_policy(ctx):
    from botteam.broker import Policy

    c, app = ctx
    bot = await make_bot(c)
    made = (await c.post("/api/mcp/servers", json=stdio_body())).json()
    sid = made["id"]
    assert (await c.patch(f"/api/bots/{bot['id']}", json={"mcpServers": [sid], "mcpAccess": {sid: {"scope": "admin"}}})).status_code == 400
    ok = (await c.patch(f"/api/bots/{bot['id']}", json={"mcpServers": [sid], "mcpAccess": {sid: {"scope": "read"}}})).json()
    assert ok["mcpAccess"][sid] == {"scope": "read", "outbound": "ask"}
    # read: only tools that declare themselves read-only are shown, and nothing else can be called
    (_, entry), = (await app.state.mcp.entries_for([sid], "th_ro", ok["mcpAccess"])).items()
    spec_file = Path(entry["env"]["BT_MCP_SPEC_FILE"])
    init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}}
    replies = {r["id"]: r for r in run_proxy(spec_file, [init, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                                                         {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "send", "arguments": {}}},
                                                         {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "echo", "arguments": {"text": "x"}}}])}
    assert [t["name"] for t in replies[2]["result"]["tools"]] == ["echo"]
    assert replies[3]["result"]["isError"] is True and "read-only" in replies[3]["result"]["content"][0]["text"]
    assert replies[4]["result"]["content"][0]["text"] == "echo: x"
    # write + ask: sending still goes to the person; write + allow: it does not
    key = app.state.mcp.key_of(sid, await app.state.mcp.get(sid))
    mine = await app.state.store.get_bot(bot["id"])
    assert await app.state.mcp.allowed_prefixes(mine) == ()
    await c.patch(f"/api/bots/{bot['id']}", json={"mcpAccess": {sid: {"scope": "write", "outbound": "ask"}}})
    assert await app.state.mcp.allowed_prefixes(await app.state.store.get_bot(bot["id"])) == ()
    await c.patch(f"/api/bots/{bot['id']}", json={"mcpAccess": {sid: {"scope": "write", "outbound": "allow"}}})
    prefixes = await app.state.mcp.allowed_prefixes(await app.state.store.get_bot(bot["id"]))
    assert prefixes == (f"mcp__{key}__",)
    broker = app.state.turns.broker
    asking = Policy(mode="ask", cwd="/", instance="claude")
    assert broker._auto(asking, f"mcp__{key}__send", {}) is None  # a custom server's tool is asked about
    assert broker._auto(Policy(mode="ask", cwd="/", instance="claude", allow_prefixes=prefixes), f"mcp__{key}__send", {})["behavior"] == "allow"
    assert broker._auto(Policy(mode="ask", cwd="/", instance="claude", allow_prefixes=prefixes), "mcp__other__send", {}) is None
