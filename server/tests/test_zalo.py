"""The Zalo input channel against a fake Zalo Bot API: photos by URL, no offset (told apart by message id), text commands instead of buttons,
long texts cut, results that cannot be sent as files going to a Telegram admin chat, and a webhook that blocks reading."""
import asyncio

from .fake_chat import TG_TOKEN, ZALO_TOKEN
from .test_api import wait_idle
from .test_telegram import OUT_PROMPT, batches, bot_with_folder, chan, connect, fakes, grant, one_batch, until  # noqa: F401  (fixtures)

CHAT = "6ede9afa66b88fe6d6a9"


async def zalo_setup(c, tmp_path, **extra):
    acc = await connect(c, "myshop", ZALO_TOKEN, "zalo")
    bot, ws = await bot_with_folder(c, tmp_path)
    await grant(c, acc, bot, chats=[CHAT], app_id="zalo", **extra)
    return acc, bot, ws


async def test_a_zalo_bot_connects_and_says_what_it_cannot_do(chan, fakes):
    c, app, tg, tmp_path = chan
    bad = await c.post("/api/channels/zalo/accounts", json={"label": "x", "token": "wrong-token-000"})
    assert bad.status_code == 400 and "refused" in bad.text
    acc = await connect(c, "myshop", ZALO_TOKEN, "zalo")
    assert acc["username"] == "Bot MyShop" and acc["app"] == "zalo" and acc["state"] == "active"
    listed = (await c.get("/api/channels")).json()["channels"][1]
    assert listed["id"] == "zalo" and listed["limits"] == ["Cannot receive PDF files", "Cannot send files", "Group chats are not supported yet"]
    assert ZALO_TOKEN not in (await c.get("/api/channels")).text


async def test_photos_arrive_once_and_a_text_command_runs_the_batch(chan, fakes):
    c, app, tg, tmp_path = chan
    zalo = fakes[1]
    acc, bot, ws = await zalo_setup(c, tmp_path)
    zalo.photo(CHAT, b"\xff\xd8first")
    b = await one_batch(c, bot)
    await until(lambda: len(list(ws.glob("jobs/*/images/*"))) == 1, what="the photo saved")
    seen = zalo.polls
    await until(lambda: zalo.polls > seen + 5, what="the same event served again")  # no offset: Zalo's fake keeps handing the event back
    assert len(list(ws.glob("jobs/*/images/*"))) == 1 and len(await batches(c, bot)) == 1
    assert (ws / "jobs" / b["id"] / "images" / "001_photo_m2.jpg").read_bytes() == b"\xff\xd8first"
    zalo.ack()
    zalo.text(CHAT, "/may BH-FLEX-M1")
    await until(lambda: any("BH-FLEX-M1" in t for t in zalo.texts(CHAT)), what="the machine code")
    zalo.ack()
    await app.state.channels.settle()
    status = [t for t in zalo.texts(CHAT) if t.startswith("📋")]
    assert len(status) == 1 and "/kiemke" in status[0] and "PDF" not in status[0]  # one status message: it cannot be edited, and there is no PDF here
    assert all("reply_markup" not in m for m in zalo.sent)
    zalo.text(CHAT, "/kiemke")
    done = await one_batch(c, bot, "done")
    zalo.ack()
    await wait_idle(c, bot["id"])
    assert done["machine"] == "BH-FLEX-M1" and done["outFiles"] == ["report.txt"]
    msgs = (await c.get(f"/api/bots/{bot['id']}/messages", params={"thread": done["threadId"]})).json()["messages"]
    assert sum(1 for m in msgs if m["role"] == "user") == 1 and "Machine code given by the sender: BH-FLEX-M1" in msgs[0]["text"]
    assert any("thư mục lô" in t and "report.txt" in t for t in zalo.texts(CHAT))  # a file cannot be sent here: say where it is
    assert all(len(t) <= 2000 for t in zalo.texts(CHAT))


async def test_a_list_of_events_is_read_too_and_unsupported_messages_are_answered(chan, fakes):
    c, app, tg, tmp_path = chan
    zalo = fakes[1]
    zalo.as_list = True
    acc, bot, ws = await zalo_setup(c, tmp_path)
    zalo.photo(CHAT)
    zalo.photo(CHAT)
    zalo.sticker(CHAT)
    await until(lambda: len(list(ws.glob("jobs/*/images/*"))) == 2, what="both photos")
    await until(lambda: any("chưa được hỗ trợ" in t for t in zalo.texts(CHAT)), what="the answer to a sticker")
    await asyncio.sleep(0.2)
    assert len(list(ws.glob("jobs/*/images/*"))) == 2 and sum(1 for t in zalo.texts(CHAT) if "chưa được hỗ trợ" in t) == 1


async def test_a_long_answer_is_cut_into_messages_of_2000(chan, fakes):
    c, app, tg, tmp_path = chan
    zalo = fakes[1]
    acc, bot, ws = await zalo_setup(c, tmp_path)
    ch = app.state.channels
    adapter = ch._adapter(await ch.db.get_account(acc["id"]))
    await ch._say(adapter, CHAT, ("dòng kết quả\n" * 400).strip())
    sent = zalo.texts(CHAT)
    assert len(sent) >= 3 and all(0 < len(t) <= 2000 for t in sent) and "".join(sent).count("dòng kết quả") == 400


async def test_a_zalo_batch_sends_its_file_to_a_telegram_admin_chat(chan, fakes):
    c, app, tg, tmp_path = chan
    zalo = fakes[1]
    tele = await connect(c, "admin", TG_TOKEN)
    acc, bot, ws = await zalo_setup(c, tmp_path, adminChats=[{"accountId": tele["id"], "chat": "900"}])
    zalo.photo(CHAT)
    await one_batch(c, bot)
    await until(lambda: len(list(ws.glob("jobs/*/images/*"))) == 1, what="the photo")
    zalo.ack()
    zalo.text(CHAT, "/kiemke")
    await one_batch(c, bot, "done")
    assert [(str(d["chat_id"]), d["filename"]) for d in tg.documents()] == [("900", "report.txt")]
    assert any(t.startswith("✅") for t in zalo.texts(CHAT)) and not any("report.txt" in t for t in zalo.texts(CHAT))


async def test_a_webhook_stops_reading_until_the_person_clears_it(chan, fakes):
    c, app, tg, tmp_path = chan
    zalo = fakes[1]
    zalo.webhook = True
    acc = await connect(c, "myshop", ZALO_TOKEN, "zalo")

    async def state():
        a = (await c.get("/api/channels")).json()["channels"][1]["accounts"][0]
        return a if a["state"] == "error" else None
    a = await until(state, what="the account stopped")
    assert "webhook" in a["error"].lower() and zalo.webhook is True  # nothing was cleared by itself
    r = await c.post(f"/api/channels/zalo/accounts/{acc['id']}/clear-webhook")
    assert r.status_code == 200 and r.json()["state"] == "active" and zalo.webhook is False
