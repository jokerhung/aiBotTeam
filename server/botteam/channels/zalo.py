"""Zalo Bot adapter (https://docs.zaloplatforms.com/docs/BOT): text and photos in, text out. No files either way, no buttons, no edits.

The API is `POST https://bot-api.zaloplatforms.com/bot<TOKEN>/<method>` with a JSON body. `getUpdates` has no offset, so what was already
seen is told apart by message id (kept in the account's cursor).
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Optional

import httpx

from ..netguard import BlockedAddress, check_url
from .base import Adapter, Button, Capabilities, ChannelError, Incoming, Sent, split_text

API = "https://bot-api.zaloplatforms.com"
POLL_SECONDS = 30
SEEN_KEEP = 300
TEXT_MAX = 2000

EVENT_KINDS = {
    "message.text.received": "text",
    "message.image.received": "image",
    "message.sticker.received": "other",
    "message.voice.received": "other",
    "message.unsupported.received": "other",
}


def parse_event(e: dict) -> Optional[Incoming]:
    name = str(e.get("event_name") or "")
    m = e.get("message")
    if name not in EVENT_KINDS or not isinstance(m, dict):
        return None
    chat, sender = m.get("chat") or {}, m.get("from") or {}
    if "id" not in chat or sender.get("is_bot"):
        return None
    inc = Incoming(chat_id=str(chat["id"]), user_id=str(sender.get("id", "")), user_name=str(sender.get("display_name") or ""),
                   message_id=str(m.get("message_id", "")), kind=EVENT_KINDS[name], text=str(m.get("text") or m.get("caption") or ""))
    if inc.kind == "image":
        inc.file_ref, inc.mime, inc.compressed = str(m.get("photo_url") or ""), "image/jpeg", True
        inc.filename = f"photo_{inc.message_id}.jpg"
        if not inc.file_ref:
            inc.kind = "other"
    elif inc.kind == "other":
        inc.text = name  # the service answers "not supported" and never reads the text
    return inc


class ZaloAdapter(Adapter):
    app = "zalo"
    caps = Capabilities(files_in=False, files_out=False, buttons=False, edit=False, groups=False, max_text=TEXT_MAX, status_gap=5.0)

    def __init__(self, token: str, transport: Optional[httpx.AsyncBaseTransport] = None, base: Optional[str] = None) -> None:
        super().__init__(token, transport, base or os.environ.get("BOTTEAM_ZALO_API") or API)

    async def _call(self, method: str, payload: Optional[dict] = None, *, timeout: float = 30) -> Any:
        url = f"{self._base}/bot{self._token}/{method}"
        try:
            async with self._client(timeout) as c:
                res = await c.post(url, json=payload or {})
        except httpx.HTTPError as e:
            raise ChannelError(f"Zalo could not be reached: {type(e).__name__}") from e
        try:
            body = res.json()
        except ValueError:
            body = {}
        code = body.get("error_code") if isinstance(body, dict) else None
        text = str((body.get("description") or body.get("message") or "") if isinstance(body, dict) else "")
        if res.status_code in (401, 403) or code in (401, 403):
            raise ChannelError("Zalo refused this token", 401, fatal=True)
        if isinstance(body, dict) and not body.get("ok", res.status_code < 400):
            if code == 408 or "timeout" in text.lower():
                return None  # a long poll with nothing new
            if "webhook" in text.lower():
                raise ChannelError("This bot has a webhook set, so messages cannot be read here. Clear the webhook to continue.", 409, fatal=True)
            raise ChannelError(self.clean(text or f"Zalo: HTTP {res.status_code}")[:300], res.status_code if res.status_code >= 400 else 502)
        return body.get("result") if isinstance(body, dict) else None

    async def get_me(self) -> dict:
        r = await self._call("getMe", timeout=15) or {}
        name = str(r.get("account_name") or r.get("display_name") or r.get("name") or r.get("username") or "")
        return {"id": str(r.get("id") or r.get("bot_id") or name or "zalo"), "username": name}

    async def poll(self, cursor: str) -> tuple[list[Incoming], str]:
        try:
            seen: list[str] = [str(x) for x in json.loads(cursor)] if cursor else []
        except ValueError:
            seen = []
        r = await self._call("getUpdates", {"timeout": POLL_SECONDS}, timeout=POLL_SECONDS + 15)
        events = r if isinstance(r, list) else ([r] if isinstance(r, dict) and r else [])
        out: list[Incoming] = []
        for e in events:
            inc = parse_event(e) if isinstance(e, dict) else None
            if not inc or not inc.message_id or inc.message_id in seen:
                continue
            seen.append(inc.message_id)
            out.append(inc)
        return out, json.dumps(seen[-SEEN_KEEP:])

    async def send_text(self, chat_id: str, text: str, buttons: Optional[list[list[Button]]] = None, keyboard: Optional[list[list[str]]] = None) -> Sent:
        last = Sent()
        for piece in split_text(text or "…", TEXT_MAX):
            r = await self._call("sendMessage", {"chat_id": chat_id, "text": piece or "…"}) or {}
            last = Sent(str(r.get("message_id", "")))
        return last

    async def download(self, ref: str, limit: int) -> bytes:
        try:
            await asyncio.to_thread(check_url, ref)
        except BlockedAddress as e:
            raise ChannelError(f"the photo address is not allowed: {e}") from e
        try:
            async with self._client(60) as c:
                res = await c.get(ref)
        except httpx.HTTPError as e:
            raise ChannelError(f"the photo could not be downloaded: {type(e).__name__}") from e
        if res.status_code >= 400:
            raise ChannelError(f"the photo could not be downloaded: HTTP {res.status_code}")
        if len(res.content) > limit:
            raise ChannelError(f"the photo is larger than {limit // (1024 * 1024)} MB")
        return res.content

    async def typing(self, chat_id: str) -> None:
        try:
            await self._call("sendChatAction", {"chat_id": chat_id, "action": "typing"}, timeout=10)
        except ChannelError:
            pass

    async def clear_webhook(self) -> None:
        await self._call("deleteWebhook", {}, timeout=15)


__all__ = ["ZaloAdapter", "parse_event"]
