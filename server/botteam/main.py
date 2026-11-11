from __future__ import annotations

import asyncio
import json
import re
import secrets
import mimetypes
from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from .approval import is_mode
from .broker import Broker
from .bus import Bus
from .config import ConfigStore
from .registry import KEY_CATALOG, KEY_IDS, Registry
from .agents import AgentTools
from .host import RuntimeHost
from .routines import Scheduler, next_run_after, valid_schedule
from .runtime import Runtime
from .store import Store, data_dir, now_ms
from .turns import Turns
from .wire import (
    BotDefaults, ConfigPatch, CreateBot, NoteBody, RoutineBody, CreateInstance, CreateTask, LeafBody, MoveBot, OrderBody, PatchBot,
    PatchInstance, PatchSection, PatchTask, RequestAnswer, SectionBody, SendMessage,
)

FILE_MAX_BYTES = 100 * 1024 * 1024
DEFAULT_SETTINGS = {
    "displayName": "", "uiMode": "simple", "skin": "daylight", "font": "skin", "chatWidth": "default",
    "reduceMotion": False, "language": "en",
}

WEB_PORT = os.environ.get("WEB_PORT", "5299")

CONFIG_FRAME = {"kind": "config", "version": "0.2.0", "needsSetup": False}


def create_app(db_path: str | None = None, home: Path | None = None, with_echo: bool = True) -> FastAPI:
    home = home or data_dir()
    store = Store(db_path or home / "messages.db")
    bus = Bus()
    config = ConfigStore(home / "config.json")
    registry = Registry(config, with_echo=with_echo)
    turns_ref: list[Turns] = []

    async def policy(thread_id: str):
        return await turns_ref[0].policy(thread_id)

    async def _noop(_t: str, _r: dict) -> None:
        return None

    broker = Broker(config, policy, _noop, _noop)
    registry.broker = broker
    turns = Turns(store, bus, registry, home / "threads", broker=broker, attachments_dir=home / "attachments")
    turns_ref.append(turns)
    scheduler = Scheduler(store, turns)
    host = RuntimeHost(store, turns, registry, bus)
    runtime = Runtime(str(home / "runtime.db"), host)
    host.runtime, turns.runtime, turns.host = runtime, runtime, host
    agents = AgentTools(store, turns, runtime, host)
    broker.agent_call = agents.call
    registry.agents = agents
    attachments_dir = home / "attachments"
    broker.read_dirs.append(str(attachments_dir))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await store.open()
        await store.expire_open_requests()
        await broker.start()
        await host.refresh()
        await registry.load()
        await runtime.open()
        await runtime.recover()  # a cut turn runs again at most once, and never after it acted outward
        runtime.start()
        turns.start()
        scheduler.start()
        yield
        await scheduler.stop()
        await runtime.close()
        await turns.stop()
        await broker.stop()
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
    def public_config() -> dict:
        """Settings and which keys are saved. Key values never leave the server."""
        return {
            **CONFIG_FRAME, "defaultSelection": registry.default_selection(),
            "settings": {**DEFAULT_SETTINGS, **config.data.get("settings", {})},
            "keys": registry.key_status(),
            "keyCatalog": [{"id": k["id"], "label": k["label"], "purpose": k["purpose"]} for k in KEY_CATALOG],
            "botDefaults": config.data.get("botDefaults", {}),
        }

    @app.get("/api/config")
    async def get_config():
        return public_config()

    @app.put("/api/config")
    async def put_config(body: ConfigPatch):
        fields = body.model_dump(exclude_unset=True)
        keys = fields.pop("keys", None) or {}
        unknown = [k for k in keys if k not in KEY_IDS]
        if unknown:
            raise HTTPException(400, f"unknown key: {unknown[0]}")
        settings = config.data.setdefault("settings", {})
        settings.update({k: v for k, v in fields.items() if v is not None})
        config.save()
        for kid, value in keys.items():
            await registry.set_key(kid, value)
        if keys:
            bus.publish({"kind": "instances"})
        out = public_config()
        bus.publish({"kind": "config", **out})
        return out

    @app.get("/api/bot-defaults")
    async def get_bot_defaults():
        return {**{"modelSelection": registry.default_selection(), "approvalMode": "full", "cwd": None},
                **config.data.get("botDefaults", {})}

    @app.put("/api/bot-defaults")
    async def put_bot_defaults(body: BotDefaults):
        fields = body.model_dump(exclude_unset=True)
        if fields.get("approvalMode") is not None and not is_mode(fields["approvalMode"]):
            raise HTTPException(400, "unknown approval mode")
        config.data.setdefault("botDefaults", {}).update(fields)
        config.save()
        return await get_bot_defaults()

    @app.get("/api/command-allowlist")
    async def allowlist():
        return {"rules": broker.rules, "supported": True}

    @app.delete("/api/command-allowlist/{rule_id}")
    async def delete_rule(rule_id: str):
        if not broker.remove_rule(rule_id):
            raise HTTPException(404, "rule not found")
        return {"ok": True}

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
        defaults = config.data.get("botDefaults", {})
        sel = (body.modelSelection.model_dump() if body.modelSelection
               else defaults.get("modelSelection") or registry.default_selection())
        mode = body.approvalMode or defaults.get("approvalMode") or "full"
        if not is_mode(mode):
            raise HTTPException(400, "unknown approval mode")
        bot = await store.create_bot(body.name.strip(), body.title, body.description, body.color, sel)
        bot.approvalMode, bot.cwd = mode, body.cwd or defaults.get("cwd")
        await store.save_bot(bot)
        await turns.publish_bot(bot)
        return await turns.bot_dict(bot)

    @app.patch("/api/bots/{bot_id}")
    async def patch_bot(bot_id: str, body: PatchBot):
        bot = await need(bot_id)
        fields = body.model_dump(exclude_unset=True)
        if fields.get("approvalMode") is not None and not is_mode(fields["approvalMode"]):
            raise HTTPException(400, "unknown approval mode")
        if fields.get("section"):
            if not any(sec["id"] == fields["section"] for sec in await store.list_sections()):
                raise HTTPException(404, "section not found")
        if "threadId" in fields:
            fields["threadId"] = await need_thread(bot, fields["threadId"])
        for k, v in fields.items():
            if k not in ("modelSelection", "fallbackSelection"):
                setattr(bot, k, v)
        if body.modelSelection:
            bot.modelSelection = body.modelSelection
        if "fallbackSelection" in fields:
            bot.fallbackSelection = body.fallbackSelection
        await store.save_bot(bot)
        if fields.get("chief"):  # one Chief of Staff at a time
            for other in await store.list_bots():
                if other.id != bot.id and other.chief:
                    other.chief = False
                    await store.save_bot(other)
                    await turns.publish_bot(other)
        await turns.publish_bot(bot)
        return await turns.bot_dict(bot)

    @app.delete("/api/bots/{bot_id}")
    async def delete_bot(bot_id: str):
        bot = await need(bot_id)
        host.forget(bot_id)
        for t in await store.list_threads(bot_id):
            await turns.interrupt(bot, t["id"])
            await broker.cancel_thread(t["id"])
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
            msg = await turns.send(bot, tid, body.text, body.sendId, branch=body.branch, parent_id=body.parentId,
                                   attachments=body.attachments)
        except RuntimeError:
            raise HTTPException(409, "the bot is still answering")
        except ValueError as e:
            raise HTTPException(400, str(e))
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

    @app.post("/api/bots/{bot_id}/fresh")
    async def start_fresh(bot_id: str, thread: str | None = None):
        bot = await need(bot_id)
        tid = await need_thread(bot, thread)
        if tid in turns.runs:
            raise HTTPException(409, "the bot is still answering")
        await store.reset_cursor(tid)
        inst = registry.get(bot.modelSelection.instanceId)
        if inst and inst.driver and hasattr(inst.driver, "_close"):
            await inst.driver._close(tid, settle=False)
        return {"ok": True}

    # ---- permission requests ------------------------------------------------------------
    @app.post("/api/threads/{thread_id}/requests/{request_id}")
    async def answer_request(thread_id: str, request_id: str, body: RequestAnswer):
        t = await store.get_thread(thread_id)
        if not t:
            raise HTTPException(404, "conversation not found")
        if not any(r["id"] == request_id for r in broker.open_for(thread_id)):
            raise HTTPException(404, "that request is no longer open")
        ok = await broker.resolve(request_id, body.behavior, body.message, body.always, body.answers)
        if not ok:
            raise HTTPException(409, "that request was already answered")
        return {"ok": True}

    # ---- bot management -------------------------------------------------------------------
    @app.post("/api/bots/{bot_id}/duplicate", status_code=201)
    async def duplicate_bot(bot_id: str):
        await need(bot_id)
        bot = await store.duplicate_bot(bot_id)
        assert bot
        await turns.publish_bot(bot)
        return await turns.bot_dict(bot)

    @app.get("/api/sidebar-sections")
    async def sections():
        return {"sections": await store.list_sections()}

    async def publish_sections() -> dict:
        out = {"sections": await store.list_sections()}
        bus.publish({"kind": "sections", **out})
        return out

    @app.post("/api/sidebar-sections", status_code=201)
    async def create_section(body: SectionBody):
        sec = await store.create_section(body.name.strip())
        await publish_sections()
        return sec

    @app.patch("/api/sidebar-sections/{sid}")
    async def patch_section(sid: str, body: PatchSection):
        if not await store.patch_section(sid, body.name.strip() if body.name else None, body.collapsed):
            raise HTTPException(404, "section not found")
        return await publish_sections()

    @app.delete("/api/sidebar-sections/{sid}")
    async def delete_section(sid: str):
        if not await store.delete_section(sid):
            raise HTTPException(404, "section not found")
        for b in await store.list_bots():
            await turns.publish_bot(b)
        return await publish_sections()

    @app.post("/api/bots/{bot_id}/move")
    async def move_bot(bot_id: str, body: MoveBot):
        bot = await need(bot_id)
        if body.section and not any(sec["id"] == body.section for sec in await store.list_sections()):
            raise HTTPException(404, "section not found")
        bot.section = body.section
        await store.save_bot(bot)
        if body.botIds:
            await store.set_order(body.botIds)
            bus.publish({"kind": "bots.order", "botIds": body.botIds})
        await turns.publish_bot(bot)
        return await turns.bot_dict(bot)

    # ---- computer (the bot's working folder, read-only) --------------------------------------------
    @app.get("/api/bots/{bot_id}/files")
    async def bot_files(bot_id: str, path: str = ""):
        bot = await need(bot_id)
        root = Path(bot.cwd or os.getcwd()).resolve()
        target = (root / path).resolve()
        if target != root and root not in target.parents:  # never outside the working folder
            raise HTTPException(400, "that path is outside the working folder")
        if not target.is_dir():
            raise HTTPException(404, "folder not found")
        entries = []
        try:
            for child in sorted(target.iterdir(), key=lambda c: (not c.is_dir(), c.name.lower()))[:300]:
                try:
                    st = child.stat()
                except OSError:
                    continue
                entries.append({"name": child.name, "dir": child.is_dir(), "size": 0 if child.is_dir() else st.st_size, "at": int(st.st_mtime * 1000)})
        except PermissionError:
            raise HTTPException(403, "that folder cannot be read")
        rel = "" if target == root else target.relative_to(root).as_posix()
        return {"root": str(root), "path": rel, "entries": entries}

    # ---- library (notes the bot keeps) ------------------------------------------------------------
    @app.get("/api/bots/{bot_id}/library")
    async def library(bot_id: str):
        await need(bot_id)
        return {"notes": await store.list_notes(bot_id)}

    @app.post("/api/bots/{bot_id}/library", status_code=201)
    async def add_note(bot_id: str, body: NoteBody):
        await need(bot_id)
        return await store.create_note(bot_id, body.title or "Untitled", body.text or "")

    @app.patch("/api/bots/{bot_id}/library/{note_id}")
    async def patch_note(bot_id: str, note_id: str, body: NoteBody):
        if not await store.patch_note(bot_id, note_id, body.title, body.text):
            raise HTTPException(404, "note not found")
        return {"ok": True}

    @app.delete("/api/bots/{bot_id}/library/{note_id}")
    async def delete_note(bot_id: str, note_id: str):
        if not await store.delete_note(bot_id, note_id):
            raise HTTPException(404, "note not found")
        return {"ok": True}

    # ---- routines (a message sent to the bot on a schedule) --------------------------------------------
    @app.get("/api/bots/{bot_id}/routines")
    async def routines(bot_id: str):
        await need(bot_id)
        return {"routines": await store.list_routines(bot_id)}

    @app.post("/api/bots/{bot_id}/routines", status_code=201)
    async def add_routine(bot_id: str, body: RoutineBody):
        await need(bot_id)
        kind = body.kind or "interval"
        why = valid_schedule(kind, body.everyMin, body.at)
        if why or not body.text:
            raise HTTPException(400, why or "a routine needs a message")
        nxt = next_run_after(kind, body.everyMin, body.at, now_ms())
        return await store.create_routine(bot_id, (body.title or body.text)[:60], body.text, kind, body.everyMin, body.at, nxt)

    @app.patch("/api/bots/{bot_id}/routines/{routine_id}")
    async def patch_routine(bot_id: str, routine_id: str, body: RoutineBody):
        cur = await store.get_routine(bot_id, routine_id)
        if not cur:
            raise HTTPException(404, "routine not found")
        f = body.model_dump(exclude_unset=True)
        kind, every, at = f.get("kind", cur["kind"]), f.get("everyMin", cur["everyMin"]), f.get("at", cur["at"])
        if {"kind", "everyMin", "at"} & f.keys():
            why = valid_schedule(kind, every, at)
            if why:
                raise HTTPException(400, why)
            f["nextRun"] = next_run_after(kind, every, at, now_ms())
        if f.get("enabled") is True and not cur["enabled"]:
            f["nextRun"] = next_run_after(kind, every, at, now_ms())
        await store.update_routine(bot_id, routine_id, **f)
        return await store.get_routine(bot_id, routine_id)

    @app.delete("/api/bots/{bot_id}/routines/{routine_id}")
    async def delete_routine(bot_id: str, routine_id: str):
        if not await store.delete_routine(bot_id, routine_id):
            raise HTTPException(404, "routine not found")
        return {"ok": True}

    @app.post("/api/bots/{bot_id}/routines/{routine_id}/run")
    async def run_routine(bot_id: str, routine_id: str):
        cur = await store.get_routine(bot_id, routine_id)
        if not cur:
            raise HTTPException(404, "routine not found")
        if not await scheduler.fire(cur):
            raise HTTPException(409, "the bot is still answering")
        return await store.get_routine(bot_id, routine_id)

    # ---- work handed between bots (the job runtime) --------------------------------------------------------------
    @app.get("/api/assignments")
    async def assignments(root: str | None = None):
        rows = await runtime.all(root)
        return {"assignments": [runtime.public(a) | {"requester": a["requester"], "origin": a["origin"], "brief": a["brief"]} for a in rows if not a["host_turn"] or a["children_since_turn"] or any(k["parent_id"] == a["id"] for k in rows)]}

    @app.get("/api/assignments/{aid}")
    async def assignment(aid: str):
        a = await runtime.get(aid)
        if not a:
            raise HTTPException(404, "assignment not found")
        return {"assignment": runtime.public(a), "events": await runtime.events(aid), "children": [runtime.public(k) for k in await runtime.children(aid)]}

    @app.post("/api/assignments/{aid}/cancel")
    async def cancel_assignment(aid: str):
        if not await runtime.get(aid):
            raise HTTPException(404, "assignment not found")
        return {"stopped": await runtime.cancel(aid)}

    # ---- search -------------------------------------------------------------------------------
    @app.get("/api/search")
    async def search(q: str = "", limit: int = 30):
        results = await store.search(q, min(max(limit, 1), 100))
        names = {b.id: b.name for b in await store.list_bots()}
        return {"results": [{**r, "botName": names.get(r["botId"], "")} for r in results]}

    # ---- attachments ---------------------------------------------------------------------------
    @app.post("/api/attachments", status_code=201)
    async def upload(request: Request):
        raw = request.headers.get("x-filename", "file")
        try:
            from urllib.parse import unquote
            filename = unquote(raw)
        except Exception:
            filename = raw
        filename = re.sub(r"[\\/\x00-\x1f]", "_", filename)[:120] or "file"
        mime = (request.headers.get("content-type") or mimetypes.guess_type(filename)[0] or "application/octet-stream").split(";")[0]
        ext = re.sub(r"[^A-Za-z0-9]", "", Path(filename).suffix)[:8]
        name = f"att_{secrets.token_hex(8)}" + (f".{ext}" if ext else "")
        attachments_dir.mkdir(parents=True, exist_ok=True)
        path, size = attachments_dir / name, 0
        try:
            with open(path, "wb") as f:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > FILE_MAX_BYTES:
                        raise HTTPException(413, f"files are limited to {FILE_MAX_BYTES // (1024 * 1024)} MB")
                    f.write(chunk)
            if size == 0:
                raise HTTPException(400, "the file is empty")
        except Exception:
            path.unlink(missing_ok=True)
            raise
        (attachments_dir / f"{name}.json").write_text(json.dumps({"filename": filename, "mime": mime}), encoding="utf8")
        info = turns.attachment_meta(name)
        assert info
        return info.model_dump()

    @app.get("/api/attachments/{name}")
    async def download(name: str):
        info = turns.attachment_meta(name)  # only a plain name inside the store resolves
        if not info:
            raise HTTPException(404, "attachment not found")
        safe_inline = info.mime in ("image/png", "image/jpeg", "image/gif", "image/webp")  # anything else downloads, never renders
        return FileResponse(attachments_dir / name, media_type=info.mime if safe_inline else "application/octet-stream",
                            filename=None if safe_inline else info.filename,
                            headers={"x-content-type-options": "nosniff", "content-security-policy": "sandbox"})

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

    app.state.turns, app.state.registry, app.state.store, app.state.broker = turns, registry, store, broker
    app.state.scheduler = scheduler
    app.state.runtime, app.state.host, app.state.agents = runtime, host, agents
    _ = now_ms
    return app


app = create_app()
