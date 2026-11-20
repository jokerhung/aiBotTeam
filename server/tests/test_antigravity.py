import asyncio
import json
import sys
from pathlib import Path

import pytest

from botteam.approval import antigravity_mode
from botteam.drivers.antigravity import AntigravityDriver, acp_mcp_servers, parse_models
from botteam.drivers.base import SendTurnInput

FAKE = str(Path(__file__).parent / "fake_acp.py")


class Collector:
    def __init__(self, driver):
        self.events = []
        driver.on_event(self.events.append)

    def types(self):
        return [e.type for e in self.events]

    async def until(self, type_, timeout=10, n=1):
        for _ in range(int(timeout / 0.02)):
            if sum(e.type == type_ for e in self.events) >= n:
                return
            await asyncio.sleep(0.02)
        raise AssertionError(f"never saw {type_}: {self.types()}")


def inp(text, **kw):
    return SendTurnInput(thread_id="t1", bot_id="b1", text=text, cwd=kw.pop("cwd", None) or str(Path(FAKE).parent), **kw)


@pytest.fixture
def log(tmp_path, monkeypatch):
    p = tmp_path / "acp.jsonl"
    monkeypatch.setenv("FAKE_ACP_LOG", str(p))
    return lambda: [json.loads(x) for x in p.read_text(encoding="utf8").splitlines()] if p.exists() else []


def test_mode_mapping_fails_closed():
    assert [antigravity_mode(m) for m in ("ask", "edits", "auto", "full", "weird")] == ["default", "accept-edits", "default", "auto", "default"]


def test_models_and_mcp_conversion():
    out = "Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-sonnet-4-6\tClaude Sonnet 4.6\n"
    assert parse_models(out) == [{"id": "gemini-3.8-flash-high", "label": "Gemini 3.8 Flash (High)"}, {"id": "claude-sonnet-4-6", "label": "Claude Sonnet 4.6"}]
    assert parse_models("Please sign in to view available models.") == []
    s = acp_mcp_servers({"my srv": {"command": "node", "args": ["x.js"], "env": {"K": "v"}}, "bad": {}})
    assert s == [{"name": "my_srv", "command": "node", "args": ["x.js"], "env": [{"name": "K", "value": "v"}]}]


async def test_turn_maps_updates_to_events(log):
    d = AntigravityDriver([sys.executable, FAKE])
    c = Collector(d)
    await d.send_turn(inp("tool please", approval_mode="ask"))
    await c.until("turn.completed")
    assert c.types() == ["turn.started", "session.started", "content.delta", "item.started", "item.completed", "content.delta", "content.delta",
                         "thread.token-usage.updated", "item.completed", "turn.completed"]
    assert c.events[1].data["sessionId"] == "S-1"
    assert c.events[2].data["streamKind"] == "reasoning_text"
    assert c.events[3].data["title"] == "write_file" and c.events[4].data["ok"] is True
    assert c.events[8].data["text"] == "Hello there"
    done = c.events[-1].data
    assert done["ok"] is True and done["stopReason"] == "end_turn" and done["usage"] == {"input": 10, "output": 5, "cachedInput": 2}
    sent = log()
    assert sent[0]["argv"][0] == "acp" and "--dangerously-skip-permissions" not in sent[0]["argv"]
    await d.stop_all()


async def test_full_access_skips_permissions_and_edits_sets_mode(log):
    d = AntigravityDriver([sys.executable, FAKE])
    c = Collector(d)
    await d.send_turn(inp("hello", approval_mode="full"))
    await c.until("turn.completed")
    assert "--dangerously-skip-permissions" in log()[0]["argv"]
    await d.stop_all()
    d2 = AntigravityDriver([sys.executable, FAKE])
    c2 = Collector(d2)
    await d2.send_turn(inp("hello", approval_mode="edits"))
    await c2.until("turn.completed")
    assert any(m.get("method") == "session/set_mode" and m["params"]["modeId"] == "accept-edits" for m in log())
    await d2.stop_all()


