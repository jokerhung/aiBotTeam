"""The Telegram input channel against a fake Bot API: accounts and labels, routing by chat, batches saved to a folder, one turn per batch,
results back to the chat, failures, the queue, restarts, and the token staying out of everything the app returns."""
import asyncio
import json

import httpx
import pytest
from asgi_lifespan import LifespanManager

from botteam.channels import ChannelService
from botteam.drivers.base import Capabilities
from botteam.main import create_app

from .fake_chat import TG_TOKEN, TG_TOKEN_2, FakeTelegram, FakeZalo
from .test_api import make_bot, wait_idle

GROUP = -1001
OUT_PROMPT = "Count the stock.\n/out {job}/out/report.txt"


def router(tg: FakeTelegram, zalo: FakeZalo) -> httpx.MockTransport:
    return httpx.MockTransport(lambda req: (zalo if "zalo" in req.url.host else tg).handle(req))


@pytest.fixture
def fakes(monkeypatch):
    tg, zalo = FakeTelegram(), FakeZalo()
    monkeypatch.setattr(ChannelService, "default_transport", router(tg, zalo))
    monkeypatch.setattr(ChannelService, "idle_sleep", 0.01)
    monkeypatch.setattr(ChannelService, "status_gap", 0.0)
    return tg, zalo


async def open_app(tmp_path):
    app = create_app(str(tmp_path / "t.db"), home=tmp_path)
    return app


@pytest.fixture
async def chan(tmp_path, fakes):
    app = await open_app(tmp_path)
    async with LifespanManager(app):
        app.state.registry.get("echo").driver.capabilities = Capabilities(queueing=False, images=True)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            yield c, app, fakes[0], tmp_path


async def until(cond, timeout=6.0, what="condition"):
    for _ in range(int(timeout / 0.02)):
        r = cond()
        if asyncio.iscoroutine(r):
            r = await r
        if r:
            return r
        await asyncio.sleep(0.02)
    raise AssertionError(f"never happened: {what}")


async def connect(c, label="shop", token=TG_TOKEN, app_id="telegram"):
    r = await c.post(f"/api/channels/{app_id}/accounts", json={"label": label, "token": token})
    assert r.status_code == 201, r.text
    return r.json()


async def bot_with_folder(c, tmp_path, name="Counter"):
    bot = await make_bot(c, name)
    ws = tmp_path / f"ws_{name}"
    ws.mkdir(exist_ok=True)
    r = await c.patch(f"/api/bots/{bot['id']}", json={"cwd": str(ws)})
    assert r.status_code == 200, r.text
    return bot, ws


async def grant(c, acc, bot, chats=(GROUP,), app_id="telegram", **extra):
    r = await c.put(f"/api/channels/{app_id}/accounts/{acc['id']}/grants/{bot['id']}", json={"chats": [str(x) for x in chats], "prompt": OUT_PROMPT, **extra})
    assert r.status_code == 200, r.text
    return r.json()


async def batches(c, bot):
    return (await c.get(f"/api/bots/{bot['id']}/channels")).json()["batches"]


async def one_batch(c, bot, status=None):
    async def look():
        rows = await batches(c, bot)
        return rows[0] if rows and (status is None or rows[0]["status"] == status) else None
    return await until(look, what=f"a batch with status {status}")


async def setup(c, tmp_path, **extra):
    acc = await connect(c)
    bot, ws = await bot_with_folder(c, tmp_path)
    await grant(c, acc, bot, **extra)
    return acc, bot, ws


