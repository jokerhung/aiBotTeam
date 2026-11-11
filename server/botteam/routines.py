"""Routines: a prompt sent to a bot or a room on a schedule (once, on days of the week, or every 5-1440 minutes).

Each run is a new task with the routine as its root (`origin: routine`), recorded as a RoutineRun. An interval keeps to its
start anchor, a run is skipped when the last one is still going, and nothing is made up after a restart.
"""
from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .store import new_id, now_ms

TIME_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")
MIN_INTERVAL = 5
MAX_INTERVAL = 1440
DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def tz_of(name: Optional[str]) -> ZoneInfo | timezone:
    if not name or name.upper() == "UTC":
        return timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return timezone.utc


def valid_tz(name: Optional[str]) -> bool:
    if not name:
        return True
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError):
        return name.upper() == "UTC"


def normalize_kind(kind: Optional[str]) -> str:
    return "weekly" if kind == "daily" else (kind or "interval")  # the Phase 3 word for every-day is a weekly routine on all days


def valid_schedule(kind: str, every_min: Optional[int], at: Optional[str], days: Optional[list[int]] = None, run_at: Optional[int] = None,
                   tz: Optional[str] = None) -> Optional[str]:
    """None when the schedule is usable, otherwise why not."""
    kind = normalize_kind(kind)
    if not valid_tz(tz):
        return "unknown time zone"
    if kind == "interval":
        if every_min is None or not (MIN_INTERVAL <= every_min <= MAX_INTERVAL):
            return f"an interval must be between {MIN_INTERVAL} and {MAX_INTERVAL} minutes"
    elif kind == "weekly":
        if not at or not TIME_RE.match(at):
            return "a daily routine needs a time like 09:30"
        if days is not None and (not days or any((not isinstance(d, int)) or d < 0 or d > 6 for d in days)):
            return "pick at least one day of the week"
    elif kind == "once":
        if not run_at or run_at < 1:
            return "a one-time routine needs a date and time"
    else:
        return "unknown schedule kind"
    return None


def next_run_after(kind: str, every_min: Optional[int], at: Optional[str], after_ms: int, *, days: Optional[list[int]] = None, tz: Optional[str] = None,
                   anchor_ms: Optional[int] = None, run_at: Optional[int] = None) -> Optional[int]:
    """The first run strictly after `after_ms` (epoch milliseconds), or None when there is none (a one-time routine already past)."""
    kind = normalize_kind(kind)
    if kind == "once":
        return run_at if run_at and run_at > after_ms else None
    if kind == "interval":
        step = int(every_min or 60) * 60_000
        anchor = anchor_ms if anchor_ms is not None else after_ms
        if after_ms < anchor:
            return anchor
        k = (after_ms - anchor) // step + 1  # keep to the start anchor, never drift
        return anchor + k * step
    h, m = (int(x) for x in (at or "09:00").split(":"))
    zone = tz_of(tz)
    base = datetime.fromtimestamp(after_ms / 1000, tz=zone)
    allowed = set(days) if days else set(range(7))
    for add in range(0, 9):
        day = (base + timedelta(days=add)).date()
        if day.weekday() not in allowed:
            continue
        cand = datetime(day.year, day.month, day.day, h, m, tzinfo=zone)  # wall-clock time in the zone: DST moves the instant, not the hour
        ms = int(cand.timestamp() * 1000)
        if ms > after_ms:
            return ms
    return None


def describe(r: dict) -> str:
    if r["kind"] == "interval":
        return f"Every {r['everyMin']} min"
    if r["kind"] == "once":
        return "Once at " + datetime.fromtimestamp((r.get("runAt") or 0) / 1000, tz=tz_of(r.get("tz"))).strftime("%Y-%m-%d %H:%M")
    days = r.get("days") or list(range(7))
    label = "Daily" if len(days) == 7 else ",".join(DAY_NAMES[d] for d in sorted(days))
    return f"{label} at {r['at']}"


