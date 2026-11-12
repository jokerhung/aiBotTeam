"""Stand-ins for the Telegram Bot API and the Zalo Bot API: tokens, pending updates, files to download and everything the bot sent back."""
import json
from urllib.parse import parse_qs

import httpx

TG_TOKEN = "111111:AAtelegramtokenforshop"
TG_TOKEN_2 = "222222:BBtelegramtokenforsupport"
ZALO_TOKEN = "zalo-token-0123456789"


class FakeTelegram:
    def __init__(self) -> None:
        self.bots = {TG_TOKEN: {"id": 111111, "username": "shop_bot"}, TG_TOKEN_2: {"id": 222222, "username": "support_bot"}}
        self.updates: dict[str, list[dict]] = {t: [] for t in self.bots}
        self.files: dict[str, bytes] = {}
        self.sent: list[dict] = []  # {token, method, chat_id, text, ...}
        self.conflict: set[str] = set()
        self.offsets: dict[str, list[int]] = {t: [] for t in self.bots}
        self.next_update = 1000
        self.next_message = 1
        self.transport = httpx.MockTransport(self.handle)

    # ---- what a person does in the chat ----------------------------------------------------------------------------------------
    def _push(self, token: str, body: dict) -> int:
        self.next_update += 1
        self.updates[token].append({"update_id": self.next_update, **body})
        return self.next_update

    def _message(self, chat, user, **extra) -> dict:
        self.next_message += 1
        return {"message_id": self.next_message, "chat": {"id": chat}, "from": {"id": user, "first_name": f"User{user}", "is_bot": False}, **extra}

    def text(self, chat, text, user=7, token=TG_TOKEN) -> int:
        return self._push(token, {"message": self._message(chat, user, text=text)})

    def photo(self, chat, data=b"\xff\xd8photo", user=7, token=TG_TOKEN, caption=None) -> int:
        fid = f"ph{len(self.files) + 1}"
        self.files[fid] = data
        extra = {"photo": [{"file_id": fid, "file_size": len(data), "width": 800}]}
        if caption:
            extra["caption"] = caption
        return self._push(token, {"message": self._message(chat, user, **extra)})

    def document(self, chat, name, data=b"%PDF-1.4 sheet", mime="application/pdf", user=7, token=TG_TOKEN, size=None) -> int:
        fid = f"doc{len(self.files) + 1}"
        self.files[fid] = data
        return self._push(token, {"message": self._message(chat, user, document={"file_id": fid, "file_name": name, "mime_type": mime, "file_size": size or len(data)})})

    def press(self, chat, data, user=7, token=TG_TOKEN, message_id=1) -> int:
        return self._push(token, {"callback_query": {"id": f"cb{self.next_update}", "from": {"id": user, "first_name": f"User{user}"}, "data": data,
                                                    "message": {"message_id": message_id, "chat": {"id": chat}}}})

    def texts(self, chat=None, token=None) -> list[str]:
        return [m["text"] for m in self.sent if m["method"] in ("sendMessage", "editMessageText") and (chat is None or str(m["chat_id"]) == str(chat))
                and (token is None or m["token"] == token)]

    def buttons(self, chat=None) -> list[str]:
        return [b["callback_data"] for m in self.sent if (chat is None or str(m.get("chat_id")) == str(chat))
                for row in (m.get("reply_markup") or {}).get("inline_keyboard", []) for b in row]

    def documents(self, chat=None) -> list[dict]:
        return [m for m in self.sent if m["method"] == "sendDocument" and (chat is None or str(m["chat_id"]) == str(chat))]

    # ---- the API -----------------------------------------------------------------------------------------------------------------
    def handle(self, req: httpx.Request) -> httpx.Response:
        parts = req.url.path.strip("/").split("/")
        if parts[0] == "file":
            token, fid = parts[1][3:], parts[-1]
            return httpx.Response(200, content=self.files[fid]) if token in self.bots and fid in self.files else httpx.Response(404)
        token, method = parts[0][3:], parts[1]
        if token not in self.bots:
            return httpx.Response(401, json={"ok": False, "error_code": 401, "description": "Unauthorized"})
        ctype = req.headers.get("content-type", "")
        if ctype.startswith("application/json"):
            body = json.loads(req.content or b"{}")
        elif ctype.startswith("multipart/"):
            raw = req.content
            body = {"chat_id": raw.split(b'name="chat_id"\r\n\r\n')[1].split(b"\r\n")[0].decode(), "filename": raw.split(b'filename="')[1].split(b'"')[0].decode(), "size": len(raw)}
        else:
            body = {k: v[0] for k, v in parse_qs(req.content.decode()).items()}

        def ok(result) -> httpx.Response:
            return httpx.Response(200, json={"ok": True, "result": result})

        if method == "getMe":
            return ok(self.bots[token])
        if method == "getUpdates":
            if token in self.conflict:
                return httpx.Response(409, json={"ok": False, "error_code": 409, "description": "Conflict: terminated by other getUpdates request"})
            offset = int(body.get("offset") or 0)
            self.offsets[token].append(offset)
            self.updates[token] = [u for u in self.updates[token] if u["update_id"] >= offset]
            return ok(list(self.updates[token]))
        if method == "getFile":
            fid = body["file_id"]
            return ok({"file_id": fid, "file_size": len(self.files.get(fid, b"")), "file_path": f"docs/{fid}"})
        if method in ("sendMessage", "editMessageText", "sendDocument", "sendChatAction", "answerCallbackQuery", "deleteWebhook"):
            self.next_message += 1
            self.sent.append({"token": token, "method": method, **body, "text": body.get("text", "")})
            if method == "deleteWebhook":
                self.conflict.discard(token)
            return ok({"message_id": self.next_message} if method.startswith("send") else True)
        return httpx.Response(404, json={"ok": False, "error_code": 404, "description": "Not Found"})