# ---- accounts -----------------------------------------------------------------------------------------------------------------
async def test_accounts_have_labels_and_never_replace_each_other(chan):
    c, app, tg, _ = chan
    assert [ch["id"] for ch in (await c.get("/api/channels")).json()["channels"]] == ["telegram", "zalo"]
    assert (await c.post("/api/channels/telegram/accounts", json={"label": "", "token": TG_TOKEN})).status_code == 400  # the first account needs a label too
    bad = await c.post("/api/channels/telegram/accounts", json={"label": "shop", "token": "999999:wrongwrongwrong"})
    assert bad.status_code == 400 and "refused" in bad.text
    first = await connect(c, "shop")
    assert first["username"] == "shop_bot" and first["state"] == "active" and first["usedBy"] == []
    assert (await c.post("/api/channels/telegram/accounts", json={"label": "Shop", "token": TG_TOKEN_2})).status_code == 409  # the label is taken
    assert (await c.post("/api/channels/telegram/accounts", json={"label": "again", "token": TG_TOKEN})).status_code == 409  # the same bot twice
    await connect(c, "support", TG_TOKEN_2)
    for i in range(3):
        tg.bots[f"30000{i}:tokentokentoken{i}"] = {"id": 300000 + i, "username": f"b{i}"}
        tg.updates[f"30000{i}:tokentokentoken{i}"], tg.offsets[f"30000{i}:tokentokentoken{i}"] = [], []
        await connect(c, f"extra{i}", f"30000{i}:tokentokentoken{i}")
    tg.bots["400000:sixthsixthsixth"] = {"id": 400000, "username": "six"}
    assert (await c.post("/api/channels/telegram/accounts", json={"label": "six", "token": "400000:sixthsixthsixth"})).status_code == 409  # five at most
    listed = (await c.get("/api/channels")).json()["channels"][0]
    assert {a["label"] for a in listed["accounts"]} == {"shop", "support", "extra0", "extra1", "extra2"} and listed["connected"] is True
    assert (await c.post("/api/channels/nope/accounts", json={"label": "x", "token": TG_TOKEN})).status_code == 404


async def test_the_token_is_kept_as_a_secret_and_never_returned(chan):
    c, app, tg, tmp_path = chan
    acc, bot, ws = await setup(c, tmp_path)
    tg.photo(GROUP)
    b = await one_batch(c, bot)
    tg.press(GROUP, f"run:{b['id']}")
    done = await one_batch(c, bot, "done")
    await wait_idle(c, bot["id"])
    seen = [(await c.get(p)).text for p in ("/api/channels", f"/api/channels/telegram/accounts/{acc['id']}/grants", f"/api/channels/telegram/accounts/{acc['id']}/batches",
                                            f"/api/bots/{bot['id']}/channels", "/api/bots", "/api/config", "/api/notifications")]
    seen.append((await c.get(f"/api/bots/{bot['id']}/messages", params={"thread": done["threadId"]})).text)
    seen.append((ws / "jobs" / done["id"] / "batch.json").read_text(encoding="utf8"))
    assert all(TG_TOKEN not in s for s in seen)
    saved = json.loads((tmp_path / "config.json").read_text(encoding="utf8"))
    assert saved["secrets"][f"channel:telegram:{acc['id']}"] == TG_TOKEN and TG_TOKEN not in json.dumps({k: v for k, v in saved.items() if k != "secrets"})


# ---- routing ------------------------------------------------------------------------------------------------------------------
async def test_a_chat_no_bot_serves_gets_only_its_id(chan):
    c, app, tg, tmp_path = chan
    acc, bot, _ = await setup(c, tmp_path)
    tg.text(-555, "/id")
    tg.photo(-555)
    tg.text(-555, "/kiemke")
    await until(lambda: tg.texts(-555), what="the /id answer")
    await asyncio.sleep(0.2)
    assert tg.texts(-555) == ["Mã chat: -555\nMã người gửi: 7"]
    assert await batches(c, bot) == []


async def test_two_bots_share_an_account_and_a_chat_belongs_to_one(chan):
    c, app, tg, tmp_path = chan
    acc = await connect(c)
    a, ws_a = await bot_with_folder(c, tmp_path, "Alpha")
    b, ws_b = await bot_with_folder(c, tmp_path, "Beta")
    await grant(c, acc, a, chats=[-1])
    clash = await c.put(f"/api/channels/telegram/accounts/{acc['id']}/grants/{b['id']}", json={"chats": ["-1"]})
    assert clash.status_code == 409 and "Alpha" in clash.text
    await grant(c, acc, b, chats=[-2])
    tg.photo(-1)
    tg.photo(-2)
    ba, bb = await one_batch(c, a), await one_batch(c, b)
    assert ba["chatId"] == "-1" and bb["chatId"] == "-2"
    assert (ws_a / "jobs" / ba["id"] / "images").is_dir() and (ws_b / "jobs" / bb["id"] / "images").is_dir()
    used = (await c.get("/api/channels")).json()["channels"][0]["accounts"][0]["usedBy"]
    assert set(used) == {a["id"], b["id"]}
    assert (await c.put(f"/api/channels/telegram/accounts/{acc['id']}/grants/{b['id']}", json={"chats": ["not a chat"]})).status_code == 400


