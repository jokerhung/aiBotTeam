"""Routines: a message a bot is sent on a schedule (every N minutes, or daily at a time of day)."""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timedelta
from typing import Any, Optional

from .store import now_ms

TIME_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")
MIN_INTERVAL = 1
MAX_INTERVAL = 7 * 24 * 60


def valid_schedule(kind: str, every_min: Optional[int], at: Optional[str]) -> Optional[str]:
    """None when the schedule is usable, otherwise why not."""
    if kind == "interval":
        if every_min is None or not (MIN_INTERVAL <= every_min <= MAX_INTERVAL):
            return f"an interval must be between {MIN_INTERVAL} and {MAX_INTERVAL} minutes"
    elif kind == "daily":
        if not at or not TIME_RE.match(at):
            return "a daily routine needs a time like 09:30"
    else:
        return "unknown schedule kind"
    return None


def next_run_after(kind: str, every_min: Optional[int], at: Optional[str], after_ms: int, tz_now: Optional[datetime] = None) -> int:
    """The first run strictly after `after_ms`, in epoch milliseconds."""
    if kind == "interval":
        return after_ms + int(every_min or 60) * 60_000
    h, m = (int(x) for x in (at or "09:00").split(":"))
    base = datetime.fromtimestamp(after_ms / 1000) if tz_now is None else tz_now
    candidate = base.replace(hour=h, minute=m, second=0, microsecond=0)
    if candidate <= base:
        candidate += timedelta(days=1)
    return int(candidate.timestamp() * 1000)


class Scheduler:
    """Wakes every few seconds and sends each due routine's message to its bot's main conversation. A bot that is busy
    keeps the routine due: it runs on a later tick instead of being skipped."""

    def __init__(self, store, turns, tick: float = 15.0) -> None:
        self.store, self.turns, self.tick = store, turns, tick
        self._task: Optional[asyncio.Task] = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    async def _loop(self) -> None:
        while True:
            try:
                await self.run_due()
            except Exception as e:  # the scheduler outlives any single bad routine
                print(f"[routines] tick failed: {type(e).__name__}: {e}")
            await asyncio.sleep(self.tick)

    async def run_due(self, now: Optional[int] = None) -> list[str]:
        now = now_ms() if now is None else now
        ran: list[str] = []
        for r in await self.store.due_routines(now):
            if await self.fire(r, now):
                ran.append(r["id"])
        return ran

    async def fire(self, r: dict[str, Any], now: Optional[int] = None) -> bool:
        """Send the routine's message now. False when the bot is busy or gone (it stays due)."""
        now = now_ms() if now is None else now
        bot = await self.store.get_bot(r["botId"])
        if not bot:
            return False
        if bot.mainThreadId in self.turns.runs:
            return False
        try:
            await self.turns.send(bot, bot.mainThreadId, r["text"], f"routine_{r['id']}_{now}")
        except RuntimeError:
            return False
        await self.store.mark_routine_ran(r["id"], now, next_run_after(r["kind"], r["everyMin"], r["at"], now))
        return True
