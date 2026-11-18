"""A bot that talks to strangers (an answering bot on a messaging channel) may use only the tools it is given by name: for an app reached through
Composio that is the search, schema and run meta-tools, and every tool a run names has to match the allowlist."""
import json

from botteam.mcp_proxy import refusal

from .test_api import ctx, make_bot  # noqa: F401  (fixture)

ALLOW = ["GOOGLESHEETS_VALUES_GET", "GOOGLESHEETS_SEARCH_SPREADSHEETS", "GOOGLESHEETS_GET_SHEET_NAMES"]


def run(*slugs):
    return {"name": "COMPOSIO_MULTI_EXECUTE_TOOL", "arguments": {"tools": [{"tool_slug": s, "arguments": {}} for s in slugs]}}


def test_only_the_listed_tools_can_be_run_and_nothing_else_is_reachable():
    assert refusal(ALLOW, run("GOOGLESHEETS_VALUES_GET")) is None
    assert refusal(ALLOW, run("googlesheets_values_get", "GOOGLESHEETS_GET_SHEET_NAMES")) is None  # case does not matter
    for slug in ("GOOGLESHEETS_VALUES_UPDATE", "GOOGLESHEETS_BATCH_UPDATE", "GMAIL_SEND_EMAIL", "GOOGLEDRIVE_DELETE_FILE"):
        assert "Not allowed" in (refusal(ALLOW, run("GOOGLESHEETS_VALUES_GET", slug)) or ""), slug  # one bad tool refuses the whole run
    assert refusal(ALLOW, run()) is not None and refusal(ALLOW, {"name": "COMPOSIO_MULTI_EXECUTE_TOOL", "arguments": "x"}) is not None
    for meta in ("COMPOSIO_REMOTE_BASH_TOOL", "COMPOSIO_REMOTE_WORKBENCH", "COMPOSIO_MANAGE_CONNECTIONS", "COMPOSIO_WAIT_FOR_CONNECTIONS"):
        assert refusal(ALLOW, {"name": meta, "arguments": {}}) is not None, meta  # no shell, no code, no changing connections
    for meta in ("COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS"):
        assert refusal(ALLOW, {"name": meta, "arguments": {}}) is None
    assert refusal(["GOOGLESHEETS_*"], run("GOOGLESHEETS_VALUES_UPDATE")) is None  # a pattern is the person's choice
    assert refusal(["send"], {"name": "send", "arguments": {}}) is None and refusal(["send"], {"name": "delete", "arguments": {}}) is not None  # any other server: by tool name


async def test_the_allowlist_is_validated_kept_and_handed_to_the_proxy(ctx, tmp_path):
    c, app = ctx
    bot = await make_bot(c, "Answerer")
    sid, _ = await app.state.mcp.create({"name": "Composio", "transport": "http", "url": "http://127.0.0.1:9/mcp", "appId": "composio"})
    bad = await c.patch(f"/api/bots/{bot['id']}", json={"mcpServers": [sid], "mcpAccess": {sid: {"scope": "write", "outbound": "allow", "allowTools": ["ok", "rm -rf /"]}}})
    assert bad.status_code == 400
    good = await c.patch(f"/api/bots/{bot['id']}", json={"mcpServers": [sid], "mcpAccess": {sid: {"scope": "write", "outbound": "allow", "allowTools": ALLOW}}})
    assert good.status_code == 200 and good.json()["mcpAccess"][sid]["allowTools"] == ALLOW
    entries = await app.state.mcp.entries_for([sid], bot["threadId"], {sid: {"scope": "write", "allowTools": ALLOW}})
    spec_file = next(iter(entries.values()))["env"]["BT_MCP_SPEC_FILE"]
    assert json.loads(open(spec_file, encoding="utf8").read())["allowTools"] == ALLOW


def test_the_cache_key_ignores_the_notes_of_a_call_and_only_good_answers_are_kept(tmp_path):
    from botteam.mcp_proxy import cache_key, cache_read, cache_write, cacheable

    run = lambda thought, session: {"name": "COMPOSIO_MULTI_EXECUTE_TOOL", "arguments": {"tools": [{"tool_slug": "GOOGLESHEETS_VALUES_GET", "arguments": {"range": "A1:B9"}}],
                                                                                          "thought": thought, "session_id": session, "memory": {"x": thought}}}
    assert cache_key(run("one", "s1")) == cache_key(run("two", "s2"))
    other = run("one", "s1")
    other["arguments"]["tools"][0]["arguments"]["range"] = "A1:B10"
    assert cache_key(other) != cache_key(run("one", "s1"))
    ok = {"content": [{"type": "text", "text": json.dumps({"successful": True, "data": {"results": [{"response": {"successful": True}}]}})}]}
    assert cacheable(ok)
    assert not cacheable({"isError": True, "content": [{"type": "text", "text": "x"}]})
    assert not cacheable({"content": [{"type": "text", "text": json.dumps({"successful": True, "data": {"results": [{"response": {"successful": False}}]}})}]})
    assert not cacheable({"content": [{"type": "text", "text": json.dumps({"successful": False})}]})
    key = cache_key(run("a", "b"))
    cache_write(tmp_path, key, ok, now=1000.0)
    assert cache_read(tmp_path, key, 900, now=1899.0) == ok  # 14 min 59 s after it was fetched
    assert cache_read(tmp_path, key, 900, now=1900.0) is None  # 15 minutes: fetched again
    assert cache_read(tmp_path, "nothing", 900) is None