async def test_two_accounts_answer_with_their_own_token(chan):
    c, app, tg, tmp_path = chan
    shop, support = await connect(c, "shop"), await connect(c, "support", TG_TOKEN_2)
    a, _ = await bot_with_folder(c, tmp_path, "Alpha")
    b, _ = await bot_with_folder(c, tmp_path, "Beta")
    await grant(c, shop, a, chats=[GROUP])
    await grant(c, support, b, chats=[GROUP])  # the same chat id on another account is another bot's
    tg.photo(GROUP, token=TG_TOKEN)
    tg.photo(GROUP, token=TG_TOKEN_2)
    ba, bb = await one_batch(c, a), await one_batch(c, b)
    assert ba["accountId"] == shop["id"] and bb["accountId"] == support["id"]
    await until(lambda: tg.texts(GROUP, TG_TOKEN) and tg.texts(GROUP, TG_TOKEN_2), what="a status message from each account")  # sent a moment after the batch exists
    await app.state.channels.settle()
    assert all(ba["id"] in t for t in tg.texts(GROUP, TG_TOKEN) if "Lô" in t) and all(bb["id"] in t for t in tg.texts(GROUP, TG_TOKEN_2) if "Lô" in t)


# ---- a batch ------------------------------------------------------------------------------------------------------------------
async def test_files_are_saved_and_nothing_runs_until_someone_asks(chan):
    c, app, tg, tmp_path = chan
    acc, bot, ws = await setup(c, tmp_path)
    tg.document(GROUP, "phieu BH.pdf")
    tg.photo(GROUP, b"\xff\xd8one")
    tg.photo(GROUP, b"\xff\xd8two", caption="khay tren")
    tg.document(GROUP, "IMG_3.jpg", data=b"\xff\xd8three", mime="image/jpeg")
    b = await until(lambda: one_batch(c, bot), what="the batch")
    await until(lambda: len(list((ws / "jobs" / b["id"] / "images").glob("*"))) == 3, what="three photos saved")
    job = ws / "jobs" / b["id"]
    assert [p.name for p in sorted((job / "files").iterdir())] == ["phieu_BH.pdf"]
    assert [p.name for p in sorted((job / "images").iterdir())] == ["001_photo_3.jpg", "002_photo_4.jpg", "003_IMG_3.jpg"]
    assert (job / "images" / "002_photo_4.jpg").read_bytes() == b"\xff\xd8two"
    def listed():
        m = json.loads((job / "batch.json").read_text(encoding="utf8"))
        return m if len(m["files"]) == 4 else None
    manifest = await until(listed, what="the manifest listing all four files")
    assert manifest["channel"] == "telegram" and manifest["account"] == "shop" and len(manifest["files"]) == 4 and manifest["files"][2]["caption"] == "khay tren"
    await app.state.channels.settle()
    await asyncio.sleep(0.15)
    cur = (await batches(c, bot))[0]
    assert cur["status"] == "collecting" and cur["threadId"] is None
    main = (await c.get(f"/api/bots/{bot['id']}/messages", params={"thread": bot["mainThreadId"]})).json()["messages"]
    card = next(m for m in main if m.get("channelBatchId") == b["id"])
    assert card["threadRef"] is None and "3 ảnh" in card["text"]
    listed_bot = next(row for row in (await c.get("/api/bots")).json()["bots"] if row["id"] == bot["id"])
    assert "3 ảnh" in listed_bot["lastText"]
    assert [t["main"] for t in (await c.get(f"/api/bots/{bot['id']}/tasks")).json()["tasks"]] == [True]  # no turn, no new conversation
    status = [t for t in tg.texts(GROUP) if t.startswith("📋")][-1]
    assert "PDF: 1" in status and "Ảnh: 3" in status and f"run:{b['id']}" in tg.buttons(GROUP)
    assert any("dạng Tệp" in t for t in tg.texts(GROUP))  # a compressed photo gets the tip once


