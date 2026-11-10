import asyncio

import httpx
import pytest
from asgi_lifespan import LifespanManager

from botteam.main import create_app


@pytest.fixture
async def ctx(tmp_path):
    app = create_app(str(tmp_path / "t.db"), home=tmp_path)
    async with LifespanManager(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            yield c, app


async def make_bot(c, name="A"):
    sel = {"instanceId": "echo", "model": "echo-1"}
    return (await c.post("/api/bots", json={"name": name, "modelSelection": sel})).json()


async def wait_idle(c, bot_id, timeout=6.0):
    for _ in range(int(timeout / 0.05)):
        await asyncio.sleep(0.05)
        bots = (await c.get("/api/bots")).json()["bots"]
        b = next(x for x in bots if x["id"] == bot_id)
        if not b["busy"]:
            return b
    raise AssertionError("bot never became idle")


async def history(c, bot_id, **params):
    return (await c.get(f"/api/bots/{bot_id}/messages", params=params)).json()["messages"]


async def test_bot_crud(ctx):
    c, _ = ctx
    bot = await make_bot(c, "Brody")
    assert bot["threadId"] == bot["mainThreadId"]
    assert [t["main"] for t in bot["tasks"]] == [True]
    r = await c.patch(f"/api/bots/{bot['id']}", json={"pinned": True})
    assert r.json()["pinned"] is True
    assert (await c.delete(f"/api/bots/{bot['id']}")).status_code == 200
    assert (await c.get("/api/bots")).json()["bots"] == []


async def test_turn_streams_and_persists(ctx):
    c, _ = ctx
    bot = await make_bot(c)
    assert (await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "hi there"})).status_code == 202
    b = await wait_idle(c, bot["id"])
    msgs = await history(c, bot["id"])
    assert [m["role"] for m in msgs] == ["user", "bot"]
    assert msgs[1]["text"] == "You said: hi there" and not msgs[1]["streaming"]
    assert b["unread"] is True and b["usage"]["turns"] == 1


async def test_tool_activity_message(ctx):
    c, _ = ctx
    bot = await make_bot(c)
    await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "/tool go"})
    await wait_idle(c, bot["id"])
    msgs = await history(c, bot["id"])
    tools = [m for m in msgs if m["kind"] == "activity"]
    assert len(tools) == 1 and tools[0]["tool"]["name"] == "Bash" and tools[0]["tool"]["ok"] is True


async def test_error_message_and_session_cursor(ctx):
    c, app = ctx
    bot = await make_bot(c)
    await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "/error"})
    await wait_idle(c, bot["id"])
    msgs = await history(c, bot["id"])
    assert msgs[-1]["kind"] == "error" and "Simulated" in msgs[-1]["text"]
    t = await app.state.store.get_thread(bot["threadId"])
    assert t["cursor"] == f"echo-{bot['threadId']}"


async def test_interrupt_stops_and_marks(ctx):
    c, _ = ctx
    bot = await make_bot(c)
    await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "/slow"})
    await asyncio.sleep(0.3)
    await c.post(f"/api/bots/{bot['id']}/interrupt")
    await wait_idle(c, bot["id"])
    msgs = await history(c, bot["id"])
    assert msgs[-1]["kind"] == "stopped"


async def test_busy_message_is_queued_then_runs_and_stop_clears_queue(ctx):
    c, _ = ctx
    bot = await make_bot(c)
    await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "/slow"})
    await asyncio.sleep(0.2)
    r = await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "second"})
    assert r.json()["message"]["queued"] is True
    await c.post(f"/api/bots/{bot['id']}/interrupt")
    await wait_idle(c, bot["id"])
    assert all(m["text"] != "second" for m in await history(c, bot["id"]))

    await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "/tool first"})
    await asyncio.sleep(0.05)
    await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "queued one"})
    await wait_idle(c, bot["id"], 8)
    await asyncio.sleep(0.5)
    await wait_idle(c, bot["id"], 8)
    texts = [m["text"] for m in await history(c, bot["id"]) if m["role"] == "bot" and m["kind"] == "text"]
    assert "You said: queued one" in texts


async def test_tasks_are_independent_conversations(ctx):
    c, _ = ctx
    bot = await make_bot(c)
    t2 = (await c.post(f"/api/bots/{bot['id']}/tasks", json={})).json()["threadId"]
    await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "in task", "threadId": t2})
    await wait_idle(c, bot["id"])
    assert len(await history(c, bot["id"], thread=t2)) == 2
    assert await history(c, bot["id"], thread=bot["mainThreadId"]) == []
    bots = (await c.get("/api/bots")).json()["bots"]
    assert [t["title"] for t in bots[0]["tasks"] if not t["main"]] == ["in task"]
    assert (await c.delete(f"/api/bots/{bot['id']}/tasks/{t2}")).status_code == 200
    assert (await c.delete(f"/api/bots/{bot['id']}/tasks/{bot['mainThreadId']}")).status_code == 400