def test_a_proxy_with_a_cache_answers_the_same_call_from_the_file_until_it_is_fifteen_minutes_old(tmp_path):
    import os
    import subprocess
    import sys
    import time
    from pathlib import Path

    from botteam.mcp_proxy import cache_key

    from .test_mcp import FAKE

    cache = tmp_path / "cache"
    spec = tmp_path / "spec.json"
    spec.write_text(json.dumps({"name": "Fake", "transport": "stdio", "command": sys.executable, "args": [FAKE], "outputDir": str(tmp_path), "allowTools": ["echo"],
                                "cacheSeconds": 900, "cacheDir": str(cache)}), encoding="utf8")

    def call(text):
        init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}}
        msgs = [init, {"jsonrpc": "2.0", "method": "notifications/initialized"}, {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "echo", "arguments": {"text": text}}}]
        env = {**os.environ, "BT_MCP_SPEC_FILE": str(spec), "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
        out = subprocess.run([sys.executable, "-m", "botteam.mcp_proxy"], input="\n".join(json.dumps(m) for m in msgs) + "\n", capture_output=True, text=True, env=env, timeout=60)
        return next(json.loads(l) for l in out.stdout.splitlines() if '"id": 2' in l)["result"]["content"][0]["text"]

    assert call("hi") == "echo: hi"
    path = cache / f"{cache_key({'name': 'echo', 'arguments': {'text': 'hi'}})}.json"
    entry = json.loads(path.read_text(encoding="utf8"))
    entry["result"]["content"][0]["text"] = "FROM THE FILE"  # prove where the next answer comes from
    path.write_text(json.dumps(entry), encoding="utf8")
    assert call("hi") == "FROM THE FILE", "within 15 minutes the saved answer is used"
    entry["at"] = time.time() - 901
    path.write_text(json.dumps(entry), encoding="utf8")
    assert call("hi") == "echo: hi", "after 15 minutes it is fetched again"
    assert json.loads(path.read_text(encoding="utf8"))["result"]["content"][0]["text"] == "echo: hi" and time.time() - json.loads(path.read_text(encoding="utf8"))["at"] < 60
    assert call("other") == "echo: other"  # another call is its own entry


async def test_cache_minutes_is_validated_and_handed_to_the_proxy(ctx):
    c, app = ctx
    bot = await make_bot(c, "Cacher")
    sid, _ = await app.state.mcp.create({"name": "Composio", "transport": "http", "url": "http://127.0.0.1:9/mcp", "appId": "composio"})
    acc = lambda **k: {"mcpServers": [sid], "mcpAccess": {sid: {"scope": "write", "outbound": "allow", **k}}}
    assert (await c.patch(f"/api/bots/{bot['id']}", json=acc(cacheMinutes=15))).status_code == 400  # a bot that can write keeps no answers
    assert (await c.patch(f"/api/bots/{bot['id']}", json=acc(allowTools=ALLOW, cacheMinutes=5000))).status_code == 400
    good = await c.patch(f"/api/bots/{bot['id']}", json=acc(allowTools=ALLOW, cacheMinutes=15))
    assert good.status_code == 200 and good.json()["mcpAccess"][sid]["cacheMinutes"] == 15
    entries = await app.state.mcp.entries_for([sid], bot["threadId"], {sid: {"scope": "write", "allowTools": ALLOW, "cacheMinutes": 15}})
    spec = json.loads(open(next(iter(entries.values()))["env"]["BT_MCP_SPEC_FILE"], encoding="utf8").read())
    assert spec["cacheSeconds"] == 900 and spec["cacheDir"].endswith(sid) and "mcp-cache" in spec["cacheDir"]


async def test_a_bot_answering_a_customer_cannot_use_the_team_tools_except_the_lookup(ctx):
    from botteam.drivers.base import SendTurnInput
    from botteam.turns import ThreadRun

    c, app = ctx
    bot = await make_bot(c, "Front")
    app.state.turns.runs[bot["threadId"]] = ThreadRun(bot_id=bot["id"], inp=SendTurnInput(thread_id=bot["threadId"], bot_id=bot["id"], text=""), channel_batch_id="chat:q1")
    try:
        for tool in ("list_bots", "coordinate_bots", "start_thread", "trigger", "post_to_room", "team_remember", "remember", "forget", "browser_open"):
            out = await app.state.agents.call(bot["threadId"], tool, {"message": "x", "url": "http://x"})
            assert out["ok"] is False and out["reason"] == "not_allowed" and "customer" in out["detail"], tool
        assert (await app.state.agents.call(bot["threadId"], "recall", {}))["ok"] is True
        assert "customer" not in (await app.state.agents.call(bot["threadId"], "sheet_rows", {"spreadsheet": "x", "match": {"a": "b"}})).get("detail", "")
    finally:
        app.state.turns.runs.pop(bot["threadId"], None)
    assert (await app.state.agents.call(bot["threadId"], "list_bots", {}))["ok"] is True  # an ordinary turn keeps them
