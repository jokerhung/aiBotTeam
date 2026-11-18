"""Zalo personal-account adapter: people write to your own Zalo account and the bot answers from it.

It does not talk to Zalo. The Node.js service in `zalo-service/` (built on zca-js, an unofficial library that behaves like Zalo Web) holds the
signed-in session; this adapter asks that service, on this computer, for new messages and gives it text to send. The "token" of an account here
is the service's key for it, made when the person scanned the QR code in the app. The service answers only a caller that knows the secret in
`<data dir>/zalo-service/secret`.

Text and photos in, text out; private chats only (the service leaves group messages out).
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Any, Optional

import httpx

from ..netguard import BlockedAddress, check_url
from .base import Adapter, Button, Capabilities, ChannelError, Incoming, Sent, split_text

SERVICE = "http://127.0.0.1:8902"
POLL_SECONDS = 25
TEXT_MAX = 2000
NOT_RUNNING = "The Zalo service is not running. Start it with `pnpm dev` or `pnpm dev:zalo` (it needs Node.js), then try again."

KINDS = {"text", "image", "other"}


def parse_event(e: dict) -> Optional[Incoming]:
    if not isinstance(e, dict) or not e.get("id") or not e.get("chatId"):
        return None
    kind = e.get("kind") if e.get("kind") in KINDS else "other"
    inc = Incoming(chat_id=str(e["chatId"]), user_id=str(e.get("userId") or ""), user_name=str(e.get("userName") or ""), message_id=str(e["id"]),
                   kind=kind, text=str(e.get("text") or ""))
    if kind == "image":
        inc.file_ref, inc.mime, inc.compressed = str(e.get("url") or ""), "image/jpeg", True
        inc.filename = f"photo_{inc.message_id}.jpg"
        if not inc.file_ref:
            inc.kind = "other"
    elif kind == "other":
        inc.text = str(e.get("text") or "other")
    return inc


class ZaloPersonalAdapter(Adapter):
    app = "zalo-personal"
    caps = Capabilities(files_in=False, files_out=False, buttons=False, edit=False, groups=False, max_text=TEXT_MAX, status_gap=5.0)
    secret_file: Optional[Path] = None  # set by the chat service: <data dir>/zalo-service/secret

    def __init__(self, token: str, transport: Optional[httpx.AsyncBaseTransport] = None, base: Optional[str] = None) -> None:
        super().__init__(token, transport, base or os.environ.get("BOTTEAM_ZALO_SERVICE") or SERVICE)

    def _secret(self) -> str:
        env = os.environ.get("ZALO_SERVICE_SECRET")
        if env:
            return env
        try:
            return self.secret_file.read_text(encoding="utf8").strip() if self.secret_file else ""
        except OSError:
            return ""

    async def _call(self, method: str, path: str, *, json: Optional[dict] = None, params: Optional[dict] = None, timeout: float = 30) -> Any:
        url = f"{self._base}/accounts/{self._token}{path}"
        try:
            async with self._client(timeout) as c:
                res = await c.request(method, url, json=json, params=params, headers={"x-botteam-secret": self._secret()})
        except httpx.HTTPError as e:
            raise ChannelError(NOT_RUNNING if isinstance(e, httpx.ConnectError) else f"The Zalo service did not answer: {type(e).__name__}") from e
        try:
            body = res.json()
        except ValueError:
            body = {}
        text = str(body.get("error") or "") if isinstance(body, dict) else ""
        if res.status_code in (401, 404):
            raise ChannelError(self.clean(text or "The Zalo service no longer knows this account. Sign in again with the QR code."), res.status_code, fatal=True)
        if res.status_code >= 400:
            raise ChannelError(self.clean(text or f"Zalo service: HTTP {res.status_code}")[:300], res.status_code if res.status_code < 500 else 502)
        return body

    async def get_me(self) -> dict:
        try:
            r = await self._call("GET", "", timeout=15)
        except ChannelError as e:
            if e.status == 404:  # said while connecting: the person's key is wrong, which is a 400 of theirs, not a missing page
                raise ChannelError("The Zalo service does not know this account. Sign in with the QR code first.", 400, fatal=True) from e
            raise
        if r.get("state") == "loggedout":
            raise ChannelError("Zalo ended this session. Sign in again with the QR code.", 401, fatal=True)
        return {"id": str(r.get("uid") or r.get("key") or ""), "username": str(r.get("name") or "")}

    async def poll(self, cursor: str) -> tuple[list[Incoming], str]:
        r = await self._call("GET", "/events", params={"after": cursor or "0", "timeout": POLL_SECONDS}, timeout=POLL_SECONDS + 15)
        out = [i for i in (parse_event(e) for e in r.get("events") or []) if i]
        return out, str(r.get("next") or cursor or "0")

    async def send_text(self, chat_id: str, text: str, buttons: Optional[list[list[Button]]] = None, keyboard: Optional[list[list[str]]] = None) -> Sent:
        last = Sent()
        for piece in split_text(text or "…", TEXT_MAX):
            r = await self._call("POST", "/send", json={"chatId": chat_id, "text": piece or "…"})
            last = Sent(str(r.get("messageId", "")))
        return last

    async def download(self, ref: str, limit: int) -> bytes:
        try:
            await asyncio.to_thread(check_url, ref)
        except BlockedAddress as e:
            raise ChannelError(f"the photo address is not allowed: {e}") from e
        try:
            async with httpx.AsyncClient(timeout=60, transport=self._transport, follow_redirects=False) as c:
                res = await c.get(ref)
        except httpx.HTTPError as e:
            raise ChannelError(f"the photo could not be downloaded: {type(e).__name__}") from e
        if res.status_code >= 400:
            raise ChannelError(f"the photo could not be downloaded: HTTP {res.status_code}")
        if len(res.content) > limit:
            raise ChannelError(f"the photo is larger than {limit // (1024 * 1024)} MB")
        return res.content

    async def forget(self) -> None:
        """The account is disconnected in BotTeam: the service signs it out and deletes its saved session."""
        try:
            await self._call("DELETE", "", timeout=15)
        except ChannelError:
            pass


__all__ = ["ZaloPersonalAdapter", "parse_event"]
