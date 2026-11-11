"""Bots handing work to bots through the real app: runtime + turns + the demo engine."""
import asyncio

from .test_api import ctx, make_bot  # noqa: F401  (fixture)


async def wait_until(fn, timeout=8.0):
    for _ in range(int(timeout / 0.05)):
        v = await fn()
        if v:
            return v
        await asyncio.sleep(0.05)
    raise AssertionError("condition never held")


async def msgs(c, bot, thread=None):
    q = f"?thread={thread}" if thread else ""
    return (await c.get(f"/api/bots/{bot['id']}/messages{q}")).json()["messages"]


async def test_a_hands_work_to_b_and_c_and_is_woken_once(ctx):
    c, app = ctx
    a, b, cc = await make_bot(c, "Alpha"), await make_bot(c, "Beta"), await make_bot(c, "Gamma")
    await c.post(f"/api/bots/{a['id']}/messages", json={"text": "/coordinate Beta, Gamma | Review the plan"})

    async def woken():
        return [m for m in await msgs(c, a) if m.get("sender") == "Team report"]
    report = await wait_until(woken)
    assert len(report) == 1
    text = report[0]["text"]
    assert text.startswith("[From system") is False and "[From" in text.split("\n")[0]
    assert "@Beta" in text and "@Gamma" in text  # one wake carries both results
    # both teammates really ran, each in a thread of its own, with the harness-written envelope
    for bot, name in ((b, "Beta"), (cc, "Gamma")):
        bots = (await c.get("/api/bots")).json()["bots"]
        mine = next(x for x in bots if x["id"] == bot["id"])
        task = next(t for t in mine["tasks"] if not t["main"])
        thread_msgs = await msgs(c, bot, task["threadId"])
        first = thread_msgs[0]
        assert first["role"] == "user" and first["sender"] == "Alpha"
        assert first["text"].startswith("[From @Alpha (bot) · assignment as_") and "on their behalf at your level" in first["text"]
    # Alpha answered the report once, and the whole tree is finished and consistent
    await wait_until(lambda: asyncio.sleep(0, result=not app.state.runtime.tasks and not app.state.turns.runs))
    rows = await app.state.runtime.all()
    assert {r["status"] for r in rows} == {"completed"}
    assert len([r for r in rows if r["parent_id"]]) == 2
    assert await app.state.runtime.check_invariants() == []
    api = (await c.get("/api/assignments")).json()["assignments"]
    assert len(api) >= 3 and all(x["status"] == "completed" for x in api)


async def test_handing_work_to_an_ancestor_or_stranger_is_refused_not_thrown(ctx):
    c, app = ctx
    a, b = await make_bot(c, "Alpha"), await make_bot(c, "Beta")
    await c.post(f"/api/bots/{a['id']}/messages", json={"text": "/coordinate Alpha, Nobody | circular"})
    reply = await wait_until(lambda: _bot_text(c, a, "Handed out:"))
    assert "refused (ancestor)" in reply and "refused (unknown_bot)" in reply

    async def clean():  # the turn that printed the reply is still closing its root for a moment
        return await app.state.runtime.check_invariants() == []
    await wait_until(clean)


async def _bot_text(c, bot, needle):
    for m in await msgs(c, bot):
        if m["role"] == "bot" and needle in m["text"]:
            return m["text"]
    return None


async def test_stop_in_the_requesters_thread_cancels_the_tree(ctx):
    c, app = ctx
    a, b = await make_bot(c, "Alpha"), await make_bot(c, "Beta")
    await c.post(f"/api/bots/{b['id']}/messages", json={"text": "/slow keep going"})  # Beta is busy, so Alpha's job to it stays queued
    await asyncio.sleep(0.2)
    await c.post(f"/api/bots/{a['id']}/messages", json={"text": "/coordinate Beta | wait for me"})
    await _wait_rows(app, lambda rows: any(r["assignee_bot"] == b["id"] and r["parent_id"] for r in rows))
    stopped = (await c.post(f"/api/bots/{a['id']}/interrupt")).json()
    await _wait_rows(app, lambda rows: all(r["status"] in ("cancelled", "completed", "failed") for r in rows if r["parent_id"] or r["assignee_bot"] == a["id"]))
    rows = await app.state.runtime.all()
    child = next(r for r in rows if r["parent_id"])
    assert child["status"] == "cancelled" and child["outcome"] == "stopped", (stopped, child["status"])
    await c.post(f"/api/bots/{b['id']}/interrupt")
    assert await app.state.runtime.check_invariants(quiescent=False) == []


