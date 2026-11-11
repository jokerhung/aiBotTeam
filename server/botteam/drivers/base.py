from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Literal, Protocol

from ..events import RuntimeEvent

Listener = Callable[[RuntimeEvent], None]
SteerOutcome = Literal["steered", "refused", "indeterminate"]


@dataclass
class Capabilities:
    sessionModelSwitch: str = "in-session"
    images: bool = False
    queueing: bool = False
    effortLevels: list[str] = field(default_factory=list)
    strictResume: bool = False

    def as_dict(self) -> dict:
        return dict(self.__dict__)


@dataclass
class SendTurnInput:
    thread_id: str
    bot_id: str
    text: str
    model: str | None = None
    effort: str | None = None
    system: str | None = None
    resume_cursor: str | None = None
    session_reset: bool = False
    cwd: str | None = None
    approval_mode: str = "full"
    attachments: list[str] = field(default_factory=list)  # absolute paths inside the attachment store
    image_attachments: list[str] = field(default_factory=list)
    transcript: list[tuple[str, str]] = field(default_factory=list)  # (role, text) for replay drivers
    custom_mcp: dict = field(default_factory=dict)  # integrations.custom: mcpServers entries for this bot's custom servers (a driver that cannot speak MCP ignores it)
    skills_dir: str | None = None  # a directory of skills for this turn (the Claude CLI reads it through --add-dir)


class ProviderAdapter(Protocol):
    provider: str
    capabilities: Capabilities

    async def send_turn(self, inp: SendTurnInput) -> str: ...
    async def interrupt_turn(self, thread_id: str) -> None: ...
    async def steer(self, thread_id: str, text: str) -> SteerOutcome: ...
    def on_event(self, listener: Listener) -> Callable[[], None]: ...
    async def stop_all(self) -> None: ...


class Emitter:
    """Shared listener list and event construction for drivers."""

    provider = "base"

    def __init__(self) -> None:
        self._listeners: list[Listener] = []

    def on_event(self, listener: Listener):
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener) if listener in self._listeners else None

    def emit(self, type_: str, thread_id: str, turn_id: str | None, **data) -> None:
        ev = RuntimeEvent(
            type=type_, eventId=uuid.uuid4().hex, provider=self.provider, threadId=thread_id,
            createdAt=datetime.now(timezone.utc).isoformat(), turnId=turn_id, data=data,
        )
        for fn in list(self._listeners):
            fn(ev)

    async def steer(self, thread_id: str, text: str) -> SteerOutcome:
        return "refused"


def new_turn_id() -> str:
    return "turn_" + uuid.uuid4().hex[:10]


def preview(value: object, limit: int = 400) -> str:
    """Bounded display text for a tool input or output; never the raw payload."""
    if isinstance(value, str):
        text = value
    elif isinstance(value, list):
        text = "\n".join(str(b.get("text", "")) if isinstance(b, dict) else str(b) for b in value)
    else:
        import json

        try:
            text = json.dumps(value, ensure_ascii=False)
        except (TypeError, ValueError):
            text = str(value)
    return text if len(text) <= limit else text[:limit] + "…"
