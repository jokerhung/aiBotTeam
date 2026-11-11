"""Rooms: who answers, in what order, mentions, chained hand-offs, the optional automatic choice."""
import asyncio

from botteam.groups import mentions_in

from .test_api import ctx, make_bot  # noqa: F401  (fixture)


async def room(c, names=("Alpha", "Beta", "Gamma"), **extra):
    bots = [await make_bot(c, n) for n in names]
    g = (await c.post("/api/groups", json={"name": "Team", "members": [b["id"] for b in bots], **extra})).json()
    return g, bots


async def room_msgs(c, g):
    return (await c.get(f"/api/groups/{g['id']}/messages")).json()["messages"]


async def wait_idle(c, g, timeout=8.0):
    for _ in range(int(timeout / 0.05)):
        await asyncio.sleep(0.05)
        cur = next(x for x in (await c.get("/api/groups")).json()["groups"] if x["id"] == g["id"])
        if not cur["busy"] and not cur["queue"]:
            return cur
    raise AssertionError("the room never went idle")


def authors(msgs):
    return [m["author"] for m in msgs if m["role"] == "bot" and m["kind"] == "text"]


def test_mentions_use_the_longest_name_and_word_boundaries():
    members = [("b1", "Dev"), ("b2", "Dev Lead"), ("b3", "Tester")]
    assert mentions_in("@Dev Lead please look, then @tester", members) == ["b2", "b3"]
    assert mentions_in("@dev", members) == ["b1"]
    assert mentions_in("hey @everyone", members) == [m[0] for m in members]  # everyone = every member
    assert mentions_in("@tester first, @everyone", members)[0] == "b3"
    assert mentions_in("mail me at x@Dev.com or @Developer", members) == []  # not a mention: inside a word / email
    assert mentions_in("@Tester @Dev @Tester", members) == ["b3", "b1"]  # in order, once each


async def test_without_a_mention_the_leader_answers_and_mentions_pick_the_bot(ctx):
    c, _ = ctx
    g, (a, b, cc) = await room(c, leader=None)
    assert g["leader"] == a["id"] and [m["name"] for m in g["memberInfo"]] == ["Alpha", "Beta", "Gamma"]
    await c.post(f"/api/groups/{g['id']}/messages", json={"text": "hello everyone"})
    await wait_idle(c, g)
    assert authors(await room_msgs(c, g)) == [a["id"]]
    await c.post(f"/api/groups/{g['id']}/messages", json={"text": "@Beta what do you think?"})
    await wait_idle(c, g)
    assert authors(await room_msgs(c, g)) == [a["id"], b["id"]]
    user = [m for m in await room_msgs(c, g) if m["role"] == "user"][-1]
    assert user["mentions"] == [b["id"]]


async def test_several_mentions_answer_in_order_one_at_a_time(ctx):
    c, app = ctx
    g, (a, b, cc) = await room(c)
    overlaps = []

    async def watch():
        for _ in range(200):
            running = [t for t in app.state.turns.runs if t == g["threadId"]]
            if len(running) > 1:
                overlaps.append(running)
            await asyncio.sleep(0.01)
    w = asyncio.create_task(watch())
    await c.post(f"/api/groups/{g['id']}/messages", json={"text": "@Gamma then @Beta please"})
    seen_queue = False
    for _ in range(100):
        cur = next(x for x in (await c.get("/api/groups")).json()["groups"] if x["id"] == g["id"])
        if len(cur["queue"]) >= 2:
            seen_queue = True
            assert [e["state"] for e in cur["queue"]][0] == "running" and cur["queue"][1]["state"] == "waiting"
            break
        await asyncio.sleep(0.01)
    await wait_idle(c, g)
    w.cancel()
    assert authors(await room_msgs(c, g)) == [cc["id"], b["id"]]
    assert seen_queue, "the room's queue was visible while it worked"
    assert not overlaps


async def test_mention_only_rooms_stay_quiet_without_a_mention(ctx):
    c, _ = ctx
    g, (a, b, cc) = await room(c, responder="mention")
    await c.post(f"/api/groups/{g['id']}/messages", json={"text": "anyone?"})
    await asyncio.sleep(0.4)
    assert authors(await room_msgs(c, g)) == []
    await c.post(f"/api/groups/{g['id']}/messages", json={"text": "@Alpha yes you"})
    await wait_idle(c, g)
    assert authors(await room_msgs(c, g)) == [a["id"]]


async def test_a_bot_can_hand_the_floor_on_with_an_at_mention_but_only_twice(ctx):
    c, _ = ctx
    g, (a, b, cc) = await room(c)
    await c.post(f"/api/groups/{g['id']}/messages", json={"text": "@Alpha start (pass to @Beta)"})
    await wait_idle(c, g)
    assert authors(await room_msgs(c, g)) == [a["id"], b["id"]]  # Alpha handed the floor to Beta; Beta named only itself
    # the message names all three, so they answer in order; Gamma's reply names Beta again (hand-off 1), Beta's names Gamma (hand-off 2), and the chain stops there
    g2, (a2, b2, c2) = await room(c)
    await c.post(f"/api/groups/{g2['id']}/messages", json={"text": "@Alpha go (pass to @Beta) (pass to @Gamma)"})
    names = {a2["id"]: "A", b2["id"]: "B", c2["id"]: "G"}
    for _ in range(100):  # the room is briefly idle between chained turns, so wait for the whole chain
        await wait_idle(c, g2)
        seen = [names[x] for x in authors(await room_msgs(c, g2))]
        if len(seen) >= 5:
            break
        await asyncio.sleep(0.1)
    await asyncio.sleep(0.5)  # and give a sixth turn the chance to wrongly appear
    await wait_idle(c, g2)
    assert [names[x] for x in authors(await room_msgs(c, g2))] == ["A", "B", "G", "B", "G"]


