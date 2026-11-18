"""The Zalo personal-account input: an adapter that talks to the Node.js Zalo service (zalo-service/), against a fake of that service. Messages come in,
the bot answers from the same account, the service's secret is sent, a lost session stops the account, and disconnecting signs the account out."""
import asyncio
import json

import httpx
import pytest
from asgi_lifespan import LifespanManager

from botteam.channels import ChannelService, ChannelError
from botteam.channels.zalo_personal import NOT_RUNNING, ZaloPersonalAdapter, parse_event
from botteam.drivers.base import Capabilities
from botteam.main import create_app

from .test_api import make_bot, wait_idle

KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
SECRET = "service-secret"
CUSTOMER = "5551"


class FakeService:
    """What zalo-service answers on /accounts/<key>..., with the same shapes."""

    def __init__(self) -> None:
        self.events: list[dict] = []
        self.sent: list[dict] = []
        self.seen_secret: list[str] = []
        self.state = "connected"
        self.deleted = False
        self.down = False
        self.polls = 0
        self.photos: dict[str, bytes] = {}
        self.seq = 100
        self.transport = httpx.MockTransport(self.handle)

    def text(self, chat, text) -> None:
        self.seq += 1
        self.events.append({"seq": self.seq, "id": f"m{self.seq}", "chatId": chat, "userId": chat, "userName": "An", "kind": "text", "text": text, "url": "", "ts": 1})

    def photo(self, chat, data=b"\xff\xd8z") -> None:
        self.seq += 1
        url = f"https://cdn.zalo.example/p{self.seq}.jpg"
        self.photos[url] = data
        self.events.append({"seq": self.seq, "id": f"m{self.seq}", "chatId": chat, "userId": chat, "userName": "An", "kind": "image", "text": "", "url": url, "ts": 1})

    def texts(self, chat=None) -> list[str]:
        return [m["text"] for m in self.sent if chat is None or m["chatId"] == chat]

    def handle(self, req: httpx.Request) -> httpx.Response:
        if str(req.url) in self.photos:
            return httpx.Response(200, content=self.photos[str(req.url)])
        if self.down:
            raise httpx.ConnectError("refused")
        self.seen_secret.append(req.headers.get("x-botteam-secret", ""))
        if req.headers.get("x-botteam-secret") != SECRET:
            return httpx.Response(401, json={"error": "not allowed"})
        parts = req.url.path.strip("/").split("/")  # accounts, key, [events|send]
        if parts[1] != KEY:
            return httpx.Response(404, json={"error": "no such account"})
        what = parts[2] if len(parts) > 2 else ""
        if not what and req.method == "GET":
            return httpx.Response(200, json={"key": KEY, "uid": "u777", "name": "Minh Shop", "state": self.state, "error": ""})
        if not what and req.method == "DELETE":
            self.deleted = True
            return httpx.Response(200, json={"ok": True})
        if what == "events":
            self.polls += 1
            if self.state == "loggedout":
                return httpx.Response(401, json={"error": "Zalo ended this session: sign in again with the QR code"})
            after = int(req.url.params.get("after") or 0)
            got = [e for e in self.events if e["seq"] > after]
            return httpx.Response(200, json={"events": got, "next": str(got[-1]["seq"] if got else after), "state": self.state})
        if what == "send":
            self.sent.append(json.loads(req.content))
            return httpx.Response(200, json={"messageId": f"s{len(self.sent)}"})
        return httpx.Response(404, json={"error": "not found"})


@pytest.fixture
def svc(monkeypatch, tmp_path):
    f = FakeService()
    monkeypatch.setenv("ZALO_SERVICE_SECRET", SECRET)
    monkeypatch.setattr(ChannelService, "default_transport", f.transport)
    monkeypatch.setattr(ChannelService, "idle_sleep", 0.01)
    monkeypatch.setattr(ChannelService, "status_gap", 0.0)
    return f


@pytest.fixture
async def chan(tmp_path, svc):
    app = create_app(str(tmp_path / "t.db"), home=tmp_path)
    async with LifespanManager(app):
        app.state.registry.get("echo").driver.capabilities = Capabilities(queueing=False, images=True)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            yield c, app, svc


async def until(cond, timeout=6.0, what="condition"):
    for _ in range(int(timeout / 0.02)):
        r = cond()
        if asyncio.iscoroutine(r):
            r = await r
        if r:
            return r
        await asyncio.sleep(0.02)
    raise AssertionError(f"never happened: {what}")


async def connect(c, label="minh"):
    r = await c.post("/api/channels/zalo-personal/accounts", json={"label": label, "token": KEY})
    assert r.status_code == 201, r.text
    return r.json()


async def accounts(c):
    return next(ch for ch in (await c.get("/api/channels")).json()["channels"] if ch["id"] == "zalo-personal")["accounts"]


# ---- the adapter -----------------------------------------------------------------------------------------------------------------
def adapter(svc, key=KEY):
    return ZaloPersonalAdapter(key, transport=svc.transport, base="http://127.0.0.1:8902")


