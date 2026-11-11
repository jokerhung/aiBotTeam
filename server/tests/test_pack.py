"""Running it for real: pairing for remote access, the backup and restore of the data folder, and serving the web build."""
import io
import zipfile

import httpx
import pytest
from asgi_lifespan import LifespanManager

from botteam.backup import BackupError, make_backup, restore
from botteam.main import create_app

from .test_api import ctx, make_bot  # noqa: F401  (fixture)


async def client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


async def test_by_default_nothing_asks_for_a_code(ctx):
    c, _ = ctx
    assert (await c.get("/api/auth/status")).json() == {"required": False, "authenticated": True}
    assert (await c.get("/api/bots")).status_code == 200
    assert (await c.post("/api/auth/pair", json={"code": "0000-0000"})).status_code == 401  # there is nothing to pair with


async def test_an_open_server_needs_a_pairing_code_and_a_session(tmp_path):
    app = create_app(str(tmp_path / "t.db"), home=tmp_path, remote=True)
    async with LifespanManager(app):
        async with await client(app) as c:
            assert (await c.get("/api/auth/status")).json() == {"required": True, "authenticated": False}
            assert (await c.get("/api/bots")).status_code == 401 and (await c.get("/api/events")).status_code == 401
            assert (await c.get("/health")).status_code == 200  # a container health check needs no session
            assert (await c.post("/api/auth/pair", json={"code": "1234-5678"})).status_code == 401
            code = app.state.pairing.new_code()
            ok = await c.post("/api/auth/pair", json={"code": code})
            assert ok.status_code == 200 and "httponly" in ok.headers["set-cookie"].lower()
            assert (await c.get("/api/bots")).status_code == 200  # the cookie is now sent
            assert (await c.get("/api/auth/status")).json()["authenticated"] is True
            async with await client(app) as other:  # a code works once
                assert (await other.post("/api/auth/pair", json={"code": code})).status_code == 401
            assert (await c.post("/api/auth/logout")).status_code == 200
            assert (await c.get("/api/bots")).status_code == 401
            tokens = list(app.state.pairing.sessions)
            assert tokens == [] or all(len(t) == 64 for t in tokens)  # only hashes are kept


async def test_wrong_codes_are_limited_and_an_old_code_expires(tmp_path, monkeypatch):
    from botteam import auth

    app = create_app(str(tmp_path / "t.db"), home=tmp_path, remote=True)
    async with LifespanManager(app):
        async with await client(app) as c:
            code = app.state.pairing.new_code()
            for _ in range(auth.MAX_TRIES):
                assert (await c.post("/api/auth/pair", json={"code": "0000-0000"})).status_code == 401
            assert (await c.post("/api/auth/pair", json={"code": code})).status_code == 401  # locked for a minute, even for the right code
            app.state.pairing.tries.clear()
            monkeypatch.setattr(auth.time, "time", lambda: 10**10)  # far in the future: the code is old
            assert (await c.post("/api/auth/pair", json={"code": code})).status_code == 401


async def test_a_backup_restores_the_whole_data_folder(tmp_path):
    home = tmp_path / "data"
    home.mkdir()
    app = create_app(home=home)  # the real layout: messages.db inside the data folder
    zpath = tmp_path / "b.zip"
    async with LifespanManager(app):
        async with await client(app) as c:
            bot = await make_bot(c, "Keeper")
            await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "remember this chat"})
            await c.put(f"/api/bots/{bot['id']}/memory/file", json={"name": "MEMORY.md", "text": "- [2026-11-11] a kept note\n"})
            await c.post("/api/skills", json={"name": "Kept skill", "description": "d", "body": "b"})
            r = await c.get("/api/backup")  # taken while the server is running
            assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
            zpath.write_bytes(r.content)
    z = zipfile.ZipFile(zpath)
    names = set(z.namelist())
    assert {"messages.db", "config.json", "BACKUP.txt"} <= names and any(n.endswith("MEMORY.md") for n in names) and any(n.endswith("SKILL.md") for n in names)
    assert not any(n.endswith(("-wal", "-shm")) for n in names)
    target = tmp_path / "restored"
    assert restore(zpath, target)["files"] >= 4
    app2 = create_app(home=target)
    async with LifespanManager(app2):
        async with await client(app2) as c2:
            bots = (await c2.get("/api/bots")).json()["bots"]
            assert [b["name"] for b in bots] == ["Keeper"]
            assert [m["text"] for m in (await c2.get(f"/api/bots/{bots[0]['id']}/messages")).json()["messages"] if m["role"] == "user"] == ["remember this chat"]
            assert "a kept note" in (await c2.get(f"/api/bots/{bots[0]['id']}/memory")).json()["entries"][0]["text"]
            assert [s["name"] for s in (await c2.get("/api/skills")).json()["skills"]] == ["Kept skill"]
    with pytest.raises(BackupError, match="already holds data"):
        restore(zpath, target)  # not over a folder with data
    assert restore(zpath, target, force=True)["files"] >= 4


