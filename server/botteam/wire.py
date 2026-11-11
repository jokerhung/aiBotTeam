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


class RequestInfo(BaseModel):
    id: str
    type: Literal["permission", "question"] = "permission"
    tool: str = ""
    summary: str = ""
    command: Optional[str] = None
    cwd: Optional[str] = None
    canAlways: bool = False
    status: Literal["open", "resolved"] = "open"
    openedAt: int = 0
    choices: list[str] = Field(default_factory=list)
    questions: list[dict[str, Any]] = Field(default_factory=list)
    behavior: Optional[str] = None
    source: Optional[str] = None  # user | auto | rule | expired | unavailable | system
    answer: Optional[str] = None


class Attachment(BaseModel):
    name: str
    filename: str = ""
    mime: str = ""
    size: int = 0
    image: bool = False


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
    approvalMode: str = "full"
    soul: str = ""
    chief: bool = False
    fallbackSelection: Optional[ModelSelection] = None
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
    kind: Literal["text", "activity", "error", "stopped", "notice", "request", "routine"] = "text"
    text: str = ""
    at: int
    sendId: Optional[str] = None
    parentId: Optional[str] = None
    streaming: bool = False
    queued: bool = False
    steered: bool = False
    tool: Optional[ToolInfo] = None
    error: Optional[ErrorInfo] = None
    request: Optional[RequestInfo] = None
    routine: Optional[dict[str, Any]] = None  # a routine a bot just made: the live card shows Edit, Pause, Undo
    mentions: list[str] = Field(default_factory=list)  # bot ids a message names with @
    sender: Optional[str] = None  # who this line came from when it is a teammate's or a routine's, not the person's
    author: Optional[str] = None  # the bot that wrote a bot message (rooms show it)
    attachments: list[Attachment] = Field(default_factory=list)
    siblings: list[str] = Field(default_factory=list)  # ids of alternative versions of this message


class CreateBot(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    title: str = ""
    description: str = ""
    color: Optional[MausColor] = None
    modelSelection: Optional[ModelSelection] = None
    approvalMode: Optional[str] = None
    cwd: Optional[str] = None


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
    approvalMode: Optional[str] = None
    soul: Optional[str] = None
    chief: Optional[bool] = None
    notifications: Optional[bool] = None
    fallbackSelection: Optional[ModelSelection] = None
    modelSelection: Optional[ModelSelection] = None
    threadId: Optional[str] = None  # switch the conversation on screen


class SendMessage(BaseModel):
    text: str = Field(min_length=1, max_length=100_000)
    sendId: Optional[str] = None
    threadId: Optional[str] = None
    attachments: list[str] = Field(default_factory=list)  # stored attachment names
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


class RequestAnswer(BaseModel):
    behavior: Literal["allow", "deny"]
    message: Optional[str] = None
    always: bool = False
    answers: Optional[dict[str, str]] = None


class SectionBody(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class PatchSection(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    collapsed: Optional[bool] = None


class MoveBot(BaseModel):
    section: Optional[str] = None
    botIds: Optional[list[str]] = None  # new order of the whole list, when given


class BotDefaults(BaseModel):
    modelSelection: Optional[ModelSelection] = None
    approvalMode: Optional[str] = None
    cwd: Optional[str] = None


class ConfigPatch(BaseModel):
    displayName: Optional[str] = Field(default=None, max_length=60)
    uiMode: Optional[Literal["simple", "advanced"]] = None
    skin: Optional[str] = Field(default=None, max_length=40)
    font: Optional[str] = Field(default=None, max_length=40)
    chatWidth: Optional[Literal["narrow", "default", "wide"]] = None
    reduceMotion: Optional[bool] = None
    language: Optional[str] = Field(default=None, max_length=12)
    keys: Optional[dict[str, Optional[str]]] = None  # name -> secret; null/empty clears


class NoteBody(BaseModel):
    title: Optional[str] = Field(default=None, max_length=120)
    text: Optional[str] = Field(default=None, max_length=200_000)


class RoutineBody(BaseModel):
    """A routine as the API takes it. `title` / `text` / `kind: daily` are the Phase 3 names and still work."""
    name: Optional[str] = Field(default=None, max_length=120)
    title: Optional[str] = Field(default=None, max_length=120)
    prompt: Optional[str] = Field(default=None, min_length=1, max_length=20_000)
    text: Optional[str] = Field(default=None, min_length=1, max_length=20_000)
    targetKind: Optional[Literal["bot", "group"]] = None
    targetId: Optional[str] = None
    kind: Optional[Literal["interval", "daily", "weekly", "once"]] = None
    everyMin: Optional[int] = None
    at: Optional[str] = Field(default=None, max_length=5)
    days: Optional[list[int]] = None
    runAt: Optional[int] = None
    tz: Optional[str] = Field(default=None, max_length=64)
    maxRunMin: Optional[int] = Field(default=None, ge=1, le=1440)
    enabled: Optional[bool] = None



Responder = Literal["leader", "auto", "mention"]


class QueueEntry(BaseModel):
    id: str
    botId: str
    name: str = ""
    state: Literal["waiting", "running"] = "waiting"
    reason: str = ""  # mention | leader | auto | chained
    text: str = ""


class MemberInfo(BaseModel):
    id: str
    name: str
    color: str = "green"
    title: str = ""


class WireGroup(BaseModel):
    id: str
    threadId: str
    mainThreadId: str = ""
    name: str
    members: list[str] = Field(default_factory=list)
    memberInfo: list[MemberInfo] = Field(default_factory=list)
    leader: Optional[str] = None
    instructions: str = ""
    cwd: Optional[str] = None
    responder: Responder = "leader"
    section: Optional[str] = None
    pinned: bool = False
    hidden: bool = False
    unread: bool = False
    busy: bool = False
    activity: Literal["working", "waiting-on-you", "idle"] = "idle"
    queue: list[QueueEntry] = Field(default_factory=list)
    lastText: str = ""
    lastAt: Optional[int] = None
    readAt: int = 0
    tasks: list[WireTask] = Field(default_factory=list)


class CreateGroup(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    members: list[str] = Field(default_factory=list)
    leader: Optional[str] = None
    instructions: str = ""
    cwd: Optional[str] = None
    responder: Responder = "leader"


class PatchGroup(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    members: Optional[list[str]] = None
    leader: Optional[str] = None
    instructions: Optional[str] = None
    cwd: Optional[str] = None
    responder: Optional[Responder] = None
    section: Optional[str] = None
    pinned: Optional[bool] = None
    hidden: Optional[bool] = None
    unread: Optional[bool] = None


class GroupMessage(BaseModel):
    text: str = Field(min_length=1, max_length=100_000)
    sendId: Optional[str] = None
    threadId: Optional[str] = None