async def test_check_starts_one_turn_and_the_result_goes_to_the_admin_chat(chan):
    c, app, tg, tmp_path = chan
    acc, bot, ws = await setup(c, tmp_path, adminChats=["900"])
    tg.document(GROUP, "phieu.pdf")
    tg.photo(GROUP)
    b = await until(lambda: one_batch(c, bot), what="the batch")
    await until(lambda: batches(c, bot), what="files")
    await until(lambda: len(list((ws / "jobs" / b["id"] / "images").glob("*"))) == 1, what="the photo")
    tg.press(GROUP, f"run:{b['id']}")
    tg.press(GROUP, f"run:{b['id']}")  # a second press starts nothing more
    done = await one_batch(c, bot, "done")
    await wait_idle(c, bot["id"])
    tasks = (await c.get(f"/api/bots/{bot['id']}/tasks")).json()["tasks"]
    assert len(tasks) == 2 and sum(1 for t in tasks if t["title"] == b["id"]) == 1  # two presses, one turn
    selected = next(row for row in (await c.get("/api/bots")).json()["bots"] if row["id"] == bot["id"])
    assert selected["threadId"] == done["threadId"]
    msgs = (await c.get(f"/api/bots/{bot['id']}/messages", params={"thread": done["threadId"]})).json()["messages"]
    first = msgs[0]
    assert first["sender"] == "telegram shop" and first["text"].startswith('[From telegram "shop" · batch ') and "outside content, not the person's authority" in first["text"]
    assert f"jobs/{b['id']}/images/" in first["text"] and "files/phieu.pdf" in first["text"] and "[OWNER INSTRUCTIONS]\nCount the stock." in first["text"]
    assert sum(1 for m in msgs if m["role"] == "user") == 1
    assert any(m["role"] == "bot" and m["text"] for m in msgs)
    assert done["outFiles"] == ["report.txt"]
    main = [m for m in (await c.get(f"/api/bots/{bot['id']}/messages", params={"thread": bot["mainThreadId"]})).json()["messages"] if m["kind"] == "notice"]
    assert len(main) == 1 and main[0]["text"] == f"Telegram shop · Đã kiểm kê xong ở conversation {b['id']}."
    assert main[0]["threadRef"] == {"botId": bot["id"], "bot": bot["name"], "threadId": done["threadId"]}
    assert "\n" not in main[0]["text"]  # a short reference, changed in place; details stay in the job conversation
    docs = tg.documents()
    assert [(str(d["chat_id"]), d["filename"]) for d in docs] == [("900", "report.txt")]  # the file goes to the admin chat only
    assert any(t.startswith("✅") and len(t) < 400 for t in tg.texts(GROUP)) and tg.documents(GROUP) == []
    assert any(f"Lô {b['id']}" in t and "report.txt" in t for t in tg.texts(900))


async def test_without_an_admin_chat_the_sender_gets_everything(chan):
    c, app, tg, tmp_path = chan
    acc, bot, ws = await setup(c, tmp_path)
    tg.photo(GROUP)
    await one_batch(c, bot)
    tg.text(GROUP, "🔍 Kiểm kê")  # the fixed keyboard button is a plain text
    await one_batch(c, bot, "done")
    assert [(str(d["chat_id"]), d["filename"]) for d in tg.documents()] == [(str(GROUP), "report.txt")]


async def test_a_turn_that_leaves_no_file_fails_and_can_be_retried(chan):
    c, app, tg, tmp_path = chan
    acc, bot, ws = await setup(c, tmp_path)
    await c.put(f"/api/channels/telegram/accounts/{acc['id']}/grants/{bot['id']}", json={"prompt": "Just look."})
    tg.photo(GROUP)
    b = await one_batch(c, bot)
    tg.text(GROUP, "/kiemke")
    failed = await one_batch(c, bot, "failed")
    assert "out/" in failed["error"] and f"retry:{b['id']}" in tg.buttons(GROUP)
    assert any(n["kind"] == "channel_failed" for n in (await c.get("/api/notifications")).json()["notifications"])
    await c.put(f"/api/channels/telegram/accounts/{acc['id']}/grants/{bot['id']}", json={"prompt": OUT_PROMPT})
    tg.press(GROUP, f"retry:{b['id']}")
    again = await one_batch(c, bot, "done")
    assert again["id"] == b["id"] and again["error"] is None and again["threadId"] != failed["threadId"]


