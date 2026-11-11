"""Looking back: runs and their tools, the waterfall of a turn, usage that adds up, the context meter, the usage-limit reset, and exported transcripts."""
import json

from botteam.events import RuntimeEvent
from botteam.observe import context_window, runs_of, to_markdown, trace_of

from .test_api import ctx, make_bot, wait_idle  # noqa: F401  (fixture)
from .test_memory import stand_in


async def send(c, bot, text):
    await c.post(f"/api/bots/{bot['id']}/messages", json={"text": text})
    await wait_idle(c, bot["id"])


async def test_a_bots_runs_show_time_tools_and_usage_and_each_has_a_waterfall(ctx):
    c, _ = ctx
    bot = await make_bot(c)
    await send(c, bot, "/tool first")
    await send(c, bot, "plain second")
    runs = (await c.get(f"/api/bots/{bot['id']}/runs")).json()["runs"]
    assert len(runs) == 2 and runs[0]["startedAt"] >= runs[1]["startedAt"]  # newest first
    tooled = next(r for r in runs if r["tools"])
    assert tooled["ok"] is True and tooled["durationMs"] > 0 and tooled["tools"][0]["name"] == "Bash" and tooled["tools"][0]["ms"] > 0
    assert tooled["usage"]["output"] == 10 and tooled["threadId"] == bot["threadId"]
    tr = (await c.get(f"/api/threads/{bot['threadId']}/trace", params={"turn": tooled["turnId"]})).json()
    (span,) = tr["spans"]
    assert span["kind"] == "tool" and span["name"] == "Bash" and 0 <= span["startMs"] < span["endMs"] <= tr["totalMs"] and tr["firstTextMs"] is not None
    assert (await c.get(f"/api/threads/{bot['threadId']}/trace", params={"turn": "turn_nope"})).status_code == 404


def test_the_run_and_trace_readers_handle_an_unfinished_turn():
    ev = lambda t, ms, **d: {"type": t, "turnId": "t1", "createdAt": f"2026-11-11T10:00:{ms // 1000:02d}.{ms % 1000:03d}+00:00", "data": d}
    log = [ev("turn.started", 0), ev("item.started", 100, itemType="tool", itemId="a", title="Read", summary="x"), ev("item.completed", 1100, itemType="tool", itemId="a", ok=True),
           ev("item.started", 1200, itemType="tool", itemId="b", title="Bash", summary="ls"), ev("runtime.error", 3000, message="boom")]
    (run,) = runs_of(log, "th")
    assert run["endedAt"] is None and run["durationMs"] is None and run["error"] == "boom" and run["tools"][0]["ms"] == 1000
    tr = trace_of(log, "t1")
    assert [(s["name"], s["ok"]) for s in tr["spans"]] == [("Read", True), ("Bash", False)] and tr["spans"][1]["endMs"] == tr["totalMs"] == 3000  # a call that never ended runs to the end


async def test_usage_adds_up_to_the_turns_by_day_bot_and_model(ctx):
    c, app = ctx
    a, b = await make_bot(c, "Ann"), await make_bot(c, "Ben")
    for bot, text in ((a, "hello there"), (a, "another one"), (b, "from ben")):
        await send(c, bot, text)
    rows = await app.state.store.usage_rows()
    assert len(rows) == 3
    total = (await c.get("/api/usage")).json()["total"]
    expect_in, expect_out = sum(r["input"] for r in rows), sum(r["output"] for r in rows)
    assert total == {"input": expect_in, "output": expect_out, "cost": 0, "turns": 3}
    # and it matches what each turn reported in the event logs
    logged_in = logged_out = 0
    for bot in (a, b):
        for e in json.loads("[" + ",".join((app.state.turns.log_dir / f"{bot['threadId']}.ndjson").read_text().splitlines()) + "]"):
            if e["type"] == "turn.completed":
                logged_in += e["data"]["usage"]["input"]; logged_out += e["data"]["usage"]["output"]
    assert (logged_in, logged_out) == (expect_in, expect_out)
    by_bot = {r["key"]: r for r in (await c.get("/api/usage", params={"by": "bot"})).json()["rows"]}
    assert by_bot["Ann"]["turns"] == 2 and by_bot["Ben"]["turns"] == 1 and by_bot["Ann"]["input"] + by_bot["Ben"]["input"] == expect_in
    assert [r["key"] for r in (await c.get("/api/usage", params={"by": "model"})).json()["rows"]] == ["echo-1"]
    assert len((await c.get("/api/usage")).json()["rows"]) == 1  # one day
    assert (await c.get("/api/usage", params={"since": 4_000_000_000_000})).json()["total"]["turns"] == 0
    assert (await c.get("/api/usage", params={"by": "year"})).status_code == 400
    await c.delete(f"/api/bots/{a['id']}")  # a deleted bot's usage is still counted
    assert (await c.get("/api/usage")).json()["total"]["turns"] == 3 and "(deleted bot)" in {r["key"] for r in (await c.get("/api/usage", params={"by": "bot"})).json()["rows"]}


async def test_the_context_meter_and_the_usage_limit_reset(ctx):
    c, app = ctx
    assert context_window("claude-sonnet-5") == 200_000 and context_window("gpt-6.1-sol") == 400_000 and context_window("mystery") == 128_000
    bot = await make_bot(c)
    app.state.turns.runs[bot["threadId"]] = stand_in(bot)
    mk = lambda t, **d: RuntimeEvent(type=t, eventId="e", provider="claude", threadId=bot["threadId"], createdAt="", turnId="t", data=d)
    await app.state.turns._handle(mk("thread.token-usage.updated", input=1000, output=5, contextTokens=48_000))
    mine = next(b for b in (await c.get("/api/bots")).json()["bots"] if b["id"] == bot["id"])
    assert mine["usage"]["contextTokens"] == 48_000 and mine["usage"]["contextWindow"] == 128_000
    await app.state.turns._handle(mk("runtime.error", message="You have hit your usage limit", limit="usage", limitResetsAt=1_900_000_000_000))
    app.state.turns.runs.pop(bot["threadId"], None)
    assert (await c.get("/api/usage")).json()["limits"]["echo"]["resetsAt"] == 1_900_000_000_000  # the Usage page can say when it resets


async def test_a_transcript_exports_as_markdown_or_json_and_only_for_that_bots_threads(ctx):
    c, _ = ctx
    bot, other = await make_bot(c, "Ann"), await make_bot(c, "Ben")
    await send(c, bot, "please keep this")
    md = await c.get(f"/api/bots/{bot['id']}/export")
    assert md.status_code == 200 and "attachment" in md.headers["content-disposition"] and md.text.startswith("# Ann")
    assert "**You**" in md.text and "please keep this" in md.text and "You said: please keep this" in md.text
    js = (await c.get(f"/api/bots/{bot['id']}/export", params={"format": "json"})).json()
    assert js["bot"] == "Ann" and [m["text"] for m in js["messages"] if m["role"] == "user"] == ["please keep this"]
    assert (await c.get(f"/api/bots/{bot['id']}/export", params={"format": "pdf"})).status_code == 400
    assert (await c.get(f"/api/bots/{bot['id']}/export", params={"thread": other["threadId"]})).status_code == 404
    assert to_markdown("Z", "", [{"kind": "activity", "text": "", "at": 0}]).strip() == "# Z"
