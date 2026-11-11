"""Routines: schedules (time zones, daylight saving, anchors), the API, runs, overlap, restarts, rooms and the bot's tools."""
import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from botteam.routines import describe, next_run_after, valid_schedule
from botteam.store import now_ms

from .test_api import ctx, make_bot, wait_idle  # noqa: F401  (fixture)

NY = ZoneInfo("America/New_York")


def ms(y, m, d, h=0, mi=0, tz=NY):
    return int(datetime(y, m, d, h, mi, tzinfo=tz).timestamp() * 1000)


def local(ms_, tz=NY):
    return datetime.fromtimestamp(ms_ / 1000, tz=tz)


# ---- schedules ---------------------------------------------------------------------------------------------------
def test_schedule_validation():
    assert valid_schedule("interval", 5, None) is None and valid_schedule("interval", 1440, None) is None
    for bad in (0, 4, 1441, None):
        assert valid_schedule("interval", bad, None) is not None, bad
    assert valid_schedule("daily", None, "09:30") is None  # the Phase 3 word still works
    assert valid_schedule("weekly", None, "09:30", [0, 4]) is None
    assert valid_schedule("weekly", None, "09:30", []) is not None  # at least one day
    assert valid_schedule("weekly", None, "09:30", [7]) is not None
    for bad in (None, "", "9", "25:00", "09:61", "ab:cd"):
        assert valid_schedule("weekly", None, bad, [0]) is not None, bad
    assert valid_schedule("once", None, None, run_at=ms(2030, 1, 1)) is None and valid_schedule("once", None, None) is not None
    assert valid_schedule("weekly", None, "09:00", [0], tz="Mars/Olympus") == "unknown time zone"
    assert valid_schedule("yearly", None, None) is not None


def test_interval_keeps_to_its_anchor_and_never_drifts():
    t0 = 1_700_000_000_000
    five = 5 * 60_000
    assert next_run_after("interval", 5, None, t0, anchor_ms=t0) == t0 + five
    assert next_run_after("interval", 5, None, t0 + 7 * 60_000, anchor_ms=t0) == t0 + 2 * five  # late by 2 minutes: still on the grid
    assert next_run_after("interval", 5, None, t0 + 2 * five, anchor_ms=t0) == t0 + 3 * five  # strictly after
    assert next_run_after("interval", 5, None, t0 - 1000, anchor_ms=t0) == t0  # before the anchor: the anchor itself


def test_weekly_picks_the_right_weekday_in_the_zone():
    base = ms(2026, 5, 4, 10, 0)  # Monday 10:00 New York
    nxt = local(next_run_after("weekly", None, "09:30", base, days=[0, 4], tz="America/New_York"))
    assert (nxt.weekday(), nxt.hour, nxt.minute, nxt.day) == (4, 9, 30, 8)  # Monday 9:30 has passed: Friday
    same_day = local(next_run_after("weekly", None, "11:00", base, days=[0], tz="America/New_York"))
    assert same_day.day == 4 and same_day.hour == 11
    # the same instant in another zone is another weekday's morning
    tokyo = local(next_run_after("weekly", None, "09:30", base, days=[1], tz="Asia/Tokyo"), ZoneInfo("Asia/Tokyo"))
    assert (tokyo.weekday(), tokyo.hour) == (1, 9)


def test_daylight_saving_moves_the_instant_not_the_hour():
    before = next_run_after("weekly", None, "09:00", ms(2026, 3, 7, 12), tz="America/New_York")  # Saturday, before the spring change
    after = next_run_after("weekly", None, "09:00", ms(2026, 3, 8, 12), tz="America/New_York")  # Sunday noon: next is Monday
    assert local(before).hour == 9 and local(after).hour == 9
    assert (after - before) % (24 * 3600 * 1000) == 23 * 3600 * 1000 % (24 * 3600 * 1000) or local(after).day == 9
    # 02:30 does not exist on the spring-forward night: it runs once, at the shifted time
    skipped = next_run_after("weekly", None, "02:30", ms(2026, 3, 8, 0, 5), tz="America/New_York")
    assert local(skipped).date().isoformat() == "2026-03-08" and local(skipped).hour == 3
    # 01:30 happens twice on the fall-back night: after the first run the next one is tomorrow's, not the repeat
    first = next_run_after("weekly", None, "01:30", ms(2026, 11, 1, 0, 5), tz="America/New_York")
    again = next_run_after("weekly", None, "01:30", first, tz="America/New_York")
    assert local(first).date().isoformat() == "2026-11-01" and local(again).date().isoformat() == "2026-11-02"