async def test_the_adapter_reads_who_it_is_collects_messages_from_a_cursor_and_sends_in_pieces(svc, monkeypatch):
    monkeypatch.setenv("ZALO_SERVICE_SECRET", SECRET)
    a = adapter(svc)
    assert await a.get_me() == {"id": "u777", "username": "Minh Shop"}
    svc.text(CUSTOMER, "xin chào")
    svc.photo(CUSTOMER)
    got, cursor = await a.poll("")
    assert [(i.kind, i.text, i.chat_id) for i in got] == [("text", "xin chào", CUSTOMER), ("image", "", CUSTOMER)]
    assert got[1].compressed and got[1].file_ref.startswith("https://cdn.zalo.example/") and got[1].filename.endswith(".jpg")
    assert await a.poll(cursor) == ([], cursor), "what was collected is not given twice"
    await a.send_text(CUSTOMER, "a" * 2500)
    assert [len(t) for t in svc.texts()] == [2000, 500]
    assert set(svc.seen_secret) == {SECRET}, "every call carries the service's secret"
    assert await a.download(got[1].file_ref, 1024) == b"\xff\xd8z"
    assert parse_event({"id": "1", "chatId": "2", "kind": "image", "url": ""}).kind == "other", "a photo without a link is not a photo"
    assert parse_event({"chatId": "2"}) is None


async def test_the_adapter_says_what_is_wrong(svc, monkeypatch):
    monkeypatch.setenv("ZALO_SERVICE_SECRET", SECRET)
    svc.down = True
    with pytest.raises(ChannelError) as e:
        await adapter(svc).get_me()
    assert str(e.value) == NOT_RUNNING and not e.value.fatal, "a service that is not running is waited for, not given up on"
    svc.down = False
    with pytest.raises(ChannelError) as e:
        await adapter(svc, "f" * 32).get_me()
    assert e.value.fatal and e.value.status == 400, "an account the service does not know ends the account"
    monkeypatch.setenv("ZALO_SERVICE_SECRET", "wrong")
    with pytest.raises(ChannelError) as e:
        await adapter(svc).get_me()
    assert e.value.fatal and e.value.status == 401
    monkeypatch.setenv("ZALO_SERVICE_SECRET", SECRET)
    svc.state = "loggedout"
    with pytest.raises(ChannelError) as e:
        await adapter(svc).get_me()
    assert e.value.fatal and "sign in again" in str(e.value).lower()


async def test_the_secret_is_read_from_the_services_file_when_no_variable_is_set(svc, monkeypatch, tmp_path):
    monkeypatch.delenv("ZALO_SERVICE_SECRET")
    a = adapter(svc)
    a.secret_file = tmp_path / "secret"
    a.secret_file.write_text(SECRET + "\n")
    assert (await a.get_me())["id"] == "u777"


# ---- in the app --------------------------------------------------------------------------------------------------------------------
async def test_it_is_listed_as_a_channel_and_an_account_is_connected_with_the_services_key(chan):
    c, app, svc = chan
    ids = [ch["id"] for ch in (await c.get("/api/channels")).json()["channels"]]
    assert ids == ["telegram", "zalo", "zalo-personal"]
    info = next(ch for ch in (await c.get("/api/channels")).json()["channels"] if ch["id"] == "zalo-personal")
    assert any("unofficial" in x for x in info["limits"])
    acc = await connect(c)
    assert acc["app"] == "zalo-personal" and acc["username"] == "Minh Shop" and acc["state"] == "active"
    assert KEY not in json.dumps((await c.get("/api/channels")).json()), "the key is a secret and is never returned"
    assert (await c.post("/api/channels/zalo-personal/accounts", json={"label": "again", "token": KEY})).status_code == 409, "the same Zalo account twice"
    assert (await c.post("/api/channels/zalo-personal/accounts", json={"label": "x", "token": "f" * 32})).status_code == 400


async def test_a_message_is_answered_from_the_same_account_and_disconnecting_signs_it_out(chan):
    c, app, svc = chan
    acc = await connect(c)
    bot = await make_bot(c, "Shop answerer")
    r = await c.put(f"/api/channels/zalo-personal/accounts/{acc['id']}/grants/{bot['id']}", json={"mode": "chat", "chats": ["*"]})
    assert r.status_code == 200, r.text
    svc.text(CUSTOMER, "lô 1401 kiện 7")
    await until(lambda: any("1401" in t for t in svc.texts(CUSTOMER)), what="the answer sent through the service")
    await wait_idle(c, bot["id"])
    assert (await c.delete(f"/api/channels/zalo-personal/accounts/{acc['id']}")).status_code == 200
    assert svc.deleted, "the service signs the account out and forgets its session"
    assert await accounts(c) == []


async def test_a_session_zalo_ended_stops_the_account_and_says_so(chan):
    c, app, svc = chan
    acc = await connect(c)
    svc.state = "loggedout"

    async def stopped():
        a = next((x for x in await accounts(c) if x["id"] == acc["id"]), None)
        return a and a["state"] == "error" and "sign in again" in (a["error"] or "").lower()

    await until(stopped, what="the account in error")


# ---- the proxy of the built app ------------------------------------------------------------------------------------------------
async def test_the_built_app_forwards_only_the_sign_in_paths_to_the_service(chan, monkeypatch):
    c, app, svc = chan
    assert (await c.get("/zalo-api/accounts/x")).status_code == 404, "the service's account paths are not for the browser"
    monkeypatch.setenv("BOTTEAM_ZALO", "http://127.0.0.1:1")  # nothing listens there
    r = await c.post("/zalo-api/login", content=b"{}", headers={"content-type": "application/json"})
    assert r.status_code == 502 and "pnpm dev:zalo" in r.text