async def _wait_rows(app, pred, timeout=8.0):
    for _ in range(int(timeout / 0.05)):
        rows = await app.state.runtime.all()
        if pred(rows):
            return rows
        await asyncio.sleep(0.05)
    raise AssertionError("rows never matched")


async def test_the_team_tools_answer_from_the_bridge_over_the_broker_socket(ctx):
    """The same call a Claude turn makes through the MCP bridge: `agent` over the broker's socket."""
    import json
    c, app = ctx
    a, b = await make_bot(c, "Alpha"), await make_bot(c, "Beta")
    broker = app.state.broker
    r, w = await asyncio.open_connection("127.0.0.1", broker.port)
    w.write((json.dumps({"t": "hello", "token": broker.token, "thread": a["threadId"]}) + "\n").encode())
    w.write((json.dumps({"t": "agent", "id": "x1", "tool": "list_bots", "args": {}}) + "\n").encode())
    await w.drain()
    ans = json.loads(await asyncio.wait_for(r.readline(), 3))
    names = [x["name"] for x in ans["agent"]["bots"]]
    assert ans["t"] == "answer" and names == ["Alpha", "Beta"]
    w.write((json.dumps({"t": "agent", "id": "x2", "tool": "no_such_tool", "args": {}}) + "\n").encode())
    await w.drain()
    bad = json.loads(await asyncio.wait_for(r.readline(), 3))
    assert bad["agent"]["ok"] is False and bad["agent"]["reason"] == "unknown_tool"
    w.close()


async def test_a_chief_with_sections_hands_work_only_inside_them(ctx):
    c, app = ctx
    a, b, cc = await make_bot(c, "Chiefy"), await make_bot(c, "Inside"), await make_bot(c, "Outside")
    sec = (await c.post("/api/sidebar-sections", json={"name": "Ship"})).json()
    await c.patch(f"/api/bots/{b['id']}", json={"section": sec["id"]})
    shown = (await c.patch(f"/api/bots/{a['id']}", json={"chief": True, "managedSections": [sec["id"]]})).json()
    assert shown["managedSections"] == [sec["id"]]
    app.state.turns.runs["tx"] = type("R", (), {"bot_id": a["id"], "group_id": None, "assignment_id": None, "origin": "person", "level": None, "started_at": 0, "label": None})()
    out = await app.state.agents.call("tx", "coordinate_bots", {"bot_ids": [b["id"], cc["id"]], "message": "write the notes", "reply": "none"})
    app.state.turns.runs.pop("tx")
    by = {r["bot"]: r for r in out["results"]}
    assert by["Inside"]["ok"] is True
    assert by["Outside"]["ok"] is False and by["Outside"]["reason"] == "outside_scope"
    await wait_until(lambda: _idle(c, b))


async def _idle(c, bot):
    bots = (await c.get("/api/bots")).json()["bots"]
    return not next(x for x in bots if x["id"] == bot["id"])["busy"]


async def test_reports_to_scopes_a_chief_and_refuses_loops(ctx):
    c, app = ctx
    a, b, cc = await make_bot(c, "Boss"), await make_bot(c, "Report"), await make_bot(c, "Other")
    sec = (await c.post("/api/sidebar-sections", json={"name": "Core"})).json()
    await c.patch(f"/api/bots/{a['id']}", json={"chief": True, "managedSections": [sec["id"]]})
    assert (await c.patch(f"/api/bots/{b['id']}", json={"reportsTo": a["id"]})).json()["reportsTo"] == a["id"]
    assert (await c.patch(f"/api/bots/{a['id']}", json={"reportsTo": b["id"]})).status_code == 400  # a loop
    assert (await c.patch(f"/api/bots/{b['id']}", json={"reportsTo": b["id"]})).status_code == 400
    assert (await c.patch(f"/api/bots/{b['id']}", json={"reportsTo": "bot_nope"})).status_code == 404
    app.state.turns.runs["tx"] = type("R", (), {"bot_id": a["id"], "group_id": None, "assignment_id": None, "origin": "person", "level": None, "started_at": 0, "label": None})()
    out = await app.state.agents.call("tx", "coordinate_bots", {"bot_ids": [b["id"], cc["id"]], "message": "go", "reply": "none"})
    app.state.turns.runs.pop("tx")
    by = {r["bot"]: r for r in out["results"]}
    assert by["Report"]["ok"] is True and by["Other"]["reason"] == "outside_scope"  # a report is in scope without a section
    await c.delete(f"/api/bots/{a['id']}")
    mine = next(x for x in (await c.get("/api/bots")).json()["bots"] if x["id"] == b["id"])
    assert mine["reportsTo"] is None
    await wait_until(lambda: _idle(c, b))
