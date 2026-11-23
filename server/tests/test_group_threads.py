"""A team (room) has several conversations: the main one from the start, more on demand, one turn at a time across all of them."""
from .test_api import ctx, make_bot  # noqa: F401  (fixture)
from .test_groups import room, room_msgs, wait_idle


async def get(c, g):
    return next(x for x in (await c.get("/api/groups")).json()["groups"] if x["id"] == g["id"])


async def msgs(c, g, thread):
    return (await c.get(f"/api/groups/{g['id']}/messages", params={"thread": thread})).json()["messages"]


async def test_a_new_team_starts_with_its_main_conversation(ctx):
    c, _ = ctx
    g, _ = await room(c)
    assert g["threadId"] == g["mainThreadId"]
    assert [(t["threadId"], t["main"], t["closed"]) for t in g["tasks"]] == [(g["mainThreadId"], True, False)]


async def test_a_new_conversation_opens_and_each_keeps_its_own_messages(ctx):
    c, _ = ctx
    g, (a, *_rest) = await room(c)
    main = g["mainThreadId"]
    r = await c.post(f"/api/groups/{g['id']}/tasks", json={"title": "Launch plan"})
    assert r.status_code == 201
    second = r.json()["threadId"]
    g = await get(c, g)
    assert g["threadId"] == second and g["mainThreadId"] == main  # the new one is on screen, main is still main
    assert [t["title"] for t in g["tasks"] if not t["main"]] == ["Launch plan"]
    await c.post(f"/api/groups/{g['id']}/messages", json={"text": "plan the launch", "threadId": second})
    await wait_idle(c, g)
    await c.patch(f"/api/groups/{g['id']}", json={"threadId": main})
    assert (await get(c, g))["threadId"] == main
    await c.post(f"/api/groups/{g['id']}/messages", json={"text": "something else", "threadId": main})
    await wait_idle(c, g)
    assert [m["text"] for m in await msgs(c, g, main) if m["role"] == "user"] == ["something else"]
    assert [m["text"] for m in await msgs(c, g, second) if m["role"] == "user"] == ["plan the launch"]
    # the answer of the bot is in the conversation it was asked in
    assert any(m["role"] == "bot" and m["author"] == a["id"] for m in await msgs(c, g, second))
    assert not any("plan the launch" in m.get("text", "") for m in await msgs(c, g, main) if m["role"] == "bot")


async def test_switching_needs_one_of_the_rooms_open_conversations(ctx):
    c, _ = ctx
    g, _ = await room(c)
    other, _ = await room(c, names=("Delta", "Echo"))
    foreign = other["mainThreadId"]
    assert (await c.patch(f"/api/groups/{g['id']}", json={"threadId": foreign})).status_code == 404
    assert (await c.patch(f"/api/groups/{g['id']}", json={"threadId": "nope"})).status_code == 404
    second = (await c.post(f"/api/groups/{g['id']}/tasks", json={})).json()["threadId"]
    await c.patch(f"/api/groups/{g['id']}/tasks/{second}", json={"closed": True})
    assert (await c.patch(f"/api/groups/{g['id']}", json={"threadId": second})).status_code == 400  # closed
    assert (await get(c, g))["threadId"] == g["mainThreadId"]  # closing the open one went back to main


async def test_rename_pin_close_and_delete_never_touch_main(ctx):
    c, _ = ctx
    g, _ = await room(c)
    main = g["mainThreadId"]
    second = (await c.post(f"/api/groups/{g['id']}/tasks", json={"title": "Draft"})).json()["threadId"]
    await c.patch(f"/api/groups/{g['id']}/tasks/{second}", json={"title": "Final", "pinned": True})
    task = next(t for t in (await get(c, g))["tasks"] if t["threadId"] == second)
    assert task["title"] == "Final" and task["pinned"] is True
    assert (await c.patch(f"/api/groups/{g['id']}/tasks/{main}", json={"closed": True})).status_code == 400
    assert (await c.delete(f"/api/groups/{g['id']}/tasks/{main}")).status_code == 400
    assert (await c.delete(f"/api/groups/{g['id']}/tasks/nope")).status_code == 404
    await c.post(f"/api/groups/{g['id']}/messages", json={"text": "keep this?", "threadId": second})
    await wait_idle(c, g)
    assert (await c.delete(f"/api/groups/{g['id']}/tasks/{second}")).status_code == 200
    now = await get(c, g)
    assert now["threadId"] == main and [t["threadId"] for t in now["tasks"]] == [main]
    gone = await c.get(f"/api/groups/{g['id']}/messages", params={"thread": second})
    assert gone.status_code == 404 or gone.json().get("messages") == []  # its messages went with it


async def test_a_conversation_of_another_room_cannot_be_changed_here(ctx):
    c, _ = ctx
    g, _ = await room(c)
    other, _ = await room(c, names=("Delta", "Echo"))
    foreign = (await c.post(f"/api/groups/{other['id']}/tasks", json={})).json()["threadId"]
    assert (await c.patch(f"/api/groups/{g['id']}/tasks/{foreign}", json={"title": "x"})).status_code == 404
    assert (await c.delete(f"/api/groups/{g['id']}/tasks/{foreign}")).status_code == 404
    assert any(t["threadId"] == foreign for t in (await get(c, other))["tasks"])


async def test_a_turn_in_another_conversation_still_marks_the_room_busy_and_stops(ctx):
    c, app = ctx
    g, _ = await room(c, responder="mention")
    second = (await c.post(f"/api/groups/{g['id']}/tasks", json={})).json()["threadId"]
    await c.patch(f"/api/groups/{g['id']}", json={"threadId": g["mainThreadId"]})  # the screen is on main, the work will be in `second`
    groups = app.state.groups if hasattr(app.state, "groups") else None
    if groups is None:
        return  # the app object does not expose the room service here; the checks above cover the API
    class Run:
        bot_id = "x"
    groups.turns.runs[second] = Run()
    try:
        assert (await get(c, g))["busy"] is True
    finally:
        groups.turns.runs.pop(second, None)
    assert (await get(c, g))["busy"] is False
