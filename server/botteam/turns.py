"""Host-side turn orchestration: RuntimeEvent -> WireMessage / WireBot frames."""
from __future__ import annotations

from .bus import Bus
from .drivers.base import ProviderAdapter, SendTurnInput
from .events import RuntimeEvent
from .store import Store, new_id, now_ms
from .wire import WireBot, WireMessage


class Turns:
    def __init__(self, store: Store, bus: Bus, driver: ProviderAdapter) -> None:
        self.store = store
        self.bus = bus
        self.driver = driver
        self._bot_by_thread: dict[str, str] = {}
        self._live: dict[str, WireMessage] = {}  # thread -> streaming reply
        driver.on_event(self._on_event)

    async def send(self, bot: WireBot, text: str, send_id: str | None) -> WireMessage:
        if bot.busy:
            raise RuntimeError("busy")
        msg = WireMessage(id=new_id("msg"), role="user", text=text, at=now_ms(), sendId=send_id)
        await self.store.add_message(bot.id, msg)
        self.bus.publish({"kind": "message", "threadId": bot.threadId, "botId": bot.id, "message": msg.model_dump()})
        bot.busy, bot.activity, bot.turnStartedAt = True, "working", now_ms()
        bot.lastText, bot.lastAt = text, msg.at
        await self.store.save_bot(bot)
        self.bus.publish({"kind": "bot", "bot": bot.model_dump()})
        self._bot_by_thread[bot.threadId] = bot.id
        await self.driver.send_turn(
            SendTurnInput(thread_id=bot.threadId, bot_id=bot.id, text=text, model=bot.modelSelection.model)
        )
        return msg

    async def interrupt(self, bot: WireBot) -> None:
        await self.driver.interrupt_turn(bot.threadId)

    def _on_event(self, ev: RuntimeEvent) -> None:
        import asyncio

        asyncio.get_running_loop().create_task(self._handle(ev))

    async def _handle(self, ev: RuntimeEvent) -> None:
        bot_id = self._bot_by_thread.get(ev.threadId)
        bot = await self.store.get_bot(bot_id) if bot_id else None
        if not bot:
            return
        if ev.type == "content.delta" and ev.data.get("streamKind") == "assistant_text":
            live = self._live.get(ev.threadId)
            if live is None:
                live = WireMessage(id=new_id("msg"), role="bot", text="", at=now_ms(), streaming=True)
                self._live[ev.threadId] = live
                await self.store.add_message(bot.id, live)
                self.bus.publish({"kind": "message", "threadId": bot.threadId, "botId": bot.id, "message": live.model_dump()})
            live.text += ev.data["delta"]
            self.bus.publish({"kind": "message.patch", "threadId": bot.threadId, "botId": bot.id,
                              "message": {"id": live.id, "text": live.text, "streaming": True}})
        elif ev.type == "turn.completed":
            live = self._live.pop(ev.threadId, None)
            if live:
                live.streaming = False
                await self.store.update_message(bot.id, live)
                self.bus.publish({"kind": "message.patch", "threadId": bot.threadId, "botId": bot.id,
                                  "message": {"id": live.id, "text": live.text, "streaming": False}})
                bot.lastText, bot.lastAt = live.text, now_ms()
            bot.busy, bot.activity, bot.turnStartedAt = False, "idle", None
            bot.unread = True
            await self.store.save_bot(bot)
            self.bus.publish({"kind": "bot", "bot": bot.model_dump()})