async def test_group_crud_membership_and_leader_rules(ctx):
    c, app = ctx
    g, (a, b, cc) = await room(c)
    assert (await c.post("/api/groups", json={"name": "Bad", "members": [a["id"]], "leader": b["id"]})).status_code == 400
    p = (await c.patch(f"/api/groups/{g['id']}", json={"members": [b["id"], "ghost", cc["id"], b["id"]]})).json()
    assert p["members"] == [b["id"], cc["id"]] and p["leader"] == b["id"]  # unknown and duplicate ids dropped; the leader stays a member
    assert (await c.patch(f"/api/groups/{g['id']}", json={"leader": a["id"]})).status_code == 400
    await c.delete(f"/api/bots/{b['id']}")
    after = next(x for x in (await c.get("/api/groups")).json()["groups"] if x["id"] == g["id"])
    assert after["members"] == [cc["id"]] and after["leader"] == cc["id"]
    assert (await c.delete(f"/api/groups/{g['id']}")).status_code == 200
    assert (await c.get(f"/api/groups/{g['id']}/messages")).status_code == 404


async def test_read_state_and_tasks_in_a_room(ctx):
    c, _ = ctx
    g, (a, *_rest) = await room(c)
    await c.post(f"/api/groups/{g['id']}/messages", json={"text": "hi"})
    cur = await wait_idle(c, g)
    assert cur["unread"] is True and "heard" in cur["lastText"]
    await c.post(f"/api/groups/{g['id']}/read")
    assert next(x for x in (await c.get("/api/groups")).json()["groups"] if x["id"] == g["id"])["unread"] is False
    t = (await c.post(f"/api/groups/{g['id']}/tasks", json={"title": "Plan"})).json()
    r = await c.post(f"/api/groups/{g['id']}/messages", json={"text": "in the task", "threadId": t["threadId"]})
    assert r.status_code == 202
    await wait_idle(c, g)
    in_task = (await c.get(f"/api/groups/{g['id']}/messages", params={"thread": t["threadId"]})).json()["messages"]
    assert authors(in_task) == [a["id"]]


async def test_automatic_choice_falls_back_to_the_leader(ctx, monkeypatch):
    c, app = ctx
    g, (a, b, cc) = await room(c, responder="auto")
    groups = app.state.groups
    # off: the leader
    assert (await groups.decide(await app.state.store.get_group(g["id"]), "anything", [])) == [(a["id"], "leader")]
    # on, the model names a member
    groups.decider = {"instanceId": "oai1", "model": "m"}

    class Inst:
        state, driver_kind, driver = "available", "openai-compat", object()
    monkeypatch.setattr(app.state.registry, "get", lambda i: Inst() if i == "oai1" else None)
    import botteam.drivers.openai_compat as oc

    async def fake(driver, model, system, user, timeout=8.0):
        return "Gamma"
    monkeypatch.setattr(oc, "ask_once", fake)
    grp = await app.state.store.get_group(g["id"])
    assert await groups.decide(grp, "write the docs", []) == [(cc["id"], "auto")]

    async def unsure(driver, model, system, user, timeout=8.0):
        return "NONE"
    monkeypatch.setattr(oc, "ask_once", unsure)
    assert await groups.decide(grp, "hmm", []) == [(a["id"], "leader")]

    async def boom(driver, model, system, user, timeout=8.0):
        raise RuntimeError("endpoint down")
    monkeypatch.setattr(oc, "ask_once", boom)
    assert await groups.decide(grp, "hmm", []) == [(a["id"], "leader")]
    groups.decider = None


async def test_post_to_room_tool_and_membership(ctx):
    c, app = ctx
    g, (a, b) = await room(c, names=("Alpha", "Beta"))
    outsider = await make_bot(c, "Outsider")
    agents = app.state.agents
    # a running turn of a member posts
    app.state.turns.runs["tx"] = type("R", (), {"bot_id": a["id"], "group_id": None})()
    ok = await agents.call("tx", "post_to_room", {"room": "Team", "message": "status: all green @Beta"})
    assert ok["ok"] is True
    await wait_idle(c, g)
    assert authors(await room_msgs(c, g))[:2] == [a["id"], b["id"]]  # the @mention in the post woke Beta
    app.state.turns.runs["ty"] = type("R", (), {"bot_id": outsider["id"], "group_id": None})()
    assert (await agents.call("ty", "post_to_room", {"room": "Team", "message": "hi"}))["reason"] == "not_a_member"
    assert (await agents.call("tx", "post_to_room", {"room": "Nope", "message": "hi"}))["reason"] == "unknown_room"
    listed = await agents.call("tx", "list_rooms", {})
    assert listed["rooms"][0]["name"] == "Team"
    app.state.turns.runs.pop("tx")
    app.state.turns.runs.pop("ty")
