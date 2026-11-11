"""The command line and the app's own MCP server: a team applied from a file, a job run from a script with meaningful exit codes, backup and restore."""
import asyncio
import json
import socket
import threading
from pathlib import Path

import httpx
import pytest
import uvicorn
import yaml
from asgi_lifespan import LifespanManager

from botteam import cli, mcp_app
from botteam.main import create_app

TEAM = {"format": "botteam.team", "version": 1, "name": "Script team", "bots": [{"key": "b1", "name": "Scripted", "title": "Tester", "instructions": "Be brief."}]}


@pytest.fixture
def data(tmp_path, monkeypatch):
    monkeypatch.setenv("BOTTEAM_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("BOTTEAM_URL", "http://127.0.0.1:1")  # nothing listens there: the commands run the app inside themselves
    return tmp_path / "data"


def run(argv, capsys):
    code = cli.main(argv)
    out = capsys.readouterr()
    return code, out.out, out.err


async def seed_echo_bot(data: Path, name="Echoer", mode="full"):
    data.mkdir(parents=True, exist_ok=True)
    app = create_app(home=data)
    async with LifespanManager(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            return (await c.post("/api/bots", json={"name": name, "modelSelection": {"instanceId": "echo", "model": "echo-1"}, "approvalMode": mode})).json()


def test_a_team_file_is_applied_from_the_command_line(data, tmp_path, capsys):
    f = tmp_path / "team.yaml"
    f.write_text(yaml.safe_dump(TEAM), encoding="utf8")
    code, out, _ = run(["team", "apply", str(f), "--json"], capsys)
    assert code == cli.EXIT_OK
    assert json.loads(out) == {"section": "Script team", "bots": 1, "skills": 0, "rooms": 0, "routines": 0, "connections": 0}
    code, out, _ = run(["team", "apply", str(f)], capsys)  # again: a second section, never over the first
    assert code == 0 and "Script team (2)" in out


def test_an_unusable_file_exits_with_the_usage_code(data, tmp_path, capsys):
    code, _, err = run(["team", "apply", str(tmp_path / "missing.yaml")], capsys)
    assert code == cli.EXIT_USAGE and "no such file" in err
    bad = tmp_path / "bad.md"
    bad.write_text("just text", encoding="utf8")
    code, _, err = run(["team", "apply", str(bad)], capsys)
    assert code == cli.EXIT_USAGE and "not a BotTeam team file" in err


def test_run_gives_a_bot_a_job_prints_the_reply_and_exports_the_transcript(data, tmp_path, capsys):
    asyncio.run(seed_echo_bot(data))
    exp = tmp_path / "out"
    code, out, _ = run(["run", "echoer", "hello from a script", "--json", "--export", str(exp)], capsys)
    assert code == cli.EXIT_OK
    d = json.loads(out)
    assert d["status"] == "done" and d["reply"] == "You said: hello from a script" and d["bot"] == "Echoer" and d["exportDir"] == str(exp.resolve())
    assert "hello from a script" in (exp / "Echoer-transcript.md").read_text(encoding="utf8")
    assert [m["text"] for m in json.loads((exp / "Echoer-transcript.json").read_text(encoding="utf8"))["messages"] if m["role"] == "user"] == ["hello from a script"]
    assert json.loads((exp / "result.json").read_text(encoding="utf8"))["status"] == "done"
    code, out, _ = run(["run", "Echoer", "plain text output"], capsys)
    assert code == 0 and out.strip() == "You said: plain text output"


def test_run_exit_codes_say_what_happened(data, capsys):
    asyncio.run(seed_echo_bot(data, "Careful", mode="ask"))
    code, _, err = run(["run", "nobody", "x"], capsys)
    assert code == cli.EXIT_USAGE and "no bot called" in err and "Careful" in err
    code, out, err = run(["run", "Careful", "/approve touch x", "--json"], capsys)  # an approval nobody here can give
    assert code == cli.EXIT_NEEDS_PERSON and json.loads(out)["status"] == "needs_person" and "waiting for an approval" in err
    code, out, _ = run(["run", "Careful", "/slow keep going", "--timeout", "1", "--json"], capsys)
    assert code == cli.EXIT_TIMEOUT and json.loads(out)["status"] == "timeout"


def test_backup_and_restore_from_the_command_line(data, tmp_path, capsys):
    asyncio.run(seed_echo_bot(data, "Kept"))
    z = tmp_path / "b.zip"
    code, out, _ = run(["backup", str(z)], capsys)
    assert code == 0 and "Backed up" in out and z.exists()
    code, _, err = run(["restore", str(z)], capsys)
    assert code == cli.EXIT_USAGE and "already holds data" in err
    code, out, _ = run(["restore", str(z), "--force"], capsys)
    assert code == 0 and "Restored" in out


def test_no_arguments_means_serve_and_unknown_commands_fail():
    assert cli.parser().parse_args(["serve", "--no-open", "--port", "9000"]).port == 9000
    with pytest.raises(SystemExit):
        cli.parser().parse_args(["frobnicate"])


# ---- the app's own MCP server -------------------------------------------------------------------------------------------------
class Live:
    """The app on a real port, in a thread, for the synchronous MCP client."""

    def __init__(self, home: Path) -> None:
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        self.server = uvicorn.Server(uvicorn.Config(create_app(home=home), host="127.0.0.1", port=self.port, log_level="error", loop="asyncio"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def __enter__(self):
        self.thread.start()
        for _ in range(200):
            if self.server.started:
                return self
            threading.Event().wait(0.05)
        raise AssertionError("the server did not start")

    def __exit__(self, *a):
        self.server.should_exit = True
        self.thread.join(10)


def test_the_apps_mcp_server_lets_an_outside_tool_work_the_team(tmp_path):
    home = tmp_path / "d"
    home.mkdir()
    with Live(home) as live:
        api = mcp_app.Api(f"http://127.0.0.1:{live.port}")
        names = {t["name"] for t in mcp_app.TOOLS}
        assert {"list_bots", "list_rooms", "read_transcript", "search", "create_bot", "create_room", "create_task", "send", "wait", "set_model", "interrupt"} <= names
        assert not any(w in n for n in names for w in ("delete", "approve", "answer", "config", "key", "secret", "setting")), "no way to approve, delete or read secrets"
        made = mcp_app.tool(api, "create_bot", {"name": "Outsider", "title": "From outside"})
        bot = api.call("GET", "/api/bots")["bots"][0]
        assert made["name"] == "Outsider" and bot["approvalMode"] == "ask"  # a bot made from outside starts cautious
        api.call("PATCH", f"/api/bots/{made['id']}", {"modelSelection": {"instanceId": "echo", "model": "echo-1"}})
        assert mcp_app.tool(api, "list_bots", {})[0]["name"] == "Outsider"
        assert mcp_app.tool(api, "send", {"target": "outsider", "text": "ping from claude desktop"}) == {"sent": True, "target": "Outsider"}
        done = mcp_app.tool(api, "wait", {"target": "Outsider", "timeout_s": 20})
        assert done == {"done": True, "reply": "You said: ping from claude desktop"}
        texts = [m["text"] for m in mcp_app.tool(api, "read_transcript", {"target": "Outsider", "limit": 5})]
        assert texts == ["ping from claude desktop", "You said: ping from claude desktop"]
        assert mcp_app.tool(api, "search", {"query": "claude desktop"})
        room = mcp_app.tool(api, "create_room", {"name": "Desk", "members": ["Outsider"]})
        assert mcp_app.tool(api, "list_rooms", {})[0]["name"] == "Desk" and room["id"]
        task = mcp_app.tool(api, "create_task", {"bot": "Outsider", "title": "Side job"})
        assert task["threadId"]
        assert mcp_app.tool(api, "set_model", {"bot": "Outsider", "instance_id": "echo", "model": "echo-1"}) == {"ok": True}
        mcp_app.tool(api, "send", {"target": "Outsider", "text": "/slow keep going"})
        assert mcp_app.tool(api, "wait", {"target": "Outsider", "timeout_s": 1}) == {"done": False, "timedOut": True}
        assert mcp_app.tool(api, "interrupt", {"target": "Outsider"}) == {"ok": True}
        # the JSON-RPC shell: listing, a call, an error that is a result and not a crash
        assert len(mcp_app.handle(api, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})["result"]["tools"]) == len(mcp_app.TOOLS)
        bad = mcp_app.handle(api, {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "send", "arguments": {"target": "ghost", "text": "x"}}})["result"]
        assert bad["isError"] is True and "no bot or room" in bad["content"][0]["text"]
        assert mcp_app.handle(api, {"jsonrpc": "2.0", "method": "notifications/initialized"}) is None
