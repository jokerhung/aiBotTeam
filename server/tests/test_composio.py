"""Connected apps through Composio: the project key, the Session, the catalog, sign-in links, several accounts per app, disconnect, and the one MCP
server the bots reach every app through."""
import json

import pytest

from botteam.composio import ComposioError, plan_link, trusted_url

from .fake_composio import GOOD_KEY, FakeComposio
from .test_api import ctx, make_bot  # noqa: F401  (fixture)


@pytest.fixture
def fake(ctx):
    c, app = ctx
    f = FakeComposio()
    app.state.composio._transport = f.transport
    return f


async def test_without_a_key_apps_ask_for_one_and_a_wrong_key_is_refused_and_forgotten(ctx, fake):
    c, app = ctx
    assert (await c.get("/api/composio")).json()["configured"] is False
    listed = (await c.get("/api/apps")).json()
    assert listed["configured"] is False and listed["source"] == "curated" and any(a["slug"] == "gmail" for a in listed["apps"])
    assert (await c.put("/api/composio/key", json={"key": "ck_wrong"})).status_code == 400  # the personal key is a different key
    r = await c.put("/api/composio/key", json={"key": "ak_wrongkey123456"})
    assert r.status_code == 400 and "Invalid API key" in r.text
    assert app.state.composio.configured() is False and not await app.state.composio._mcp_id()


async def test_saving_a_good_key_makes_one_session_and_one_mcp_server_and_never_shows_the_key(ctx, fake):
    c, app = ctx
    r = await c.put("/api/composio/key", json={"key": GOOD_KEY})
    assert r.status_code == 200 and r.json()["configured"] is True and GOOD_KEY not in r.text
    sessions = list(fake.sessions)
    assert len(sessions) == 1 and fake.sessions[sessions[0]]["multi"]["require_explicit_selection"] is True
    servers = (await c.get("/api/mcp/servers")).json()["servers"]
    comp = next(s for s in servers if s.get("appId") == "composio")
    assert comp["url"].endswith(f"{sessions[0]}/mcp") and comp["headers"] == {"x-api-key": "********"} and GOOD_KEY not in json.dumps(servers)
    stored = await app.state.mcp.get(comp["id"])
    assert stored["headers"]["x-api-key"] == GOOD_KEY  # kept for the turn like any secret of a server
    for surface in ((await c.get("/api/config")).text, (await c.get("/api/apps")).text, (await c.get("/api/composio")).text):
        assert GOOD_KEY not in surface
    # saving again reuses the Session instead of making another
    await c.put("/api/composio/key", json={"key": GOOD_KEY})
    assert len(fake.sessions) == 1 and len([s for s in (await c.get("/api/mcp/servers")).json()["servers"] if s.get("appId") == "composio"]) == 1
    # clearing removes the key and the server
    assert (await c.delete("/api/composio/key")).json()["configured"] is False
    assert not [s for s in (await c.get("/api/mcp/servers")).json()["servers"] if s.get("appId") == "composio"]


async def test_the_catalog_comes_from_composio_and_a_link_is_made_in_the_persons_browser(ctx, fake):
    c, app = ctx
    await c.put("/api/composio/key", json={"key": GOOD_KEY})
    listed = (await c.get("/api/apps")).json()
    assert listed["source"] == "api" and {a["slug"] for a in listed["apps"]} == {"gmail", "slack", "xero"}
    link = await c.post("/api/apps/gmail/connect", json={"alias": "work"})
    assert link.status_code == 200 and link.json()["url"].startswith("https://connect.composio.dev/link/")
    state = (await c.get("/api/apps")).json()["connections"]["gmail"]
    assert state["pending"] is True and state["connected"] is False and state["accounts"][0]["alias"] == "work"
    fake.accounts[0]["status"] = "ACTIVE"  # the person finished signing in
    state = (await c.get("/api/apps/gmail")).json()
    assert state["connected"] is True and state["status"] == "ACTIVE"


async def test_several_accounts_need_labels_and_each_is_disconnected_on_its_own(ctx, fake):
    c, app = ctx
    await c.put("/api/composio/key", json={"key": GOOD_KEY})
    user = next(iter(fake.sessions.values()))["user_id"]
    work = fake.activate("gmail", user, "work")
    assert (await c.post("/api/apps/gmail/connect", json={})).status_code == 400  # a label, so the first is not replaced
    assert (await c.post("/api/apps/gmail/connect", json={"alias": "Work"})).status_code == 409  # taken (any case)
    assert (await c.post("/api/apps/gmail/connect", json={"alias": "home"})).status_code == 200
    other_user = fake.activate("gmail", "someone_else", "theirs")
    # only an account of this user and this toolkit goes
    assert (await c.delete(f"/api/apps/gmail/accounts/{other_user['id']}")).json() == {"removed": 0}
    assert (await c.delete(f"/api/apps/slack/accounts/{work['id']}")).json() == {"removed": 0}
    assert (await c.delete(f"/api/apps/gmail/accounts/{work['id']}")).json() == {"removed": 1}
    assert any(a["id"] == other_user["id"] for a in fake.accounts) and not any(a["id"] == work["id"] for a in fake.accounts)
    assert (await c.delete("/api/apps/gmail/accounts/bad id!")).status_code in (400, 404, 422)


async def test_an_app_without_a_managed_sign_in_says_what_to_do(ctx, fake):
    c, _ = ctx
    await c.put("/api/composio/key", json={"key": GOOD_KEY})
    r = await c.post("/api/apps/xero/connect", json={})
    assert r.status_code == 409 and "auth config" in r.text


async def test_an_expired_session_is_replaced_for_the_same_user(ctx, fake):
    c, app = ctx
    await c.put("/api/composio/key", json={"key": GOOD_KEY})
    user = next(iter(fake.sessions.values()))["user_id"]
    fake.sessions.clear()  # Composio forgot the Session
    await c.get("/api/apps/gmail")
    assert len(fake.sessions) == 1 and next(iter(fake.sessions.values()))["user_id"] == user, "a new Session keeps the user, so every connection stays"


def test_plan_and_links_are_checked():
    assert plan_link("gmail", [], None) == {"alias": None, "replace": []}
    with pytest.raises(ComposioError, match="alias"):
        plan_link("gmail", [{"id": "a", "alias": "x", "status": "ACTIVE"}], None)
    stopped = plan_link("gmail", [{"id": "a", "alias": "x", "status": "FAILED"}], None)
    assert stopped["alias"].startswith("bt-retry-") and stopped["replace"] == []
    assert plan_link("gmail", [{"id": "a", "alias": "x", "status": "EXPIRED"}], "x")["replace"] == ["a"]
    with pytest.raises(ComposioError, match="maximum"):
        plan_link("gmail", [{"id": str(i), "alias": f"a{i}", "status": "ACTIVE"} for i in range(5)], "new")
    assert trusted_url("https://connect.composio.dev/x", "link")
    for bad in ("https://evil.example/x", "http://backend.composio.dev/x", "https://composio.dev.evil.example/x", "javascript:alert(1)"):
        with pytest.raises(ComposioError):
            trusted_url(bad, "link")
