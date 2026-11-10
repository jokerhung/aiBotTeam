"""Canonical runtime events (subset of the reference project's runtime-events contract)."""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class RuntimeEvent(BaseModel):
    type: str
    eventId: str
    provider: str
    threadId: str
    createdAt: str
    turnId: Optional[str] = None
    itemId: Optional[str] = None
    data: dict[str, Any] = {}
