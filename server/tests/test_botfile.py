"""One bot as one file: what goes in (and what never does), the review, the cautious import, connections found again by themselves, and rollback."""
import httpx
import pytest
import yaml
from asgi_lifespan import LifespanManager

from botteam.botfile import parse
from botteam.main import create_app
from botteam.teams import PackageError

from .test_api import ctx, make_bot  # noqa: F401  (fixture)

SECRET = "sk-live-0123456789abcdefABCDEF"
ALLOW = ["GOOGLESHEETS_VALUES_GET", "GOOGLESHEETS_SEARCH_SPREADSHEETS"]


def front(text):
    return yaml.safe_load(text.split("---\n")[1])


async def a_bot_with_everything(c, app):
    bot = await make_bot(c, "Ugreen lookup")
    comp, _ = await app.state.mcp.create({"name": "Composio", "transport": "http", "url": "https://backend.composio.dev/tool_router/v3/trs_abc123/mcp", "appId": "composio",
                                          "headers": {"x-api-key": SECRET}})
    orders, _ = await app.state.mcp.create({"name": "Orders", "transport": "http", "url": f"https://orders.example.com/mcp?token={SECRET}", "headers": {"Authorization": f"Bearer {SECRET}"}})
    local, _ = await app.state.mcp.create({"name": "Files", "transport": "stdio", "command": "npx", "args": ["x"], "env": {"K": SECRET}})
    sk = app.state.skills.save(None, "Read labels", "How to read a carton label", f"Use the label. key={SECRET}", enabled=True)
    r = await c.patch(f"/api/bots/{bot['id']}", json={
        "title": "Lookup", "description": "Answers lot and carton questions", "soul": f"You look things up. Never use {SECRET}.", "color": "blue", "approvalMode": "full",
        "cwd": str(__import__("pathlib").Path(app.state.store.path).parent), "skills": [sk["id"]], "mcpServers": [comp, orders, local],
        "mcpAccess": {comp: {"scope": "write", "outbound": "allow", "allowTools": ALLOW, "cacheMinutes": 15}, orders: {"scope": "read", "outbound": "allow"}}})
    assert r.status_code == 200, r.text
    app.state.memory.remember(bot["id"], "customer phone is 0900 000 000")
    return bot, comp, orders


async def fresh_app(tmp_path, name):
    home = tmp_path / name
    home.mkdir()
    app = create_app(str(home / "t.db"), home=home)
    return app


async def test_the_file_holds_what_the_bot_is_and_nothing_it_knows_or_holds_secret(ctx):
    c, app = ctx
    bot, comp, orders = await a_bot_with_everything(c, app)
    out = (await c.post(f"/api/bots/{bot['id']}/export-file")).json()
    text, meta = out["file"], front(out["file"])
    assert out["filename"].endswith(".bot.md") and meta["format"] == "botteam.bot" and meta["version"] == 1
    assert SECRET not in text, "no key in any field"
    assert "0900" not in text and "customer phone" not in text, "no memory"
    for forbidden in ("approvalMode", "cwd", "model", "threadId", "section", "chief", "memory", "outbound"):
        assert forbidden not in meta and "outbound" not in text
    assert meta["name"] == "Ugreen lookup" and meta["color"] == "blue" and "You look things up" in meta["instructions"] and meta["skills"][0]["name"] == "Read labels"
    by = {x["name"]: x for x in meta["connections"]}
    assert set(by) == {"Composio", "Orders"}, "a program on this computer (stdio) is not shared"
    assert by["Composio"] == {"name": "Composio", "transport": "http", "access": {"scope": "write", "allowTools": ALLOW, "cacheMinutes": 15}, "appId": "composio"}  # no session address
    assert by["Orders"]["needs"] == ["Authorization"] and "token=" in by["Orders"]["url"] and SECRET not in by["Orders"]["url"] and by["Orders"]["access"] == {"scope": "read"}
    assert any("Files" in x for x in out["report"]["leftOut"]) and out["report"]["changed"], "what was left out and what was changed are told"