class FakeZalo:
    def __init__(self) -> None:
        self.events: list[dict] = []
        self.sent: list[dict] = []
        self.webhook = False
        self.photos: dict[str, bytes] = {}
        self.next_id = 1
        self.as_list = False
        self.polls = 0
        self.transport = httpx.MockTransport(self.handle)

    def _event(self, name, chat, **extra) -> dict:
        self.next_id += 1
        e = {"event_name": name, "message": {"message_id": f"m{self.next_id}", "date": 1, "from": {"id": chat, "display_name": "Ted", "is_bot": False},
                                             "chat": {"id": chat, "chat_type": "PRIVATE"}, **extra}}
        self.events.append(e)
        return e

    def text(self, chat, text) -> dict:
        return self._event("message.text.received", chat, message_type="CHAT_TEXT", text=text)

    def photo(self, chat, data=b"\xff\xd8zalo") -> dict:
        url = f"https://photo.zalo.example/p{len(self.photos) + 1}.jpg"
        self.photos[url] = data
        return self._event("message.image.received", chat, message_type="CHAT_PHOTO", photo_url=url)

    def sticker(self, chat) -> dict:
        return self._event("message.sticker.received", chat, message_type="CHAT_STICKER", sticker="s1")

    def texts(self, chat=None) -> list[str]:
        return [m["text"] for m in self.sent if m["method"] == "sendMessage" and (chat is None or m["chat_id"] == chat)]

    def handle(self, req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if url in self.photos:
            return httpx.Response(200, content=self.photos[url])
        parts = req.url.path.strip("/").split("/")
        token, method = parts[0][3:], parts[1]
        if token != ZALO_TOKEN:
            return httpx.Response(401, json={"ok": False, "error_code": 401, "description": "Unauthorized"})
        body = json.loads(req.content or b"{}")
        if method == "getMe":
            return httpx.Response(200, json={"ok": True, "result": {"id": "zb1", "account_name": "Bot MyShop"}})
        if method == "getUpdates":
            self.polls += 1
            if self.webhook:
                return httpx.Response(200, json={"ok": False, "error_code": 400, "description": "Webhook is active, delete webhook first"})
            if not self.events:
                return httpx.Response(200, json={"ok": False, "error_code": 408, "description": "Request timeout"})
            if self.as_list:
                return httpx.Response(200, json={"ok": True, "result": list(self.events)})
            return httpx.Response(200, json={"ok": True, "result": self.events[0]})  # the same event again until `ack`: the bot must tell it apart
        if method == "deleteWebhook":
            self.webhook = False
            return httpx.Response(200, json={"ok": True, "result": True})
        if method in ("sendMessage", "sendChatAction"):
            self.sent.append({"method": method, **body})
            return httpx.Response(200, json={"ok": True, "result": {"message_id": f"s{len(self.sent)}", "date": 1}})
        return httpx.Response(404, json={"ok": False, "description": "Not Found"})

    def ack(self) -> None:
        """Zalo keeps no offset the bot can send: the fake drops the oldest event when the test says the bot has read it."""
        if self.events:
            self.events.pop(0)