class RoutineService:
    """Definitions, runs and the scheduler. `start` it once; `tick` is what the loop calls (and what tests call with a fake clock)."""

    def __init__(self, store, turns, bus, groups=None, tick: float = 15.0) -> None:
        self.store, self.turns, self.bus, self.groups = store, turns, bus, groups
        self.webhooks = None  # set by the app: a bot may ask for a webhook through `trigger`
        self.tick_seconds = tick
        self._task: Optional[asyncio.Task] = None
        self.run_threads: dict[str, str] = {}  # routine run id -> its task thread, while it is running
        self.notify = None  # notifications service (set by the app)

    # ---- lifecycle ------------------------------------------------------------------------------------------------
    def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    async def _loop(self) -> None:
        while True:
            try:
                await self.tick()
            except Exception as e:  # the scheduler outlives any single bad routine
                print(f"[routines] tick failed: {type(e).__name__}: {e}")
            await asyncio.sleep(self.tick_seconds)

    async def after_restart(self, now: Optional[int] = None) -> int:
        """Runs missed while the server was off are not made up: every enabled routine moves to its next future time, and a run that
        was in progress when the process died is closed as interrupted."""
        now = now_ms() if now is None else now
        n = 0
        for rid in await self.store.interrupt_running_routine_runs(now):
            n += 1
        for r in await self.store.list_routines():
            if not r["enabled"]:
                continue
            nxt = next_run_after(r["kind"], r["everyMin"], r["at"], now, days=r["days"], tz=r["tz"], anchor_ms=r["anchor"], run_at=r["runAt"])
            if nxt != r["nextRun"]:
                await self.store.update_routine(r["id"], nextRun=nxt, enabled=nxt is not None)
        return n

    # ---- views ------------------------------------------------------------------------------------------------------
    def public(self, r: dict) -> dict:
        return {**r, "schedule": describe(r), "botId": r["targetId"] if r["targetKind"] == "bot" else None, "title": r["name"], "text": r["prompt"]}

    async def publish(self, rid: str, deleted: bool = False) -> None:
        if deleted:
            self.bus.publish({"kind": "routine.deleted", "routineId": rid})
            return
        r = await self.store.get_routine(rid)
        if r:
            self.bus.publish({"kind": "routine", "routine": self.public(r)})

    async def publish_run(self, run: dict) -> None:
        self.bus.publish({"kind": "routine.run", "run": run})

    # ---- definitions ----------------------------------------------------------------------------------------------
    async def create(self, *, target_kind: str, target_id: str, name: str, prompt: str, kind: str, every_min: Optional[int] = None, at: Optional[str] = None,
                     days: Optional[list[int]] = None, run_at: Optional[int] = None, tz: Optional[str] = None, max_run_min: Optional[int] = None,
                     created_by: str = "person") -> dict:
        kind = normalize_kind(kind)
        why = valid_schedule(kind, every_min, at, days, run_at, tz)
        if why:
            raise ValueError(why)
        if not prompt.strip():
            raise ValueError("a routine needs a message")
        now = now_ms()
        nxt = next_run_after(kind, every_min, at, now, days=days, tz=tz, anchor_ms=now, run_at=run_at)
        r = await self.store.create_routine(target_kind, target_id, (name or prompt)[:60], prompt, kind, every_min, at, days if kind == "weekly" else None, run_at, tz or "UTC",
                                            nxt, now, max_run_min, created_by)
        await self.publish(r["id"])
        return r

    async def update(self, rid: str, **f: Any) -> Optional[dict]:
        cur = await self.store.get_routine(rid)
        if not cur:
            return None
        kind = normalize_kind(f.get("kind", cur["kind"]))
        every, at = f.get("everyMin", cur["everyMin"]), f.get("at", cur["at"])
        days, run_at, tz = f.get("days", cur["days"]), f.get("runAt", cur["runAt"]), f.get("tz", cur["tz"])
        schedule_changed = bool({"kind", "everyMin", "at", "days", "runAt", "tz"} & f.keys())
        if schedule_changed:
            why = valid_schedule(kind, every, at, days, run_at, tz)
            if why:
                raise ValueError(why)
            f = {**f, "kind": kind, "anchor": now_ms()}
        if "prompt" in f and not str(f["prompt"]).strip():
            raise ValueError("a routine needs a message")
        if schedule_changed or (f.get("enabled") is True and not cur["enabled"]):
            f["nextRun"] = next_run_after(kind, every, at, now_ms(), days=days, tz=tz, anchor_ms=f.get("anchor", cur["anchor"]), run_at=run_at)
            if f["nextRun"] is None and kind == "once":
                f["enabled"] = False
        await self.store.update_routine(rid, **f)
        await self.publish(rid)
        return await self.store.get_routine(rid)

    async def delete(self, rid: str) -> bool:
        ok = await self.store.delete_routine(rid)
        if ok:
            await self.publish(rid, deleted=True)
        return ok

    # ---- running --------------------------------------------------------------------------------------------------
    async def tick(self, now: Optional[int] = None) -> list[str]:
        """Start every due routine (skipping one whose last run is still going) and time out runs that took too long."""
        now = now_ms() if now is None else now
        started: list[str] = []
        for r in await self.store.due_routines(now):
            nxt = next_run_after(r["kind"], r["everyMin"], r["at"], now, days=r["days"], tz=r["tz"], anchor_ms=r["anchor"], run_at=r["runAt"])
            await self.store.update_routine(r["id"], nextRun=nxt, enabled=(r["enabled"] and nxt is not None) if r["kind"] == "once" else r["enabled"])
            run = await self.start_run(r, now, manual=False)
            if run and run["status"] == "running":
                started.append(r["id"])
        await self._timeouts(now)
        return started

    async def start_run(self, r: dict, now: Optional[int] = None, manual: bool = True) -> Optional[dict]:
        """One run: a new task on the target, or a message to the room. A routine already running gets a `skipped` record instead."""
        now = now_ms() if now is None else now
        if await self.store.running_run_of(r["id"]):
            run = await self.store.create_run(r["id"], now, "skipped", None, "the previous run is still going")
            await self.publish_run(run)
            return run
        run = await self.store.create_run(r["id"], now, "running", None, "")
        try:
            thread_id = await self._deliver(r, run)
        except Exception as e:  # a routine that cannot start is a failed run, not a crashed scheduler
            run = await self.store.finish_run(run["id"], now_ms(), "failed", f"{type(e).__name__}: {e}"[:300])
            await self.publish_run(run)
            await self._notify_failure(r, run)
            return run
        run = await self.store.set_run_thread(run["id"], thread_id)  # a room run is already completed; a bot run ends with its turn
        await self.store.update_routine(r["id"], lastRun=now)
        await self.publish_run(run)
        await self.publish(r["id"])
        return run

    async def _deliver(self, r: dict, run: dict) -> str:
        prompt = r["prompt"]
        if r["targetKind"] == "group":
            g = await self.store.get_group(r["targetId"])
            if not g:
                raise RuntimeError("the room no longer exists")
            if not self.groups:
                raise RuntimeError("rooms are not available")
            await self.groups.send(g, f"[Routine \"{r['name']}\"] {prompt}", sender=f"routine {r['name']}")
            await self.store.finish_run(run["id"], now_ms(), "completed", "sent to the room")
            return g.threadId
        bot = await self.store.get_bot(r["targetId"])
        if not bot:
            raise RuntimeError("the bot no longer exists")
        from .runtime import envelope  # the same grammar every delegated turn opens with
        t = await self.store.create_thread(bot.id, f"Routine: {r['name']}"[:48])
        text = envelope(f'routine "{r["name"]}"', f"routine run {run['id']}", "on their behalf at your level", prompt)
        from .wire import WireMessage

        msg = WireMessage(id=new_id("msg"), role="user", text=text, at=now_ms(), sender=f"routine {r['name']}")
        await self.store.add_message(bot.id, t["id"], msg)
        self.turns._frame("message", bot.id, t["id"], msg)
        ok = await self.turns._start_turn(bot, t["id"], text, origin="routine", routine_run_id=run["id"])
        if not ok:
            raise RuntimeError("the engine could not start the run")
        self.run_threads[run["id"]] = t["id"]
        await self.turns.publish_bot(bot)
        return t["id"]

    async def run_finished(self, thread_id: str, run_id: str, ok: bool, detail: str = "") -> None:
        """The turn of a routine run ended (called by the turn pipeline)."""
        run = await self.store.get_run(run_id)
        if not run or run["status"] != "running":
            return
        run = await self.store.finish_run(run_id, now_ms(), "completed" if ok else "failed", detail)
        self.run_threads.pop(run_id, None)
        await self.publish_run(run)
        if not ok:
            r = await self.store.get_routine(run["routineId"])
            if r:
                await self._notify_failure(r, run)

    async def cancel_run(self, run_id: str) -> Optional[dict]:
        run = await self.store.get_run(run_id)
        if not run:
            return None
        if run["status"] == "running":
            tid = run.get("threadId") or self.run_threads.get(run_id)
            run = await self.store.finish_run(run_id, now_ms(), "cancelled", "stopped")
            self.run_threads.pop(run_id, None)
            if tid and tid in self.turns.runs:
                bot = await self.store.get_bot(self.turns.runs[tid].bot_id)
                if bot:
                    await self.turns.interrupt(bot, tid)
            await self.publish_run(run)
        return run

    async def _timeouts(self, now: int) -> None:
        for run in await self.store.running_runs():
            r = await self.store.get_routine(run["routineId"])
            if r and r["maxRunMin"] and now - run["startedAt"] > r["maxRunMin"] * 60_000:
                tid = run.get("threadId")
                done = await self.store.finish_run(run["id"], now, "failed", f"stopped after {r['maxRunMin']} minutes")
                if tid and tid in self.turns.runs:
                    bot = await self.store.get_bot(self.turns.runs[tid].bot_id)
                    if bot:
                        await self.turns.interrupt(bot, tid)
                await self.publish_run(done)
                await self._notify_failure(r, done)

    async def _notify_failure(self, r: dict, run: dict) -> None:
        if self.notify:
            await self.notify.add("routine_failed", f"Routine failed: {r['name']}", run.get("detail") or "The run did not finish.", target_kind=r["targetKind"], target_id=r["targetId"],
                                  thread_id=run.get("threadId"))

    # ---- the bot's tools (trigger_info, trigger, delete_trigger) ------------------------------------------------------
    async def tool_info(self, thread_id: str) -> dict:
        run = self.turns.runs.get(thread_id)
        mine = [self.public(r) for r in await self.store.list_routines() if run and r["targetKind"] == "bot" and r["targetId"] == run.bot_id]
        return {"ok": True, "kinds": ["once", "weekly", "interval"], "interval_minutes": [MIN_INTERVAL, MAX_INTERVAL], "days": "0=Monday .. 6=Sunday", "timezone": "IANA name, e.g. Europe/Paris",
                "yours": [{"id": r["id"], "name": r["name"], "schedule": r["schedule"], "enabled": r["enabled"]} for r in mine]}

    async def tool_trigger(self, thread_id: str, args: dict) -> dict:
        run = self.turns.runs.get(thread_id)
        if not run:
            return {"ok": False, "reason": "no_turn", "detail": "routines are made from a running turn"}
        action = str(args.get("action") or "create")
        try:
            if action == "create" and str(args.get("kind")) == "webhook" and self.webhooks:
                w, _secret = await self.webhooks.create(target_id=run.bot_id, name=str(args.get("name") or "Webhook"), prompt=str(args.get("prompt") or ""), created_by="bot")
                from .wire import WireMessage

                m = WireMessage(id=new_id("msg"), role="bot", kind="routine", author=run.bot_id, text=f"Created webhook {w['name']}", at=now_ms(),
                                routine={"id": w["id"], "name": w["name"], "schedule": "Webhook", "enabled": True, "webhook": True})
                await self.store.add_message(run.bot_id, thread_id, m)
                self.turns._frame("message", run.bot_id, thread_id, m)
                # the secret is kept aside for the person to reveal once; this result, and so the bot, never carries it
                return {"ok": True, "id": w["id"], "note": "Created. The person copies the link and secret from the card; you cannot see the secret."}
            if action == "create":
                r = await self.create(target_kind="bot", target_id=run.bot_id, name=str(args.get("name") or ""), prompt=str(args.get("prompt") or ""),
                                      kind=str(args.get("kind") or "interval"), every_min=args.get("every_min"), at=args.get("at"), days=args.get("days"),
                                      run_at=args.get("run_at"), tz=args.get("timezone"), created_by="bot")
                await self._card(thread_id, run.bot_id, r)
                return {"ok": True, "id": r["id"], "schedule": describe(r), "note": "Created. The person sees a card in this chat with Edit, Pause and Undo."}
            rid = str(args.get("id") or "")
            cur = await self.store.get_routine(rid)
            if not cur or cur["targetKind"] != "bot" or cur["targetId"] != run.bot_id:
                return {"ok": False, "reason": "not_yours", "detail": "no routine of yours with that id"}
            if action == "pause":
                await self.update(rid, enabled=False)
            elif action == "resume":
                await self.update(rid, enabled=True)
            elif action == "run":
                out = await self.start_run(cur)
                return {"ok": True, "run": out["status"] if out else "unknown"}
            elif action == "update":
                f = {k: v for k, v in {"name": args.get("name"), "prompt": args.get("prompt"), "kind": args.get("kind"), "everyMin": args.get("every_min"), "at": args.get("at"),
                                        "days": args.get("days"), "tz": args.get("timezone")}.items() if v is not None}
                await self.update(rid, **f)
            else:
                return {"ok": False, "reason": "unknown_action", "detail": "action is create, update, pause, resume or run"}
            return {"ok": True, "id": rid}
        except ValueError as e:
            return {"ok": False, "reason": "invalid", "detail": str(e)}

    async def tool_delete(self, thread_id: str, args: dict) -> dict:
        run = self.turns.runs.get(thread_id)
        cur = await self.store.get_routine(str(args.get("id") or ""))
        if not run or not cur or cur["targetKind"] != "bot" or cur["targetId"] != run.bot_id:
            return {"ok": False, "reason": "not_yours", "detail": "no routine of yours with that id"}
        await self.delete(cur["id"])
        return {"ok": True}

    async def _card(self, thread_id: str, bot_id: str, r: dict) -> None:
        """A live card in the chat for a routine a bot just made: Edit, Pause, Undo."""
        from .wire import WireMessage

        m = WireMessage(id=new_id("msg"), role="bot", kind="routine", author=bot_id, text=f"Created routine {r['name']}", at=now_ms(),
                        routine={"id": r["id"], "name": r["name"], "schedule": describe(r), "enabled": r["enabled"]})
        await self.store.add_message(bot_id, thread_id, m)
        self.turns._frame("message", bot_id, thread_id, m)
