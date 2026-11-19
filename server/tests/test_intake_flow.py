"""A session of messages by the bot's intake.md: it waits for quiet then runs, photos are saved to the folder the path template gives, a caption names the
machine and phase, a file that stops checking keeps the bot on its last good settings, and an old input gets its file."""
import asyncio
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from botteam.channels import ChannelService
from botteam.channels import intake as ik

from .test_telegram import GROUP, OUT_PROMPT, batches, bot_with_folder, chan, connect, fakes, grant, one_batch, setup, until  # noqa: F401  (fixtures)

MACHINES = ik.MACHINES_SAMPLE + "| BH FLEX M10 | 1000000350 | |\n| BH FLEX M2 | 1000000343 | flex m2 |\n"


def intake_text(quiet=30, path="jobs/{session}/", phases=True, prompt=None, unknown="ask"):
    t = ik.default_text("collect", prompt=prompt or "Count the stock.\n/out {out}report.txt")
    t = t.replace("quietSeconds: 30", f"quietSeconds: {quiet}").replace('path: "jobs/{session}/"', f'path: "{path}"\n  unknown: {unknown}')
    if phases:
        t = t.replace(f'path: "{path}"', f'path: "{path}"\n  phases:\n    Truoc: [trước, truoc]\n    Sau: [sau]')
    return t


def write_intake(app, ws, text, machines=True):
    (ws / "intake.md").write_text(text, encoding="utf8")
    if machines:
        (ws / "machines.md").write_text(MACHINES, encoding="utf8")
    app.state.channels.intake.forget(ws)


async def _done(c, bot):
    rows = (await c.get(f"/api/bots/{bot['id']}/channels")).json()["batches"]
    return next((r for r in rows if r["status"] == "done"), None)


async def svc_files(app, batch_id):
    return (await app.state.channels.db.get_batch(batch_id))["files"]


def today():
    return datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).strftime("%Y-%m-%d")


async def fast(monkeypatch, scale=0.04):
    monkeypatch.setattr(ChannelService, "time_scale", scale)


# ---- adding an input makes the file once -----------------------------------------------------------------------------------------------
async def test_adding_an_input_makes_intake_md_in_the_working_folder_and_never_replaces_one(chan, tmp_path):
    c, app, tg, _ = chan
    acc = await connect(c)
    bot, ws = await bot_with_folder(c, tmp_path, "First")
    assert not (ws / "intake.md").exists()
    g = await grant(c, acc, bot)
    assert (ws / "intake.md").is_file() and g["intake"]["valid"] is True and g["mode"] == "batch"
    assert "{out}report.txt" in ik.parse((ws / "intake.md").read_text(encoding="utf8")).cfg["prompt"], "the grant's old prompt carried over, its {job} turned into {folder}"
    other, ws2 = await bot_with_folder(c, tmp_path, "Second")
    mine = ik.default_text("collect").replace("quietSeconds: 30", "quietSeconds: 77")
    (ws2 / "intake.md").write_text(mine, encoding="utf8")
    await c.put(f"/api/channels/telegram/accounts/{acc['id']}/grants/{other['id']}", json={"chats": ["555"]})
    assert (ws2 / "intake.md").read_text(encoding="utf8") == mine, "a file that is there is kept"


async def test_a_bot_without_a_folder_gets_one_when_it_is_given_an_input(chan, tmp_path):
    c, app, tg, _ = chan
    acc = await connect(c)
    bot = (await c.post("/api/bots", json={"name": "Bare", "modelSelection": {"instanceId": "echo", "model": "echo-1"}})).json()
    old = await app.state.store.get_bot(bot["id"])
    old.cwd = None  # a bot from before every bot had a folder
    await app.state.store.save_bot(old)
    r = await c.put(f"/api/channels/telegram/accounts/{acc['id']}/grants/{bot['id']}", json={"chats": ["9"]})
    assert r.status_code == 200, r.text
    got = next(b for b in (await c.get("/api/bots")).json()["bots"] if b["id"] == bot["id"])
    assert got["cwd"] and (Path(got["cwd"]) / "intake.md").is_file()


async def test_anyone_may_write_only_when_the_file_says_answer(chan, tmp_path):
    c, app, tg, _ = chan
    acc = await connect(c)
    bot, ws = await bot_with_folder(c, tmp_path)
    r = await c.put(f"/api/channels/telegram/accounts/{acc['id']}/grants/{bot['id']}", json={"chats": ["*"], "mode": "batch"})
    assert r.status_code == 400 and "intake.md" in r.text
    ok = await c.put(f"/api/channels/telegram/accounts/{acc['id']}/grants/{bot['id']}", json={"chats": ["*"], "mode": "chat"})
    assert ok.status_code == 200 and ok.json()["mode"] == "chat" and ik.parse((ws / "intake.md").read_text(encoding="utf8")).cfg["mode"] == "answer"


