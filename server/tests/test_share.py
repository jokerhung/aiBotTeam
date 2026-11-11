"""Sharing a team as one file: what goes in, what never does, the review, the cautious import, rollback, and fetching by address."""
import json

import httpx
import pytest
import yaml
from asgi_lifespan import LifespanManager

from botteam import teams as teamlib
from botteam.main import create_app

from .test_api import ctx, make_bot  # noqa: F401  (fixture)

KEY = "sk-" + "live1234567890abcdefghij"
PW = "password: hunter2hunter2"


async def build_team(c, app):
    sec = (await c.post("/api/sidebar-sections", json={"name": "Crew"})).json()
    lead, dev = await make_bot(c, "Lead"), await make_bot(c, "Dev")
    outsider = await make_bot(c, "Outsider")
    for b, extra in ((lead, {"chief": True, "title": "Tech lead", "soul": f"Lead the team. Our deploy key is {KEY}.", "color": "purple"}),
                     (dev, {"title": "Developer", "soul": "Write code.", "cwd": "C:/private/work", "approvalMode": "full"})):
        await c.patch(f"/api/bots/{b['id']}", json={"section": sec["id"], **extra})
    # skills, memory, connections, a room, a routine, and a chat message that must stay behind
    skill = (await c.post("/api/skills", json={"name": "Release notes", "description": "Write notes", "body": "List changes."})).json()
    await c.patch(f"/api/bots/{dev['id']}", json={"skills": [skill["id"]]})
    app.state.memory.remember(dev["id"], f"staging is at example.test; {PW}", today="2026-11-10")
    remote = (await c.post("/api/mcp/servers", json={"name": "crm", "transport": "http", "url": "https://abc123def456ghi789jkl012.example.com/mcp/v1?api_key=SECRETVALUE#frag",
                                                      "headers": {"Authorization": "Bearer realtoken"}})).json()
    local = (await c.post("/api/mcp/servers", json={"name": "files", "transport": "stdio", "command": "npx", "args": ["x"], "env": {"TOKEN": "t0k3n"}})).json()
    await c.patch(f"/api/bots/{dev['id']}", json={"mcpServers": [remote["id"], local["id"]]})
    room = (await c.post("/api/groups", json={"name": "Standup", "members": [lead["id"], dev["id"]], "leader": lead["id"], "instructions": "Be brief."})).json()
    await c.post("/api/routines", json={"name": "Daily check", "prompt": "Check the build", "targetKind": "bot", "targetId": dev["id"], "kind": "interval", "everyMin": 60})
    await c.post(f"/api/bots/{dev['id']}/messages", json={"text": "a private chat message"})
    return sec, lead, dev, room


async def test_the_file_holds_the_team_and_never_chat_keys_models_or_folders(ctx):
    c, app = ctx
    sec, lead, dev, room = await build_team(c, app)
    out = (await c.post("/api/teams/export", json={"sectionId": sec["id"]})).json()
    text, rep = out["file"], out["report"]
    assert out["filename"].endswith(".botteam.md") and text.startswith("---\n")
    for forbidden in (KEY, "hunter2hunter2", "SECRETVALUE", "realtoken", "t0k3n", "C:/private/work", "private chat message", "modelSelection", "approvalMode", "cwd", "threadId", "echo-1"):
        assert forbidden not in text, forbidden
    pkg = yaml.safe_load(text.split("---\n")[1])
    assert pkg["format"] == "botteam.team" and [b["name"] for b in pkg["bots"]] == ["Lead", "Dev"] and pkg["bots"][0]["chief"] is True
    assert pkg["bots"][1]["skills"][0]["name"] == "Release notes" and "Outsider" not in text
    assert pkg["rooms"][0]["members"] == ["b1", "b2"] and pkg["routines"][0]["name"] == "Daily check"
    assert [x["name"] for x in pkg["connections"]] == ["crm"] and pkg["connections"][0]["needs"] == ["Authorization"]
    assert "redacted" in pkg["connections"][0]["url"] and "?api_key=" in pkg["connections"][0]["url"] and "#" not in pkg["connections"][0]["url"]
    assert any("key or password" in x for x in rep["changed"]) and any("files" in x for x in rep["leftOut"])  # what was changed, and what a local program is
    assert rep["bots"] == 2 and rep["skills"] == 1 and rep["rooms"] == 1 and rep["routines"] == 1 and rep["connections"] == 1
    assert "keys" in text.lower() or "chat history" in text  # the body says so in plain words
    plain = (await c.post("/api/teams/export", json={"sectionId": sec["id"], "options": {"notes": False, "skills": False}})).json()["report"]
    assert plain["notes"] == 0 and plain["skills"] == 0
    assert (await c.post("/api/teams/export", json={"sectionId": "sec_none"})).status_code == 404


