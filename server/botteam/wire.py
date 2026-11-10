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


class WireTask(BaseModel):
    threadId: str
    title: str
    busy: bool = False
    pinned: bool = False
    closed: bool = False
    at: int = 0
    main: bool = False


class WireBot(BaseModel):
    id: str
    threadId: str  # the conversation on screen (a task, or the main thread)
    mainThreadId: str = ""
    name: str
    title: str = ""
    description: str = ""
    color: MausColor = "green"
    notifications: bool = True
    unread: bool = False
    busy: bool = False  # any conversation is running
    threadBusy: bool = False  # the one on screen is running
    activity: Literal["working", "waiting-on-you", "idle", "no-signal", "dead"] = "idle"
    turnStartedAt: Optional[int] = None
    statusLine: Optional[str] = None
    modelSelection: ModelSelection = Field(default_factory=ModelSelection)
    pinned: bool = False
    hidden: bool = False
    section: Optional[str] = None
    cwd: Optional[str] = None
    lastText: str = ""
    lastAt: Optional[int] = None
    readAt: int = 0
    tasks: list[WireTask] = Field(default_factory=list)
    usage: dict[str, Any] = Field(default_factory=dict)


class ToolInfo(BaseModel):
    name: str
    itemId: Optional[str] = None
    ok: Optional[bool] = None  # None while running
    summary: str = ""
    input: str = ""
    output: str = ""


class ErrorInfo(BaseModel):
    setup: bool = False
    terminal: bool = False
    limit: Optional[str] = None
    limitResetsAt: Optional[int] = None


class WireMessage(BaseModel):
    id: str
    role: Literal["bot", "user"]
    kind: Literal["text", "activity", "error", "stopped", "notice"] = "text"
    text: str = ""
    at: int
    sendId: Optional[str] = None
    parentId: Optional[str] = None
    streaming: bool = False
    queued: bool = False
    steered: bool = False
    tool: Optional[ToolInfo] = None
    error: Optional[ErrorInfo] = None
    siblings: list[str] = Field(default_factory=list)  # ids of alternative versions of this message


class CreateBot(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    title: str = ""
    description: str = ""
    color: Optional[MausColor] = None
    modelSelection: Optional[ModelSelection] = None


class PatchBot(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    title: Optional[str] = None
    description: Optional[str] = None
    color: Optional[MausColor] = None
    pinned: Optional[bool] = None
    hidden: Optional[bool] = None
    unread: Optional[bool] = None
    section: Optional[str] = None
    cwd: Optional[str] = None
    modelSelection: Optional[ModelSelection] = None
    threadId: Optional[str] = None  # switch the conversation on screen


class SendMessage(BaseModel):
    text: str = Field(min_length=1, max_length=100_000)
    sendId: Optional[str] = None
    threadId: Optional[str] = None
    branch: bool = False  # true: parentId is explicit (None = the thread's root), making the new message a sibling of the one that had it
    parentId: Optional[str] = None


class OrderBody(BaseModel):
    botIds: list[str]


class CreateTask(BaseModel):
    title: str = "New task"
    modelSelection: Optional[ModelSelection] = None


class PatchTask(BaseModel):
    title: Optional[str] = None
    pinned: Optional[bool] = None
    closed: Optional[bool] = None


class LeafBody(BaseModel):
    messageId: str


class CreateInstance(BaseModel):
    displayName: str = Field(min_length=1, max_length=60)
    baseUrl: str
    apiKey: Optional[str] = None
    models: list[str] = Field(default_factory=list)


class PatchInstance(BaseModel):
    enabled: Optional[bool] = None
    hidden: Optional[bool] = None
    path: Optional[str] = None


Frame = dict[str, Any]
