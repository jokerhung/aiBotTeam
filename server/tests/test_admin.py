"""The Administrator: one built-in bot kept out of the bot list, whose tools make and change bots, within limits it cannot argue its way past."""
from .test_api import ctx, make_bot  # noqa: F401  (fixture)


async def admin(c):
    r = await c.post("/api/admin/open")
    assert r.status_code == 200, r.text
    return r.json()


async def test_it_is_made_once_kept_out_of_the_list_and_cannot_be_deleted(ctx):
    c, app = ctx
    a = await admin(c)
    again = await admin(c)
    assert a["id"] == again["id"] and a["admin"] is True and a["name"] == "Administrator" and a["approvalMode"] == "ask"
    assert "admin_create_bot" in a["soul"]
    assert all(b["id"] != a["id"] for b in (await c.get("/api/bots")).json()["bots"]), "not among the person's bots"
    assert (await c.delete(f"/api/bots/{a['id']}")).status_code == 400


async def test_it_makes_a_bot_that_starts_at_ask_and_changes_only_what_it_is_told(ctx):
    c, app = ctx
    a = await admin(c)
    call = lambda tool, args: app.state.agents.call(a["threadId"], tool, args)  # noqa: E731
    made = await call("admin_create_bot", {"name": "Lookup", "title": "Researcher", "description": "Finds things", "instructions": "Answer in Vietnamese.", "color": "red"})
    assert made["ok"] and made["bot"]["approvalMode"] == "ask" and made["bot"]["instructions"] == "Answer in Vietnamese." and made["bot"]["color"] == "red"
    bots = (await c.get("/api/bots")).json()["bots"]
    got = next(b for b in bots if b["name"] == "Lookup")
    assert got["soul"] == "Answer in Vietnamese." and got["title"] == "Researcher" and got["admin"] is False
    changed = await call("admin_update_bot", {"bot": "lookup", "title": "Analyst"})
    assert changed["ok"] and changed["before"]["title"] == "Researcher" and changed["bot"]["title"] == "Analyst"
    assert changed["bot"]["instructions"] == "Answer in Vietnamese." and changed["bot"]["color"] == "red", "what was not named stays"
    assert (await call("admin_update_bot", {"bot": "nobody", "title": "x"}))["reason"] == "not_found"
    assert (await call("admin_update_bot", {"bot": got["id"]}))["reason"] == "nothing_to_change"
    listed = await call("admin_list_bots", {})
    assert [b["name"] for b in listed["bots"]] == ["Lookup"] and "ask" in listed["approvalModes"], "the Administrator is not in its own list"


async def test_it_cannot_give_full_access_a_folder_or_edit_itself(ctx):
    c, app = ctx
    a = await admin(c)
    call = lambda tool, args: app.state.agents.call(a["threadId"], tool, args)  # noqa: E731
    bot = await make_bot(c, "Plain")
    assert (await call("admin_create_bot", {"name": "X", "approvalMode": "full"}))["reason"] == "invalid"
    assert (await call("admin_update_bot", {"bot": bot["id"], "approvalMode": "full"}))["reason"] == "invalid"
    r = await call("admin_update_bot", {"bot": bot["id"], "title": "T", "cwd": "C:/", "chief": True, "mcpServers": ["x"]})
    assert r["ok"]
    now = next(b for b in (await c.get("/api/bots")).json()["bots"] if b["id"] == bot["id"])
    assert now["cwd"].replace("\\", "/").endswith("/" + bot["id"]) and now["chief"] is False and now["mcpServers"] == [], "only the named fields can be set (the folder is the one made for the bot, not C:/)"
    assert (await call("admin_update_bot", {"bot": "Administrator", "title": "Boss"}))["reason"] == "not_found"
    assert (await call("admin_create_bot", {"name": "Y", "color": "plaid"}))["reason"] == "invalid"
    assert (await call("coordinate_bots", {"bot_ids": [bot["id"]], "message": "x"}))["reason"] == "not_allowed", "it has no other tools"
    assert (await app.state.agents.call(bot["threadId"], "admin_create_bot", {"name": "Z"}))["reason"] == "not_allowed", "no other bot has its tools"


async def test_a_connection_must_exist_and_is_given_read_only(ctx):
    c, app = ctx
    a = await admin(c)
    call = lambda tool, args: app.state.agents.call(a["threadId"], tool, args)  # noqa: E731
    sid, _ = await app.state.mcp.create({"name": "Orders", "transport": "http", "url": "https://orders.example.com/mcp"})
    assert (await call("admin_create_bot", {"name": "A", "connections": ["Nope"]}))["reason"] == "unknown_connection"
    assert "Orders" in (await call("admin_list_bots", {}))["availableConnections"]
    made = await call("admin_create_bot", {"name": "A", "connections": ["orders"]})
    assert made["ok"] and made["bot"]["connections"] == ["Orders"]
    got = next(b for b in (await c.get("/api/bots")).json()["bots"] if b["name"] == "A")
    assert got["mcpServers"] == [sid] and got["mcpAccess"][sid] == {"scope": "read", "outbound": "ask"}
    cleared = await call("admin_update_bot", {"bot": "A", "connections": []})
    assert cleared["ok"] and cleared["bot"]["connections"] == []