async def test_importing_assigns_connections_again_and_stays_cautious(ctx, tmp_path):
    c, app = ctx
    bot, comp, orders = await a_bot_with_everything(c, app)
    file = (await c.post(f"/api/bots/{bot['id']}/export-file")).json()["file"]
    other = await fresh_app(tmp_path, "other")
    async with LifespanManager(other):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=other), base_url="http://t") as d:
            have_comp, _ = await other.state.mcp.create({"name": "Composio", "transport": "http", "url": "https://backend.composio.dev/x/mcp", "appId": "composio", "headers": {"x-api-key": "mine"}})
            rev = (await d.post("/api/bot-files/preview", json={"text": file})).json()
            assert rev["name"] == "Ugreen lookup" and rev["skills"] == ["Read labels"]
            actions = {x["name"]: x for x in rev["connections"]}
            assert actions["Composio"]["action"] == "use" and actions["Orders"]["action"] == "create" and actions["Orders"]["needs"] == ["Authorization"]
            assert (await d.get("/api/bots")).json()["bots"] == [], "the review creates nothing"
            made = (await d.post("/api/bot-files/import", json={"text": file})).json()
            assert made["name"] == "Ugreen lookup" and made["skills"] == 1 and made["connections"] == 2
            got = next(b for b in (await d.get("/api/bots")).json()["bots"] if b["id"] == made["botId"])
            assert got["approvalMode"] == "ask" and got["chief"] is False and not got["section"] and got["soul"].startswith("You look things up")
            servers = {s["name"]: (i, s) for i, s in await other.state.mcp.list()}
            assert set(got["mcpServers"]) == {have_comp, servers["Orders"][0]}, "the Composio of this computer was used; the other connection was made"
            assert servers["Orders"][1]["enabled"] is False and servers["Orders"][1]["headers"] == {"Authorization": ""}, "empty and switched off"
            assert (await other.state.mcp.get(have_comp))["headers"]["x-api-key"] == "mine", "its own credentials are untouched"
            acc = got["mcpAccess"][have_comp]
            assert acc == {"scope": "write", "outbound": "ask", "allowTools": ALLOW, "cacheMinutes": 15}, "sending out is always Ask"
            assert got["mcpAccess"][servers["Orders"][0]]["outbound"] == "ask"
            skills = other.state.skills.list()
            assert len(skills) == 1 and skills[0]["enabled"] is False
            assert other.state.memory.entries(made["botId"]) == [], "no memory travels"
            again = (await d.post("/api/bot-files/import", json={"text": file})).json()  # the same name again
            assert again["name"] == "Ugreen lookup (2)"
            # the same connection is matched again, not made twice
            assert len([s for _, s in await other.state.mcp.list() if s["name"].startswith("Orders")]) == 1


async def test_a_composio_connection_that_is_not_here_is_said_not_made(ctx, tmp_path):
    c, app = ctx
    bot, *_ = await a_bot_with_everything(c, app)
    file = (await c.post(f"/api/bots/{bot['id']}/export-file")).json()["file"]
    other = await fresh_app(tmp_path, "bare")
    async with LifespanManager(other):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=other), base_url="http://t") as d:
            rev = (await d.post("/api/bot-files/preview", json={"text": file})).json()
            assert next(x for x in rev["connections"] if x["name"] == "Composio")["action"] == "missing"
            made = (await d.post("/api/bot-files/import", json={"text": file})).json()
            assert any("Composio" in n and "not connected" in n for n in made["notes"]) and made["connections"] == 1


async def test_files_that_are_not_bot_files_or_are_dangerous_are_refused_or_cleaned(ctx):
    c, app = ctx
    assert (await c.post("/api/bot-files/preview", json={"text": "hello"})).status_code == 400
    team = "---\nformat: botteam.team\nversion: 1\nname: T\nbots: [{name: A}]\n---\n"
    r = await c.post("/api/bot-files/preview", json={"text": team})
    assert r.status_code == 400 and "team file" in r.text
    assert (await c.post("/api/bot-files/preview", json={"text": "---\nformat: botteam.bot\nversion: 9\nname: A\n---\n"})).status_code == 400
    with pytest.raises(PackageError):
        parse("---\nformat: botteam.bot\nversion: 1\n---\n")
    hostile = ("---\nformat: botteam.bot\nversion: 1\nname: Evil\napprovalMode: full\ncwd: C:/\nchief: true\nsection: x\ninstructions: key " + SECRET + "\n"
               "connections:\n- {name: Shell, transport: stdio, command: calc}\n- {name: Web, transport: http, url: 'http://169.254.169.254/', access: {scope: write, outbound: allow, allowTools: ['rm -rf', 'OK_TOOL'], cacheMinutes: 99999}}\n---\n")
    pkg = parse(hostile)
    assert SECRET not in pkg["instructions"] and pkg["changed"] and [x["name"] for x in pkg["connections"]] == ["Web"], "a program connection is dropped"
    assert pkg["connections"][0]["access"] == {"scope": "write", "allowTools": ["OK_TOOL"]}, "a bad tool pattern and a silly cache time are dropped"
    made = (await c.post("/api/bot-files/import", json={"text": hostile})).json()
    assert made["connections"] == 0 and any("left out" in n for n in made["notes"]), "an address that cannot be used leaves that connection out"
    got = next(b for b in (await c.get("/api/bots")).json()["bots"] if b["id"] == made["botId"])
    assert got["approvalMode"] == "ask" and got["chief"] is False and not got["section"] and got["cwd"] != "C:/" and "workdirs" in got["cwd"].replace("\\", "/")


async def test_a_failure_in_the_middle_removes_everything_the_import_made(ctx, monkeypatch):
    c, app = ctx
    bot, *_ = await a_bot_with_everything(c, app)
    file = (await c.post(f"/api/bots/{bot['id']}/export-file")).json()["file"]
    before = {"bots": len((await c.get("/api/bots")).json()["bots"]), "servers": len(await app.state.mcp.list()), "skills": len(app.state.skills.list())}

    async def boom(*a, **k):
        raise RuntimeError("disk full")

    monkeypatch.setattr(app.state.store, "save_bot", boom)
    r = await c.post("/api/bot-files/import", json={"text": file})
    assert r.status_code == 500 and "nothing was added" in r.text
    after = {"bots": len((await c.get("/api/bots")).json()["bots"]), "servers": len(await app.state.mcp.list()), "skills": len(app.state.skills.list())}
    assert after == before