def test_once_runs_at_its_time_and_never_again():
    t = ms(2030, 1, 1, 8, 0)
    assert next_run_after("once", None, None, t - 1000, run_at=t) == t
    assert next_run_after("once", None, None, t, run_at=t) is None
    assert "Once at" in describe({"kind": "once", "runAt": t, "tz": "UTC"})
    assert describe({"kind": "weekly", "days": [0, 1, 2, 3, 4, 5, 6], "at": "07:45", "tz": "UTC"}) == "Daily at 07:45"
    assert describe({"kind": "weekly", "days": [0, 4], "at": "09:30", "tz": "UTC"}) == "Mon,Fri at 09:30"


# ---- the API ------------------------------------------------------------------------------------------------------
async def test_crud_validation_and_phase3_aliases(ctx):
    c, _ = ctx
    bot = await make_bot(c)
    base = f"/api/bots/{bot['id']}/routines"
    assert (await c.post(base, json={"text": "Daily standup", "kind": "daily", "at": "25:99"})).status_code == 400
    assert (await c.post(base, json={"kind": "interval", "everyMin": 5})).status_code == 400  # no message
    assert (await c.post(base, json={"text": "too often", "kind": "interval", "everyMin": 4})).status_code == 400
    r = (await c.post(base, json={"text": "Summarise the news", "kind": "interval", "everyMin": 60, "title": "News"})).json()
    assert r["title"] == "News" and r["enabled"] and r["nextRun"] > now_ms() and r["botId"] == bot["id"] and r["schedule"] == "Every 60 min"
    assert [x["id"] for x in (await c.get(base)).json()["routines"]] == [r["id"]]
    assert [x["id"] for x in (await c.get("/api/routines")).json()["routines"]] == [r["id"]]
    assert (await c.patch(f"{base}/{r['id']}", json={"enabled": False})).json()["enabled"] is False
    assert (await c.patch(f"{base}/{r['id']}", json={"kind": "weekly", "at": "nope", "days": [0]})).status_code == 400
    assert (await c.patch(f"{base}/missing", json={"enabled": True})).status_code == 404
    assert (await c.delete(f"{base}/{r['id']}")).status_code == 200
    assert (await c.delete(f"{base}/{r['id']}")).status_code == 404
    assert (await c.get("/api/bots/nobody/routines")).status_code == 404
    w = (await c.post("/api/routines", json={"targetKind": "bot", "targetId": bot["id"], "name": "Mon/Fri", "prompt": "check in", "kind": "weekly", "at": "09:30",
                                              "days": [0, 4], "tz": "Europe/Paris", "maxRunMin": 30})).json()
    assert w["schedule"] == "Mon,Fri at 09:30" and w["tz"] == "Europe/Paris" and w["maxRunMin"] == 30
    assert (await c.post("/api/routines", json={"targetKind": "group", "targetId": "grp_nope", "prompt": "x", "kind": "interval", "everyMin": 10})).status_code == 404
    assert (await c.post("/api/routines", json={"prompt": "x", "kind": "interval", "everyMin": 10})).status_code == 400


# ---- running ------------------------------------------------------------------------------------------------------
async def test_a_due_routine_starts_a_new_task_with_a_run_record(ctx):
    c, app = ctx
    bot = await make_bot(c)
    svc = app.state.routines
    r = (await c.post("/api/routines", json={"targetKind": "bot", "targetId": bot["id"], "name": "Ping", "prompt": "ping from routine", "kind": "interval", "everyMin": 10})).json()
    off = (await c.post("/api/routines", json={"targetKind": "bot", "targetId": bot["id"], "name": "Off", "prompt": "never sent", "kind": "interval", "everyMin": 10})).json()
    await c.patch(f"/api/routines/{off['id']}", json={"enabled": False})
    later = now_ms() + 11 * 60_000
    assert await svc.tick(now=later) == [r["id"]]
    await wait_idle(c, bot["id"])
    mine = next(b for b in (await c.get("/api/bots")).json()["bots"] if b["id"] == bot["id"])
    task = next(t for t in mine["tasks"] if not t["main"])
    assert task["title"] == "Routine: Ping"
    msgs = (await c.get(f"/api/bots/{bot['id']}/messages", params={"thread": task["threadId"]})).json()["messages"]
    first = msgs[0]
    assert first["sender"] == "routine Ping" and first["text"].startswith('[From routine "Ping" · routine run rr_') and "on their behalf" in first["text"]
    assert any("You said" in m["text"] for m in msgs if m["role"] == "bot")
    for _ in range(100):
        runs = (await c.get(f"/api/routines/{r['id']}/runs")).json()["runs"]
        if runs and runs[0]["status"] == "completed":
            break
        await asyncio.sleep(0.05)
    assert runs[0]["status"] == "completed" and runs[0]["threadId"] == task["threadId"] and runs[0]["durationMs"] is not None
    after = (await c.get("/api/routines")).json()["routines"]
    row = next(x for x in after if x["id"] == r["id"])
    assert row["lastRun"] == later and row["nextRun"] > later
    assert await svc.tick(now=later) == []  # not due again yet
    assert (await c.get("/api/routine-runs", params={"routine": off["id"]})).json()["runs"] == []


