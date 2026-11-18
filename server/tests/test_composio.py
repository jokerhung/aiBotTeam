"""Connected apps through Composio: the project key, the Session, the catalog, sign-in links, several accounts per app, disconnect, and the one MCP
server the bots reach every app through."""
import json
import asyncio

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
    assert listed["apps"][0]["slug"] == "telegram" and listed["apps"][0]["label"] == "Telegram"
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
    assert "gmail" not in (await c.get("/api/apps")).json()["connections"]
    await c.post("/api/apps/refresh")
    state = (await c.get("/api/apps")).json()["connections"]["gmail"]
    assert state["pending"] is True and state["connected"] is False and state["accounts"][0]["alias"] == "work"
    fake.accounts[0]["status"] = "ACTIVE"  # the person finished signing in
    assert (await c.get("/api/apps/gmail")).json()["pending"] is True
    await c.post("/api/apps/refresh")
    state = (await c.get("/api/apps/gmail")).json()
    assert state["connected"] is True and state["status"] == "ACTIVE"


async def test_apps_snapshot_never_waits_for_composio_and_reuses_known_accounts(ctx, fake):
    c, app = ctx
    await c.put("/api/composio/key", json={"key": GOOD_KEY})
    before = len(fake.calls)
    snapshot = (await c.get("/api/apps?cached=true")).json()
    assert len(fake.calls) == before
    assert snapshot["apps"] and snapshot["connectionsLoaded"] is False
    user = next(iter(fake.sessions.values()))["user_id"]
    fake.activate("gmail", user, "work")
    await c.get("/api/apps")
    before = len(fake.calls)
    snapshot = (await c.get("/api/apps?cached=true")).json()
    assert len(fake.calls) == before
    assert snapshot["source"] == "api" and snapshot["connectionsLoaded"] is True
    assert snapshot["connections"]["gmail"]["accounts"][0]["alias"] == "work"
    await c.delete("/api/composio/key")
    assert (await c.get("/api/apps?cached=true")).json()["connections"] == {}


async def test_catalog_and_connection_status_load_in_parallel(ctx, fake, monkeypatch):
    c, app = ctx
    await c.put("/api/composio/key", json={"key": GOOD_KEY})
    catalog_started, status_started = asyncio.Event(), asyncio.Event()

    async def catalog():
        catalog_started.set()
        await status_started.wait()
        return [], "api"

    async def status():
        status_started.set()
        await catalog_started.wait()
        return {}

    monkeypatch.setattr(app.state.composio, "catalog", catalog)
    monkeypatch.setattr(app.state.composio, "status", status)
    response = await asyncio.wait_for(c.get("/api/apps"), timeout=2)
    assert response.status_code == 200 and response.json()["connectionsLoaded"] is True


async def test_existing_database_snapshot_never_calls_catalog_or_status(ctx, fake, monkeypatch):
    c, app = ctx
    await c.put("/api/composio/key", json={"key": GOOD_KEY})
    user = next(iter(fake.sessions.values()))["user_id"]
    fake.activate("gmail", user, "work")
    await c.get("/api/apps")

    async def forbidden(*args, **kwargs):
        pytest.fail("ordinary reads must only use the saved database snapshot")

    monkeypatch.setattr(app.state.composio, "catalog", forbidden)
    monkeypatch.setattr(app.state.composio, "status", forbidden)
    for path in ("/api/apps", "/api/apps?cached=true", "/api/apps?section=connections"):
        result = (await c.get(path)).json()
        assert result["connections"]["gmail"]["connected"] is True
    assert (await c.get("/api/apps/gmail")).json()["connected"] is True


async def test_saved_catalog_survives_a_new_service_and_reopened_database(ctx, fake):
    from botteam.composio import Composio
    from botteam.store import Store

    c, app = ctx
    await c.put("/api/composio/key", json={"key": GOOD_KEY})
    user = next(iter(fake.sessions.values()))["user_id"]
    fake.activate("gmail", user, "work")
    initial = (await c.get("/api/apps")).json()
    calls = len(fake.calls)
    reopened = Store(app.state.store.path)
    await reopened.open()
    try:
        original = app.state.composio
        fresh = Composio(original.config, original.mcp, original.bus, reopened, transport=fake.transport)
        assert fresh._catalog is None and fresh._connections is None
        assert (await fresh.saved_apps())["apps"] == initial["apps"]
        assert (await fresh.saved_apps())["connections"]["gmail"]["connected"] is True
        assert len(fake.calls) == calls
        row = await reopened.connected_apps_cache(fresh._cache_key())
        assert GOOD_KEY not in json.dumps(row)
    finally:
        await reopened.close()


async def test_refresh_bypasses_catalog_ttl_and_persists_changes(ctx, fake):
    c, app = ctx
    await c.put("/api/composio/key", json={"key": GOOD_KEY})
    await c.get("/api/apps")
    calls = len(fake.calls)
    user = next(iter(fake.sessions.values()))["user_id"]
    fake.activate("gmail", user, "new account")
    assert "gmail" not in (await c.get("/api/apps")).json()["connections"]
    assert len(fake.calls) == calls
    refreshed = (await c.post("/api/apps/refresh")).json()
    assert refreshed["connections"]["gmail"]["accounts"][0]["alias"] == "new account"
    assert any("/toolkits" in path for _, path in fake.calls[calls:])
    calls = len(fake.calls)
    assert (await c.get("/api/apps")).json()["connections"] == refreshed["connections"]
    assert len(fake.calls) == calls