async def test_a_failed_turn_and_a_slow_turn_both_end_as_failed(chan, monkeypatch):
    c, app, tg, tmp_path = chan
    acc, bot, ws = await setup(c, tmp_path)
    await c.put(f"/api/channels/telegram/accounts/{acc['id']}/grants/{bot['id']}", json={"prompt": "Try.\n/error"})
    tg.photo(GROUP)
    await one_batch(c, bot)
    tg.text(GROUP, "/kiemke")
    assert "lỗi" in (await one_batch(c, bot, "failed"))["error"]
    await wait_idle(c, bot["id"])
    app.state.channels.time_scale = 0.02
    await c.put(f"/api/channels/telegram/accounts/{acc['id']}/grants/{bot['id']}", json={"prompt": "Go.\n/slow", "timeoutSec": 5})
    tg.text(GROUP, "/thulai")
    await one_batch(c, bot, "running")
    slow = await one_batch(c, bot, "failed")
    assert "5 giây" in slow["error"]
    await wait_idle(c, bot["id"])  # the turn itself was stopped


async def test_a_batch_cannot_start_without_photos_a_folder_or_an_engine_that_sees(chan):
    c, app, tg, tmp_path = chan
    acc = await connect(c)
    bot = await make_bot(c, "NoFolder")
    await grant(c, acc, bot)
    assert any("working folder" in w for w in (await c.get(f"/api/bots/{bot['id']}/channels")).json()["warnings"])
    tg.photo(GROUP)
    await until(lambda: any("thư mục làm việc" in t for t in tg.texts(GROUP)), what="the no-folder warning")
    assert await batches(c, bot) == []
    ws = tmp_path / "ws_late"
    ws.mkdir()
    await c.patch(f"/api/bots/{bot['id']}", json={"cwd": str(ws)})
    tg.document(GROUP, "phieu.pdf")
    await one_batch(c, bot)
    tg.text(GROUP, "/kiemke")
    await until(lambda: any("Chưa có ảnh" in t for t in tg.texts(GROUP)), what="the no-photo answer")
    app.state.registry.get("echo").driver.capabilities = Capabilities(queueing=False, images=False)
    tg.photo(GROUP)
    await until(lambda: len(list(ws.glob("jobs/*/images/*"))) == 1, what="the photo")
    tg.text(GROUP, "/kiemke")
    await until(lambda: any("không đọc được ảnh" in t for t in tg.texts(GROUP)), what="the engine answer")
    assert (await batches(c, bot))[0]["status"] == "collecting"


async def test_two_batches_of_one_bot_run_one_after_the_other(chan):
    c, app, tg, tmp_path = chan
    acc, bot, ws = await setup(c, tmp_path)
    await c.put(f"/api/channels/telegram/accounts/{acc['id']}/grants/{bot['id']}", json={"prompt": OUT_PROMPT + "\n/slow"})
    tg.photo(GROUP, user=7)
    tg.photo(GROUP, user=8)
    rows = await until(lambda: _two(c, bot), what="two batches")
    ids = {r["id"] for r in rows}
    for bid in ids:
        tg.press(GROUP, f"run:{bid}")
    queued_rows = await until(lambda: _statuses(c, bot, {"running", "queued"}), what="one running, one waiting")
    queued = next(row for row in queued_rows if row["status"] == "queued")
    assert queued["threadId"]
    selected = next(row for row in (await c.get("/api/bots")).json()["bots"] if row["id"] == bot["id"])
    assert selected["threadId"] == queued["threadId"]
    queued_tasks = (await c.get(f"/api/bots/{bot['id']}/tasks")).json()["tasks"]
    assert next(task for task in queued_tasks if task["threadId"] == queued["threadId"])["title"] == queued["id"]
    assert any("Đang chờ lô trước" in t for t in tg.texts(GROUP))
    running = next(r for r in await batches(c, bot) if r["status"] == "running")
    assert (await c.post(f"/api/channels/batches/{running['id']}/cancel")).status_code == 200
    rows = await until(lambda: _statuses(c, bot, {"cancelled", "running"}), what="the waiting batch started")
    other = next(r for r in rows if r["status"] == "running")
    assert other["id"] != running["id"]
    assert other["threadId"] == queued["threadId"]  # starting a queued job reuses the conversation created on Check
    assert (await c.post(f"/api/channels/batches/{other['id']}/cancel")).status_code == 200
    await wait_idle(c, bot["id"])
    assert (await c.post(f"/api/channels/batches/{other['id']}/cancel")).status_code == 409


async def _events(c, acc, outcome):
    ev = (await c.get(f"/api/channels/telegram/accounts/{acc['id']}/events")).json()["events"]
    return ev if any(e["outcome"] == outcome for e in ev) else None


