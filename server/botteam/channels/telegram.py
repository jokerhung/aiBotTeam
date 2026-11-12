"""Telegram Bot API adapter: long polling (`getUpdates`), files in and out, inline buttons, edited status messages."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

import httpx

from .base import Adapter, Button, Capabilities, ChannelError, Incoming, Sent

API = "https://api.telegram.org"
POLL_SECONDS = 25


def _name(u: dict) -> str:
    full = " ".join(x for x in (u.get("first_name"), u.get("last_name")) if x)
    return full or u.get("username") or str(u.get("id", ""))


def parse_update(u: dict) -> Optional[Incoming]:
    """One Telegram update in the shared shape; None for kinds this bot does not use (edited messages, joins...)."""
    cb = u.get("callback_query")
    if cb:
        m = cb.get("message") or {}
        chat = m.get("chat") or {}
        if "id" not in chat:
            return None
        return Incoming(chat_id=str(chat["id"]), user_id=str((cb.get("from") or {}).get("id", "")), user_name=_name(cb.get("from") or {}),
                        message_id=str(m.get("message_id", "")), kind="callback", callback_id=str(cb.get("id", "")), callback_data=str(cb.get("data") or ""))
    m = u.get("message")
    if not m or "chat" not in m or "id" not in m["chat"]:
        return None
    sender = m.get("from") or {}
    if sender.get("is_bot"):
        return None
    inc = Incoming(chat_id=str(m["chat"]["id"]), user_id=str(sender.get("id", "")), user_name=_name(sender), message_id=str(m.get("message_id", "")),
                   text=str(m.get("caption") or m.get("text") or ""), reply_to=str((m.get("reply_to_message") or {}).get("message_id", "")))
    if m.get("photo"):
        best = max(m["photo"], key=lambda p: (p.get("file_size") or 0, p.get("width") or 0))
        inc.kind, inc.file_ref, inc.size, inc.compressed = "image", str(best.get("file_id", "")), int(best.get("file_size") or 0), True
        inc.filename, inc.mime = f"photo_{inc.message_id}.jpg", "image/jpeg"
    elif m.get("document"):
        d = m["document"]
        inc.file_ref, inc.size, inc.mime = str(d.get("file_id", "")), int(d.get("file_size") or 0), str(d.get("mime_type") or "")
        inc.filename = str(d.get("file_name") or f"file_{inc.message_id}")
        inc.kind = "image" if inc.mime.startswith("image/") else "file"
    elif m.get("text"):
        inc.kind = "text"
    else:
        inc.kind = "other"
    return inc


class TelegramAdapter(Adapter):
    app = "telegram"
    caps = Capabilities(files_in=True, files_out=True, buttons=True, edit=True, groups=True, max_text=4000, status_gap=2.0)

    def __init__(self, token: str, transport: Optional[httpx.AsyncBaseTransport] = None, base: Optional[str] = None) -> None:
        super().__init__(token, transport, base or os.environ.get("BOTTEAM_TELEGRAM_API") or API)

    async def _call(self, method: str, payload: Optional[dict] = None, *, files: Optional[dict] = None, timeout: float = 30) -> Any:
        url = f"{self._base}/bot{self._token}/{method}"
        try:
            async with self._client(timeout) as c:
                res = await (c.post(url, data=payload, files=files) if files else c.post(url, json=payload or {}))
        except httpx.HTTPError as e:
            raise ChannelError(f"Telegram could not be reached: {type(e).__name__}") from e
        try:
            body = res.json()
        except ValueError:
            body = {}
        if res.status_code == 401 or (not body.get("ok") and body.get("error_code") == 401):
            raise ChannelError("Telegram refused this token", 401, fatal=True)
        if res.status_code == 409 or body.get("error_code") == 409:
            raise ChannelError("Another program is reading this bot's messages (a webhook, or a second server). Stop it or remove the webhook.", 409, fatal=True)
        if not body.get("ok"):
            raise ChannelError(self.clean(str(body.get("description") or f"Telegram: HTTP {res.status_code}"))[:300], res.status_code if res.status_code >= 400 else 502)
        return body.get("result")

    async def get_me(self) -> dict:
        r = await self._call("getMe", timeout=15)
        return {"id": str(r.get("id", "")), "username": str(r.get("username") or "")}

    async def poll(self, cursor: str) -> tuple[list[Incoming], str]:
        payload: dict[str, Any] = {"timeout": POLL_SECONDS, "allowed_updates": ["message", "callback_query"]}
        if cursor:
            payload["offset"] = int(cursor)
        updates = await self._call("getUpdates", payload, timeout=POLL_SECONDS + 15) or []
        out = [i for i in (parse_update(u) for u in updates) if i]
        nxt = str(max(int(u["update_id"]) for u in updates) + 1) if updates else cursor
        return out, nxt

    @staticmethod
    def _markup(buttons: Optional[list[list[Button]]], keyboard: Optional[list[list[str]]]) -> Optional[dict]:
        if buttons:
            return {"inline_keyboard": [[{"text": b.label, "callback_data": b.data} for b in row] for row in buttons]}
        if keyboard:
            return {"keyboard": [[{"text": t} for t in row] for row in keyboard], "resize_keyboard": True, "is_persistent": True}
        return None

    async def send_text(self, chat_id: str, text: str, buttons=None, keyboard=None) -> Sent:
        payload: dict[str, Any] = {"chat_id": chat_id, "text": text or "…"}
        markup = self._markup(buttons, keyboard)
        if markup:
            payload["reply_markup"] = markup
        r = await self._call("sendMessage", payload)
        return Sent(str((r or {}).get("message_id", "")))

    async def edit_text(self, chat_id: str, message_id: str, text: str, buttons=None) -> bool:
        payload: dict[str, Any] = {"chat_id": chat_id, "message_id": int(message_id), "text": text or "…"}
        payload["reply_markup"] = self._markup(buttons, None) or {"inline_keyboard": []}
        try:
            await self._call("editMessageText", payload)
        except ChannelError as e:
            if "not modified" in str(e).lower():
                return True
            raise
        return True

    async def send_file(self, chat_id: str, path: Path, caption: str = "") -> Sent:
        with open(path, "rb") as f:
            r = await self._call("sendDocument", {"chat_id": chat_id, "caption": caption[:1000]}, files={"document": (path.name, f.read())}, timeout=120)
        return Sent(str((r or {}).get("message_id", "")))

    async def download(self, ref: str, limit: int) -> bytes:
        info = await self._call("getFile", {"file_id": ref}, timeout=15)
        size = int((info or {}).get("file_size") or 0)
        if size > limit:
            raise ChannelError(f"the file is larger than {limit // (1024 * 1024)} MB")
        path = (info or {}).get("file_path")
        if not path:
            raise ChannelError("Telegram gave no file path")
        try:
            async with self._client(120) as c:
                res = await c.get(f"{self._base}/file/bot{self._token}/{path}")
        except httpx.HTTPError as e:
            raise ChannelError(f"the file could not be downloaded: {type(e).__name__}") from e
        if res.status_code >= 400:
            raise ChannelError(f"the file could not be downloaded: HTTP {res.status_code}")
        if len(res.content) > limit:
            raise ChannelError(f"the file is larger than {limit // (1024 * 1024)} MB")
        return res.content

    async def answer_callback(self, callback_id: str) -> None:
        try:
            await self._call("answerCallbackQuery", {"callback_query_id": callback_id}, timeout=10)
        except ChannelError:
            pass

    async def typing(self, chat_id: str) -> None:
        try:
            await self._call("sendChatAction", {"chat_id": chat_id, "action": "typing"}, timeout=10)
        except ChannelError:
            pass

    async def clear_webhook(self) -> None:
        await self._call("deleteWebhook", {"drop_pending_updates": False}, timeout=15)


__all__ = ["TelegramAdapter", "parse_update"]