async def test_importing_into_an_empty_data_folder_rebuilds_the_team_cautiously(ctx, tmp_path):
    c, app = ctx
    sec, *_ = await build_team(c, app)
    text = (await c.post("/api/teams/export", json={"sectionId": sec["id"]})).json()["file"]
    (tmp_path / "fresh").mkdir()
    fresh = create_app(str(tmp_path / "fresh.db"), home=tmp_path / "fresh")
    async with LifespanManager(fresh):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=fresh), base_url="http://t") as f:
            before = await f.post("/api/teams/import/preview", json={"text": text})
            assert before.status_code == 200 and before.json()["counts"]["bots"] == 2 and "skills are switched off" in before.json()["willDo"]
            assert (await f.get("/api/bots")).json()["bots"] == []  # a review creates nothing
            made = (await f.post("/api/teams/import", json={"text": text})).json()
            assert made == {"section": "Crew", "bots": 2, "skills": 1, "rooms": 1, "routines": 1, "connections": 1}
            bots = {b["name"]: b for b in (await f.get("/api/bots")).json()["bots"]}
            assert all(b["approvalMode"] == "ask" for b in bots.values())  # a file never sets a level
            assert bots["Lead"]["chief"] is False and bots["Lead"]["title"] == "Tech lead" and bots["Lead"]["color"] == "purple" and bots["Dev"]["cwd"] is None
            assert (await f.get("/api/sidebar-sections")).json()["sections"][0]["name"] == "Crew"
            skills = (await f.get("/api/skills")).json()["skills"]
            assert [s["enabled"] for s in skills] == [False] and bots["Dev"]["skills"] == [skills[0]["id"]]
            assert all(r["enabled"] is False for r in (await f.get("/api/routines")).json()["routines"])  # always paused
            servers = (await f.get("/api/mcp/servers")).json()["servers"]
            assert len(servers) == 1 and servers[0]["enabled"] is False and servers[0]["headers"] == {"Authorization": "********"}
            row = await fresh.state.mcp.get(servers[0]["id"])
            assert row["headers"] == {"Authorization": ""}  # empty values, to be filled in by the person
            assert (await f.get("/api/groups")).json()["groups"][0]["name"] == "Standup"
            notes = (await f.get(f"/api/bots/{bots['Dev']['id']}/memory")).json()["entries"]
            assert "staging is at example.test" in notes[0]["text"] and "hunter2" not in json.dumps(notes)
            assert (await f.get(f"/api/bots/{bots['Dev']['id']}/messages")).json()["messages"] == []  # no chat history
            # a second import of the same file makes a second section, never touching the first
            again = (await f.post("/api/teams/import", json={"text": text})).json()
            assert again["section"] == "Crew (2)" and len((await f.get("/api/bots")).json()["bots"]) == 4


async def test_a_file_that_is_not_a_team_is_refused_and_secrets_in_it_are_replaced(ctx):
    c, _ = ctx
    bad = ["just some text", "---\nformat: other\n---\n", "---\nformat: botteam.team\nversion: 9\nbots: []\n---\n", "---\nformat: botteam.team\nversion: 1\nbots: []\n---\n",
           "---\nformat: botteam.team\nversion: 1\nbots: [{title: x}]\n---\n", "x" * (600 * 1024)]
    for t in bad:
        assert (await c.post("/api/teams/import/preview", json={"text": t})).status_code == 400
    assert (await c.post("/api/teams/import/preview", json={})).status_code == 400
    handmade = {"format": "botteam.team", "version": 1, "name": "Mine", "bots": [{"name": "A", "instructions": f"use {KEY} and {PW}", "approvalMode": "full", "modelSelection": {"x": 1}, "cwd": "/etc"}]}
    preview = (await c.post("/api/teams/import/preview", json={"text": "---\n" + yaml.safe_dump(handmade) + "---\n"})).json()
    assert any("key or password" in x for x in preview["changed"])
    made = await c.post("/api/teams/import", json={"text": "---\n" + yaml.safe_dump(handmade) + "---\n"})
    assert made.status_code == 201
    bot = next(b for b in (await c.get("/api/bots")).json()["bots"] if b["name"] == "A")
    assert KEY not in bot["soul"] and "hunter2hunter2" not in bot["soul"] and bot["approvalMode"] == "ask" and bot["cwd"] is None  # fields a file has no place for are ignored