async def test_a_bot_holds_three_batches_in_the_queue_and_refuses_the_next(chan):
    c, app, tg, tmp_path = chan
    acc, bot, ws = await setup(c, tmp_path)
    await c.put(f"/api/channels/telegram/accounts/{acc['id']}/grants/{bot['id']}", json={"prompt": OUT_PROMPT + "\n/slow"})
    for user in range(7, 12):
        tg.photo(GROUP, user=user)
    rows = await until(lambda: _count(c, bot, 5), what="five batches")
    for r in rows:
        tg.press(GROUP, f"run:{r['id']}")
    await until(lambda: any("Hàng đợi của bot đã đầy" in t for t in tg.texts(GROUP)), what="the full-queue answer")
    seen = sorted(r["status"] for r in await batches(c, bot))
    assert seen == ["collecting", "queued", "queued", "queued", "running"], seen
    for r in await batches(c, bot):
        await c.post(f"/api/channels/batches/{r['id']}/cancel")
    await wait_idle(c, bot["id"])


async def _count(c, bot, n):
    rows = await batches(c, bot)
    return rows if len(rows) == n else None


async def _two(c, bot):
    rows = await batches(c, bot)
    return rows if len(rows) == 2 else None


async def _statuses(c, bot, want):
    rows = await batches(c, bot)
    return rows if {r["status"] for r in rows} == want else None


async def test_a_new_pdf_starts_a_new_batch_and_a_reply_picks_the_batch(chan):
    c, app, tg, tmp_path = chan
    acc, bot, ws = await setup(c, tmp_path)
    tg.document(GROUP, "may1.pdf")
    first = await one_batch(c, bot)
    await until(lambda: [t for t in tg.sent if t["method"] == "sendMessage" and t["text"].startswith("📋")], what="the first status message")
    status_id = app.state.channels and (await app.state.channels.db.get_batch(first["id"]))["statusMessageId"]
    tg.document(GROUP, "may2.pdf")
    rows = await until(lambda: _two(c, bot), what="a second batch")
    second = next(r for r in rows if r["id"] != first["id"])
    tg.photo(GROUP)  # goes to the newest
    await until(lambda: len(list((ws / "jobs" / second["id"] / "images").glob("*"))) == 1, what="photo in the second")
    tg.updates[TG_TOKEN].append({"update_id": tg.next_update + 1, "message": {"message_id": 9001, "chat": {"id": GROUP}, "from": {"id": 7, "first_name": "User7"},
                                                                              "reply_to_message": {"message_id": int(status_id)},
                                                                              "photo": [{"file_id": "ph_reply", "file_size": 4}]}})
    tg.next_update += 1
    tg.files["ph_reply"] = b"\xff\xd8re"
    await until(lambda: len(list((ws / "jobs" / first["id"] / "images").glob("*"))) == 1, what="the reply's photo in the first batch")
    tg.text(GROUP, "/huy")
    await until(lambda: _statuses(c, bot, {"cancelled", "collecting"}), what="the newest cancelled")
    assert next(r for r in await batches(c, bot) if r["id"] == second["id"])["status"] == "cancelled"


async def test_limits_on_size_and_number_of_photos(chan):
    c, app, tg, tmp_path = chan
    acc, bot, ws = await setup(c, tmp_path, maxPhotos=2)
    tg.document(GROUP, "huge.pdf", size=30 * 1024 * 1024)
    await until(lambda: any("quá lớn" in t for t in tg.texts(GROUP)), what="the size answer")
    assert await batches(c, bot) == []
    for _ in range(3):
        tg.photo(GROUP)
    await until(lambda: any("đủ 2 ảnh" in t for t in tg.texts(GROUP)), what="the photo limit answer")
    assert len(list(ws.glob("jobs/*/images/*"))) == 2
    tg.text(-777, "hello")  # a chat no bot serves
    ev = await until(lambda: _events(c, acc, "filtered"), what="the filtered event")
    outcomes = [(e["outcome"], e["reason"]) for e in ev]
    assert ("rejected", "file too large") in outcomes and ("filtered", "no bot serves this chat") in outcomes and ("started", "") in outcomes and ("joined", "") in outcomes
    assert any(e["outcome"] == "rejected" and "2 photos" in e["reason"] for e in ev) and all(TG_TOKEN not in json.dumps(e) for e in ev)
    for bad in ({"maxPhotos": 0}, {"timeoutSec": 1}, {"remindAt": "25:00"}, {"adminChats": [{"accountId": "nope", "chat": "1"}]}):
        assert (await c.put(f"/api/channels/telegram/accounts/{acc['id']}/grants/{bot['id']}", json=bad)).status_code == 400, bad