# ---- the quiet clock ----------------------------------------------------------------------------------------------------------------------
async def test_a_session_runs_by_itself_when_nothing_new_arrives_and_every_message_starts_the_wait_again(chan, tmp_path, monkeypatch):
    c, app, tg, _ = chan
    await fast(monkeypatch)  # 30 seconds become 1.2
    acc, bot, ws = await setup(c, tmp_path)
    tg.photo(GROUP, caption="một")
    b = await one_batch(c, bot, "collecting")
    await asyncio.sleep(0.8)
    tg.photo(GROUP, b"a second, different photo")
    await until(lambda: len(tg.texts(GROUP)) >= 1 and True, what="a first acknowledgement")
    await asyncio.sleep(0.8)  # more than the wait since the first photo, less since the second
    assert (await one_batch(c, bot))["status"] == "collecting", "the second photo started the wait again"
    done = await one_batch(c, bot, "done")
    assert done["id"] == b["id"] and len([f for f in done["files"] if f["kind"] == "image"]) == 2
    saved = sorted(p.name for p in (ws / "jobs" / done["id"]).glob("*.jpg"))
    assert len(saved) == 2 and not (ws / "jobs" / done["id"] / "images").exists(), "photos sit in jobs/<session>/, with no images/ in between"
    assert (ws / "jobs" / done["id"] / "out" / "report.txt").is_file() and tg.documents(GROUP), "the result went back to the chat"
    assert any("Đã nhận" in t and "ảnh" in t for t in tg.texts(GROUP)), "the sender was told"
    assert sum(1 for t in tg.texts(GROUP) if t.startswith("📋") or "Đang nhận" in t) >= 1


async def test_with_zero_quiet_seconds_only_the_button_runs_it(chan, tmp_path, monkeypatch):
    c, app, tg, _ = chan
    await fast(monkeypatch)
    acc, bot, ws = await setup(c, tmp_path)
    write_intake(app, ws, intake_text(quiet=0, phases=False), machines=False)
    tg.photo(GROUP)
    b = await one_batch(c, bot, "collecting")
    await asyncio.sleep(1.0)
    assert (await one_batch(c, bot))["status"] == "collecting", "nothing runs by itself"
    tg.text(GROUP, "/kiemke")
    assert (await one_batch(c, bot, "done"))["id"] == b["id"]


async def test_a_session_that_was_quiet_while_the_server_was_off_runs_when_it_starts_again(chan, tmp_path, monkeypatch):
    c, app, tg, _ = chan
    acc, bot, ws = await setup(c, tmp_path)
    write_intake(app, ws, intake_text(quiet=10, phases=False), machines=False)
    tg.photo(GROUP)
    b = await one_batch(c, bot, "collecting")
    await until(lambda: svc_files(app, b["id"]), what="the photo saved in the session")
    svc = app.state.channels
    svc._disarm_quiet(b["id"])  # as if the wait had been lost with the process
    await svc.db.update_batch(b["id"], lastAt=1)  # long ago
    await svc._run_overdue()
    done = await until(lambda: _done(c, bot), timeout=20, what="the session ran")
    assert done["id"] == b["id"]


# ---- folders from captions ------------------------------------------------------------------------------------------------------------------
async def test_photos_go_to_the_machine_date_and_phase_folder_and_the_rest_of_an_album_follows_the_caption(chan, tmp_path):
    c, app, tg, _ = chan
    acc, bot, ws = await setup(c, tmp_path)
    write_intake(app, ws, intake_text(quiet=0, path="{machine}/{date}/{phase}/"))
    tg.photo(GROUP, b"one", caption="Máy BH Flex M1 trước")
    tg.photo(GROUP, b"two")  # the rest of an album has no caption
    folder = ws / "BH FLEX M1" / today() / "Truoc"
    await until(lambda: folder.is_dir() and len(list(folder.glob("*.jpg"))) == 2, what="two photos in the caption's folder")
    tg.photo(GROUP, b"three", caption="may bh flx m1 sau")
    after = ws / "BH FLEX M1" / today() / "Sau"
    await until(lambda: after.is_dir() and len(list(after.glob("*.jpg"))) == 1, what="the photo of the other phase")
    b = await one_batch(c, bot, "collecting")
    assert not any((ws / "jobs" / b["id"]).glob("*.jpg")), "no photo is left in the session's own folder"
    manifest = (ws / "jobs" / b["id"] / "intake.json").read_text(encoding="utf8")  # the session's own folder, not among the photos
    assert "BH FLEX M1" in manifest and "Truoc" in manifest
    tg.text(GROUP, "/kiemke")
    done = await one_batch(c, bot, "done")
    assert (ws / "jobs" / b["id"] / "out" / "report.txt").is_file(), "results go to the session's own folder, not among the photos"
    assert not list((ws / "BH FLEX M1").rglob("*.json")), "the photo folders hold only the photos"
    assert done["id"] == b["id"]


async def test_a_photo_whose_machine_is_unknown_waits_in_the_inbox_asks_and_moves_when_a_text_names_it(chan, tmp_path):
    c, app, tg, _ = chan
    acc, bot, ws = await setup(c, tmp_path)
    write_intake(app, ws, intake_text(quiet=0, path="{machine}/{date}/{phase}/"))
    tg.photo(GROUP, b"mystery", caption="máy lạ trước")
    b = await one_batch(c, bot, "collecting")
    inbox = ws / "jobs" / "_inbox" / b["id"]
    await until(lambda: inbox.is_dir() and list(inbox.glob("*.jpg")), what="the photo waits in the inbox")
    await until(lambda: any("Tôi chưa biết" in t for t in tg.texts(GROUP)), what="a question")
    tg.text(GROUP, "/kiemke")
    await until(lambda: any("Còn ảnh chưa biết" in t for t in tg.texts(GROUP)), what="it does not run with a photo nobody could place")
    assert (await one_batch(c, bot))["status"] == "collecting"
    tg.text(GROUP, "BH FLEX M2 sau")
    target = ws / "BH FLEX M2" / today() / "Sau"
    await until(lambda: target.is_dir() and list(target.glob("*.jpg")), what="the photo moved to the folder the text named")
    assert not list(inbox.glob("*.jpg")), "and it is no longer in the inbox"
    tg.text(GROUP, "/kiemke")
    assert (await one_batch(c, bot, "done"))["id"] == b["id"]


