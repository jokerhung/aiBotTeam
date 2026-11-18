import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest

from botteam.drivers.base import SendTurnInput
from botteam.drivers.claude import ClaudeDriver
from botteam.drivers.codex import CodexDriver, Run
from botteam.drivers.openai_compat import OpenAICompatDriver

FAKE = str(Path(__file__).parent / "fake_claude.py")


class Collector:
    def __init__(self, driver):
        self.events = []
        driver.on_event(self.events.append)

    def types(self):
        return [e.type for e in self.events]

    async def until(self, type_, timeout=8):
        for _ in range(int(timeout / 0.02)):
            if any(e.type == type_ for e in self.events):
                return
            await asyncio.sleep(0.02)
        raise AssertionError(f"never saw {type_}: {self.types()}")


def inp(text, **kw):
    return SendTurnInput(thread_id="t1", bot_id="b1", text=text, **kw)


@pytest.fixture
def argv_log(tmp_path, monkeypatch):
    p = tmp_path / "argv.jsonl"
    monkeypatch.setenv("FAKE_CLAUDE_ARGV", str(p))
    return p


async def test_claude_turn_maps_frames_to_events(argv_log):
    d = ClaudeDriver([sys.executable, FAKE])
    c = Collector(d)
    await d.send_turn(inp("hello"))
    await c.until("turn.completed")
    assert c.types() == ["turn.started", "session.started", "content.delta", "content.delta", "item.completed",
                         "thread.token-usage.updated", "turn.completed"]
    done = c.events[-1].data
    assert done["ok"] is True and done["usage"]["output"] == 6 and done["cost"] == 0.01
    assert c.events[1].data["sessionId"] == "sess-123"
    await d.stop_all()


async def test_claude_tool_use_and_result(argv_log):
    d = ClaudeDriver([sys.executable, FAKE])
    c = Collector(d)
    await d.send_turn(inp("tool please"))
    await c.until("turn.completed")
    started = next(e for e in c.events if e.type == "item.started")
    assert started.data["title"] == "Bash" and started.data["summary"] == "ls" and started.data["itemId"] == "tu1"
    finished = next(e for e in c.events if e.type == "item.completed" and e.data["itemType"] == "tool")
    assert finished.data == {"itemType": "tool", "itemId": "tu1", "ok": True, "output": "file.txt"}
    await d.stop_all()


async def test_claude_process_is_reused_and_resume_flag_used(argv_log):
    d = ClaudeDriver([sys.executable, FAKE])
    c = Collector(d)
    await d.send_turn(inp("one"))
    await c.until("turn.completed")
    c.events.clear()
    await d.send_turn(inp("two"))
    await c.until("turn.completed")
    assert len(argv_log.read_text().splitlines()) == 1  # one process served both turns
    await d.stop_all()
    d2 = ClaudeDriver([sys.executable, FAKE])
    c2 = Collector(d2)
    await d2.send_turn(inp("three", resume_cursor="sess-old"))
    await c2.until("turn.completed")
    args = json.loads(argv_log.read_text().splitlines()[-1])
    assert args[args.index("--resume") + 1] == "sess-old"
    assert next(e for e in c2.events if e.type == "session.started").data["sessionId"] == "sess-old"
    await d2.stop_all()


async def test_claude_model_change_restarts_with_model_flag(argv_log):
    d = ClaudeDriver([sys.executable, FAKE])
    c = Collector(d)
    await d.send_turn(inp("a", model="sonnet"))
    await c.until("turn.completed")
    c.events.clear()
    await d.send_turn(inp("b", model="opus"))
    await c.until("turn.completed")
    lines = [json.loads(x) for x in argv_log.read_text().splitlines()]
    assert len(lines) == 2 and "sonnet" in lines[0] and "opus" in lines[1]
    await d.stop_all()


async def test_claude_interrupt_kills_process_and_settles(argv_log):
    d = ClaudeDriver([sys.executable, FAKE])
    c = Collector(d)
    await d.send_turn(inp("hang"))
    await asyncio.sleep(0.3)
    proc = d.sessions["t1"].proc
    await d.interrupt_turn("t1")
    await c.until("turn.completed")
    assert c.events[-1].data["stopReason"] == "interrupted"
    assert proc.returncode is not None and not d.has_session("t1")


async def test_claude_crash_reports_retryable_error(argv_log):
    d = ClaudeDriver([sys.executable, FAKE])
    c = Collector(d)
    await d.send_turn(inp("crash now"))
    await c.until("turn.completed")
    err = next(e for e in c.events if e.type == "runtime.error")
    assert err.data["retryable"] is True and c.events[-1].data["ok"] is False


async def test_claude_steer_only_during_a_turn(argv_log):
    d = ClaudeDriver([sys.executable, FAKE])
    c = Collector(d)
    assert await d.steer("t1", "x") == "refused"
    await d.send_turn(inp("hang"))
    await asyncio.sleep(0.3)
    assert await d.steer("t1", "more") == "steered"
    await d.stop_all()


