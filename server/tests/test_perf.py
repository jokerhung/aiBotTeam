"""Load: ten bots streaming at once, and a long transcript paged from the database."""
import asyncio
import time

from botteam.store import new_id, now_ms
from botteam.wire import WireMessage

from .test_api import ctx, make_bot  # noqa: F401  (fixture)


async def test_ten_bots_stream_at_once_and_no_listener_loses_a_frame(ctx):
    c, app = ctx
    bots = [await make_bot(c, f"Bot{i}") for i in range(10)]
    seen: dict[str, list[dict]] = {b["id"]: [] for b in bots}
    stream = app.state.turns.bus.subscribe()
    subs_before = len(app.state.turns.bus._subs)

    async def listen():
        async for f in stream:
            if f.get("botId") in seen and f.get("kind") in ("message", "message.patch"):
                seen[f["botId"]].append(f)

    task = asyncio.create_task(listen())
    await asyncio.sleep(0.05)
    assert len(app.state.turns.bus._subs) == subs_before + 1
    t0 = time.time()
    await asyncio.gather(*[c.post(f"/api/bots/{b['id']}/messages", json={"text": f"count to ten, bot {i}", "threadId": b["threadId"]}) for i, b in enumerate(bots)])
    for _ in range(300):
        await asyncio.sleep(0.05)
        if not any(x["busy"] for x in (await c.get("/api/bots")).json()["bots"]):
            break
    took = time.time() - t0
    still = len(app.state.turns.bus._subs) == subs_before + 1
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert still, "the listener was dropped for being too slow: frames were lost"
    for i, b in enumerate(bots):
        frames = seen[b["id"]]
        assert frames, f"bot {i} produced no frames"
        stored = (await c.get(f"/api/bots/{b['id']}/messages", params={"thread": b["threadId"]})).json()["messages"]
        assert any(m["role"] == "bot" and m["text"] for m in stored), f"bot {i} has no reply stored"
        assert not any(m.get("streaming") for m in stored), f"bot {i} is left streaming"
    assert took < 20, f"ten bots took {took:.1f}s"


async def test_a_five_thousand_message_transcript_pages_quickly(ctx):
    c, app = ctx
    bot = await make_bot(c, "Long")
    store = app.state.store
    t0 = time.time()
    parent, last = None, None
    for i in range(5000):
        m = WireMessage(id=new_id("msg"), role="user" if i % 2 == 0 else "bot", kind="text", author=bot["id"], at=now_ms() + i, text=f"line {i} " + "word " * 40)
        await store.db.execute("INSERT INTO messages(id,bot_id,thread_id,parent_id,role,at,seq,body) VALUES(?,?,?,?,?,?,?,?)",
                               (m.id, bot["id"], bot["threadId"], parent, m.role, m.at, i + 1, m.model_dump_json()))
        parent = last = m.id
    await store.db.execute("UPDATE threads SET leaf_id=? WHERE id=?", (last, bot["threadId"]))
    await store.db.commit()
    seeded = time.time() - t0
    t1 = time.time()
    first = (await c.get(f"/api/bots/{bot['id']}/messages", params={"thread": bot["threadId"]})).json()
    newest = time.time() - t1
    assert first["hasMore"] is True and 0 < len(first["messages"]) <= 200
    assert newest < 0.5, f"the newest page took {newest:.2f}s"
    got, before, pages = len(first["messages"]), first["messages"][0]["id"], 1
    t2 = time.time()
    while True:
        page = (await c.get(f"/api/bots/{bot['id']}/messages", params={"thread": bot["threadId"], "before": before})).json()
        got += len(page["messages"])
        pages += 1
        if not page["hasMore"] or not page["messages"]:
            break
        before = page["messages"][0]["id"]
    assert got == 5000, got
    assert (time.time() - t2) / pages < 0.3, "an older page took too long"
    _ = seeded
