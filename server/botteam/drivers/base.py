from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Protocol

from ..events import RuntimeEvent

Listener = Callable[[RuntimeEvent], None]


@dataclass
class Capabilities:
    sessionModelSwitch: str = "in-session"
    images: bool = False
    queueing: bool = False
    effortLevels: list[str] = field(default_factory=list)


@dataclass
class SendTurnInput:
    thread_id: str
    bot_id: str
    text: str
    model: str | None = None
    system: str | None = None


class ProviderAdapter(Protocol):
    provider: str
    capabilities: Capabilities

    async def send_turn(self, inp: SendTurnInput) -> str: ...
    async def interrupt_turn(self, thread_id: str) -> None: ...
    def on_event(self, listener: Listener) -> Callable[[], None]: ...
    async def stop_all(self) -> None: ...
