import asyncio
import json

from botteam.toolbox import Toolbox, migrate
from .test_api import ctx, make_bot  # noqa: F401


async def test_defaults_validation_and_server_enforcement(ctx):
    c, app = ctx
    bot = await make_bot(c)
    assert bot["toolbox"]["web"]["enabled"] is True
    assert not bot["toolbox"]["subagents"]["enabled"]
    assert not bot["toolbox"]["computer"]["enabled"]
    for payload in ({"toolbox": None}, {"toolbox": {"subagents": {"maxFanout": 11}}}, {"toolbox": {"computer": {"resolution": [3, 800]}}}):
        assert (await c.patch(f"/api/bots/{bot['id']}", json=payload)).status_code in (400, 422)
    tools = app.state.registry.agents
    result = await tools.call(bot["mainThreadId"], "coordinate_bots", {"bot_ids": [], "message": "test"})
    assert result["reason"] == "capability_disabled"
    result = await tools.call(bot["mainThreadId"], "browser_open", {"url": "https://example.com"})
    assert not result["ok"]  # the bespoke browser tools are gone


async def test_migration_backup_cooperation_and_idempotency(ctx):
    c, app = ctx
    store, runtime, cfg = app.state.store, app.state.runtime, app.state.config
    made = [await make_bot(c, name) for name in ("Chief", "Manager", "Worker", "Boss", "Sender", "Receiver", "Independent", "Configured")]
    bots = [await store.get_bot(row["id"]) for row in made]
    for bot in bots:
        bot.toolbox = None
    bots[0].chief = True
    bots[1].managedSections = ["legacy-section"]
    bots[2].reportsTo = bots[3].id
    bots[7].chief = True
    bots[7].toolbox = Toolbox()  # a deliberate setting always wins over migration
    for bot in bots:
        await store.save_bot(bot)
    await runtime.begin_root("person", {"kind": "bot", "bot": bots[4].id}, bots[5].id, bots[5].mainThreadId, "ask")
    cfg.data.pop("toolboxMigrated", None)
    enabled = await migrate(store, runtime, cfg, cfg.path.parent)
    assert set(enabled) == {bot.id for bot in bots[:6]}
    for bot in bots[:6]:
        settings = (await store.get_bot(bot.id)).toolbox
        assert settings.subagents.enabled and settings.subagents.allowAnyAgent
        assert bot.id not in {delegate.bot for delegate in settings.subagents.delegates}
    assert not (await store.get_bot(bots[6].id)).toolbox.subagents.enabled
    assert not (await store.get_bot(bots[7].id)).toolbox.subagents.enabled
    backup = cfg.path.parent / "backup" / "toolbox-before-migration.json"
    raw = backup.read_text(encoding="utf8")
    assert next(row for row in json.loads(raw) if row["id"] == bots[0].id)["toolbox"] is None
    assert await migrate(store, runtime, cfg, cfg.path.parent) == []
    assert backup.read_text(encoding="utf8") == raw


async def test_inline_specialists_sync_and_dont_leak_into_agent_list(ctx):
    c, app = ctx
    parent = await make_bot(c, "Parent")
    payload = {"toolbox": {"subagents": {"enabled": True, "inline": [{"id": "review", "name": "Reviewer", "instructions": "Review carefully", "capabilities": ["web", "memory"]}]}}}
    saved = (await c.patch(f"/api/bots/{parent['id']}", json=payload)).json()
    child_id = saved["toolbox"]["subagents"]["inline"][0]["botId"]
    child = await app.state.store.get_bot(child_id)
    assert child.inline and child.hidden and child.owner == parent["id"]
    assert child.soul == "Review carefully"
    assert not child.toolbox.web.enabled and not child.memory  # not explicitly shared by the parent
    assert not child.toolbox.subagents.enabled
    assert child_id not in {bot["id"] for bot in (await c.get("/api/bots")).json()["bots"]}
    payload["toolbox"]["subagents"]["inline"][0]["botId"] = child_id
    payload["toolbox"]["subagents"]["shareWithDelegates"] = ["web", "memory"]
    await c.patch(f"/api/bots/{parent['id']}", json=payload)
    assert (await app.state.store.get_bot(child_id)).toolbox.web.enabled
    assert (await app.state.store.get_bot(child_id)).memory
    await c.patch(f"/api/bots/{parent['id']}", json={"toolbox": {"subagents": {"enabled": True, "inline": []}}})
    assert await app.state.store.get_bot(child_id) is None
