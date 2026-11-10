"""Scripted fake driver: replays a canned RuntimeEvent sequence, no CLI needed."""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from ..events import RuntimeEvent
from .base import Capabilities, Listener, SendTurnInput


def _ts() -> str:
    return datetime.now(timezone.utc).isoformat()


class EchoDriver:
    provider = "echo"
    capabilities = Capabilities()

    def __init__(self, delay: float = 0.03) -> None:
        self._listeners: list[Listener] = []
        self._tasks: dict[str, asyncio.Task] = {}
        self.delay = delay

    def on_event(self, listener: Listener):
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener)

    def _emit(self, type_: str, thread_id: str, turn_id: str, **data) -> None:
        ev = RuntimeEvent(
            type=type_, eventId=uuid.uuid4().hex, provider=self.provider, threadId=thread_id,
            createdAt=_ts(), turnId=turn_id, data=data,
        )
        for fn in list(self._listeners):
            fn(ev)

    async def send_turn(self, inp: SendTurnInput) -> str:
        turn_id = "turn_" + uuid.uuid4().hex[:10]
        self._tasks[inp.thread_id] = asyncio.create_task(self._run(inp, turn_id))
        return turn_id

    async def _run(self, inp: SendTurnInput, turn_id: str) -> None:
        t = inp.thread_id
        try:
            self._emit("turn.started", t, turn_id)
            reply = f"You said: {inp.text}"
            for word in reply.split(" "):
                self._emit("content.delta", t, turn_id, streamKind="assistant_text", delta=word + " ")
                await asyncio.sleep(self.delay)
            self._emit("item.completed", t, turn_id, itemType="assistant_text", text=reply)
            self._emit("turn.completed", t, turn_id, ok=True)
        except asyncio.CancelledError:
            self._emit("turn.completed", t, turn_id, ok=False, stopReason="interrupted")
            raise

    async def interrupt_turn(self, thread_id: str) -> None:
        task = self._tasks.get(thread_id)
        if task and not task.done():
            task.cancel()

    async def stop_all(self) -> None:
        for t in self._tasks.values():
            t.cancel()
