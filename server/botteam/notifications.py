"""The notification log (what needs you, what finished, what failed) and the inbox of requests waiting on a person."""
from __future__ import annotations

from typing import Any, Optional

from .store import new_id, now_ms

KINDS = {"approval", "question", "turn_done", "routine_failed", "webhook_failed", "assignment_failed", "channel_failed"}
LONG_TURN_MS = 15_000  # a turn that ran this long is worth a note when it ends


class Notifications:
    def __init__(self, store, bus, turns) -> None:
        self.store, self.bus, self.turns = store, bus, turns

    async def add(self, kind: str, title: str, body: str = "", *, target_kind: str = "bot", target_id: str = "", thread_id: Optional[str] = None) -> dict[str, Any]:
        n = await self.store.add_notification(kind if kind in KINDS else "turn_done", title[:140], body[:400], target_kind, target_id, thread_id)
        self.bus.publish({"kind": "notify", "notification": n})
        return n

    async def read(self, ids: Optional[list[str]] = None) -> list[str]:
        done = await self.store.mark_notifications_read(ids)
        if done:
            self.bus.publish({"kind": "notifications.read", "ids": done})
        return done

    async def clear(self) -> None:
        await self.store.clear_notifications()
        self.bus.publish({"kind": "notifications.read", "ids": [], "cleared": True})

    # ---- who is waiting on a person ------------------------------------------------------------------------------------
    async def inbox(self) -> list[dict[str, Any]]:
        """Every card waiting on a person, across all bots and rooms."""
        out: list[dict[str, Any]] = []
        broker = self.turns.broker
        if not broker:
            return out
        for thread_id, req in broker.all_open():
            run = self.turns.runs.get(thread_id)
            bot = await self.store.get_bot(run.bot_id) if run else await self.store.bot_of_thread(thread_id)
            group = await self.store.group_of_thread(thread_id)
            out.append({"requestId": req["id"], "type": req["type"], "tool": req["tool"], "summary": req["summary"], "command": req.get("command"), "cwd": req.get("cwd"),
                        "canAlways": req.get("canAlways", False), "choices": req.get("choices", []), "questions": req.get("questions", []), "openedAt": req["openedAt"],
                        "threadId": thread_id, "botId": bot.id if bot else None, "botName": bot.name if bot else "", "botColor": bot.color if bot else "green",
                        "groupId": group.id if group else None, "groupName": group.name if group else None})
        return sorted(out, key=lambda x: x["openedAt"])