async def test_claude_missing_binary_is_a_setup_error():
    d = ClaudeDriver(["definitely-not-a-binary-xyz"])
    c = Collector(d)
    await d.send_turn(inp("hi"))
    assert c.types()[-1] == "turn.completed"
    assert next(e for e in c.events if e.type == "runtime.error").data["setup"] is True


def test_claude_signed_out_frame_is_a_setup_error():
    d = ClaudeDriver("x")
    c = Collector(d)
    s = type("S", (), {"turn_id": "t", "saw_stream_delta": False, "explained": False})()
    d._assistant("t1", s, {"type": "assistant", "error": "authentication_failed", "message": {
        "model": "<synthetic>", "content": [{"type": "text", "text": "Not logged in · Please run /login"}]}})
    ev = c.events[0]
    assert ev.type == "runtime.error" and ev.data["setup"] and ev.data["terminal"] and s.explained


def test_codex_real_jsonl_maps_to_events():
    d = CodexDriver("x")
    c = Collector(d)
    run = Run(proc=None, turn_id="turn1")
    for line in (
        '{"type":"thread.started","thread_id":"01a1c5eb"}',
        '{"type":"turn.started"}',
        '{"type":"item.started","item":{"id":"i1","type":"command_execution","command":"ls","status":"in_progress"}}',
        '{"type":"item.completed","item":{"id":"i1","type":"command_execution","command":"ls","aggregated_output":"a\\n","exit_code":0,"status":"completed"}}',
        '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}',
        '{"type":"turn.completed","usage":{"input_tokens":15407,"cached_input_tokens":7680,"output_tokens":5}}',
    ):
        d.handle_line("t1", run, json.loads(line))
    assert c.types() == ["session.started", "item.started", "item.completed", "content.delta", "item.completed", "turn.completed"]
    assert c.events[0].data["sessionId"] == "01a1c5eb"
    assert c.events[2].data["ok"] is True
    assert c.events[-1].data["usage"] == {"input": 15407, "output": 5, "cachedInput": 7680}


def test_codex_args_resume_and_model():
    d = CodexDriver("codex")
    fresh = d.build_args(inp("x", model="gpt-5.6-luna"))
    assert fresh[:2] == ["codex", "exec"] and "resume" not in fresh and fresh[fresh.index("-m") + 1] == "gpt-5.6-luna"
    resumed = d.build_args(inp("x", resume_cursor="abc"))
    assert resumed[2] == "resume" and "abc" in resumed and resumed[-1] == "-" and "-m" not in resumed
    assert "-m" not in d.build_args(inp("x", model="default"))


async def test_openai_compat_streams_and_reports_usage():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        seen["auth"] = request.headers.get("authorization")
        sse = (
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n'
            'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\n'
            "data: [DONE]\n\n"
        )
        return httpx.Response(200, text=sse, headers={"content-type": "text/event-stream"})

    d = OpenAICompatDriver("http://x/v1", "sk-1", transport=httpx.MockTransport(handler))
    c = Collector(d)
    await d.send_turn(inp("hi", model="m1", system="be brief", transcript=[("user", "earlier"), ("assistant", "yes")]))
    await c.until("turn.completed")
    assert [m["role"] for m in seen["body"]["messages"]] == ["system", "user", "assistant", "user"]
    assert seen["auth"] == "Bearer sk-1"
    assert "".join(e.data["delta"] for e in c.events if e.type == "content.delta") == "Hello"
    assert c.events[-1].data["usage"] == {"input": 7, "output": 2}


async def test_openai_compat_http_error_becomes_runtime_error():
    d = OpenAICompatDriver("http://x/v1", transport=httpx.MockTransport(lambda r: httpx.Response(401, text="bad key")))
    c = Collector(d)
    await d.send_turn(inp("hi", model="m"))
    await c.until("turn.completed")
    err = next(e for e in c.events if e.type == "runtime.error")
    assert "401" in err.data["message"] and c.events[-1].data["ok"] is False


def test_claude_signed_in_parses_auth_status_json():
    from botteam.registry import claude_signed_in

    assert claude_signed_in(0, '{\n  "loggedIn": false,\n  "authMethod": "none"\n}') is False
    assert claude_signed_in(0, '{"loggedIn": true}') is True
    assert claude_signed_in(-1, "boom") is None
    assert claude_signed_in(1, "Not logged in") is False