async def test_model_system_resume_and_missing_session(log):
    d = AntigravityDriver([sys.executable, FAKE])
    c = Collector(d)
    await d.send_turn(inp("hello", model="claude-sonnet-4-6", system="BE BRIEF"))
    await c.until("turn.completed")
    sent = log()
    assert any(m.get("method") == "session/set_model" and m["params"]["modelId"] == "claude-sonnet-4-6" for m in sent)
    prompt = next(m for m in sent if m.get("method") == "session/prompt")
    assert prompt["params"]["prompt"][0]["text"].startswith("BE BRIEF")
    await d.stop_all()
    c.events.clear()
    await d.send_turn(inp("hello", resume_cursor="S-1", system="BE BRIEF"))
    await c.until("turn.completed")
    assert any(m.get("method") == "session/resume" for m in log())
    assert [m for m in log() if m.get("method") == "session/prompt"][-1]["params"]["prompt"][0]["text"] == "hello"  # a resumed session already has the system prompt
    await d.stop_all()
    c.events.clear()
    await d.send_turn(inp("hello", resume_cursor="gone"))
    await c.until("turn.completed")
    assert [e for e in c.events if e.type == "session.started"][0].data["sessionId"] == "S-1"  # a new session replaced the lost one
    await d.stop_all()


async def test_images_go_in_the_prompt(tmp_path, log):
    img = tmp_path / "p.png"
    img.write_bytes(b"\x89PNG")
    d = AntigravityDriver([sys.executable, FAKE])
    c = Collector(d)
    await d.send_turn(inp("hello", attachments=[str(img)], image_attachments=[str(img)]))
    await c.until("turn.completed")
    blocks = [m for m in log() if m.get("method") == "session/prompt"][0]["params"]["prompt"]
    assert blocks[1]["type"] == "image" and blocks[1]["mimeType"] == "image/png" and blocks[1]["data"]
    assert "Attached files" not in blocks[0]["text"]
    await d.stop_all()


async def test_stop_cancels_the_turn():
    d = AntigravityDriver([sys.executable, FAKE])
    c = Collector(d)
    await d.send_turn(inp("slow"))
    await c.until("content.delta")
    await d.interrupt_turn("t1")
    await c.until("turn.completed")
    done = c.events[-1].data
    assert done["ok"] is False and done["stopReason"] == "interrupted"
    await d.send_turn(inp("hello"))  # the same bot goes on afterwards
    await c.until("turn.completed", n=2)
    assert c.events[-1].data["ok"] is True
    await d.stop_all()


async def test_process_dying_mid_turn_is_reported():
    d = AntigravityDriver([sys.executable, FAKE])
    c = Collector(d)
    await d.send_turn(inp("die now"))
    await c.until("turn.completed")
    err = [e for e in c.events if e.type == "runtime.error"][0].data
    assert "exited unexpectedly" in err["message"] and err["retryable"] is True
    assert c.events[-1].data["ok"] is False
    await d.send_turn(inp("hello"))
    await c.until("turn.completed", n=2)
    assert c.events[-1].data["ok"] is True
    await d.stop_all()


async def test_sign_in_error_is_a_setup_error():
    d = AntigravityDriver([sys.executable, FAKE])
    c = Collector(d)
    await d.send_turn(inp("fail"))
    await c.until("turn.completed")
    err = [e for e in c.events if e.type == "runtime.error"][0].data
    assert err["setup"] is True and "sign in" in err["message"].lower()
    await d.stop_all()


async def test_a_binary_that_does_not_exist_is_a_setup_error():
    d = AntigravityDriver(["definitely-not-agy"])
    c = Collector(d)
    await d.send_turn(inp("hello"))
    await c.until("turn.completed")
    err = [e for e in c.events if e.type == "runtime.error"][0].data
    assert err["setup"] is True and "Could not start Antigravity" in err["message"]


