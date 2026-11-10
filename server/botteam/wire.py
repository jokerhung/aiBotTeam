from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

MausColor = Literal[
    "green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral", "silver", "chrome"
]
MAUS_COLORS: list[str] = list(MausColor.__args__)  # type: ignore[attr-defined]


class ModelSelection(BaseModel):
    instanceId: str = "echo"
    model: str = "echo-1"
    effort: Optional[str] = None


class WireBot(BaseModel):
    id: str
    threadId: str
    name: str
    title: str = ""
    description: str = ""
    color: MausColor = "green"
    notifications: bool = True
    unread: bool = False
    busy: bool = False
    activity: Literal["working", "waiting-on-you", "idle", "no-signal", "dead"] = "idle"
    turnStartedAt: Optional[int] = None
    modelSelection: ModelSelection = Field(default_factory=ModelSelection)
    pinned: bool = False
    hidden: bool = False
    section: Optional[str] = None
    lastText: str = ""
    lastAt: Optional[int] = None


class WireMessage(BaseModel):
    id: str
    role: Literal["bot", "user"]
    kind: Literal["text", "activity"] = "text"
    text: str = ""
    at: int
    sendId: Optional[str] = None
    parentId: Optional[str] = None
    streaming: bool = False


class CreateBot(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    title: str = ""
    description: str = ""
    color: Optional[MausColor] = None


class PatchBot(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    title: Optional[str] = None
    description: Optional[str] = None
    color: Optional[MausColor] = None
    pinned: Optional[bool] = None
    hidden: Optional[bool] = None
    unread: Optional[bool] = None
    section: Optional[str] = None
    modelSelection: Optional[ModelSelection] = None


class SendMessage(BaseModel):
    text: str = Field(min_length=1, max_length=100_000)
    sendId: Optional[str] = None


class OrderBody(BaseModel):
    botIds: list[str]


# ServerFrame: {"kind": ..., ...}; plain dicts on the bus.
Frame = dict[str, Any]