async def test_a_failed_import_removes_everything_it_made(ctx):
    c, app = ctx
    sec, *_ = await build_team(c, app)
    text = (await c.post("/api/teams/export", json={"sectionId": sec["id"]})).json()["file"]
    sections_before = (await c.get("/api/sidebar-sections")).json()["sections"]
    bots_before, skills_before, servers_before = (await c.get("/api/bots")).json()["bots"], (await c.get("/api/skills")).json()["skills"], (await c.get("/api/mcp/servers")).json()["servers"]
    original = app.state.routines.create

    async def boom(**kw):
        raise RuntimeError("the schedule could not be made")
    app.state.routines.create = boom
    try:
        r = await c.post("/api/teams/import", json={"text": text})
    finally:
        app.state.routines.create = original
    assert r.status_code == 500 and "nothing was added" in r.json()["detail"]
    assert (await c.get("/api/sidebar-sections")).json()["sections"] == sections_before
    assert (await c.get("/api/bots")).json()["bots"] == bots_before and (await c.get("/api/skills")).json()["skills"] == skills_before
    assert (await c.get("/api/mcp/servers")).json()["servers"] == servers_before and len((await c.get("/api/groups")).json()["groups"]) == 1


def test_addresses_are_checked_before_anything_is_fetched():
    assert teamlib.raw_address("https://github.com/o/r/blob/main/teams/crew.botteam.md") == "https://raw.githubusercontent.com/o/r/main/teams/crew.botteam.md"
    assert teamlib.raw_address("https://raw.githubusercontent.com/o/r/main/x.md").startswith("https://raw.githubusercontent.com/")
    for url in ("http://github.com/o/r/blob/main/x", "https://example.com/team.md", "file:///etc/passwd", "http://127.0.0.1:8899/api/config", "https://169.254.169.254/latest"):
        with pytest.raises(teamlib.PackageError):
            teamlib.raw_address(url)


async def test_fetching_refuses_internal_addresses_oversize_files_and_hops_to_them(monkeypatch):
    calls = []
    monkeypatch.setattr(teamlib, "check_url", lambda u, **k: calls.append(u) or (_ for _ in ()).throw(teamlib.BlockedAddress("internal")) if "internal" in u else u)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/redirect.md"):
            return httpx.Response(302, headers={"location": "https://raw.githubusercontent.com/internal/x.md"})
        if request.url.path.endswith("/big.md"):
            return httpx.Response(200, content=b"x" * (teamlib.MAX_FILE + 10))
        return httpx.Response(200, text="---\nformat: botteam.team\n---\n")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    assert (await teamlib.fetch("https://raw.githubusercontent.com/o/r/main/ok.md", client)).startswith("---")
    with pytest.raises(teamlib.PackageError, match="too large"):
        await teamlib.fetch("https://raw.githubusercontent.com/o/r/main/big.md", client)
    with pytest.raises(teamlib.PackageError, match="cannot be fetched"):
        await teamlib.fetch("https://raw.githubusercontent.com/o/r/main/redirect.md", client)  # a redirect is checked again
    assert any("internal" in u for u in calls)
    await client.aclose()


async def test_the_new_bot_dialog_has_presets(ctx):
    c, _ = ctx
    presets = (await c.get("/api/presets")).json()["presets"]
    assert {"researcher", "developer", "qa"} <= {p["id"] for p in presets}
    assert all(set(p) <= {"id", "name", "title", "description", "color", "instructions"} for p in presets)  # no model, folder, level or apps