async def _broker(tmp_path, mode):
    from botteam.broker import Broker, Policy
    from botteam.config import ConfigStore

    opened = []

    async def policy(_t):
        return Policy(mode, str(tmp_path), "antigravity")

    async def on_open(t, r):
        opened.append(r)

    async def noop(t, r):
        return None

    return Broker(ConfigStore(tmp_path / "cfg"), policy, on_open, noop), opened


async def test_permission_requests_go_to_the_broker(tmp_path, log):
    b, opened = await _broker(tmp_path, "ask")
    d = AntigravityDriver([sys.executable, FAKE], broker=b)
    c = Collector(d)
    await d.send_turn(inp("shell please", cwd=str(tmp_path), approval_mode="ask"))
    for _ in range(300):
        if opened:
            break
        await asyncio.sleep(0.02)
    assert opened and opened[0]["tool"] == "Bash" and opened[0]["command"] == "rm -rf build"
    await b.resolve(opened[0]["id"], "deny")
    await c.until("turn.completed")
    failed = [e for e in c.events if e.type == "item.completed" and e.data.get("itemId") == "c2"][0].data
    assert failed["ok"] is False and failed["output"] == "deny"
    await d.stop_all()


async def test_allowed_request_picks_the_allow_option(tmp_path):
    b, opened = await _broker(tmp_path, "ask")
    d = AntigravityDriver([sys.executable, FAKE], broker=b)
    c = Collector(d)
    await d.send_turn(inp("shell please", cwd=str(tmp_path), approval_mode="ask"))
    for _ in range(300):
        if opened:
            break
        await asyncio.sleep(0.02)
    await b.resolve(opened[0]["id"], "allow")
    await c.until("turn.completed")
    done = [e for e in c.events if e.type == "item.completed" and e.data.get("itemId") == "c2"][0].data
    assert done["ok"] is True and done["output"] == "allow"
    await d.stop_all()


async def test_no_broker_means_deny(tmp_path):
    d = AntigravityDriver([sys.executable, FAKE])
    c = Collector(d)
    await d.send_turn(inp("shell please", cwd=str(tmp_path)))
    await c.until("turn.completed")
    done = [e for e in c.events if e.type == "item.completed" and e.data.get("itemId") == "c2"][0].data
    assert done["ok"] is False
    await d.stop_all()


async def test_team_tools_and_custom_mcp_in_session_new(tmp_path, log):
    b, _ = await _broker(tmp_path, "ask")
    await b.start()
    try:
        d = AntigravityDriver([sys.executable, FAKE], broker=b)
        c = Collector(d)
        await d.send_turn(inp("hello", mount_agents=True, custom_mcp={"notes": {"command": "node", "args": ["n.js"], "env": {"T": "secret"}}}))
        await c.until("turn.completed")
        servers = next(m for m in log() if m.get("method") == "session/new")["params"]["mcpServers"]
        assert {s["name"] for s in servers} == {"notes", "bt"}
        bt = next(s for s in servers if s["name"] == "bt")
        assert {"name": "BT_THREAD_ID", "value": "t1"} in bt["env"]
        await d.stop_all()
    finally:
        await b.stop()


async def test_mcp_tool_names_reach_the_broker_in_claude_form(tmp_path):
    b, opened = await _broker(tmp_path, "ask")
    d = AntigravityDriver([sys.executable, FAKE], broker=b)
    from botteam.drivers.antigravity import Session

    s = Session(proc=None, cwd=str(tmp_path), mode="ask", model=None, effort=None, servers=("bt", "notes"))
    assert d._permission_input({"name": "mcp_bt_list_bots", "kind": "other", "rawInput": {}}, s)[0] == "mcp__bt__list_bots"
    assert d._permission_input({"name": "mcp_notes_search", "kind": "other"}, s)[0] == "mcp__notes__search"
    assert d._permission_input({"name": "view_file", "kind": "read"}, s)[0] == "view_file"
    # our own bridge's tools are answered without a card at every level
    assert (await b.ask("t1", "x1", "permission", "mcp__bt__list_bots", {}))["behavior"] == "allow"