async def test_edit_creates_branch_and_switching(ctx):
    c, _ = ctx
    bot = await make_bot(c)
    await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "one"})
    await wait_idle(c, bot["id"])
    first = (await history(c, bot["id"]))[0]
    await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "uno", "branch": True, "parentId": first["parentId"]})
    await wait_idle(c, bot["id"])
    msgs = await history(c, bot["id"])
    assert [m["text"] for m in msgs] == ["uno", "You said: uno"]
    assert len(msgs[0]["siblings"]) == 2
    leaf = (await c.put(f"/api/threads/{bot['threadId']}/leaf", json={"messageId": first["id"]})).json()["activeLeafId"]
    assert leaf
    assert [m["text"] for m in await history(c, bot["id"])] == ["one", "You said: one"]


async def test_pagination(ctx):
    c, _ = ctx
    bot = await make_bot(c)
    for i in range(3):
        await c.post(f"/api/bots/{bot['id']}/messages", json={"text": f"m{i}"})
        await wait_idle(c, bot["id"])
    all_msgs = await history(c, bot["id"])
    assert len(all_msgs) == 6
    page = (await c.get(f"/api/bots/{bot['id']}/messages", params={"before": all_msgs[3]["id"]})).json()
    assert [m["id"] for m in page["messages"]] == [m["id"] for m in all_msgs[:3]]


async def test_unavailable_engine_reports_instead_of_crashing(ctx):
    c, _ = ctx
    bot = (await c.post("/api/bots", json={"name": "X", "modelSelection": {"instanceId": "nope", "model": "m"}})).json()
    r = await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "hello"})
    assert r.status_code == 202
    msgs = await history(c, bot["id"])
    assert msgs[-1]["kind"] == "error" and msgs[-1]["error"]["setup"] is True


async def test_instances_listed_and_secrets_never_returned(ctx):
    c, app = ctx
    ids = {i["id"] for i in (await c.get("/api/instances")).json()["instances"]}
    assert {"claude", "codex", "echo"} <= ids
    r = await c.post("/api/instances", json={"displayName": "Local", "baseUrl": "http://127.0.0.1:9/v1", "apiKey": "sk-secret", "models": ["m1"]})
    assert r.status_code == 201 and "sk-secret" not in r.text
    assert "sk-secret" not in (await c.get("/api/instances")).text
    assert "sk-secret" not in (await c.get("/api/config")).text


# ---- host-level behaviour with a fake `claude` binary -------------------------------------------------
import json  # noqa: E402
import sys  # noqa: E402
from pathlib import Path  # noqa: E402

from botteam import turns as turns_mod  # noqa: E402
from botteam.drivers.claude import CLAUDE_MODELS, ClaudeDriver  # noqa: E402
from botteam.registry import Instance  # noqa: E402

FAKE = str(Path(__file__).parent / "fake_claude.py")


@pytest.fixture
async def claude_ctx(tmp_path, monkeypatch):
    argv = tmp_path / "argv.jsonl"
    monkeypatch.setenv("FAKE_CLAUDE_ARGV", str(argv))
    monkeypatch.setattr(turns_mod, "RETRY_DELAYS", (0.05, 0.05))
    app = create_app(str(tmp_path / "t.db"), home=tmp_path)
    async with LifespanManager(app):
        drv = ClaudeDriver([sys.executable, FAKE])
        drv.on_event(app.state.turns._events.put_nowait)
        app.state.registry.instances["claude"] = Instance("claude", "claude", "Claude Code", driver=drv, state="available", models=CLAUDE_MODELS)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            bot = (await c.post("/api/bots", json={"name": "C", "modelSelection": {"instanceId": "claude", "model": "default"}})).json()
            yield c, app, bot, argv
        await drv.stop_all()


async def test_claude_end_to_end_with_resume_and_tools(claude_ctx):
    c, app, bot, argv = claude_ctx
    await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "tool run"})
    await wait_idle(c, bot["id"])
    msgs = await history(c, bot["id"])
    assert [m["kind"] for m in msgs] == ["text", "text", "activity", "text"]
    assert msgs[2]["tool"]["ok"] is True and msgs[2]["tool"]["output"] == "file.txt"
    assert msgs[3]["text"].startswith("ok:")
    t = await app.state.store.get_thread(bot["threadId"])
    assert t["cursor"] == "sess-123"
    assert "--append-system-prompt" in json.loads(argv.read_text().splitlines()[0])
    log = (app.state.turns.log_dir / f"{bot['threadId']}.ndjson").read_text()
    assert '"session.started"' in log and '"content.delta"' not in log


async def test_claude_crash_is_retried_then_reported(claude_ctx):
    c, app, bot, argv = claude_ctx
    await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "crash now"})
    await wait_idle(c, bot["id"], 10)
    assert len(argv.read_text().splitlines()) == 3  # first try + two retries
    msgs = await history(c, bot["id"])
    assert msgs[-1]["kind"] == "error" and "exited unexpectedly" in msgs[-1]["text"]


async def test_steer_while_busy_is_not_queued(claude_ctx):
    c, app, bot, argv = claude_ctx
    await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "hang"})
    await asyncio.sleep(0.4)
    r = await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "also this"})
    assert r.json()["message"]["steered"] is True and r.json()["message"]["queued"] is False
    await c.post(f"/api/bots/{bot['id']}/interrupt")
    await wait_idle(c, bot["id"])
