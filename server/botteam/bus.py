from __future__ import annotations

import asyncio
from typing import AsyncIterator

from .wire import Frame


class Bus:
    """Fan-out of server frames to every SSE client."""

    def __init__(self) -> None:
        self._subs: set[asyncio.Queue[Frame]] = set()

    def publish(self, frame: Frame) -> None:
        for q in list(self._subs):
            try:
                q.put_nowait(frame)
            except asyncio.QueueFull:
                self._subs.discard(q)

    async def subscribe(self) -> AsyncIterator[Frame]:
        q: asyncio.Queue[Frame] = asyncio.Queue(maxsize=1000)
        self._subs.add(q)
        try:
            while True:
                yield await q.get()
        finally:
            self._subs.discard(q)
