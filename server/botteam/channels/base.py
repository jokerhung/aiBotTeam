"""Messaging channels (Telegram bot, Zalo bot): what an adapter must offer, and the few types the service and the adapters share.

An adapter only speaks one chat service's HTTP API. Grouping files into a batch, routing a chat to a bot, running the turn and sending the
result back are the service's job (`service.py`), the same for every channel.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import httpx


class ChannelError(Exception):
    """`fatal` ends the account's polling (a wrong or taken token); anything else is retried after a pause."""

    def __init__(self, message: str, status: int = 502, fatal: bool = False) -> None:
        super().__init__(message)
        self.status, self.fatal = status, fatal


class Unsupported(ChannelError):
    pass


@dataclass(frozen=True)
class Capabilities:
    files_in: bool = True  # the bot can receive files that are not photos (a PDF)
    files_out: bool = True  # the bot can send a file back
    buttons: bool = True  # inline buttons under a message
    edit: bool = True  # a sent message can be changed
    groups: bool = True
    max_text: int = 4000  # longest text in one message
    max_file: int = 20 * 1024 * 1024  # largest file the bot may download
    status_gap: float = 2.0  # seconds between two status messages of one batch


@dataclass
class Incoming:
    """One thing a person sent, in the same shape for every channel."""

    chat_id: str
    user_id: str
    user_name: str = ""
    message_id: str = ""
    kind: str = "text"  # text | image | file | callback | other
    text: str = ""
    file_ref: str = ""  # what `download` needs: a Telegram file_id, a Zalo photo URL
    filename: str = ""
    mime: str = ""
    size: int = 0
    reply_to: str = ""
    compressed: bool = False  # a photo the chat service has shrunk (not sent as a file)
    callback_id: str = ""
    callback_data: str = ""


@dataclass(frozen=True)
class Button:
    label: str
    data: str


@dataclass
class Sent:
    message_id: str = ""


class Adapter:
    """One account's connection to a chat service. Never logs or returns its token."""

    app = ""
    caps = Capabilities()

    def __init__(self, token: str, transport: Optional[httpx.AsyncBaseTransport] = None, base: Optional[str] = None) -> None:
        self._token = token
        self._transport = transport
        self._base = (base or "").rstrip("/")

    # ---- plumbing ---------------------------------------------------------------------------------------------------------
    def clean(self, text: object) -> str:
        """An error text with the token taken out (some URLs carry it)."""
        s = str(text)
        return s.replace(self._token, "***") if self._token else s

    def _client(self, timeout: float = 30) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=timeout, transport=self._transport, follow_redirects=False)

    # ---- the API every channel offers -----------------------------------------------------------------------------------------
    async def get_me(self) -> dict:
        """`{"id": str, "username": str}` of the bot this token belongs to; ChannelError when the token is wrong."""
        raise NotImplementedError

    async def poll(self, cursor: str) -> tuple[list[Incoming], str]:
        """New things people sent and the cursor after them. Returns quickly (empty) when there is nothing."""
        raise NotImplementedError

    async def send_text(self, chat_id: str, text: str, buttons: Optional[list[list[Button]]] = None, keyboard: Optional[list[list[str]]] = None) -> Sent:
        raise NotImplementedError

    async def edit_text(self, chat_id: str, message_id: str, text: str, buttons: Optional[list[list[Button]]] = None) -> bool:
        raise Unsupported("this channel cannot change a sent message")

    async def send_file(self, chat_id: str, path: Path, caption: str = "") -> Sent:
        raise Unsupported("this channel cannot send files")

    async def download(self, ref: str, limit: int) -> bytes:
        raise NotImplementedError

    async def answer_callback(self, callback_id: str) -> None:
        return None

    async def typing(self, chat_id: str) -> None:
        return None

    async def clear_webhook(self) -> None:
        raise Unsupported("this channel has no webhook to clear")


# ---- small helpers ---------------------------------------------------------------------------------------------------------------
def safe_name(value: str, default: str = "file") -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value or "").strip("._")
    return value[:80] or default


def split_text(text: str, limit: int) -> list[str]:
    """Pieces of at most `limit` characters, cut at a line break when there is one."""
    text = text or ""
    if len(text) <= limit:
        return [text]
    out: list[str] = []
    while len(text) > limit:
        cut = text.rfind("\n", 0, limit)
        cut = cut if cut > limit // 2 else limit
        out.append(text[:cut])
        text = text[cut:].lstrip("\n")
    if text:
        out.append(text)
    return out


@dataclass
class ChannelInfo:
    id: str
    name: str
    blurb: str
    limits: list[str] = field(default_factory=list)