# ---- accounts over time ------------------------------------------------------------------------------------------------------------
async def test_a_restart_handles_no_update_twice_and_fails_what_was_running(tmp_path, fakes):
    tg = fakes[0]
    app = await open_app(tmp_path)
    async with LifespanManager(app):
        app.state.registry.get("echo").driver.capabilities = Capabilities(queueing=False, images=True)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            acc, bot, ws = await setup(c, tmp_path)
            await c.put(f"/api/channels/telegram/accounts/{acc['id']}/grants/{bot['id']}", json={"prompt": OUT_PROMPT + "\n/slow"})
            last = tg.photo(GROUP)
            b = await one_batch(c, bot)
            await until(lambda: len(list(ws.glob("jobs/*/images/*"))) == 1, what="the photo")
            await until(lambda: tg.offsets[TG_TOKEN] and tg.offsets[TG_TOKEN][-1] == last + 1, what="the cursor past the photo")
            tg.press(GROUP, f"run:{b['id']}")
            await one_batch(c, bot, "running")
            await until(lambda: tg.offsets[TG_TOKEN][-1] > last + 1, what="the cursor past the press")
            await app.state.channels.settle()
            # Simulate a notice saved before batch notices linked to the transcript.
            saved = await app.state.channels.db.get_batch(b["id"])
            card = await app.state.store.get_message(saved["cardId"])
            card.threadRef = None
            await app.state.store.update_message(card)
    tg.updates[TG_TOKEN].insert(0, {"update_id": last, "message": {"message_id": 5, "chat": {"id": GROUP}, "from": {"id": 7}, "photo": [{"file_id": "ph1", "file_size": 7}]}})
    app2 = await open_app(tmp_path)
    async with LifespanManager(app2):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app2), base_url="http://t") as c:
            await until(lambda: len(tg.offsets[TG_TOKEN]) > 3 and tg.updates[TG_TOKEN] == [], what="the old update dropped by the saved cursor")
            rows = await batches(c, bot)
            assert len(rows) == 1 and rows[0]["status"] == "failed" and "restarted" in rows[0]["error"]
            main = (await c.get(f"/api/bots/{bot['id']}/messages", params={"thread": bot["mainThreadId"]})).json()["messages"]
            card = next(m for m in main if m["id"] == saved["cardId"])
            assert card["threadRef"]["threadId"] == rows[0]["threadId"]
            assert len(list(ws.glob("jobs/*/images/*"))) == 1  # the photo already handled was not saved again
            assert (await c.get("/api/channels")).json()["channels"][0]["accounts"][0]["state"] == "active"


async def test_a_taken_token_stops_only_that_account_and_says_why(chan):
    c, app, tg, tmp_path = chan
    shop, support = await connect(c, "shop"), await connect(c, "support", TG_TOKEN_2)
    bot, ws = await bot_with_folder(c, tmp_path)
    await grant(c, support, bot)
    tg.conflict.add(TG_TOKEN)

    async def stopped():
        accs = {a["label"]: a for a in (await c.get("/api/channels")).json()["channels"][0]["accounts"]}
        return accs if accs["shop"]["state"] == "error" else None
    accs = await until(stopped, what="the shop account stopped")
    assert "Another program" in accs["shop"]["error"] and accs["support"]["state"] == "active"
    assert any(n["kind"] == "channel_failed" for n in (await c.get("/api/notifications")).json()["notifications"])
    tg.photo(GROUP, token=TG_TOKEN_2)
    await one_batch(c, bot)  # the other account still receives
    r = await c.post(f"/api/channels/telegram/accounts/{shop['id']}/clear-webhook")
    assert r.status_code == 200 and r.json()["state"] == "active"


