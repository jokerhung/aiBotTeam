from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from .bus import Bus
from .config import ConfigStore
from .registry import Registry
from .store import Store, data_dir, now_ms
from .turns import Turns
from .wire import (
    CreateBot, CreateInstance, CreateTask, LeafBody, OrderBody, PatchBot, PatchInstance, PatchTask, SendMessage,
)

WEB_PORT = os.environ.get("WEB_PORT", "5299")

CONFIG_FRAME = {"kind": "config", "version": "0.2.0", "needsSetup": False}


def create_app(db_path: str | None = None, home: Path | None = None, with_echo: bool = True) -> FastAPI:
    home = home or data_dir()
    store = Store(db_path or home / "messages.db")
    bus = Bus()
    config = ConfigStore(home / "config.json")
    registry = Registry(config, with_echo=with_echo)
    turns = Turns(store, bus, registry, home / "threads")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await store.open()
        await registry.load()
        turns.start()
        yield
        await turns.stop()
        await registry.stop_all()
        await store.close()

    app = FastAPI(title="BotTeam", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware, allow_origins=[f"http://127.0.0.1:{WEB_PORT}", f"http://localhost:{WEB_PORT}"],
        allow_methods=["*"], allow_headers=["*"],
    )

    async def need(bot_id: str):
        bot = await store.get_bot(bot_id)
        if not bot:
            raise HTTPException(404, "bot not found")
        return bot

    async def need_thread(bot, thread_id: str | None) -> str:
        tid = thread_id or bot.threadId
        t = await store.get_thread(tid)
        if not t or t["botId"] != bot.id:
            raise HTTPException(404, "conversation not found")
        return tid

    # ---- config & instances -------------------------------------------------------
    @app.get("/api/config")
    async def get_config():
        return {**CONFIG_FRAME, "defaultSelection": registry.default_selection()}

    @app.get("/api/instances")
    async def instances():
        return {"instances": [i.public() for i in registry.instances.values()]}

    @app.post("/api/instances", status_code=201)
    async def add_instance(body: CreateInstance):
        inst = await registry.add_openai_compat(body.displayName, body.baseUrl, body.apiKey, body.models)
        bus.publish({"kind": "instances"})
        return inst.public()

    @app.patch("/api/instances/{iid}")
    async def patch_instance(iid: str, body: PatchInstance):
        inst = registry.patch(iid, **body.model_dump(exclude_unset=True))
        if not inst:
            raise HTTPException(404, "engine not found")
        if body.path is not None:
            inst = await registry.check(iid)
        bus.publish({"kind": "instances"})
        return inst.public()

    @app.post("/api/instances/{iid}/check")
    async def check_instance(iid: str):
        inst = await registry.check(iid)
        if not inst:
            raise HTTPException(404, "engine not found")
        bus.publish({"kind": "instances"})
        return inst.public()

    # ---- bots ---------------------------------------------------------------------
    @app.get("/api/bots")
    async def list_bots():
        return {"bots": [await turns.bot_dict(b) for b in await store.list_bots()]}

    @app.post("/api/bots", status_code=201)
    async def create_bot(body: CreateBot):
        sel = (body.modelSelection.model_dump() if body.modelSelection else registry.default_selection())
        bot = await store.create_bot(body.name.strip(), body.title, body.description, body.color, sel)
        await turns.publish_bot(bot)
        return await turns.bot_dict(bot)

    @app.patch("/api/bots/{bot_id}")
    async def patch_bot(bot_id: str, body: PatchBot):
        bot = await need(bot_id)
        fields = body.model_dump(exclude_unset=True)
        if "threadId" in fields:
            fields["threadId"] = await need_thread(bot, fields["threadId"])
        for k, v in fields.items():
            if k != "modelSelection":
                setattr(bot, k, v)
        if body.modelSelection:
            bot.modelSelection = body.modelSelection
        await store.save_bot(bot)
        await turns.publish_bot(bot)
        return await turns.bot_dict(bot)

    @app.delete("/api/bots/{bot_id}")
    async def delete_bot(bot_id: str):
        bot = await need(bot_id)
        for t in await store.list_threads(bot_id):
            await turns.interrupt(bot, t["id"])
        await store.delete_bot(bot_id)
        bus.publish({"kind": "bot.deleted", "botId": bot_id})
        return {"ok": True}

    @app.put("/api/bots/order")
    async def order(body: OrderBody):
        await store.set_order(body.botIds)
        bus.publish({"kind": "bots.order", "botIds": body.botIds})
        return {"ok": True}

    @app.post("/api/bots/{bot_id}/read")
    async def read(bot_id: str):
        bot = await need(bot_id)
        if bot.unread:
            bot.unread, bot.readAt = False, now_ms()
            await store.save_bot(bot)
            await turns.publish_bot(bot)
        return {"ok": True}

    # ---- messages -------------------------------------------------------------------
    @app.get("/api/bots/{bot_id}/messages")
    async def messages(bot_id: str, before: str | None = None, thread: str | None = None):
        bot = await need(bot_id)
        tid = await need_thread(bot, thread)
        items, more = await store.page(tid, before)
        return {"threadId": tid, "messages": [m.model_dump() for m in items], "hasMore": more}

    @app.post("/api/bots/{bot_id}/messages", status_code=202)
    async def send(bot_id: str, body: SendMessage):
        bot = await need(bot_id)
        tid = await need_thread(bot, body.threadId)
        try:
            msg = await turns.send(bot, tid, body.text, body.sendId, branch=body.branch, parent_id=body.parentId)
        except RuntimeError:
            raise HTTPException(409, "the bot is still answering")
        await turns.publish_bot(bot)
        return {"message": msg.model_dump()}

    @app.post("/api/bots/{bot_id}/interrupt")
    async def interrupt(bot_id: str, thread: str | None = None):
        bot = await need(bot_id)
        await turns.interrupt(bot, await need_thread(bot, thread))
        return {"ok": True}

    @app.delete("/api/bots/{bot_id}/queue/{message_id}")
    async def drop_queued(bot_id: str, message_id: str, thread: str | None = None):
        bot = await need(bot_id)
        if not await turns.drop_queued(bot_id, await need_thread(bot, thread), message_id):
            raise HTTPException(404, "that message is not waiting")
        return {"ok": True}

    # ---- tasks (conversations) -----------------------------------------------------
    @app.get("/api/bots/{bot_id}/tasks")
    async def tasks(bot_id: str):
        bot = await need(bot_id)
        return {"tasks": (await turns.bot_dict(bot))["tasks"]}

    @app.post("/api/bots/{bot_id}/tasks", status_code=201)
    async def create_task(bot_id: str, body: CreateTask):
        bot = await need(bot_id)
        t = await store.create_thread(bot_id, body.title)
        bot.threadId = t["id"]
        await store.save_bot(bot)
        await turns.publish_bot(bot)
        return {"threadId": t["id"]}

    @app.patch("/api/bots/{bot_id}/tasks/{thread_id}")
    async def patch_task(bot_id: str, thread_id: str, body: PatchTask):
        bot = await need(bot_id)
        tid = await need_thread(bot, thread_id)
        await store.patch_thread(tid, **body.model_dump(exclude_unset=True))
        if body.closed and bot.threadId == tid:
            bot.threadId = bot.mainThreadId
            await store.save_bot(bot)
        await turns.publish_bot(bot)
        return {"ok": True}

    @app.delete("/api/bots/{bot_id}/tasks/{thread_id}")
    async def delete_task(bot_id: str, thread_id: str):
        bot = await need(bot_id)
        tid = await need_thread(bot, thread_id)
        if tid == bot.mainThreadId:
            raise HTTPException(400, "the main conversation cannot be deleted")
        await turns.interrupt(bot, tid)
        await store.delete_thread(tid)
        if bot.threadId == tid:
            bot.threadId = bot.mainThreadId
            await store.save_bot(bot)
        await turns.publish_bot(bot)
        return {"ok": True}

    # ---- branches & inspector ---------------------------------------------------------
    @app.put("/api/threads/{thread_id}/leaf")
    async def set_leaf(thread_id: str, body: LeafBody):
        t = await store.get_thread(thread_id)
        if not t:
            raise HTTPException(404, "conversation not found")
        if thread_id in turns.runs:
            raise HTTPException(409, "the bot is still answering")
        msg = await store.get_message(body.messageId)
        if not msg:
            raise HTTPException(404, "message not found")
        leaf = await store.leaf_of_branch(body.messageId)
        await store.patch_thread(thread_id, leafId=leaf)
        bus.publish({"kind": "thread", "botId": t["botId"], "threadId": thread_id, "activeLeafId": leaf})
        return {"activeLeafId": leaf}

    @app.get("/api/threads/{thread_id}/events")
    async def thread_events(thread_id: str, limit: int = 500):
        path = turns.log_dir / f"{thread_id}.ndjson"
        if not path.exists():
            return {"events": []}
        lines = path.read_text(encoding="utf8").splitlines()[-limit:]
        return {"events": [json.loads(x) for x in lines if x]}

    # ---- live stream ------------------------------------------------------------------
    @app.get("/api/events")
    async def events():
        async def gen():
            yield {"data": json.dumps(CONFIG_FRAME)}
            stream = bus.subscribe()
            nxt = asyncio.ensure_future(stream.__anext__())
            try:
                while True:
                    done, _ = await asyncio.wait({nxt}, timeout=15)
                    if not done:
                        yield {"event": "ping", "data": "{}"}
                        continue
                    frame = nxt.result()
                    nxt = asyncio.ensure_future(stream.__anext__())
                    yield {"data": json.dumps(frame)}
            finally:
                nxt.cancel()
                await stream.aclose()

        return EventSourceResponse(gen(), ping=None)

    app.state.turns, app.state.registry, app.state.store = turns, registry, store
    _ = now_ms
    return app


app = create_app()