async def test_a_caption_cannot_make_a_photo_leave_the_working_folder(chan, tmp_path):
    c, app, tg, _ = chan
    acc, bot, ws = await setup(c, tmp_path)
    write_intake(app, ws, intake_text(quiet=0, path="{machine}/{date}/{phase}/"))
    tg.photo(GROUP, b"x", caption="../../../evil trước")
    tg.photo(GROUP, b"y", caption="C:\\Windows\\System32 sau")
    await until(lambda: (ws / "jobs" / "_inbox").is_dir() and len(list((ws / "jobs" / "_inbox").rglob("*.jpg"))) == 2, what="both wait in the inbox")
    outside = [p for p in tmp_path.rglob("*.jpg") if ws not in p.parents]
    assert outside == [], "nothing was written outside the working folder"


# ---- a file that stops checking ---------------------------------------------------------------------------------------------------------
async def test_a_file_that_stops_checking_keeps_the_bot_on_its_last_good_settings_and_says_so(chan, tmp_path):
    c, app, tg, _ = chan
    acc, bot, ws = await setup(c, tmp_path)
    write_intake(app, ws, intake_text(quiet=0, phases=False), machines=False)
    first = (await c.get(f"/api/bots/{bot['id']}/intake")).json()
    assert first["valid"] and first["usingLastGood"] is False
    (ws / "intake.md").write_text(intake_text(quiet=0, phases=False).replace("quietSeconds: 0", "quietSeconds: 3"), encoding="utf8")
    app.state.channels.intake.forget(ws)
    bad = (await c.get(f"/api/bots/{bot['id']}/intake")).json()
    assert bad["valid"] is False and bad["usingLastGood"] is True and bad["line"] == 6 and "quietSeconds" in bad["error"]
    tg.photo(GROUP)
    b = await one_batch(c, bot, "collecting")
    tg.text(GROUP, "/kiemke")
    assert (await one_batch(c, bot, "done"))["id"] == b["id"], "it still runs, on the last good file"


async def test_a_file_that_never_checked_gathers_but_does_not_run_and_tells_the_sender(chan, tmp_path):
    c, app, tg, _ = chan
    acc = await connect(c)
    bot, ws = await bot_with_folder(c, tmp_path)
    (ws / "intake.md").write_text("---\nformat: botteam.intake\nversion: 1\nmode: sideways\n---\n", encoding="utf8")
    r = await c.put(f"/api/channels/telegram/accounts/{acc['id']}/grants/{bot['id']}", json={"chats": [str(GROUP)]})
    assert r.status_code == 200 and r.json()["intake"]["valid"] is False and r.json()["intake"]["line"] == 4, "the input is saved, and the file is said to need work"
    tg.photo(GROUP)
    b = await one_batch(c, bot, "collecting")
    tg.text(GROUP, "/kiemke")
    await until(lambda: any("đang được cấu hình" in t for t in tg.texts(GROUP)), what="the sender is told the bot is being configured")
    assert (await one_batch(c, bot))["status"] == "collecting" and b["id"]
    (ws / "intake.md").unlink()
    app.state.channels.intake.forget(ws)
    state = (await c.get(f"/api/bots/{bot['id']}/intake")).json()
    assert state["exists"] is False and state["hasInput"] is True, "a deleted file is not made again by itself"
    assert not (ws / "intake.md").exists()


# ---- old inputs ---------------------------------------------------------------------------------------------------------------------------
async def test_an_old_input_gets_an_intake_md_made_from_its_settings_at_start(chan, tmp_path):
    c, app, tg, _ = chan
    acc = await connect(c)
    bot, ws = await bot_with_folder(c, tmp_path, "Old")
    svc = app.state.channels
    await svc.db.put_grant(acc["id"], bot["id"], chats=["77"], maxPhotos=12, timeoutSec=300, prompt="Đọc {job}/images/ rồi ghi {job}/out/r.txt", mode="batch")
    assert not (ws / "intake.md").exists()
    await svc.migrate_legacy()
    cfg = ik.parse((ws / "intake.md").read_text(encoding="utf8")).cfg
    assert cfg["mode"] == "collect" and cfg["maxPhotos"] == 12 and cfg["timeoutSec"] == 300 and cfg["quietSeconds"] == 30
    assert cfg["prompt"] == "Đọc {folder} rồi ghi {out}r.txt"
    chat_bot, ws2 = await bot_with_folder(c, tmp_path, "OldChat")
    await svc.db.put_grant(acc["id"], chat_bot["id"], chats=["*"], mode="chat")
    await svc.migrate_legacy()
    assert ik.parse((ws2 / "intake.md").read_text(encoding="utf8")).cfg["mode"] == "answer"
    bare = (await c.post("/api/bots", json={"name": "Bare2", "modelSelection": {"instanceId": "echo", "model": "echo-1"}})).json()
    assert bare["cwd"]