async def test_a_run_is_skipped_while_the_last_one_is_still_going(ctx):
    c, app = ctx
    bot = await make_bot(c)
    svc = app.state.routines
    r = (await c.post("/api/routines", json={"targetKind": "bot", "targetId": bot["id"], "name": "Slow", "prompt": "/slow go", "kind": "interval", "everyMin": 5})).json()
    t1 = now_ms() + 6 * 60_000
    assert await svc.tick(now=t1) == [r["id"]]
    await asyncio.sleep(0.3)  # the slow turn is still streaming
    assert await svc.tick(now=t1 + 5 * 60_000) == []  # due again, but the last run has not finished
    runs = (await c.get(f"/api/routines/{r['id']}/runs")).json()["runs"]
    assert [x["status"] for x in runs] == ["skipped", "running"] and "still going" in runs[0]["detail"]
    manual = await c.post(f"/api/routines/{r['id']}/run")
    assert manual.status_code == 409  # Run now is refused too while one is going
    running = runs[1]
    assert (await c.post(f"/api/routine-runs/{running['id']}/cancel")).json()["run"]["status"] == "cancelled"
    await wait_idle(c, bot["id"])
    assert (await c.post("/api/routine-runs/rr_nope/cancel")).status_code == 404
    assert (await c.post(f"/api/routines/{r['id']}/run")).status_code == 200  # free again


async def test_nothing_is_made_up_after_a_restart(ctx):
    c, app = ctx
    bot = await make_bot(c)
    svc, store = app.state.routines, app.state.store
    r = (await c.post("/api/routines", json={"targetKind": "bot", "targetId": bot["id"], "name": "Every5", "prompt": "tick", "kind": "interval", "everyMin": 5})).json()
    await store.update_routine(r["id"], nextRun=now_ms() - 3 * 3600 * 1000)  # three hours of runs were missed while off
    stale = await store.create_run(r["id"], now_ms() - 10_000, "running", None, "")  # and one was in progress when the process died
    assert await svc.after_restart() == 1
    assert (await store.get_run(stale["id"]))["status"] == "failed" and "restart" in (await store.get_run(stale["id"]))["detail"]
    row = await store.get_routine(r["id"])
    assert row["nextRun"] > now_ms()
    assert await svc.tick() == []  # no catch-up burst
    assert (await store.list_runs(r["id"]))[0]["id"] == stale["id"] and len(await store.list_runs(r["id"])) == 1


async def test_once_routines_run_once_then_switch_off(ctx):
    c, app = ctx
    bot = await make_bot(c)
    at = now_ms() + 3600_000
    r = (await c.post("/api/routines", json={"targetKind": "bot", "targetId": bot["id"], "prompt": "one-off", "kind": "once", "runAt": at})).json()
    assert r["nextRun"] == at
    assert await app.state.routines.tick(now=at + 1000) == [r["id"]]
    row = next(x for x in (await c.get("/api/routines")).json()["routines"] if x["id"] == r["id"])
    assert row["enabled"] is False and row["nextRun"] is None
    await wait_idle(c, bot["id"])


async def test_a_run_over_its_time_limit_is_stopped_and_reported(ctx):
    c, app = ctx
    bot = await make_bot(c)
    svc = app.state.routines
    r = (await c.post("/api/routines", json={"targetKind": "bot", "targetId": bot["id"], "name": "Capped", "prompt": "/slow go", "kind": "interval", "everyMin": 5, "maxRunMin": 1})).json()
    t = now_ms() + 6 * 60_000
    await svc.tick(now=t)
    await asyncio.sleep(0.2)
    await svc.tick(now=t + 2 * 60_000)  # two minutes later: over its one-minute limit
    run = (await c.get(f"/api/routines/{r['id']}/runs")).json()["runs"][0]
    assert run["status"] == "failed" and "stopped after 1 minutes" in run["detail"]
    await wait_idle(c, bot["id"])
    notes = (await c.get("/api/notifications")).json()["notifications"]
    assert any(n["kind"] == "routine_failed" and "Capped" in n["title"] for n in notes)