def test_codex_gets_the_custom_mcp_servers_as_config_overrides():
    from botteam.drivers.base import SendTurnInput
    from botteam.drivers.codex import CodexDriver

    bs = chr(92)
    ent = {"command": f"C:{bs}py{bs}python.exe", "args": ["-m", "botteam.mcp_proxy"], "env": {"BT_MCP_SPEC_FILE": f"C:{bs}u{bs}s.json", "PYTHONPATH": f"C:{bs}srv"}}
    args = CodexDriver("codex").build_args(SendTurnInput(thread_id="t", bot_id="b", text="x", approval_mode="ask", custom_mcp={"x_Composio-e25f": ent}))
    over = [a for a in args if a.startswith("mcp_servers.")]
    assert over[0] == f'mcp_servers.x_Composio_e25f.command="C:{bs}{bs}py{bs}{bs}python.exe"'  # a TOML string: the backslashes are escaped
    assert 'mcp_servers.x_Composio_e25f.args=["-m", "botteam.mcp_proxy"]' in over
    assert f'mcp_servers.x_Composio_e25f.env.BT_MCP_SPEC_FILE="C:{bs}{bs}u{bs}{bs}s.json"' in over
    assert all(args[args.index(a) - 1] == "-c" for a in over)
    assert not [a for a in CodexDriver("codex").build_args(SendTurnInput(thread_id="t", bot_id="b", text="x")) if a.startswith("mcp_servers.")]


async def test_the_codex_app_server_is_started_with_the_custom_mcp_servers(monkeypatch):
    import asyncio

    from botteam.drivers import codex_app
    from botteam.drivers.base import SendTurnInput

    seen = {}

    async def fake_spawn(args, cwd=None, env=None, stdin=True):
        seen["args"] = list(args)
        raise OSError("stop here")  # only the command line matters

    monkeypatch.setattr(codex_app, "spawn", fake_spawn)
    d = codex_app.CodexAppDriver("codex")
    ent = {"command": "py", "args": ["-m", "botteam.mcp_proxy"], "env": {"BT_MCP_SPEC_FILE": "s.json"}}
    inp = SendTurnInput(thread_id="t", bot_id="b", text="x", custom_mcp={"x_Composio_e25f": ent})
    try:
        await d._start(inp, ".")
    except OSError:
        pass
    assert seen["args"][:2] == ["codex", "app-server"] and 'mcp_servers.x_Composio_e25f.env.BT_MCP_SPEC_FILE="s.json"' in seen["args"]
    seen.clear()
    try:
        await d._start(SendTurnInput(thread_id="t2", bot_id="b", text="x"), ".")
    except OSError:
        pass
    assert seen["args"] == ["codex", "app-server"]
    # the team tools are given for a turn that asks for them (an answering bot), and only then
    class FakeBroker:
        port, token = 4321, "tok"

    d2 = codex_app.CodexAppDriver("codex", broker=FakeBroker())
    seen.clear()
    try:
        await d2._start(SendTurnInput(thread_id="t3", bot_id="b", text="x", mount_agents=True), ".")
    except OSError:
        pass
    assert 'mcp_servers.bt.args=["-m", "botteam.mcp_bridge"]' in seen["args"] and 'mcp_servers.bt.env.BT_AGENTS="1"' in seen["args"]
    seen.clear()
    try:
        await d2._start(SendTurnInput(thread_id="t4", bot_id="b", text="x"), ".")
    except OSError:
        pass
    assert not [a for a in seen["args"] if "mcp_servers.bt" in a]


async def test_codex_asks_the_permission_broker_before_an_mcp_tool_runs():
    import asyncio

    from botteam.drivers import codex_app

    asked, written = [], []

    class Broker:
        port = 1
        token = "t"

        def __init__(self, behavior):
            self.behavior = behavior

        async def ask(self, thread_id, req_id, kind, tool, inp):
            asked.append((tool, inp))
            return {"behavior": self.behavior}

    class Proc:
        class stdin:
            @staticmethod
            async def drain():
                return None

    msg = {"method": "mcpServer/elicitation/request", "id": 7, "params": {"serverName": "x_Fake_1", "message": 'Allow the x_Fake_1 MCP server to run tool "echo"?',
                                                                         "_meta": {"codex_approval_kind": "mcp_tool_call", "tool_params": {"text": "hi"}}}}
    for behavior, expected in (("allow", "accept"), ("deny", "decline")):
        d = codex_app.CodexAppDriver("codex", broker=Broker(behavior))
        d._write = lambda s, obj: written.append(obj)
        s = type("S", (), {"proc": Proc})()
        await d._server_request("t1", s, msg)
        assert written[-1] == {"id": 7, "result": {"action": expected}}
    assert asked[0] == ("mcp__x_Fake_1__echo", {"text": "hi"})
    # without a broker, or for something that is not a tool call, the answer is no
    d = codex_app.CodexAppDriver("codex")
    d._write = lambda s, obj: written.append(obj)
    await d._server_request("t1", type("S", (), {"proc": Proc})(), msg)
    assert written[-1] == {"id": 7, "result": {"action": "decline"}}