# ---- no bot run: the sender is told, nothing else ----------------------------------------------------------------------------------------------
async def test_without_an_agent_the_photos_are_saved_and_the_sender_gets_a_short_reply_and_no_turn_runs(chan, tmp_path, monkeypatch):
    c, app, tg, _ = chan
    await fast(monkeypatch)
    acc, bot, ws = await setup(c, tmp_path)
    text = intake_text(quiet=30, path="{machine}/{date}/{phase}/").replace(
        "run:\n", 'run:\n  agent: false\n  reply: "Đã nhận đủ {photos} ảnh và lưu vào folder:\\n{summary}"\n', 1)
    write_intake(app, ws, text)
    state = (await c.get(f"/api/bots/{bot['id']}/intake")).json()
    assert state["valid"], state
    for i in range(3):
        tg.photo(GROUP, f"p{i}".encode(), caption="Máy BH Flex M1 trước" if i == 0 else None)
    done = await one_batch(c, bot, "done")
    folder = ws / "BH FLEX M1" / today() / "Truoc"
    assert len(list(folder.glob("*.jpg"))) == 3
    await until(lambda: any(t.startswith("Đã nhận đủ") for t in tg.texts(GROUP)), what="the reply")
    reply = [t for t in tg.texts(GROUP) if t.startswith("Đã nhận đủ")]
    assert reply == ["Đã nhận đủ 3 ảnh và lưu vào folder:\nBH FLEX M1\\" + today() + "\\Truoc"], reply
    assert done["outFiles"] == [] and not (folder / "out").exists(), "no result file is made or asked for"
    assert done["threadId"] and len((await c.get(f"/api/bots/{bot['id']}/tasks")).json()["tasks"]) == 2, "the session's own conversation, and no turn of the bot in it"
    assert all(m["role"] != "bot" or m["kind"] == "text" for m in (await c.get(f"/api/bots/{bot['id']}/messages", params={"thread": done["threadId"]})).json()["messages"])
    assert not tg.documents(GROUP)
    # a later session names each folder with its count
    tg.photo(GROUP, b"before2", caption="BH FLEX M1 trước")
    tg.photo(GROUP, b"after", caption="BH FLEX M1 sau")
    await until(lambda: list((ws / "BH FLEX M1" / today() / "Sau").glob("*.jpg")), what="a photo of the other phase")
    tg.text(GROUP, "/kiemke")
    await until(lambda: any("Truoc: 1 ảnh" in t and "Sau: 1 ảnh" in t for t in tg.texts(GROUP)), what="a reply that names each folder with its count")


async def test_with_no_button_and_no_status_the_chat_sees_no_status_card_and_no_check_button(chan, tmp_path, monkeypatch):
    c, app, tg, _ = chan
    await fast(monkeypatch)
    acc, bot, ws = await setup(c, tmp_path)
    text = intake_text(quiet=30, path="{machine}/{date}/{phase}/", phases=True).replace(
        "run:\n", 'run:\n  agent: false\n  reply: "Đã nhận đủ {photos} ảnh và lưu vào folder:\\n{summary}"\n', 1).replace("button: true", "button: false").replace(
        "ack:", "status: false\nack:", 1)
    write_intake(app, ws, text)
    assert (await c.get(f"/api/bots/{bot['id']}/intake")).json()["valid"]
    tg.photo(GROUP, b"a", caption="Máy BH Flex M1 trước")
    tg.photo(GROUP, b"b")
    await one_batch(c, bot, "done")
    texts = tg.texts(GROUP)
    assert any(t.startswith("Đã nhận đủ 2 ảnh") for t in texts), texts
    assert not any(t.startswith("📋") or "Đang nhận file" in t for t in texts), "no status card in the chat"
    assert not any("Mẹo" in t for t in texts), "no tip about sending photos as files when no bot counts them"
    assert not any(d.startswith("run:") for d in tg.buttons(GROUP)), "and no Check button"
    final = [m for m in tg.sent if m["method"] == "sendMessage" and str(m["chat_id"]) == str(GROUP) and m["text"].startswith("Đã nhận đủ")]
    assert final and final[-1]["reply_markup"] == {"remove_keyboard": True}, "the old fixed keyboard (with Check) is taken away"
    tg.text(GROUP, "/kiemke")
    await until(lambda: any("không cần bấm Kiểm kê" in t for t in tg.texts(GROUP)), what="the answer to a Check that is no longer used")
    tg.text(GROUP, "/start")
    await until(lambda: any(t.startswith("Cách dùng: gửi ảnh kèm chú thích") and "Kiểm kê" not in t for t in tg.texts(GROUP)), what="a short help without Check")