async def test_concurrent_first_opens_initialize_only_once(ctx, fake):
    c, app = ctx
    await c.put("/api/composio/key", json={"key": GOOD_KEY})
    calls = len(fake.calls)
    responses = await asyncio.gather(*(c.get("/api/apps") for _ in range(4)))
    assert all(response.status_code == 200 for response in responses)
    assert sum("/toolkits" in path for _, path in fake.calls[calls:]) == 1


async def test_a_different_project_key_cannot_read_the_saved_accounts(ctx, fake, monkeypatch):
    c, app = ctx
    await c.put("/api/composio/key", json={"key": GOOD_KEY})
    user = next(iter(fake.sessions.values()))["user_id"]
    fake.activate("gmail", user, "private work")
    await c.get("/api/apps")
    calls = len(fake.calls)
    monkeypatch.setattr(app.state.composio, "key", lambda: "ak_different_project_key")
    result = await app.state.composio.saved_apps(initialize=False)
    assert result["initialized"] is False and result["connections"] == {}
    assert len(fake.calls) == calls


async def test_successful_sign_in_refreshes_and_persists_without_a_manual_refresh(ctx, fake, monkeypatch):
    c, app = ctx
    comp = app.state.composio
    monkeypatch.setattr(comp, "connection_poll_interval", 0.01)
    await c.put("/api/composio/key", json={"key": GOOD_KEY})
    await c.get("/api/apps")
    assert (await c.post("/api/apps/gmail/connect", json={})).status_code == 200
    tasks = list(comp._authorization_tasks)
    assert tasks
    events = []
    publish = comp.bus.publish

    def record(frame):
        events.append(frame)
        publish(frame)

    monkeypatch.setattr(comp.bus, "publish", record)
    assert "gmail" not in (await c.get("/api/apps")).json()["connections"]
    fake.accounts[0]["status"] = "ACTIVE"
    await asyncio.wait_for(asyncio.gather(*tasks), timeout=3)
    stored = await app.state.store.connected_apps_cache(comp._cache_key())
    assert stored["connections"]["gmail"]["connected"] is True
    assert any(frame["kind"] == "mcp.changed" for frame in events)
    assert not comp._authorization_tasks
    calls = len(fake.calls)
    assert (await c.get("/api/apps")).json()["connections"]["gmail"]["connected"] is True
    assert len(fake.calls) == calls  # the updated dialog still reads SQLite only


async def test_an_existing_active_account_does_not_complete_a_new_sign_in(ctx, fake, monkeypatch):
    from unittest.mock import AsyncMock

    c, app = ctx
    comp = app.state.composio
    monkeypatch.setattr(comp, "connection_poll_interval", 0.01)
    await c.put("/api/composio/key", json={"key": GOOD_KEY})
    user = next(iter(fake.sessions.values()))["user_id"]
    fake.activate("gmail", user, "work")
    await c.get("/api/apps")
    refresh = AsyncMock(wraps=comp.refresh_apps)
    monkeypatch.setattr(comp, "refresh_apps", refresh)
    checked = asyncio.Event()
    accounts = comp.accounts

    async def observe(*args):
        result = await accounts(*args)
        if any(a.get("status") == "INITIATED" for a in result):
            checked.set()
        return result

    monkeypatch.setattr(comp, "accounts", observe)
    assert (await c.post("/api/apps/gmail/connect", json={"alias": "home"})).status_code == 200
    await asyncio.wait_for(checked.wait(), timeout=2)
    assert refresh.await_count == 0
    tasks = list(comp._authorization_tasks)
    next(a for a in fake.accounts if a["alias"] == "home")["status"] = "ACTIVE"
    await asyncio.wait_for(asyncio.gather(*tasks), timeout=3)
    assert refresh.await_count == 1
    assert len((await c.get("/api/apps/gmail")).json()["accounts"]) == 2


async def test_stopping_the_service_cancels_pending_sign_in_watchers(ctx, fake):
    c, app = ctx
    await c.put("/api/composio/key", json={"key": GOOD_KEY})
    await c.post("/api/apps/gmail/connect", json={})
    tasks = list(app.state.composio._authorization_tasks)
    assert tasks
    await app.state.composio.stop()
    assert all(task.done() for task in tasks)
    assert not app.state.composio._authorization_tasks


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


async def test_telegram_connects_like_any_other_app_with_one_account_per_bot_token(ctx, fake):
    c, app = ctx
    await c.put("/api/composio/key", json={"key": GOOD_KEY})
    first = await c.post("/api/apps/telegram/connect", json={"alias": "shop"})
    assert first.status_code == 200 and first.json()["url"].startswith("https://connect.composio.dev/")
    fake.accounts[0]["status"] = "ACTIVE"
    assert (await c.post("/api/apps/telegram/connect", json={})).status_code == 400  # a second bot needs its own label
    assert (await c.post("/api/apps/telegram/connect", json={"alias": "support"})).status_code == 200
    state = (await c.get("/api/apps/telegram")).json()
    assert state["connected"] is True and {a["alias"] for a in state["accounts"]} == {"shop", "support"}
