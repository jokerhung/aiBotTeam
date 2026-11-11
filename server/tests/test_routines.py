"""Routines: schedules, the REST API, and the scheduler sending due messages."""
import asyncio
from datetime import datetime

from botteam.routines import next_run_after, valid_schedule
from botteam.store import now_ms

from .test_api import ctx, make_bot, wait_idle  # noqa: F401  (fixture)


def test_schedule_validation():
    assert valid_schedule("interval", 30, None) is None
    assert valid_schedule("interval", 0, None) is not None
    assert valid_schedule("interval", 10_000_000, None) is not None
    assert valid_schedule("interval", None, None) is not None
    assert valid_schedule("daily", None, "09:30") is None
    for bad in (None, "", "9", "25:00", "09:61", "ab:cd"):
        assert valid_schedule("daily", None, bad) is not None, bad
    assert valid_schedule("weekly", 5, None) is not None


def test_next_run_interval_and_daily():
    t0 = 1_700_000_000_000
    assert next_run_after("interval", 15, None, t0) == t0 + 15 * 60_000
    morning = int(datetime(2026, 5, 1, 8, 0).timestamp() * 1000)
    assert datetime.fromtimestamp(next_run_after("daily", None, "09:30", morning) / 1000) == datetime(2026, 5, 1, 9, 30)
    evening = int(datetime(2026, 5, 1, 18, 0).timestamp() * 1000)
    assert datetime.fromtimestamp(next_run_after("daily", None, "09:30", evening) / 1000) == datetime(2026, 5, 2, 9, 30)
    exact = int(datetime(2026, 5, 1, 9, 30).timestamp() * 1000)  # at the minute itself: tomorrow, not again now
    assert datetime.fromtimestamp(next_run_after("daily", None, "09:30", exact) / 1000) == datetime(2026, 5, 2, 9, 30)


async def test_crud_and_validation(ctx):
    c, _ = ctx
    bot = await make_bot(c)
    base = f"/api/bots/{bot['id']}/routines"
    assert (await c.post(base, json={"text": "Daily standup", "kind": "daily", "at": "25:99"})).status_code == 400
    assert (await c.post(base, json={"kind": "interval", "everyMin": 5})).status_code == 400  # no message
    r = (await c.post(base, json={"text": "Summarise the news", "kind": "interval", "everyMin": 60, "title": "News"})).json()
    assert r["title"] == "News" and r["enabled"] and r["nextRun"] > now_ms()
    assert [x["id"] for x in (await c.get(base)).json()["routines"]] == [r["id"]]
    p = (await c.patch(f"{base}/{r['id']}", json={"enabled": False})).json()
    assert p["enabled"] is False
    assert (await c.patch(f"{base}/{r['id']}", json={"kind": "daily", "at": "nope"})).status_code == 400
    assert (await c.patch(f"{base}/missing", json={"enabled": True})).status_code == 404
    assert (await c.delete(f"{base}/{r['id']}")).status_code == 200
    assert (await c.delete(f"{base}/{r['id']}")).status_code == 404
    assert (await c.get(f"/api/bots/nobody/routines")).status_code == 404


async def test_scheduler_sends_due_routines_only(ctx):
    c, app = ctx
    bot = await make_bot(c)
    base = f"/api/bots/{bot['id']}/routines"
    due = (await c.post(base, json={"text": "ping from routine", "kind": "interval", "everyMin": 10})).json()
    off = (await c.post(base, json={"text": "never sent", "kind": "interval", "everyMin": 10})).json()
    await c.patch(f"{base}/{off['id']}", json={"enabled": False})
    later = now_ms() + 11 * 60_000
    ran = await app.state.scheduler.run_due(now=later)
    assert ran == [due["id"]]
    await wait_idle(c, bot["id"])
    texts = [m["text"] for m in (await c.get(f"/api/bots/{bot['id']}/messages")).json()["messages"] if m["role"] == "user"]
    assert texts == ["ping from routine"]
    after = (await c.get(base)).json()["routines"]
    ran_row = next(x for x in after if x["id"] == due["id"])
    assert ran_row["lastRun"] == later and ran_row["nextRun"] == later + 10 * 60_000  # next one is scheduled from this run
    assert await app.state.scheduler.run_due(now=later) == []  # not due again yet


async def test_busy_bot_keeps_the_routine_due(ctx):
    c, app = ctx
    bot = await make_bot(c)
    base = f"/api/bots/{bot['id']}/routines"
    r = (await c.post(base, json={"text": "second message", "kind": "interval", "everyMin": 5})).json()
    await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "/slow"})  # keeps the bot busy for a while
    await asyncio.sleep(0.3)
    later = now_ms() + 6 * 60_000
    assert await app.state.scheduler.run_due(now=later) == []
    still = (await c.get(base)).json()["routines"][0]
    assert still["lastRun"] is None and still["nextRun"] <= later  # skipped this tick, not dropped
    await c.post(f"/api/bots/{bot['id']}/interrupt")
    await wait_idle(c, bot["id"])
    assert await app.state.scheduler.run_due(now=later) == [r["id"]]


async def test_run_now_and_busy_conflict(ctx):
    c, _ = ctx
    bot = await make_bot(c)
    base = f"/api/bots/{bot['id']}/routines"
    r = (await c.post(base, json={"text": "run me", "kind": "daily", "at": "03:00"})).json()
    ok = await c.post(f"{base}/{r['id']}/run")
    assert ok.status_code == 200 and ok.json()["lastRun"] is not None
    await wait_idle(c, bot["id"])
    await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "/slow"})
    await asyncio.sleep(0.3)
    assert (await c.post(f"{base}/{r['id']}/run")).status_code == 409
    await c.post(f"/api/bots/{bot['id']}/interrupt")
    await wait_idle(c, bot["id"])


async def test_deleting_a_bot_removes_its_routines(ctx):
    c, app = ctx
    bot = await make_bot(c)
    await c.post(f"/api/bots/{bot['id']}/routines", json={"text": "x", "kind": "interval", "everyMin": 5})
    await c.delete(f"/api/bots/{bot['id']}")
    assert await app.state.store.due_routines(now_ms() + 10**12) == []