async def test_progress_is_reported_while_photos_arrive_and_received_all_comes_before_anything_is_saved(chan, tmp_path, monkeypatch):
    c, app, tg, _ = chan
    await fast(monkeypatch, 0.1)  # 30 s become 3 s
    acc, bot, ws = await setup(c, tmp_path)
    text = intake_text(quiet=30, path="{machine}/{date}/{phase}/").replace(
        "run:\n", 'run:\n  agent: false\n  start: "Đã nhận đủ {photos} ảnh. Bắt đầu lưu file…"\n  reply: "Đã lưu {photos} ảnh vào folder:\\n{summary}"\n', 1).replace(
        'path: "{machine}/{date}/{phase}/"', 'path: "{machine}/{date}/{phase}/"\n  stage: true', 1).replace(
        "ack:", "ack:", 1)
    text = text.replace(ik.DEFAULT_ACK, "Đang nhận: {photos} ảnh")
    write_intake(app, ws, text)
    assert (await c.get(f"/api/bots/{bot['id']}/intake")).json()["valid"]
    tg.photo(GROUP, b"1", caption="Máy BH Flex M1 trước")
    await until(lambda: any(t == "Đang nhận: 1 ảnh" for t in tg.texts(GROUP)), what="progress after the first photo")
    tg.photo(GROUP, b"2")
    tg.photo(GROUP, b"3")
    await until(lambda: any(t == "Đang nhận: 3 ảnh" for t in tg.texts(GROUP)), what="progress with three photos")
    target = ws / "BH FLEX M1" / today() / "Truoc"
    inbox = ws / "jobs" / "_inbox"
    assert not target.exists() and len(list(inbox.rglob("*.jpg"))) == 3, "while photos are still coming nothing is saved in the folder yet"
    start = await until(lambda: next((t for t in tg.texts(GROUP) if t.startswith("Đã nhận đủ 3 ảnh")), None), what="received all")
    assert start == "Đã nhận đủ 3 ảnh. Bắt đầu lưu file…"
    done = await one_batch(c, bot, "done")
    assert len(list(target.glob("*.jpg"))) == 3 and not list(inbox.rglob("*.jpg")), "after the start message the photos moved into their folder"
    await until(lambda: any(t.startswith("Đã lưu") for t in tg.texts(GROUP)), what="the saved message")
    sent = [t for t in tg.texts(GROUP) if t.startswith(("Đang nhận", "Đã nhận đủ", "Đã lưu"))]
    assert sent.index("Đã nhận đủ 3 ảnh. Bắt đầu lưu file…") > sent.index("Đang nhận: 3 ảnh"), sent
    assert sent[-1] == "Đã lưu 3 ảnh vào folder:\nBH FLEX M1\\" + today() + "\\Truoc", sent
    assert done["files"] and all(f["name"].endswith(".jpg") for f in done["files"])
    edits = [m for m in tg.sent if m["method"] == "editMessageText" and m["text"].startswith("Đang nhận")]
    assert edits, "later counts change the same message instead of adding new ones"


async def test_each_staged_photo_goes_where_its_own_caption_said(chan, tmp_path, monkeypatch):
    c, app, tg, _ = chan
    await fast(monkeypatch, 0.1)
    acc, bot, ws = await setup(c, tmp_path)
    text = intake_text(quiet=30, path="{machine}/{date}/{phase}/").replace(
        "run:\n", 'run:\n  agent: false\n  reply: "{summary}"\n', 1).replace('path: "{machine}/{date}/{phase}/"', 'path: "{machine}/{date}/{phase}/"\n  stage: true', 1)
    write_intake(app, ws, text)
    tg.photo(GROUP, b"a", caption="BH FLEX M1 trước")
    tg.photo(GROUP, b"b", caption="BH FLEX M1 sau")
    tg.photo(GROUP, b"c")
    await one_batch(c, bot, "done")
    assert len(list((ws / "BH FLEX M1" / today() / "Truoc").glob("*.jpg"))) == 1
    assert len(list((ws / "BH FLEX M1" / today() / "Sau").glob("*.jpg"))) == 2, "a photo without a caption follows the caption before it"


async def test_a_file_the_folder_already_has_is_not_saved_again(chan, tmp_path, monkeypatch):
    c, app, tg, _ = chan
    await fast(monkeypatch, 0.1)
    acc, bot, ws = await setup(c, tmp_path)
    text = intake_text(quiet=30, path="{machine}/{date}/{phase}/").replace(
        "run:\n", 'run:\n  agent: false\n  reply: "Đã lưu {saved} ảnh vào folder:\\n{summary}{skipped_note}"\n', 1).replace(
        'path: "{machine}/{date}/{phase}/"', 'path: "{machine}/{date}/{phase}/"\n  stage: true', 1)
    write_intake(app, ws, text)
    folder = ws / "BH FLEX M1" / today() / "Truoc"
    folder.mkdir(parents=True)
    (folder / "earlier_photo.jpg").write_bytes(b"\xff\xd8same photo")  # a photo an earlier session saved
    tg.photo(GROUP, b"\xff\xd8same photo", caption="BH FLEX M1 trước")  # the same one again
    tg.photo(GROUP, b"\xff\xd8new photo")
    tg.photo(GROUP, b"\xff\xd8new photo")  # and a new one sent twice in the same session
    done = await one_batch(c, bot, "done")
    saved = sorted(p.read_bytes() for p in folder.glob("*.jpg"))
    assert saved == sorted([b"\xff\xd8same photo", b"\xff\xd8new photo"]), "each content is in the folder once"
    await until(lambda: any(t.startswith("Đã lưu") for t in tg.texts(GROUP)), what="the reply")
    reply = next(t for t in tg.texts(GROUP) if t.startswith("Đã lưu"))
    assert reply.startswith("Đã lưu 1 ảnh vào folder:\nBH FLEX M1\\" + today() + "\\Truoc") and "Bỏ qua 2 ảnh đã có sẵn" in reply, reply
    flags = [bool(f.get("duplicate")) for f in (await app.state.channels.db.get_batch(done["id"]))["files"]]
    assert flags == [True, False, True]
    assert not list((ws / "jobs" / "_inbox").rglob("*.jpg")), "nothing is left waiting"