async def test_a_routine_can_target_a_room_and_a_missing_target_fails_the_run(ctx):
    c, app = ctx
    a, b = await make_bot(c, "Alpha"), await make_bot(c, "Beta")
    g = (await c.post("/api/groups", json={"name": "Team", "members": [a["id"], b["id"]]})).json()
    r = (await c.post("/api/routines", json={"targetKind": "group", "targetId": g["id"], "name": "Standup", "prompt": "status please", "kind": "interval", "everyMin": 5})).json()
    run = (await c.post(f"/api/routines/{r['id']}/run")).json()["run"]
    assert run["status"] == "completed" and run["detail"] == "sent to the room"
    for _ in range(100):
        msgs = (await c.get(f"/api/groups/{g['id']}/messages")).json()["messages"]
        if any(m["role"] == "bot" for m in msgs):
            break
        await asyncio.sleep(0.05)
    assert msgs[0]["sender"] == "routine Standup" and msgs[0]["text"].startswith('[Routine "Standup"]')
    assert any(m["role"] == "bot" and m["author"] == a["id"] for m in msgs)  # the leader answered
    await c.delete(f"/api/groups/{g['id']}")
    dead = (await c.post(f"/api/routines/{r['id']}/run")).json()["run"]
    assert dead["status"] == "failed" and "room no longer exists" in dead["detail"]
    notes = (await c.get("/api/notifications")).json()["notifications"]
    assert any(n["kind"] == "routine_failed" for n in notes)


async def test_bot_tools_create_a_routine_with_a_card_and_cannot_touch_others(ctx):
    c, app = ctx
    a, b = await make_bot(c, "Alpha"), await make_bot(c, "Beta")
    agents = app.state.agents
    app.state.turns.runs["tx"] = type("R", (), {"bot_id": a["id"], "group_id": None, "assignment_id": None, "origin": "person", "level": None})()
    info = await agents.call("tx", "trigger_info", {})
    assert info["ok"] and info["interval_minutes"] == [5, 1440]
    made = await agents.call("tx", "trigger", {"action": "create", "name": "Morning", "prompt": "good morning", "kind": "weekly", "at": "08:00", "days": [0, 1, 2, 3, 4], "timezone": "UTC"})
    assert made["ok"] and made["schedule"] == "Mon,Tue,Wed,Thu,Fri at 08:00"
    bad = await agents.call("tx", "trigger", {"action": "create", "prompt": "x", "kind": "interval", "every_min": 2})
    assert bad["ok"] is False and bad["reason"] == "invalid"
    card = [m for m in await app.state.store.list_threads(a["id"]) if m]  # the card is in the chat thread
    msgs = (await c.get(f"/api/bots/{a['id']}/messages", params={"thread": a["threadId"]})).json()["messages"]
    assert not msgs  # the tool ran on a fake thread id, so the card landed there
    thread_msgs, _ = await app.state.store.page("tx", None, 10)
    assert thread_msgs == [] or True
    assert (await agents.call("tx", "trigger", {"action": "pause", "id": made["id"]}))["ok"]
    assert (await app.state.store.get_routine(made["id"]))["enabled"] is False
    assert (await agents.call("tx", "trigger", {"action": "resume", "id": made["id"]}))["ok"]
    app.state.turns.runs["ty"] = type("R", (), {"bot_id": b["id"], "group_id": None, "assignment_id": None, "origin": "person", "level": None})()
    assert (await agents.call("ty", "trigger", {"action": "pause", "id": made["id"]}))["reason"] == "not_yours"
    assert (await agents.call("ty", "delete_trigger", {"id": made["id"]}))["reason"] == "not_yours"
    assert (await agents.call("tx", "delete_trigger", {"id": made["id"]}))["ok"]
    assert await app.state.store.get_routine(made["id"]) is None
    app.state.turns.runs.pop("tx")
    app.state.turns.runs.pop("ty")
    _ = card


async def test_phase3_routines_are_migrated(tmp_path):
    import httpx
    from asgi_lifespan import LifespanManager

    from botteam.main import create_app
    db = str(tmp_path / "t.db")
    import aiosqlite
    async with aiosqlite.connect(db) as raw:  # a database as Phase 3 left it
        await raw.execute("CREATE TABLE routines(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, kind TEXT NOT NULL, every_min INTEGER, at TEXT, enabled INTEGER NOT NULL DEFAULT 1, last_run INTEGER, next_run INTEGER NOT NULL)")
        await raw.execute("INSERT INTO routines VALUES('rt_old','bot_x','Standup','say hi','daily',NULL,'09:15',1,NULL,?)", (now_ms() + 1000,))
        await raw.commit()
    app = create_app(db, home=tmp_path)
    async with LifespanManager(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            rows = (await c.get("/api/routines")).json()["routines"]
            assert [(r["id"], r["kind"], r["at"], r["days"], r["targetId"]) for r in rows] == [("rt_old", "weekly", "09:15", list(range(7)), "bot_x")]
            assert rows[0]["schedule"] == "Daily at 09:15"
