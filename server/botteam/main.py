from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from .bus import Bus
from .drivers.echo import EchoDriver
from .store import Store, data_dir
from .turns import Turns
from .wire import CreateBot, OrderBody, PatchBot, SendMessage

CONFIG_FRAME = {"kind": "config", "version": "0.1.0", "needsSetup": False}
INSTANCES = [
    {
        "id": "echo", "driver": "echo", "displayName": "Echo (demo)",
        "snapshot": {"state": "available", "version": "0.1.0"},
        "models": [{"id": "echo-1", "label": "Echo 1", "default": True}],
    }
]


def create_app(db_path: str | None = None) -> FastAPI:
    store = Store(db_path or data_dir() / "messages.db")
    bus = Bus()
    driver = EchoDriver()
    turns = Turns(store, bus, driver)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await store.open()
        yield
        await driver.stop_all()
        await store.close()

    app = FastAPI(title="BotTeam", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware, allow_origins=[r"http://127.0.0.1:5299", "http://localhost:5299"],
        allow_methods=["*"], allow_headers=["*"],
    )

    async def need(bot_id: str):
        bot = await store.get_bot(bot_id)
        if not bot:
            raise HTTPException(404, "bot not found")
        return bot

    @app.get("/api/config")
    async def config():
        return CONFIG_FRAME

    @app.get("/api/instances")
    async def instances():
        return {"instances": INSTANCES}

    @app.get("/api/bots")
    async def list_bots():
        return {"bots": [b.model_dump() for b in await store.list_bots()]}

    @app.post("/api/bots", status_code=201)
    async def create_bot(body: CreateBot):
        bot = await store.create_bot(body.name.strip(), body.title, body.description, body.color)
        bus.publish({"kind": "bot", "bot": bot.model_dump()})
        return bot.model_dump()

    @app.patch("/api/bots/{bot_id}")
    async def patch_bot(bot_id: str, body: PatchBot):
        bot = await need(bot_id)
        for k, v in body.model_dump(exclude_unset=True).items():
            setattr(bot, k, v)
        if body.modelSelection:
            bot.modelSelection = body.modelSelection
        await store.save_bot(bot)
        bus.publish({"kind": "bot", "bot": bot.model_dump()})
        return bot.model_dump()

    @app.delete("/api/bots/{bot_id}")
    async def delete_bot(bot_id: str):
        bot = await need(bot_id)
        await turns.interrupt(bot)
        await store.delete_bot(bot_id)
        bus.publish({"kind": "bot.deleted", "botId": bot_id})
        return {"ok": True}

    @app.put("/api/bots/order")
    async def order(body: OrderBody):
        await store.set_order(body.botIds)
        bus.publish({"kind": "bots.order", "botIds": body.botIds})
        return {"ok": True}

    @app.get("/api/bots/{bot_id}/messages")
    async def messages(bot_id: str, before: str | None = None):
        await need(bot_id)
        items, more = await store.page(bot_id, before)
        return {"messages": [m.model_dump() for m in items], "hasMore": more}

    @app.post("/api/bots/{bot_id}/messages", status_code=202)
    async def send(bot_id: str, body: SendMessage):
        bot = await need(bot_id)
        try:
            msg = await turns.send(bot, body.text, body.sendId)
        except RuntimeError:
            raise HTTPException(409, "bot is busy")
        return {"message": msg.model_dump()}

    @app.post("/api/bots/{bot_id}/interrupt")
    async def interrupt(bot_id: str):
        await turns.interrupt(await need(bot_id))
        return {"ok": True}

    @app.post("/api/bots/{bot_id}/read")
    async def read(bot_id: str):
        bot = await need(bot_id)
        if bot.unread:
            bot.unread = False
            await store.save_bot(bot)
            bus.publish({"kind": "bot", "bot": bot.model_dump()})
        return {"ok": True}

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

    return app


app = create_app()