async def test_a_photo_sent_straight_into_its_folder_is_checked_too(chan, tmp_path, monkeypatch):
    c, app, tg, _ = chan
    await fast(monkeypatch, 0.1)
    acc, bot, ws = await setup(c, tmp_path)
    write_intake(app, ws, intake_text(quiet=0, path="{machine}/{date}/{phase}/"))
    tg.photo(GROUP, b"\xff\xd8one", caption="BH FLEX M1 sau")
    tg.photo(GROUP, b"\xff\xd8one")
    tg.photo(GROUP, b"\xff\xd8two")
    folder = ws / "BH FLEX M1" / today() / "Sau"
    await until(lambda: len((app.state.channels.db and [1])) and len(list(folder.glob("*.jpg"))) == 2, what="two different photos")
    await asyncio.sleep(0.3)
    assert sorted(p.read_bytes() for p in folder.glob("*.jpg")) == [b"\xff\xd8one", b"\xff\xd8two"]


async def test_a_machine_typed_once_covers_every_photo_of_the_session_that_had_none(chan, tmp_path, monkeypatch):
    c, app, tg, _ = chan
    await fast(monkeypatch, 0.1)
    acc, bot, ws = await setup(c, tmp_path)
    text = intake_text(quiet=30, path="{machine}/{date}/{phase}/").replace(
        "run:\n", 'run:\n  agent: false\n  reply: "Đã lưu {saved} ảnh vào folder:\\n{summary}"\n', 1).replace(
        'path: "{machine}/{date}/{phase}/"', 'path: "{machine}/{date}/{phase}/"\n  stage: true', 1)
    write_intake(app, ws, text)
    for i in range(3):
        tg.photo(GROUP, f"no caption {i}".encode())  # the machine is not known yet
    await until(lambda: any("Tôi chưa biết" in t for t in tg.texts(GROUP)), what="the question")
    tg.text(GROUP, "máy bh flex m1 sau")  # said once, for the whole session
    tg.photo(GROUP, b"sent after the text")  # and a photo that comes later follows it too
    done = await one_batch(c, bot, "done")
    folder = ws / "BH FLEX M1" / today() / "Sau"
    assert len(list(folder.glob("*.jpg"))) == 4, "all four photos went to the machine named once"
    assert not any("Còn ảnh chưa biết" in t for t in tg.texts(GROUP)), "no complaint about photos that are no longer unknown"
    assert done["id"] and not list((ws / "jobs" / "_inbox").rglob("*.jpg"))
    assert any(t.startswith("Đã lưu 4 ảnh vào folder:") for t in tg.texts(GROUP))


async def test_after_a_few_quiet_seconds_the_sender_is_told_what_happens_next_and_when(chan, tmp_path, monkeypatch):
    c, app, tg, _ = chan
    await fast(monkeypatch, 0.2)  # 5 s become 1 s, 30 s become 6 s
    acc, bot, ws = await setup(c, tmp_path)
    text = intake_text(quiet=30, phases=False).replace("  button: true", "  hintAfterSeconds: 5\n  button: true", 1).replace(
        "ack:", 'hint: "Nếu không còn ảnh nào thì sau {remaining} giây sẽ tiến hành lưu."\nack:', 1).replace(
        "run:\n", 'run:\n  agent: false\n  start: "Đã nhận đủ {photos} ảnh. Bắt đầu lưu file…"\n  reply: "Đã lưu."\n', 1)
    write_intake(app, ws, text, machines=False)
    state = (await c.get(f"/api/bots/{bot['id']}/intake")).json()
    assert state["valid"] and state["effective"]["hintAfter"] == 5, state
    tg.photo(GROUP, b"first")
    await asyncio.sleep(0.6)  # less than the 1 s of quiet: nothing is said yet
    assert not any("Nếu không còn ảnh" in t for t in tg.texts(GROUP))
    tg.photo(GROUP, b"second")  # news: the wait starts again
    await asyncio.sleep(0.6)
    assert not any("Nếu không còn ảnh" in t for t in tg.texts(GROUP)), "a photo that arrived in between put the notice off"
    await until(lambda: any(t == "Nếu không còn ảnh nào thì sau 25 giây sẽ tiến hành lưu." for t in tg.texts(GROUP)), what="the notice after 5 quiet seconds")
    await one_batch(c, bot, "done")
    texts = tg.texts(GROUP)
    assert texts.index("Nếu không còn ảnh nào thì sau 25 giây sẽ tiến hành lưu.") < texts.index("Đã nhận đủ 2 ảnh. Bắt đầu lưu file…"), "the notice comes before the session starts"
    left = [int(t.split("sau ")[1].split(" giây")[0]) for t in texts if t.startswith("Nếu không còn ảnh")]
    assert left[0] == 25 and left == sorted(set(left), reverse=True) and left[-1] <= 15 and all(x % 5 == 0 for x in left), left  # 25, 20, 15, … every 5 seconds
    notices = [m for m in tg.sent if m["method"] in ("sendMessage", "editMessageText") and m["text"].startswith("Nếu không còn ảnh")]
    assert sum(1 for m in notices if m["method"] == "sendMessage") == 1 and any(m["method"] == "editMessageText" for m in notices), "one message, changed in place"


def test_the_notice_must_come_before_the_session_starts():
    bad = ik.default_text("collect").replace("  button: true", "  hintAfterSeconds: 30\n  button: true", 1)
    assert "hintAfterSeconds" in ik.parse(bad).error
    ok = ik.parse(ik.default_text("collect").replace("  button: true", "  hintAfterSeconds: 5\n  button: true", 1))
    assert ok.valid and ok.cfg["hintAfter"] == 5 and "{remaining}" in ok.cfg["hint"]