@pytest.mark.parametrize("version,models,state,signed_in,n_models", [
    ((0, "1.5.13"), (0, "Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)"), "available", True, 2),
    ((0, "1.5.13"), (0, "Please sign in to view available models."), "available", False, 1),
    ((0, "1.5.13"), (-1, "timed out"), "available", None, 1),
    ((1, "boom"), (0, ""), "unavailable", None, 1),
])
async def test_registry_detects_three_states(tmp_path, monkeypatch, version, models, state, signed_in, n_models):
    from botteam import registry as reg
    from botteam.config import ConfigStore

    fake = tmp_path / "agy.exe"
    fake.write_text("x")

    async def fake_run(args, timeout=15):
        return version if "--version" in args else models

    monkeypatch.setattr(reg, "run_text", fake_run)
    r = reg.Registry(ConfigStore(tmp_path / "cfg"), with_echo=False)
    r.config.instances["antigravity"] = {"path": str(fake)}
    inst = await r._add("antigravity", "antigravity", "Antigravity")
    assert (inst.state, inst.signed_in, len(inst.models)) == (state, signed_in, n_models)
    assert inst.models[0]["id"] == "default"
    if signed_in is False:
        assert "agy" in inst.reason
    if state == "available":
        assert inst.driver.provider == "antigravity" and inst.public()["capabilities"]["images"] is True


async def test_registry_without_the_cli_is_unavailable(tmp_path, monkeypatch):
    from botteam import registry as reg
    from botteam.config import ConfigStore

    monkeypatch.setattr(reg.shutil, "which", lambda _n: None)
    monkeypatch.setattr(reg, "antigravity_paths", lambda: [])
    r = reg.Registry(ConfigStore(tmp_path / "cfg"), with_echo=False)
    inst = await r._add("antigravity", "antigravity", "Antigravity")
    assert inst.state == "unavailable" and "not found" in inst.reason


async def test_sign_in_link_from_stderr_reaches_the_error(monkeypatch):
    monkeypatch.setenv("FAKE_ACP_AUTH", "1")
    d = AntigravityDriver([sys.executable, FAKE])
    c = Collector(d)
    await d.send_turn(inp("hello"))
    await c.until("turn.completed")
    err = [e for e in c.events if e.type == "runtime.error"][0].data
    assert err["setup"] is True and "https://accounts.example/auth?x=1" in err["message"]
    await d.stop_all()


async def test_an_image_too_big_to_send_is_named_by_path(tmp_path, log, monkeypatch):
    from botteam.drivers import antigravity as ag

    monkeypatch.setattr(ag, "MAX_IMAGE_BYTES", 3)
    img = tmp_path / "big.png"
    img.write_bytes(b"\x89PNG-more-than-3-bytes")
    d = AntigravityDriver([sys.executable, FAKE])
    c = Collector(d)
    await d.send_turn(inp("hello", attachments=[str(img)], image_attachments=[str(img)]))
    await c.until("turn.completed")
    blocks = [m for m in log() if m.get("method") == "session/prompt"][0]["params"]["prompt"]
    assert len(blocks) == 1 and str(img) in blocks[0]["text"]
    await d.stop_all()


async def test_models_listing_is_reused_but_a_failure_is_not(monkeypatch):
    from botteam import registry as reg

    calls = []

    async def fake_run(args, timeout=15):
        calls.append(1)
        return (0, "m\tM") if len(calls) < 3 else (-1, "boom")

    monkeypatch.setattr(reg, "run_text", fake_run)
    reg._MODELS_CACHE.clear()
    assert await reg.models_listing("agy-x") == (0, "m\tM") and await reg.models_listing("agy-x") == (0, "m\tM")
    assert len(calls) == 1
    reg._MODELS_CACHE.clear()
    calls.extend([1, 1])
    assert (await reg.models_listing("agy-y"))[0] == -1 and (await reg.models_listing("agy-y"))[0] == -1
    assert len(calls) == 5