def test_a_backup_that_leads_outside_the_folder_or_is_not_one_is_refused(tmp_path):
    evil = tmp_path / "evil.zip"
    with zipfile.ZipFile(evil, "w") as z:
        z.writestr("messages.db", b"x")
        z.writestr("../escape.txt", b"boom")
    with pytest.raises(BackupError, match="outside"):
        restore(evil, tmp_path / "data")
    assert not (tmp_path / "escape.txt").exists() and not (tmp_path / "data").exists()
    (tmp_path / "x.zip").write_text("not a zip")
    with pytest.raises(BackupError, match="not a backup"):
        restore(tmp_path / "x.zip", tmp_path / "d2")
    nodb = tmp_path / "nodb.zip"
    with zipfile.ZipFile(nodb, "w") as z:
        z.writestr("config.json", b"{}")
    with pytest.raises(BackupError, match="no messages database"):
        restore(nodb, tmp_path / "d3")
    with pytest.raises(BackupError, match="no data folder"):
        make_backup(tmp_path / "missing", tmp_path / "o.zip")


async def test_the_server_serves_the_web_build_and_the_api_still_answers_first(tmp_path):
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<html><title>BotTeam</title></html>")
    (web / "app.js").write_text("console.log(1)")
    home = tmp_path / "home"
    home.mkdir()
    app = create_app(str(home / "t.db"), home=home, web_dir=web)
    async with LifespanManager(app):
        async with await client(app) as c:
            assert "BotTeam" in (await c.get("/")).text and (await c.get("/app.js")).text == "console.log(1)"
            assert (await c.get("/api/bots")).json() == {"bots": []}
            assert (await c.get("/api/nope")).status_code == 404


def test_one_command_serves_the_api_and_the_web_build(tmp_path):
    """`botteam serve`: the Python process alone answers for both the app and its API (needs the static build: pnpm build:static)."""
    import os
    import socket
    import subprocess
    import sys
    import time
    from pathlib import Path

    web = Path(__file__).resolve().parents[2] / "web" / ".next-export"
    if not (web / "index.html").exists():
        pytest.skip("the static web build is not made (pnpm build:static)")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = {**os.environ, "BOTTEAM_DATA_DIR": str(tmp_path / "data"), "WEBHOOK_PORT": "0", "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
    p = subprocess.Popen([sys.executable, "-m", "botteam", "serve", "--no-open", "--port", str(port), "--web-dir", str(web)], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        base = f"http://127.0.0.1:{port}"
        for _ in range(120):
            try:
                if httpx.get(base + "/health", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.25)
        else:
            raise AssertionError("the server did not start")
        page = httpx.get(base + "/")
        assert page.status_code == 200 and "BotTeam" in page.text and "/_next/" in page.text  # the app itself
        assert httpx.get(base + "/api/bots").json() == {"bots": []} and httpx.get(base + "/api/auth/status").json()["required"] is False  # loopback: no code
        asset = next(iter(page.text.split("/_next/static/")[1:2]), "").split('"')[0]
        assert httpx.get(f"{base}/_next/static/{asset}").status_code == 200
    finally:
        p.terminate()
        try:
            p.wait(10)
        except subprocess.TimeoutExpired:
            p.kill()