# ---- area folders and the follow-up command (download the PDFs) --------------------------------------------------------------------------------
AREA_MACHINES = "| Tên chuẩn | Mã máy | Khu vực | Tên gọi khác |\n|---|---|---|---|\n| BH Flex M1 | 1000000342 | Vĩnh Phúc | flex m1 |\n| BH FLEX M2 | 1000000343 | | flex m2 |\n"
FAKE_FETCH = '''import pathlib, sys
machine, folder = sys.argv[1], pathlib.Path(sys.argv[2])
tries = pathlib.Path(sys.argv[0]).with_name("tries.txt")
n = int(tries.read_text()) + 1 if tries.exists() else 1
tries.write_text(str(n))
if n < int(sys.argv[3]):
    print(f"Chưa có phiếu kiểm kê của {machine} trên web")
    sys.exit(3)
(folder / f"TU{machine}.pdf").write_bytes(b"%PDF-topup")
(folder / f"{machine}.pdf").write_bytes(b"%PDF-kk")
print(f"Đã tải TU{machine}.pdf và {machine}.pdf")
'''


def area_intake(ready_on: int, retry_hours: int = 3) -> str:
    return intake_text(quiet=30, path="{dd}.{mm}/{area}/{machine}/{phase}/", phases=False).replace(
        'path: "{dd}.{mm}/{area}/{machine}/{phase}/"', 'path: "{dd}.{mm}/{area}/{machine}/{phase}/"\n  stage: true\n  phases:\n    Trước: [trước, truoc]\n    Sau: [sau]', 1).replace(
        "run:\n", 'run:\n  agent: false\n  reply: "Đã lưu {saved} ảnh vào folder:\\n{summary}"\n'
                  f'  command: ["{{python}}", "_tools/fake_fetch.py", "{{machine}}", "{{machine_folder}}", "{ready_on}"]\n'
                  f'  retryMinutes: 10\n  retryHours: {retry_hours}\n', 1)


async def area_setup(c, app, tmp_path, ready_on, retry_hours=3):
    acc = await connect(c)
    bot, ws = await bot_with_folder(c, tmp_path)
    await grant(c, acc, bot, adminChats=["900"])  # 900: the chat of the person who watches
    (ws / "_tools").mkdir()
    (ws / "_tools" / "fake_fetch.py").write_text(FAKE_FETCH, encoding="utf8")
    (ws / "intake.md").write_text(area_intake(ready_on, retry_hours), encoding="utf8")
    (ws / "machines.md").write_text(AREA_MACHINES, encoding="utf8")
    app.state.channels.intake.forget(ws)
    state = (await c.get(f"/api/bots/{bot['id']}/intake")).json()
    assert state["valid"], state
    return acc, bot, ws


def pumped(app, cond):
    """A condition that first lets the waiting commands run, as the maintenance loop does every 30 seconds."""
    async def check():
        await app.state.channels._followups_due()
        return cond()
    return check


def ddmm():
    return datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).strftime("%d.%m")


async def test_photos_go_to_day_area_machine_and_phase_and_the_pdfs_are_fetched_after_they_are_saved(chan, tmp_path, monkeypatch):
    c, app, tg, _ = chan
    await fast(monkeypatch, 0.001)  # 10 minutes become 0.6 s
    acc, bot, ws = await area_setup(c, app, tmp_path, ready_on=2)
    tg.photo(GROUP, b"one", caption="Máy BH Flex M1 trước")
    tg.photo(GROUP, b"two")
    await one_batch(c, bot, "done")
    machine = ws / ddmm() / "Vĩnh Phúc" / "BH Flex M1"
    assert len(list((machine / "Trước").glob("*.jpg"))) == 2, list(ws.rglob("*"))
    await until(lambda: any("Sẽ thử lại sau mỗi 10 phút" in t for t in tg.texts(GROUP)), what="the sender hears it will be tried again")
    await until(pumped(app, lambda: (machine / "TUBH Flex M1.pdf").is_file() and (machine / "BH Flex M1.pdf").is_file()), timeout=10, what="both PDFs in the machine's folder")
    await until(lambda: any(t == "Đã tải TUBH Flex M1.pdf và BH Flex M1.pdf" for t in tg.texts(900)), what="the result told to the chat that watches")
    assert sum(1 for t in tg.texts(GROUP) if "Sẽ thử lại" in t) == 1, "said once, not every time"


async def test_when_the_pdfs_never_come_the_person_who_watches_is_told(chan, tmp_path, monkeypatch):
    c, app, tg, _ = chan
    await fast(monkeypatch, 0.0005)  # 3 hours become 5.4 s, 10 minutes 0.3 s
    acc, bot, ws = await area_setup(c, app, tmp_path, ready_on=999, retry_hours=3)
    tg.photo(GROUP, b"one", caption="flex m1 sau")
    await one_batch(c, bot, "done")
    await until(pumped(app, lambda: any(t.startswith("⚠️ BH Flex M1") and "vẫn chưa xong" in t and "Chưa có phiếu kiểm kê" in t for t in tg.texts(900))), timeout=20,
                what="the error to the chat that watches")
    jobs = (await app.state.channels.db.list_batches(bot_id=bot["id"]))[0]["followup"]["jobs"]
    assert jobs[0]["state"] == "failed" and jobs[0]["tries"] > 3


