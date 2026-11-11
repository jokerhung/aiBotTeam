"""Rooms: several bots in one conversation. Who answers, in what order, and what each bot is told.

A room has one transcript (a thread of its own) and one turn at a time: a message queues its responders and they answer in
turn, so turns of the same room never overlap. Each responder's turn is stateless on the engine side (`session_reset`): the
room's transcript is what it is shown.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from .store import new_id, now_ms
from .turns import persona
from .wire import MemberInfo, QueueEntry, WireGroup, WireMessage, WireTask

MAX_CHAIN = 2  # a bot's @mention may hand the floor on twice before a person speaks again
TRANSCRIPT_LINES = 24


def mentions_in(text: str, members: list[tuple[str, str]]) -> list[str]:
    """Bot ids named with @ in the text, in the order they appear; the longest name wins (`@Dev Lead` before `@Dev`)."""
    found: list[tuple[int, str]] = []
    spans: list[tuple[int, int]] = []
    for bid, name in sorted(members, key=lambda m: -len(m[1])):
        for m in re.finditer(r"(?<![\w@])@" + re.escape(name) + r"(?![\w])", text, flags=re.I):
            if any(lo <= m.start() < hi for lo, hi in spans):
                continue  # already part of a longer name
            spans.append((m.start(), m.end()))
            found.append((m.start(), bid))
    found.sort()
    out: list[str] = []
    for _, bid in found:
        if bid not in out:
            out.append(bid)
    return out


class Groups:
    def __init__(self, store, turns, bus, registry, host) -> None:
        self.store, self.turns, self.bus, self.registry, self.host = store, turns, bus, registry, host
        self.queues: dict[str, list[dict[str, Any]]] = {}  # group id -> waiting entries (the room's turn order)
        self.running: dict[str, dict[str, Any]] = {}  # group id -> the entry being answered
        self.decider: Optional[dict] = None  # {"instanceId", "model"}: who chooses automatically; None = off

    # ---- views ----------------------------------------------------------------------------------------------------
    async def info(self, g: WireGroup) -> list[MemberInfo]:
        out = []
        for bid in g.members:
            b = await self.store.get_bot(bid)
            if b:
                out.append(MemberInfo(id=b.id, name=b.name, color=b.color, title=b.title))
        return out

    async def dict_of(self, g: WireGroup) -> dict[str, Any]:
        threads = await self.store.list_threads(g.id)
        busy = g.threadId in self.turns.runs
        waiting = bool(self.turns.broker and self.turns.broker.open_for(g.threadId))
        queue = [QueueEntry(**e) for e in ([{**self.running[g.id], "state": "running"}] if g.id in self.running else []) + self.queues.get(g.id, [])]
        out = g.model_copy(update={
            "memberInfo": await self.info(g), "busy": busy or bool(queue), "queue": queue,
            "activity": "waiting-on-you" if waiting else ("working" if busy or queue else "idle"),
            "tasks": [WireTask(threadId=t["id"], title=t["title"], busy=t["id"] in self.turns.runs, pinned=t["pinned"], closed=t["closed"],
                               at=t["updatedAt"], main=t["main"]) for t in threads]})
        return out.model_dump()

    async def list(self) -> list[dict]:
        return [await self.dict_of(g) for g in await self.store.list_groups()]

    async def publish(self, g: WireGroup) -> None:
        self.bus.publish({"kind": "group", "group": await self.dict_of(g)})

    # ---- membership -------------------------------------------------------------------------------------------------
    async def clean_members(self, ids: list[str]) -> list[str]:
        seen: list[str] = []
        for i in ids:
            if i not in seen and await self.store.get_bot(i):
                seen.append(i)
        return seen

    async def remove_bot(self, bot_id: str) -> None:
        for g in await self.store.list_groups():
            if bot_id in g.members or g.leader == bot_id:
                g.members = [m for m in g.members if m != bot_id]
                if g.leader == bot_id:
                    g.leader = g.members[0] if g.members else None
                await self.store.save_group(g)
                await self.publish(g)

    # ---- sending ----------------------------------------------------------------------------------------------------
    async def send(self, g: WireGroup, text: str, thread_id: Optional[str] = None, send_id: Optional[str] = None, sender: str = "") -> WireMessage:
        tid = thread_id or g.threadId
        members = [(b.id, b.name) for b in [await self.store.get_bot(i) for i in g.members] if b]
        msg = WireMessage(id=new_id("msg"), role="user", text=text, at=now_ms(), sendId=send_id, mentions=mentions_in(text, members), sender=sender or None)
        await self.store.add_message(g.id, tid, msg)
        self.turns._frame("message", g.id, tid, msg)
        g.lastText, g.lastAt = text, msg.at
        await self.store.save_group(g)
        who = await self.decide(g, text, msg.mentions)
        for bid, why in who:
            self.queues.setdefault(g.id, []).append({"id": new_id("rq"), "botId": bid, "name": self.host.bot_name(bid), "reason": why, "text": text, "thread": tid, "depth": 0})
        await self.publish(g)
        await self.kick(g.id)
        return msg

    async def decide(self, g: WireGroup, text: str, mentioned: list[str]) -> list[tuple[str, str]]:
        """Who answers: the people named with @, else the room's rule (leader, automatic choice, or only when named)."""
        named = [(b, "mention") for b in mentioned if b in g.members]
        if named:
            return named
        leader = g.leader if g.leader in g.members else (g.members[0] if g.members else None)
        if g.responder == "mention" or not leader:
            return []
        if g.responder == "auto":
            pick = await self.auto_pick(g, text)
            if pick:
                return [(pick, "auto")]
        return [(leader, "leader")]

    async def auto_pick(self, g: WireGroup, text: str) -> Optional[str]:
        """A fast model picks one member. Off, unreachable or unsure: None, and the room falls back to its leader."""
        d = self.decider
        if not d:
            return None
        inst = self.registry.get(d.get("instanceId", ""))
        if not inst or inst.state != "available" or inst.driver_kind != "openai-compat" or not inst.driver:
            return None
        from .drivers.openai_compat import ask_once

        names = []
        for bid in g.members:
            b = await self.store.get_bot(bid)
            if b:
                names.append(f"{b.name}: {b.title or b.description or 'teammate'}")
        try:
            answer = await ask_once(inst.driver, d.get("model", ""), "You route a message in a team chat. Reply with exactly one member name from the list, or NONE if you are unsure.",
                                    "Members:\n" + "\n".join(names) + f"\n\nMessage: {text[:600]}")
        except Exception:
            return None
        for bid in g.members:
            if self.host.bot_name(bid).lower() == answer.strip().strip(".@").lower():
                return bid
        return None

    # ---- the room's turn order --------------------------------------------------------------------------------------
    async def kick(self, group_id: str) -> None:
        """Start the next waiting responder unless a turn of this room is already running."""
        g = await self.store.get_group(group_id)
        if not g or g.threadId in self.turns.runs or group_id in self.running:
            return
        q = self.queues.get(group_id, [])
        while q:
            entry = q.pop(0)
            if entry["botId"] not in g.members:
                continue
            bot = await self.store.get_bot(entry["botId"])
            if not bot:
                continue
            self.running[group_id] = entry
            ok = await self.turns._start_turn(bot, entry["thread"], await self._prompt(g, bot, entry), extra_system=self._room_system(g, bot), session_reset=True,
                                              cwd=g.cwd or bot.cwd, group_id=group_id)
            if ok:
                run = self.turns.runs.get(entry["thread"])
                if run:
                    run.origin = "person"
                await self.publish(g)
                return
            self.running.pop(group_id, None)
        await self.publish(g)

    def _room_system(self, g: WireGroup, bot) -> str:
        team = ", ".join(f"{self.host.bot_name(m)}" for m in g.members)
        return (f"\n\nYou are {bot.name} in the room \"{g.name}\" with: {team}, and the person. Answer as {bot.name} only, briefly. "
                f"To hand the floor to a teammate, name them with @Name. Do not speak for others."
                + (f"\nRoom instructions: {g.instructions.strip()}" if g.instructions.strip() else ""))

    async def _prompt(self, g: WireGroup, bot, entry: dict) -> str:
        rows, _ = await self.store.page(entry["thread"], None, TRANSCRIPT_LINES)
        lines = []
        for m in rows:
            if m.kind != "text" or not m.text.strip():
                continue
            who = m.sender or "Person" if m.role == "user" else (self.host.bot_name(m.author or "") or "Bot")
            lines.append(f"{who}: {m.text.strip()[:1200]}")
        return "Room transcript so far:\n" + "\n".join(lines[-TRANSCRIPT_LINES:]) + f"\n\nIt is your turn, {bot.name}. Reply now."

    async def turn_done(self, thread_id: str, run) -> None:
        """A room turn ended: chained @mentions join the queue, then the next responder starts."""
        gid = run.group_id
        g = await self.store.get_group(gid) if gid else None
        if not g:
            return
        entry = self.running.pop(gid, None) or {"depth": 0, "thread": thread_id}
        text = run.final_text or ""
        if text.strip():
            g.lastText, g.lastAt, g.unread = text, now_ms(), True
            await self.store.save_group(g)
            if entry.get("depth", 0) < MAX_CHAIN:
                members = [(b.id, b.name) for b in [await self.store.get_bot(i) for i in g.members] if b]
                for bid in mentions_in(text, members):
                    if bid != run.bot_id and not any(e["botId"] == bid for e in self.queues.get(gid, [])):
                        self.queues.setdefault(gid, []).append({"id": new_id("rq"), "botId": bid, "name": self.host.bot_name(bid), "reason": "chained",
                                                                "text": text, "thread": entry["thread"], "depth": entry.get("depth", 0) + 1})
        await self.publish(g)
        await self.kick(gid)

    async def stop(self, g: WireGroup) -> None:
        self.queues.pop(g.id, None)
        run = self.turns.runs.get(g.threadId)
        if run:
            bot = await self.store.get_bot(run.bot_id)
            if bot:
                await self.turns.interrupt(bot, g.threadId)
        self.running.pop(g.id, None)
        await self.publish(g)

    # ---- a bot posting into a room from outside it ------------------------------------------------------------------
    async def post_from_bot(self, thread_id: str, room: str, message: str) -> dict:
        run = self.turns.runs.get(thread_id)
        if not run:
            return {"ok": False, "reason": "no_turn", "detail": "post_to_room needs a running turn"}
        room = room.strip()
        g = next((x for x in await self.store.list_groups() if x.id == room or x.name.lower() == room.lower()), None)
        if not g:
            return {"ok": False, "reason": "unknown_room", "detail": "no such room; list_rooms shows them"}
        if run.bot_id not in g.members:
            return {"ok": False, "reason": "not_a_member", "detail": "you are not a member of that room"}
        if not message.strip():
            return {"ok": False, "reason": "empty_message", "detail": "say what to post"}
        bot = await self.store.get_bot(run.bot_id)
        msg = WireMessage(id=new_id("msg"), role="bot", author=run.bot_id, text=message.strip(), at=now_ms())
        await self.store.add_message(g.id, g.threadId, msg)
        self.turns._frame("message", g.id, g.threadId, msg)
        g.lastText, g.lastAt, g.unread = msg.text, msg.at, True
        await self.store.save_group(g)
        members = [(b.id, b.name) for b in [await self.store.get_bot(i) for i in g.members] if b]
        for bid in mentions_in(msg.text, members):
            if bid != run.bot_id:
                self.queues.setdefault(g.id, []).append({"id": new_id("rq"), "botId": bid, "name": self.host.bot_name(bid), "reason": "chained", "text": msg.text,
                                                         "thread": g.threadId, "depth": 1})
        await self.publish(g)
        await self.kick(g.id)
        _ = bot
        return {"ok": True, "note": f"Posted to {g.name}."}
