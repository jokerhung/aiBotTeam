import asyncio

from botteam.drivers.base import SendTurnInput
from botteam.turns import ThreadRun
from .test_api import ctx, make_bot  # noqa: F401


async def active_parent(c, app, policy, origin="person", approval="full"):
    row = await make_bot(c, "Parent")
    response = await c.patch(f"/api/bots/{row['id']}", json={"approvalMode": approval, "toolbox": {"subagents": {"enabled": True, **policy}}})
    assert response.status_code == 200, response.text
    bot = await app.state.store.get_bot(row["id"])
    inp = SendTurnInput(thread_id=bot.mainThreadId, bot_id=bot.id, text="A task", approval_mode=approval)
    app.state.turns.runs[bot.mainThreadId] = ThreadRun(bot.id, inp, origin=origin)
    app.state.registry.get("echo").driver.delay = 0
    node = await app.state.registry.agents._node(bot.mainThreadId)
    return bot, node


async def until(predicate, seconds=4):
    for _ in range(int(seconds / .02)):
        result = predicate()
        if asyncio.iscoroutine(result):
            result = await result
        if result:
            return result
        await asyncio.sleep(.02)
    raise AssertionError("condition was not reached")


async def test_sync_task_collects_answer_without_a_second_parent_wake(ctx):
    c, app = ctx
    child = await make_bot(c, "Research")
    parent, node = await active_parent(c, app, {"delegates": [{"bot": child["id"]}], "mode": "sync", "maxResultChars": 500})
    result = await app.state.registry.agents.call(parent.mainThreadId, "task", {"bot": child["id"], "description": "Research the campaign " * 100})
    row = result["results"][0]
    assert result["ok"] and row["status"] == "completed" and row["mode"] == "sync"
    assert len(row["answer"]) <= 500 and row["truncated"]
    assert (await app.state.runtime.get(node["id"]))["children_since_turn"] == 0
    await app.state.runtime.turn_ended_for_thread(parent.mainThreadId, True, "Collected the answer", False)
    assert (await app.state.runtime.get(node["id"]))["status"] == "completed"
    assert not [event for event in await app.state.runtime.events(node["id"]) if event["kind"] == "wake"]


async def test_unattended_only_explicit_delegates_and_fanout(ctx):
    c, app = ctx
    selected, other = await make_bot(c, "Selected"), await make_bot(c, "Other")
    parent, node = await active_parent(c, app, {"allowAnyAgent": True, "delegates": [{"bot": selected["id"]}], "maxFanout": 1}, origin="routine")
    tools = app.state.registry.agents
    assert [b["id"] for b in (await tools.call(parent.mainThreadId, "list_bots", {}))["bots"]] == [selected["id"]]
    rejected = await tools.call(parent.mainThreadId, "task", {"bot": other["id"], "description": "Cannot select this agent"})
    assert rejected["results"][0]["reason"] == "not_a_delegate"
    accepted = await tools.call(parent.mainThreadId, "task", {"bot": selected["id"], "description": "/slow"})
    assert accepted["ok"]
    again = await tools.call(parent.mainThreadId, "task", {"bot": selected["id"], "description": "A different task"})
    assert again["results"][0]["reason"] == "fanout"
    await app.state.runtime.cancel(node["id"])


async def test_depth_limit_hides_tools_in_delegate_and_sync_timeout_becomes_background(ctx):
    c, app = ctx
    child = await make_bot(c, "Child")
    await c.patch(f"/api/bots/{child['id']}", json={"toolbox": {"subagents": {"enabled": True, "allowAnyAgent": True, "maxDepth": 3}}})
    parent, node = await active_parent(c, app, {"delegates": [{"bot": child["id"]}], "mode": "sync", "maxDepth": 1, "maxWaitSeconds": 1})
    pending = asyncio.create_task(app.state.registry.agents.call(parent.mainThreadId, "task", {"bot": child["id"], "description": "/slow"}))
    run = await until(lambda: next((run for run in app.state.turns.runs.values() if run.bot_id == child["id"]), None))
    assert "coordinate_bots" not in run.inp.allowed_tools and "task" not in run.inp.allowed_tools
    result = await pending
    assert result["results"][0]["status"] == "background"
    assignment = (await app.state.runtime.children(node["id"]))[0]
    assert assignment["reply"] == "resume"
    await app.state.runtime.cancel(node["id"])


async def test_dynamic_approval_promote_cleanup_and_no_questions(ctx):
    c, app = ctx
    parent, node = await active_parent(c, app, {"allowDynamic": True, "mode": "sync", "allowQuestions": True}, approval="ask")
    tools = app.state.registry.agents
    created = await tools.call(parent.mainThreadId, "create_agent", {"name": "Temporary", "instructions": "Work independently"})
    child = await app.state.store.get_bot(created["bot"])
    assert child.ephemeral and child.hidden and not child.memory and not child.toolbox.web.enabled
    pending = asyncio.create_task(tools.call(parent.mainThreadId, "delegate", {"bot": child.id, "description": "/ask May I ask? | Yes | No"}))
    request = await until(lambda: next((request for _, request in app.state.broker.all_open() if request["tool"] == "Delegate"), None))
    assert request["instructions"] == "Work independently"
    await app.state.broker.resolve(request["id"], "allow")
    result = await pending
    assert result["results"][0]["answer"] == "No answer"  # temporary specialists never question the parent person
    promoted = await c.post(f"/api/bots/{child.id}/promote")
    assert promoted.status_code == 200 and not promoted.json()["hidden"] and not promoted.json()["ephemeral"]
    another = await tools.call(parent.mainThreadId, "create_agent", {"name": "Disposable", "instructions": "A short task"})
    await app.state.runtime.cancel(node["id"])
    assert await app.state.store.get_bot(another["bot"]) is None
    assert await app.state.store.get_bot(child.id) is not None


async def test_sync_delegate_question_is_answerable_in_parent_conversation(ctx):
    c, app = ctx
    child = await make_bot(c, "Research")
    parent, node = await active_parent(c, app, {"delegates": [{"bot": child["id"]}], "mode": "sync", "allowQuestions": True})
    pending = asyncio.create_task(app.state.registry.agents.call(parent.mainThreadId, "task", {"bot": child["id"], "description": "/ask Which audience? | Teams | Consumers"}))
    request = await until(lambda: next((request for _, request in app.state.broker.all_open() if request["type"] == "question"), None))
    messages = (await c.get(f"/api/bots/{parent.id}/messages")).json()["messages"]
    shown = next(m for m in messages if (m.get("request") or {}).get("id") == request["id"])
    assert shown["request"]["by"] == "Research"
    reply = await c.post(f"/api/threads/{parent.mainThreadId}/requests/{request['id']}", json={"behavior": "allow", "message": "Teams"})
    assert reply.status_code == 200
    result = await pending
    assert "Teams" in result["results"][0]["answer"]
    await app.state.runtime.cancel(node["id"])