async def test_a_machine_without_an_area_is_said_and_its_photos_still_have_a_folder(chan, tmp_path, monkeypatch):
    c, app, tg, _ = chan
    await fast(monkeypatch, 0.001)
    acc, bot, ws = await area_setup(c, app, tmp_path, ready_on=1)
    warnings = (await c.get(f"/api/bots/{bot['id']}/intake")).json()["warnings"]
    assert any("BH FLEX M2" in w and "Khu vực" in w for w in warnings)
    tg.photo(GROUP, b"m2", caption="flex m2 trước")
    await one_batch(c, bot, "done")
    assert list((ws / ddmm() / "Chưa có khu vực" / "BH FLEX M2" / "Trước").glob("*.jpg"))


def test_the_command_can_only_run_a_program_inside_the_working_folder():
    base = area_intake(1)
    for bad in ('["C:/Windows/System32/cmd.exe"]', '["{python}", "../evil.py"]', '["/bin/sh", "-c", "x"]', '["{python}"]', '["{python}", "x.py", "{sender}"]'):
        st = ik.parse(base.replace(base[base.index("  command: "):base.index("\n", base.index("  command: "))], f"  command: {bad}"), AREA_MACHINES)
        assert not st.valid and "run.command" in st.error, (bad, st.error)


# ---- each session has its own conversation, with everything sent to the chat ---------------------------------------------------------------
async def thread_texts(c, bot_id, thread_id):
    msgs = (await c.get(f"/api/bots/{bot_id}/messages", params={"thread": thread_id})).json()["messages"]
    return [(m["role"], m["text"]) for m in msgs]


async def test_a_new_session_opens_its_own_conversation_and_everything_sent_to_the_chat_is_in_it(chan, tmp_path, monkeypatch):
    c, app, tg, _ = chan
    await fast(monkeypatch, 0.001)
    acc, bot, ws = await area_setup(c, app, tmp_path, ready_on=1)
    tg.photo(GROUP, b"one", caption="Máy BH Flex M1 trước")
    first = await until(lambda: _with_thread(c, bot), what="the session has a conversation from its first photo")
    shown = next(b for b in (await c.get("/api/bots")).json()["bots"] if b["id"] == bot["id"])
    assert shown["threadId"] == first["threadId"], "and the bot switches to it at once"
    tg.photo(GROUP, b"two")
    done = await one_batch(c, bot, "done")
    assert done["threadId"] == first["threadId"], "one conversation for the whole session"
    await until(pumped(app, lambda: any(t.startswith("Đã tải") for t in tg.texts(900))), what="the PDFs fetched")
    lines = await thread_texts(c, bot["id"], done["threadId"])
    users = [t for r, t in lines if r == "user"]
    assert users[0].startswith("📷 001_") and "Máy BH Flex M1 trước" in users[0] and users[1].startswith("📷 002_"), lines
    bots = [t for r, t in lines if r == "bot"]
    assert any(t.startswith("Đã lưu 2 ảnh vào folder:") for t in bots), "the reply"
    assert any(t.startswith("Đã tải TUBH Flex M1.pdf") for t in bots), "the result of the follow-up, hours later if need be"
    tasks = (await c.get(f"/api/bots/{bot['id']}/tasks")).json()["tasks"]
    title = next(t["title"] for t in tasks if t["threadId"] == done["threadId"])
    assert title == f"BH Flex M1 · Trước · {ddmm()} · {done['id']}", title
    # a second session is a second conversation
    tg.photo(GROUP, b"three", caption="Máy BH Flex M1 sau")
    second = await until(lambda: _newest_other(c, bot, done["id"]), what="a second session")
    assert second["threadId"] and second["threadId"] != done["threadId"]


async def _with_thread(c, bot):
    rows = (await c.get(f"/api/bots/{bot['id']}/channels")).json()["batches"]
    return next((r for r in rows if r["threadId"]), None)


async def _newest_other(c, bot, not_id):
    rows = (await c.get(f"/api/bots/{bot['id']}/channels")).json()["batches"]
    return next((r for r in rows if r["id"] != not_id and r["threadId"]), None)


async def test_progress_and_countdown_are_one_line_each_in_the_conversation(chan, tmp_path, monkeypatch):
    c, app, tg, _ = chan
    await fast(monkeypatch, 0.2)
    acc, bot, ws = await setup(c, tmp_path)
    text = intake_text(quiet=30, phases=False).replace("  button: true", "  hintAfterSeconds: 5\n  button: true", 1).replace(
        "ack:", 'hint: "Còn {remaining} giây."\nack:', 1).replace("run:\n", 'run:\n  agent: false\n  reply: "Xong."\n', 1)
    text = text.replace(ik.DEFAULT_ACK, "Đang nhận: {photos} ảnh")
    write_intake(app, ws, text, machines=False)
    tg.photo(GROUP, b"1")
    tg.photo(GROUP, b"2")
    done = await one_batch(c, bot, "done")
    bots = [t for r, t in await thread_texts(c, bot["id"], done["threadId"]) if r == "bot"]
    assert sum(1 for t in bots if t.startswith("Đang nhận")) == 1 and "Đang nhận: 2 ảnh" in bots, bots
    assert sum(1 for t in bots if t.startswith("Còn ")) == 1, bots
    assert bots[-1] == "Xong."
