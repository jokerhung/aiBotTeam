"""Durability: the server is killed in the middle of writing. The database must open, pass its integrity check, and keep every message
that had been confirmed (written and committed) before the kill."""
import asyncio
import subprocess
import sys
import time
from pathlib import Path

from botteam.store import Store

WRITER = r"""
import asyncio, sys
from botteam.store import Store, new_id, now_ms
from botteam.wire import WireMessage

async def main(path):
    s = Store(path)
    await s.open()
    bot = await s.create_bot("Writer", "", "", None, {"instanceId": "echo", "model": "echo-1"})
    print("READY " + bot.mainThreadId, flush=True)
    i = 0
    while True:
        i += 1
        m = WireMessage(id=new_id("msg"), role="bot", kind="text", author=bot.id, at=now_ms(), text=f"message {i} " + "x" * 2000)
        await s.add_message(bot.id, bot.mainThreadId, m)
        print("DONE " + m.id, flush=True)  # printed after the commit: this one is confirmed

asyncio.run(main(sys.argv[1]))
"""


def test_a_killed_server_leaves_a_sound_database_with_every_confirmed_message(tmp_path):
    db = tmp_path / "messages.db"
    server_dir = str(Path(__file__).resolve().parents[1])
    proc = subprocess.Popen([sys.executable, "-c", WRITER, str(db)], cwd=server_dir, stdout=subprocess.PIPE, text=True, env={**__import__("os").environ, "PYTHONPATH": server_dir})
    confirmed, thread = [], ""
    deadline = time.time() + 30
    for line in proc.stdout:  # type: ignore[union-attr]
        if line.startswith("READY"):
            thread = line.split()[1]
        elif line.startswith("DONE"):
            confirmed.append(line.split()[1])
        if len(confirmed) >= 60 or time.time() > deadline:
            break
    if sys.platform == "win32":  # the venv's python.exe is a launcher: kill the whole tree, not only the launcher
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
    else:
        proc.kill()  # not a clean shutdown: no close(), no checkpoint
    proc.wait(10)
    assert len(confirmed) >= 20, "the writer did not get far enough to mean anything"

    async def check():
        s = Store(str(db))
        await s.open()
        try:
            cur = await s.db.execute("PRAGMA integrity_check")
            assert [r[0] for r in await cur.fetchall()] == ["ok"]
            cur = await s.db.execute("SELECT id FROM messages WHERE thread_id=?", (thread,))
            have = {r[0] for r in await cur.fetchall()}
            missing = [m for m in confirmed if m not in have]
            assert not missing, f"{len(missing)} confirmed messages were lost"
            msgs, _ = await s.page(thread, None, 500)
            assert len(msgs) >= len(confirmed)
            # the transcript is still ordered, and the index (search) still answers
            seqs = [m.text for m in msgs]
            assert seqs == sorted(seqs, key=lambda t: int(t.split()[1]))
        finally:
            await s.close()

    asyncio.run(check())