async def test_disconnecting_one_account_leaves_the_other_and_its_grants(chan):
    c, app, tg, tmp_path = chan
    shop, support = await connect(c, "shop"), await connect(c, "support", TG_TOKEN_2)
    bot, ws = await bot_with_folder(c, tmp_path)
    await grant(c, shop, bot, chats=[-1])
    await grant(c, support, bot, chats=[-2])
    tg.photo(-1, token=TG_TOKEN)
    await one_batch(c, bot)
    assert (await c.delete(f"/api/channels/telegram/accounts/{shop['id']}")).json() == {"removed": 1}
    assert (await c.delete(f"/api/channels/telegram/accounts/{shop['id']}")).status_code == 404
    left = (await c.get("/api/channels")).json()["channels"][0]["accounts"]
    assert [a["label"] for a in left] == ["support"]
    mine = (await c.get(f"/api/bots/{bot['id']}/channels")).json()
    assert [g["accountLabel"] for g in mine["grants"]] == ["support"] and mine["batches"][0]["status"] == "cancelled"
    assert f"channel:telegram:{shop['id']}" not in json.loads((tmp_path / "config.json").read_text(encoding="utf8"))["secrets"]
    polls = len(tg.offsets[TG_TOKEN])
    tg.photo(-2, token=TG_TOKEN_2)
    await until(lambda: _two(c, bot), what="the other account's batch")
    assert len(tg.offsets[TG_TOKEN]) == polls  # nobody reads the disconnected bot any more


async def test_deleting_a_bot_or_a_grant_takes_its_access_away(chan):
    c, app, tg, tmp_path = chan
    acc, bot, ws = await setup(c, tmp_path)
    other, _ = await bot_with_folder(c, tmp_path, "Other")
    assert (await c.delete(f"/api/channels/telegram/accounts/{acc['id']}/grants/{bot['id']}")).status_code == 200
    assert (await c.delete(f"/api/channels/telegram/accounts/{acc['id']}/grants/{bot['id']}")).status_code == 404
    await grant(c, acc, other)  # the chat is free again
    assert (await c.delete(f"/api/bots/{other['id']}")).status_code == 200
    assert (await c.get(f"/api/channels/telegram/accounts/{acc['id']}/grants")).json()["grants"] == []
    assert (await c.get("/api/channels")).json()["channels"][0]["accounts"][0]["usedBy"] == []


async def test_a_batch_waiting_for_an_approval_says_so_to_the_result_chat(chan):
    c, app, tg, tmp_path = chan
    acc, bot, ws = await setup(c, tmp_path, adminChats=["900"])
    await c.patch(f"/api/bots/{bot['id']}", json={"approvalMode": "ask"})
    await c.put(f"/api/channels/telegram/accounts/{acc['id']}/grants/{bot['id']}", json={"prompt": "Run it.\n/approve mkdir demo"})
    tg.photo(GROUP)
    b = await one_batch(c, bot)
    tg.press(GROUP, f"run:{b['id']}")
    await until(lambda: any("chờ bạn duyệt" in t for t in tg.texts(900)), what="the waiting-for-approval note")
    assert not any("chờ bạn duyệt" in t for t in tg.texts(GROUP))  # the staff chat is not told: it is not theirs to answer
    assert (await c.post(f"/api/channels/batches/{b['id']}/cancel")).status_code == 200
    await wait_idle(c, bot["id"])


async def test_commands_reminders_and_cleanup(chan):
    c, app, tg, tmp_path = chan
    from datetime import datetime

    acc, bot, ws = await setup(c, tmp_path, remindAt="18:30", retentionDays=3)
    tg.text(GROUP, "/start")
    await until(lambda: any(m.get("reply_markup", {}).get("keyboard") for m in tg.sent), what="the fixed keyboard")
    tg.text(GROUP, "/tomtat")
    await until(lambda: any("Không có lô nào" in t for t in tg.texts(GROUP)), what="the empty summary")
    tg.photo(GROUP)
    b = await one_batch(c, bot)
    tg.text(GROUP, "/may BH-FLEX-M1")
    await until(lambda: any("BH-FLEX-M1" in t for t in tg.texts(GROUP)), what="the machine code")
    assert (await batches(c, bot))[0]["machine"] == "BH-FLEX-M1"
    ch = app.state.channels
    await ch.tick(datetime(2026, 11, 12, 18, 30))
    await ch.tick(datetime(2026, 11, 12, 18, 30))
    assert sum(1 for t in tg.texts(GROUP) if t.startswith("🔔")) == 1  # once a day
    job = ws / "jobs" / b["id"]
    row = await ch.db.get_batch(b["id"])
    await ch.cleanup(row["createdAt"] + 25 * 3600 * 1000)
    assert (await batches(c, bot))[0]["status"] == "expired" and job.is_dir()
    await ch.cleanup(row["createdAt"] + 30 * 24 * 3600 * 1000)
    assert not job.exists() and (await batches(c, bot))[0]["outFiles"] == []
