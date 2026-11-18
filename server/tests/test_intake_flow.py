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
    t = ik.default_text("collect", prompt=prompt or "Count the stock.\n/out {folder}out/report.txt")
    t = t.replace("quietSeconds: 30", f"quietSeconds: {quiet}").replace('path: "jobs/{session}/"', f'path: "{path}"\n  unknown: {unknown}')
    if phases:
        t = t.replace(f'path: "{path}"', f'path: "{path}"\n  phases:\n    Truoc: [trước, truoc]\n    Sau: [sau]')
    return t


def write_intake(app, ws, text, machines=True):
    (ws / "intake.md").write_text(text, encoding="utf8")
    if machines:
        (ws / "machines.md").write_text(MACHINES, encoding="utf8")
    app.state.channels.intake.forget(ws)


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
    assert "{folder}out/report.txt" in ik.parse((ws / "intake.md").read_text(encoding="utf8")).cfg["prompt"], "the grant's old prompt carried over, its {job} turned into {folder}"
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
    tg.photo(GROUP)
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
    svc = app.state.channels
    svc._disarm_quiet(b["id"])  # as if the wait had been lost with the process
    await svc.db.update_batch(b["id"], lastAt=1)  # long ago
    await svc._run_overdue()
    assert (await one_batch(c, bot, "done"))["id"] == b["id"]


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
    assert not (ws / "jobs" / b["id"]).exists() or not any((ws / "jobs" / b["id"]).glob("*.jpg")), "nothing is left in the default folder"
    manifest = (ws / "BH FLEX M1" / today() / "Truoc" / "intake.json").read_text(encoding="utf8")
    assert "BH FLEX M1" in manifest and "Truoc" in manifest
    tg.text(GROUP, "/kiemke")
    done = await one_batch(c, bot, "done")
    assert (ws / "BH FLEX M1" / today() / "Truoc" / "out" / "report.txt").is_file(), "results go beside the first folder"
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
    assert cfg["prompt"] == "Đọc {folder} rồi ghi {folder}out/r.txt"
    chat_bot, ws2 = await bot_with_folder(c, tmp_path, "OldChat")
    await svc.db.put_grant(acc["id"], chat_bot["id"], chats=["*"], mode="chat")
    await svc.migrate_legacy()
    assert ik.parse((ws2 / "intake.md").read_text(encoding="utf8")).cfg["mode"] == "answer"
    bare = (await c.post("/api/bots", json={"name": "Bare2", "modelSelection": {"instanceId": "echo", "model": "echo-1"}})).json()
    assert bare["cwd"]
