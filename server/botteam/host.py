"""The runtime's host: engines, threads, names and notifications behind the job runtime (docs/runtime-contract.md §8)."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from .approval import normalize_mode
from .runtime import RunResult
from .store import Store, now_ms
from .turns import READ_ONLY_TOOLS, Turns
from .wire import WireBot


class RuntimeHost:
    def __init__(self, store: Store, turns: Turns, registry, bus) -> None:
        self.store, self.turns, self.registry, self.bus = store, turns, registry, bus
        self.names: dict[str, str] = {}
        self.mains: dict[str, str] = {}
        self.modes: dict[str, str] = {}
        self.chiefs: set[str] = set()
        self.managed: dict[str, list[str]] = {}  # chief id -> the sections it manages
        self.sections: dict[str, Optional[str]] = {}  # bot id -> its section
        self.reports: dict[str, Optional[str]] = {}  # bot id -> the bot it reports to
        self.instances: dict[str, str] = {}
        self.runtime = None

    # ---- the cache the sync ports read from ---------------------------------------------------------------------
    def note(self, bot: WireBot) -> None:
        self.names[bot.id] = bot.name
        self.mains[bot.id] = bot.mainThreadId
        self.modes[bot.id] = normalize_mode(bot.approvalMode)
        self.instances[bot.id] = bot.modelSelection.instanceId
        (self.chiefs.add if bot.chief else self.chiefs.discard)(bot.id)
        self.managed[bot.id] = list(bot.managedSections)
        self.sections[bot.id] = bot.section
        self.reports[bot.id] = bot.reportsTo

    def forget(self, bot_id: str) -> None:
        for d in (self.names, self.mains, self.modes, self.instances, self.managed, self.sections, self.reports):
            d.pop(bot_id, None)
        self.chiefs.discard(bot_id)

    async def refresh(self) -> None:
        for b in await self.store.list_bots():
            self.note(b)

    # ---- the ports --------------------------------------------------------------------------------------------------
    def can_start(self, a: dict) -> bool:
        return a["thread_id"] not in self.turns.runs and a["thread_id"] not in self.turns.delegated

    def own_level(self, bot_id: str) -> str:
        return self.modes.get(bot_id, "ask")

    def caps(self, bot_id: str) -> dict:
        inst = self.registry.get(self.instances.get(bot_id, ""))
        return dict(getattr(inst.driver, "engine_caps", {}) if inst and inst.driver else {})

    def bot_name(self, bot_id: str) -> str:
        return self.names.get(bot_id, "")

    def is_chief(self, bot_id: str) -> bool:
        return bot_id in self.chiefs

    def in_scope(self, chief_id: str, target_id: str) -> bool:
        """A Chief of Staff with sections of its own may hand work only to bots in them (itself always); with none it manages the whole team."""
        mine = self.managed.get(chief_id) or []
        return not mine or target_id == chief_id or self.sections.get(target_id) in mine or self.reports.get(target_id) == chief_id

    def standing_thread(self, bot_id: str) -> Optional[str]:
        return self.mains.get(bot_id)

    async def new_thread(self, bot_id: str, title: str) -> str:
        t = await self.store.create_thread(bot_id, title[:60])
        bot = await self.store.get_bot(bot_id)
        if bot:
            await self.turns.publish_bot(bot)
        return t["id"]

    def _sender(self, req: dict) -> str:
        if req.get("kind") == "bot":
            return self.bot_name(req.get("bot", "")) or "a teammate"
        if req.get("kind") == "routine":
            return f"routine {req.get('name', '')}".strip()
        if req.get("kind") == "outside":
            return f"webhook {req.get('name', '')}".strip()
        return req.get("name") or "the person"

    async def run(self, a: dict, kind: str, text: str) -> RunResult:
        bot = await self.store.get_bot(a["assignee_bot"])
        if not bot:
            return RunResult("failed", "", "that bot no longer exists")
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self.turns.delegated[a["thread_id"]] = fut
        sender = "Team report" if kind == "resume" else self._sender(a["requester"])
        started = await self.turns.start_delegated(bot, a["thread_id"], text, sender, a["level"], a["id"], a["origin"])
        if not started:
            self.turns.delegated.pop(a["thread_id"], None)
            return RunResult("failed", "", "the engine could not start the turn")
        return await fut

    async def report(self, a: dict) -> None:
        if a["status"] == "failed" and a.get("outcome") not in (None, "stopped") and getattr(self.turns, "notify", None):
            await self.turns.notify.add("assignment_failed", f"{self.bot_name(a['assignee_bot'])} could not finish a task", (a.get("outcome_detail") or a.get("outcome") or "")[:200],
                                        target_id=a["assignee_bot"], thread_id=a["thread_id"])
        self.bus.publish({"kind": "assignment", "assignment": self.runtime.public(a) if self.runtime else {"id": a["id"]}})

    async def stop_thread(self, thread_id: str) -> None:
        run = self.turns.runs.get(thread_id)
        fut = self.turns.delegated.pop(thread_id, None)
        if run:
            bot = await self.store.get_bot(run.bot_id)
            inst = self.registry.get(bot.modelSelection.instanceId) if bot else None
            run.interrupted = True
            if inst and inst.driver:
                await inst.driver.interrupt_turn(thread_id)
        if fut and not fut.done():
            fut.set_result(RunResult("failed", "", "stopped"))

    async def outward(self, a: dict) -> list[str]:
        """What a cut turn already did outward, from the thread's own event log (never from model text)."""
        path = Path(self.turns.log_dir) / f"{a['thread_id']}.ndjson"
        labels: list[str] = []
        try:
            lines = path.read_text(encoding="utf8").splitlines()[-400:]
        except OSError:
            return labels
        since = a["updated_at"] - 2000
        for line in lines:
            try:
                ev = json.loads(line)
                at = int(datetime.fromisoformat(ev["createdAt"]).timestamp() * 1000)
            except (ValueError, KeyError):
                continue
            d = ev.get("data") or {}
            if at >= since and ev.get("type") == "item.started" and d.get("itemType") == "tool":
                title = str(d.get("title") or "")
                if title not in READ_ONLY_TOOLS and not title.startswith("mcp__bt__"):
                    labels.append(f"ran {title} {str(d.get('summary') or '')[:40]}".strip())
        return labels[:3]
