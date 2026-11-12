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
from .groups import Groups
from .host import RuntimeHost
from .notifications import Notifications
from .routines import RoutineService
from .composio import Composio, ComposioError, slug_of
from . import teams as teamlib
from . import observe
from .auth import COOKIE, OPEN_PATHS, Pairing
from .backup import BackupError, make_backup
from .memory import Memory, redact
from .skills import SkillError, Skills
from .mcp_servers import McpServers, SpecError, from_desktop_json, public as mcp_public
from .runtime import Runtime
from .webhooks import WebhookService, make_hook_app
from .store import Store, data_dir, now_ms
from .turns import Turns
from pydantic import BaseModel

from .browser import BrowserService, BrowserUnavailable
from .wire import (
    BotDefaults, ConfigPatch, CreateBot, CreateGroup, GroupMessage, NoteBody, PatchGroup, RoutineBody, CreateInstance, CreateTask, LeafBody, MoveBot, OrderBody, PatchBot,
    PatchInstance, PatchSection, PatchTask, RequestAnswer, SectionBody, SendMessage,
)

FILE_MAX_BYTES = 100 * 1024 * 1024
DEFAULT_SETTINGS = {
    "displayName": "", "uiMode": "simple", "skin": "daylight", "font": "skin", "chatWidth": "default",
    "reduceMotion": False, "language": "en",
}

WEB_PORT = os.environ.get("WEB_PORT", "5299")

CONFIG_FRAME = {"kind": "config", "version": "0.2.0", "needsSetup": False}


class ControlBody(BaseModel):
    holder: str  # "person" | "bot"

class InputBody(BaseModel):
    type: str
    x: float | None = None
    y: float | None = None
    text: str | None = None
    key: str | None = None
    dy: float | None = None
    url: str | None = None

class WatchBody(BaseModel):
    on: bool

class ComputerSettings(BaseModel):
    allowLocal: bool


class ComposioKey(BaseModel):
    key: str


class ConnectBody(BaseModel):
    alias: str | None = None


def create_app(db_path: str | None = None, home: Path | None = None, with_echo: bool = True, serve_hooks: bool = False, remote: bool | None = None, web_dir: Path | None = None) -> FastAPI:
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
    host = RuntimeHost(store, turns, registry, bus)
    runtime = Runtime(str(home / "runtime.db"), host)
    host.runtime, turns.runtime, turns.host = runtime, runtime, host
    agents = AgentTools(store, turns, runtime, host)
    groups = Groups(store, turns, bus, registry, host)
    routines = RoutineService(store, turns, bus, groups)
    notify = Notifications(store, bus, turns)
    hook_port = int(os.environ.get("WEBHOOK_PORT") or 8900)
    webhooks = WebhookService(store, turns, bus, port=hook_port)
    webhooks.notify = notify
    hook_state: dict = {}
    pairing = Pairing(required=bool(remote) if remote is not None else os.environ.get("BOTTEAM_REMOTE") == "1")
    mcp = McpServers(store, bus, home)
    turns.mcp = mcp
    turns.config = config
    memory, skills = Memory(home), Skills(home)
    turns.memory, turns.skills = memory, skills
    browser = BrowserService(home, bus, allow_local=bool((config.data.get("browser") or {}).get("allowLocal")) or os.environ.get("BOTTEAM_BROWSER_LOCAL") == "1",
                             channel=os.environ.get("BOTTEAM_BROWSER_CHANNEL") or None)
    turns.browser = browser
    composio = Composio(config, mcp, bus)
    turns.notify, routines.notify = notify, notify
    turns.groups, agents.groups = groups, groups
    turns.routines, agents.routines = routines, routines
    routines.webhooks = webhooks
    broker.agent_call = agents.call
    registry.agents = agents
    attachments_dir = home / "attachments"
    broker.read_dirs.append(str(attachments_dir))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await store.open()
        if pairing.required:
            print(f"\nBotTeam is open to other computers. Pair a browser with this code (valid 10 minutes, once): {pairing.new_code()}\n", flush=True)
        await store.expire_open_requests()
        await broker.start()
        await host.refresh()
        await registry.load()
        await runtime.open()
        groups.decider = config.data.get("decider")
        await runtime.recover()  # a cut turn runs again at most once, and never after it acted outward
        runtime.start()
        turns.start()
        if serve_hooks:  # the receiver: its own port, only /health and /hooks/...
            import uvicorn

            srv = uvicorn.Server(uvicorn.Config(make_hook_app(webhooks), host="127.0.0.1", port=hook_port, log_level="warning", loop="asyncio"))
            hook_state["server"], hook_state["task"] = srv, asyncio.create_task(srv.serve())
        await routines.after_restart()  # nothing missed while the server was off is made up
        routines.start()
        yield
        if hook_state.get("server"):
            hook_state["server"].should_exit = True
            try:
                await asyncio.wait_for(hook_state["task"], 5)
            except Exception:
                pass
        await routines.stop()
        await browser.shutdown()
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

    @app.middleware("http")
    async def require_pairing(request, call_next):
        """Only when the server is open beyond this computer: no session, no API. The UI files themselves are public; they ask for the code."""
        path = request.url.path
        if pairing.required and path.startswith("/api/") and path not in OPEN_PATHS and not pairing.valid(request.cookies.get(COOKIE)):
            from fastapi.responses import JSONResponse

            return JSONResponse({"detail": "pairing required"}, status_code=401)
        return await call_next(request)

    @app.get("/health")
    async def health():
        return {"ok": True}

    @app.get("/api/auth/status")
    async def auth_status(request: Request):
        return {"required": pairing.required, "authenticated": (not pairing.required) or pairing.valid(request.cookies.get(COOKIE))}

    @app.post("/api/auth/pair")
    async def auth_pair(body: dict):
        from fastapi.responses import JSONResponse

        token = pairing.pair(str(body.get("code") or "")) if pairing.required else None
        if not token:
            return JSONResponse({"detail": "that code is not valid"}, status_code=401)
        r = JSONResponse({"ok": True})
        r.set_cookie(COOKIE, token, httponly=True, samesite="lax", max_age=30 * 24 * 3600, path="/")
        return r

    @app.post("/api/auth/logout")
    async def auth_logout(request: Request):
        pairing.revoke(request.cookies.get(COOKIE))
        return {"ok": True}

    @app.get("/api/backup")
    async def download_backup():
        """The data folder as one zip (databases are snapshotted consistently)."""
        import tempfile

        from fastapi.responses import FileResponse

        out = Path(tempfile.mkdtemp()) / f"botteam-backup-{now_ms()}.zip"
        try:
            make_backup(home, out)
        except BackupError as e:
            raise HTTPException(500, str(e))
        return FileResponse(out, media_type="application/zip", filename=out.name)

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
        if body.greet:
            asyncio.create_task(turns.greet(bot))
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
        if fields.get("skills") is not None:
            have = {s["id"] for s in skills.list()}
            if any(x not in have for x in fields["skills"]):
                raise HTTPException(404, "skill not found")
        if fields.get("mcpServers") is not None:
            known = {i for i, _ in await mcp.list()}
            if any(x not in known for x in fields["mcpServers"]):
                raise HTTPException(404, "server not found")
        if fields.get("mcpAccess") is not None:
            for sid, acc in fields["mcpAccess"].items():
                if not isinstance(acc, dict) or acc.get("scope", "read") not in ("read", "write") or acc.get("outbound", "ask") not in ("ask", "allow"):
                    raise HTTPException(400, "access is a scope (read or write) and a policy for sending out (ask or allow)")
            fields["mcpAccess"] = {sid: {"scope": a.get("scope", "read"), "outbound": a.get("outbound", "ask")} for sid, a in fields["mcpAccess"].items()}
        if fields.get("reportsTo"):
            boss, seen = fields["reportsTo"], {bot.id}
            while boss:  # the target must exist and the chain must not come back to this bot
                if boss in seen:
                    raise HTTPException(400, "a bot cannot report to itself or to one that reports to it")
                seen.add(boss)
                up = await store.get_bot(boss)
                if not up:
                    raise HTTPException(404, "bot not found")
                boss = up.reportsTo
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
        await groups.remove_bot(bot_id)
        for t in await store.list_threads(bot_id):
            await turns.interrupt(bot, t["id"])
            await broker.cancel_thread(t["id"])
        for other in await store.list_bots():  # nobody keeps reporting to a bot that is gone
            if other.reportsTo == bot_id:
                other.reportsTo = None
                await store.save_bot(other)
                await turns.publish_bot(other)
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

    # ---- routines ----------------------------------------------------------------------------------------------------
    def routine_args(body: RoutineBody) -> dict:
        f = body.model_dump(exclude_unset=True)
        f["name"] = f.pop("name", None) or f.pop("title", None)
        f.pop("title", None)
        f["prompt"] = f.pop("prompt", None) or f.pop("text", None)
        f.pop("text", None)
        return {k: v for k, v in f.items() if v is not None or k in ("maxRunMin",)}

    async def need_routine(rid: str):
        r = await store.get_routine(rid)
        if not r:
            raise HTTPException(404, "routine not found")
        return r

    async def check_target(kind: str, tid: str):
        ok = (await store.get_bot(tid)) if kind == "bot" else (await store.get_group(tid))
        if not ok:
            raise HTTPException(404, "bot not found" if kind == "bot" else "room not found")

    @app.get("/api/routines")
    async def list_all_routines(target: str | None = None):
        rows = await store.list_routines()
        if target:
            rows = [r for r in rows if r["targetId"] == target]
        return {"routines": [routines.public(r) for r in rows]}

    @app.post("/api/routines", status_code=201)
    async def create_routine(body: RoutineBody):
        f = routine_args(body)
        kind, tid = f.pop("targetKind", None) or "bot", f.pop("targetId", None)
        if not tid:
            raise HTTPException(400, "pick a bot or a room for the routine")
        await check_target(kind, tid)
        try:
            r = await routines.create(target_kind=kind, target_id=tid, name=f.get("name") or "", prompt=f.get("prompt") or "", kind=f.get("kind") or "interval",
                                      every_min=f.get("everyMin"), at=f.get("at"), days=f.get("days"), run_at=f.get("runAt"), tz=f.get("tz"), max_run_min=f.get("maxRunMin"))
        except ValueError as e:
            raise HTTPException(400, str(e))
        return routines.public(r)

    @app.patch("/api/routines/{rid}")
    async def patch_routine(rid: str, body: RoutineBody):
        await need_routine(rid)
        f = routine_args(body)
        f.pop("targetKind", None)
        f.pop("targetId", None)
        try:
            r = await routines.update(rid, **f)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return routines.public(r)  # type: ignore[arg-type]

    @app.delete("/api/routines/{rid}")
    async def delete_routine(rid: str):
        if not await routines.delete(rid):
            raise HTTPException(404, "routine not found")
        return {"ok": True}

    @app.post("/api/routines/{rid}/run")
    async def run_routine(rid: str):
        r = await need_routine(rid)
        run = await routines.start_run(r)
        if run and run["status"] == "skipped":
            raise HTTPException(409, "the previous run is still going")
        return {"run": run, "routine": routines.public(await need_routine(rid))}

    @app.get("/api/routines/{rid}/runs")
    async def routine_runs_of(rid: str, status: str | None = None):
        await need_routine(rid)
        return {"runs": await store.list_runs(rid, status)}

    @app.get("/api/routine-runs")
    async def list_routine_runs(routine: str | None = None, status: str | None = None, since: int | None = None, until: int | None = None):
        return {"runs": await store.list_runs(routine, status, since, until)}

    @app.post("/api/routine-runs/{run_id}/cancel")
    async def cancel_routine_run(run_id: str):
        run = await routines.cancel_run(run_id)
        if not run:
            raise HTTPException(404, "run not found")
        return {"run": run}

    # Phase 3's per-bot routines: the same routines, filtered to one bot
    @app.get("/api/bots/{bot_id}/routines")
    async def bot_routines(bot_id: str):
        await need(bot_id)
        return {"routines": [routines.public(r) for r in await store.list_routines("bot", bot_id)]}

    @app.post("/api/bots/{bot_id}/routines", status_code=201)
    async def add_bot_routine(bot_id: str, body: RoutineBody):
        await need(bot_id)
        f = routine_args(body)
        if not f.get("prompt"):
            raise HTTPException(400, "a routine needs a message")
        try:
            r = await routines.create(target_kind="bot", target_id=bot_id, name=f.get("name") or "", prompt=f["prompt"], kind=f.get("kind") or "interval",
                                      every_min=f.get("everyMin"), at=f.get("at"), days=f.get("days"), run_at=f.get("runAt"), tz=f.get("tz"), max_run_min=f.get("maxRunMin"))
        except ValueError as e:
            raise HTTPException(400, str(e))
        return routines.public(r)

    @app.patch("/api/bots/{bot_id}/routines/{routine_id}")
    async def patch_bot_routine(bot_id: str, routine_id: str, body: RoutineBody):
        r = await store.get_routine(routine_id)
        if not r or r["targetId"] != bot_id:
            raise HTTPException(404, "routine not found")
        f = routine_args(body)
        f.pop("targetKind", None)
        f.pop("targetId", None)
        try:
            out = await routines.update(routine_id, **f)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return routines.public(out)  # type: ignore[arg-type]

    @app.delete("/api/bots/{bot_id}/routines/{routine_id}")
    async def delete_bot_routine(bot_id: str, routine_id: str):
        r = await store.get_routine(routine_id)
        if not r or r["targetId"] != bot_id or not await routines.delete(routine_id):
            raise HTTPException(404, "routine not found")
        return {"ok": True}

    @app.post("/api/bots/{bot_id}/routines/{routine_id}/run")
    async def run_bot_routine(bot_id: str, routine_id: str):
        r = await store.get_routine(routine_id)
        if not r or r["targetId"] != bot_id:
            raise HTTPException(404, "routine not found")
        run = await routines.start_run(r)
        if not run or run["status"] != "running":
            raise HTTPException(409, "the bot is still answering")
        return routines.public(await store.get_routine(routine_id))  # type: ignore[arg-type]

    # ---- rooms (channels with several bots) --------------------------------------------------------------------
    async def need_group(group_id: str):
        g = await store.get_group(group_id)
        if not g:
            raise HTTPException(404, "room not found")
        return g

    @app.get("/api/groups")
    async def list_groups():
        return {"groups": await groups.list()}

    @app.post("/api/groups", status_code=201)
    async def create_group(body: CreateGroup):
        members = await groups.clean_members(body.members)
        if body.leader and body.leader not in members:
            raise HTTPException(400, "the leader must be a member")
        g = await store.create_group(body.name.strip(), members, body.leader or (members[0] if members else None), body.instructions, body.cwd, body.responder)
        await groups.publish(g)
        return await groups.dict_of(g)

    @app.patch("/api/groups/{group_id}")
    async def patch_group(group_id: str, body: PatchGroup):
        g = await need_group(group_id)
        f = body.model_dump(exclude_unset=True)
        if "members" in f:
            g.members = await groups.clean_members(f.pop("members") or [])
            if g.leader not in g.members:
                g.leader = g.members[0] if g.members else None
        if f.get("leader") is not None and f["leader"] not in g.members:
            raise HTTPException(400, "the leader must be a member")
        if f.get("section"):
            if not any(sec["id"] == f["section"] for sec in await store.list_sections()):
                raise HTTPException(404, "section not found")
        for k, v in f.items():
            setattr(g, k, v)
        await store.save_group(g)
        await groups.publish(g)
        return await groups.dict_of(g)

    @app.delete("/api/groups/{group_id}")
    async def delete_group(group_id: str):
        g = await need_group(group_id)
        await groups.stop(g)
        await store.delete_group(group_id)
        bus.publish({"kind": "group.deleted", "groupId": group_id})
        return {"ok": True}

    @app.get("/api/groups/{group_id}/messages")
    async def group_messages(group_id: str, before: str | None = None, thread: str | None = None):
        g = await need_group(group_id)
        tid = thread or g.threadId
        t = await store.get_thread(tid)
        if not t or t["botId"] != g.id:
            raise HTTPException(404, "conversation not found")
        items, more = await store.page(tid, before)
        return {"threadId": tid, "messages": [m.model_dump() for m in items], "hasMore": more}

    @app.post("/api/groups/{group_id}/messages", status_code=202)
    async def group_send(group_id: str, body: GroupMessage):
        g = await need_group(group_id)
        if body.threadId:
            t = await store.get_thread(body.threadId)
            if not t or t["botId"] != g.id:
                raise HTTPException(404, "conversation not found")
        msg = await groups.send(g, body.text, body.threadId, body.sendId)
        return {"message": msg.model_dump()}

    @app.post("/api/groups/{group_id}/read")
    async def group_read(group_id: str):
        g = await need_group(group_id)
        if g.unread:
            g.unread, g.readAt = False, now_ms()
            await store.save_group(g)
            await groups.publish(g)
        return {"ok": True}

    @app.post("/api/groups/{group_id}/interrupt")
    async def group_interrupt(group_id: str):
        await groups.stop(await need_group(group_id))
        return {"ok": True}

    @app.get("/api/groups/{group_id}/queue")
    async def group_queue(group_id: str):
        g = await need_group(group_id)
        return {"queue": (await groups.dict_of(g))["queue"]}

    @app.post("/api/groups/{group_id}/tasks", status_code=201)
    async def group_task(group_id: str, body: CreateTask):
        g = await need_group(group_id)
        t = await store.create_thread(g.id, body.title)
        await groups.publish(g)
        return {"threadId": t["id"]}

    @app.get("/api/decider")
    async def get_decider():
        return {"decider": groups.decider}

    @app.put("/api/decider")
    async def put_decider(body: dict):
        inst, model = body.get("instanceId"), body.get("model")
        groups.decider = {"instanceId": inst, "model": model} if inst and model else None
        config.data["decider"] = groups.decider
        config.save()
        return {"decider": groups.decider}

    # ---- sharing a team ------------------------------------------------------------------------------------------------------------
    async def team_text(body: dict) -> str:
        """The text of a team file: pasted, or fetched from a public address."""
        if isinstance(body.get("text"), str) and body["text"].strip():
            return body["text"]
        if isinstance(body.get("url"), str) and body["url"].strip():
            try:
                return await teamlib.fetch(body["url"])
            except teamlib.PackageError as e:
                raise HTTPException(400, str(e))
        raise HTTPException(400, "give the file's text or a public address")

    @app.post("/api/teams/export")
    async def export_team(body: dict):
        try:
            return await teamlib.export_team(store, mcp, skills, memory, str(body.get("sectionId") or ""), body.get("options"))
        except teamlib.PackageError as e:
            raise HTTPException(404, str(e))

    @app.post("/api/teams/import/preview")
    async def import_preview(body: dict):
        try:
            return teamlib.review(teamlib.parse(await team_text(body)))
        except teamlib.PackageError as e:
            raise HTTPException(400, str(e))

    @app.post("/api/teams/import", status_code=201)
    async def import_team(body: dict):
        try:
            pkg = teamlib.parse(await team_text(body))
        except teamlib.PackageError as e:
            raise HTTPException(400, str(e))
        defaults = config.data.get("botDefaults", {})
        sel = defaults.get("modelSelection") or registry.default_selection()
        try:
            return await teamlib.apply_import(store, bus, mcp, skills, memory, groups, routines, turns, pkg, sel)
        except Exception as e:  # everything it made has been removed again
            raise HTTPException(500, f"the import failed and nothing was added: {e}")

    @app.get("/api/presets")
    async def list_presets():
        return {"presets": [*config.data.get("presets", []), *teamlib.BUILTIN_PRESETS]}

    # ---- memory and skills ------------------------------------------------------------------------------------------------------
    @app.get("/api/bots/{bot_id}/memory")
    async def get_memory(bot_id: str):
        bot = await need(bot_id)
        return {"enabled": bot.memory, "gauge": memory.gauge(bot_id), "entries": memory.entries(bot_id), "files": memory.files(bot_id), "folder": str(memory.folder(bot_id)),
                "teamMemory": memory.read(memory.team_path(bot.section)) if bot.section else None}

    @app.get("/api/bots/{bot_id}/memory/file")
    async def read_memory_file(bot_id: str, name: str):
        await need(bot_id)
        path = memory.resolve(bot_id, name)
        if not path:
            raise HTTPException(404, "file not found")
        return {"name": name, "text": memory.read(path)}

    @app.put("/api/bots/{bot_id}/memory/file")
    async def write_memory_file(bot_id: str, body: dict):
        await need(bot_id)
        path = memory.resolve(bot_id, str(body.get("name") or ""))
        if not path:
            raise HTTPException(404, "file not found")
        from .memory import write_atomic

        write_atomic(path, str(body.get("text") or ""))
        return {"ok": True, "gauge": memory.gauge(bot_id)}

    @app.delete("/api/bots/{bot_id}/memory/entries/{eid}")
    async def delete_memory_entry(bot_id: str, eid: str):
        await need(bot_id)
        if not memory.delete_entry(bot_id, eid):
            raise HTTPException(404, "note not found")
        return {"ok": True, "gauge": memory.gauge(bot_id)}

    @app.put("/api/bots/{bot_id}/memory/team")
    async def write_team_memory(bot_id: str, body: dict):
        bot = await need(bot_id)
        if not bot.section:
            raise HTTPException(400, "this bot is not in a section")
        from .memory import write_atomic

        write_atomic(memory.team_path(bot.section), str(body.get("text") or ""))
        return {"ok": True}

    @app.get("/api/skills")
    async def list_skills():
        return {"skills": skills.list()}

    @app.post("/api/skills", status_code=201)
    async def create_skill(body: dict):
        try:
            return skills.save(None, str(body.get("name") or ""), str(body.get("description") or ""), str(body.get("body") or ""), body.get("enabled"))
        except SkillError as e:
            raise HTTPException(400, str(e))

    @app.patch("/api/skills/{sid}")
    async def patch_skill(sid: str, body: dict):
        cur = skills.get(sid)
        if not cur:
            raise HTTPException(404, "skill not found")
        try:
            return skills.save(sid, str(body.get("name", cur["name"])), str(body.get("description", cur["description"])), str(body.get("body", cur["body"])), body.get("enabled"))
        except SkillError as e:
            raise HTTPException(400, str(e))

    @app.delete("/api/skills/{sid}")
    async def delete_skill(sid: str):
        try:
            gone = skills.delete(sid)
        except SkillError:
            gone = False
        if not gone:
            raise HTTPException(404, "skill not found")
        for b in await store.list_bots():
            if sid in b.skills:
                b.skills = [x for x in b.skills if x != sid]
                await store.save_bot(b)
        return {"ok": True}

    # ---- custom MCP servers -----------------------------------------------------------------------------------------------------
    @app.get("/api/mcp/servers")
    async def list_mcp():
        return {"servers": [mcp_public(i, s, mcp.status.get(i)) for i, s in await mcp.list()]}

    @app.post("/api/mcp/servers", status_code=201)
    async def create_mcp(body: dict):
        try:
            sid, spec = await mcp.create(body)
        except SpecError as e:
            raise HTTPException(400, str(e))
        return mcp_public(sid, spec)

    @app.post("/api/mcp/import", status_code=201)
    async def import_mcp(body: dict):
        """Several servers at once from pasted Claude Desktop JSON; nothing is made unless every entry is valid."""
        try:
            specs = from_desktop_json(body.get("json"))
            from .mcp_servers import clean
            for s in specs:
                clean(s)
        except SpecError as e:
            raise HTTPException(400, str(e))
        made = []
        for s in specs:
            sid, spec = await mcp.create(s)
            made.append(mcp_public(sid, spec))
        return {"servers": made}

    @app.post("/api/mcp/test")
    async def test_mcp_spec(body: dict):
        """Try a server that is not saved yet (the editor's Test button)."""
        from .mcp_servers import clean
        try:
            spec = clean(body)
        except SpecError as e:
            raise HTTPException(400, str(e))
        return await mcp.test(spec)

    @app.patch("/api/mcp/servers/{sid}")
    async def patch_mcp(sid: str, body: dict):
        try:
            spec = await mcp.update(sid, body)
        except SpecError as e:
            raise HTTPException(400, str(e))
        if spec is None:
            raise HTTPException(404, "server not found")
        return mcp_public(sid, spec, mcp.status.get(sid))

    @app.delete("/api/mcp/servers/{sid}")
    async def delete_mcp(sid: str):
        if not await mcp.delete(sid):
            raise HTTPException(404, "server not found")
        return {"ok": True}

    @app.post("/api/mcp/servers/{sid}/test")
    async def test_mcp(sid: str):
        spec = await mcp.get(sid)
        if spec is None:
            raise HTTPException(404, "server not found")
        return await mcp.test(spec, sid)

    # ---- connected apps: the catalog, and a server made from an entry of it ------------------------------------------------------
    # ---- connected apps: all of them through Composio -----------------------------------------------------------------------------
    def composio_failed(e: ComposioError):
        return HTTPException(e.status if 400 <= e.status < 600 else 400, str(e))

    @app.get("/api/composio")
    async def composio_state():
        return composio.public()

    @app.put("/api/composio/key")
    async def composio_set_key(body: ComposioKey):
        try:
            return await composio.set_key(body.key)
        except ComposioError as e:
            raise composio_failed(e)

    @app.delete("/api/composio/key")
    async def composio_clear_key():
        await composio.clear_key()
        return composio.public()

    @app.get("/api/apps")
    async def apps():
        cards, source = await composio.catalog()
        out = {**composio.public(), "source": source, "apps": cards, "connections": {}, "error": None}
        if composio.configured():
            try:
                out["connections"] = await composio.status()
            except ComposioError as e:
                out["error"] = str(e)
        return out

    @app.get("/api/apps/{slug}")
    async def app_status(slug: str):
        try:
            return (await composio.status([slug]))[slug_of(slug)]
        except ComposioError as e:
            raise composio_failed(e)

    @app.post("/api/apps/{slug}/connect")
    async def connect_app(slug: str, body: ConnectBody):
        try:
            return await composio.authorize(slug, body.alias)
        except ComposioError as e:
            raise composio_failed(e)

    @app.delete("/api/apps/{slug}/accounts/{account_id}")
    async def disconnect_account(slug: str, account_id: str):
        try:
            return await composio.remove_account(slug, account_id)
        except ComposioError as e:
            raise composio_failed(e)

    # ---- webhooks (management; the receiver is a separate app on its own port) ---------------------------------------------------
    async def need_webhook(wid: str):
        w = await store.get_webhook(wid)
        if not w:
            raise HTTPException(404, "webhook not found")
        return w

    @app.get("/api/webhooks")
    async def list_webhooks():
        return {"webhooks": [webhooks.public(w) for w in await store.list_webhooks()], "port": hook_port}

    @app.post("/api/webhooks", status_code=201)
    async def create_webhook(body: dict):
        target, name = str(body.get("targetId") or ""), str(body.get("name") or "").strip()
        if not await store.get_bot(target):
            raise HTTPException(404, "bot not found")
        if not name:
            raise HTTPException(400, "a webhook needs a name")
        auth = "url" if body.get("auth") == "url" else "bearer"
        w, secret = await webhooks.create(target_id=target, name=name, prompt=str(body.get("prompt") or ""), auth=auth)
        return {"webhook": webhooks.public(w), "secret": secret}  # shown here once and never again

    @app.patch("/api/webhooks/{wid}")
    async def patch_webhook(wid: str, body: dict):
        await need_webhook(wid)
        f = {k: body[k] for k in ("name", "prompt", "enabled") if k in body}
        if "targetId" in body:
            if not await store.get_bot(str(body["targetId"])):
                raise HTTPException(404, "bot not found")
            f["targetId"] = body["targetId"]
        await store.update_webhook(wid, **f)
        await webhooks.publish(wid)
        return webhooks.public(await need_webhook(wid))

    @app.delete("/api/webhooks/{wid}")
    async def delete_webhook(wid: str):
        if not await store.delete_webhook(wid):
            raise HTTPException(404, "webhook not found")
        await webhooks.publish(wid, deleted=True)
        return {"ok": True}

    @app.post("/api/webhooks/{wid}/rotate")
    async def rotate_webhook(wid: str):
        secret = await webhooks.rotate(wid)
        if not secret:
            raise HTTPException(404, "webhook not found")
        return {"secret": secret}

    @app.post("/api/webhooks/{wid}/reveal")
    async def reveal_webhook(wid: str):
        await need_webhook(wid)
        secret = await webhooks.reveal(wid)
        if not secret:
            raise HTTPException(404, "there is no secret waiting to be shown")
        return {"secret": secret}

    @app.get("/api/webhooks/{wid}/attempts")
    async def webhook_attempts(wid: str):
        await need_webhook(wid)
        return {"attempts": await store.list_webhook_attempts(wid)}

    # ---- notifications and the inbox of cards waiting on a person -------------------------------------------------------
    @app.get("/api/notifications")
    async def list_notifications(limit: int = 100):
        rows = await store.list_notifications(min(max(limit, 1), 300))
        return {"notifications": rows, "unread": sum(1 for n in rows if not n["read"])}

    @app.post("/api/notifications/read")
    async def read_notifications(body: dict):
        ids = body.get("ids")
        return {"read": await notify.read(None if body.get("all") or ids is None else [str(i) for i in ids])}

    @app.delete("/api/notifications")
    async def clear_notifications():
        await notify.clear()
        return {"ok": True}

    @app.get("/api/inbox")
    async def inbox():
        return {"items": await notify.inbox()}

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

    @app.get("/api/bots/{bot_id}/runs")
    async def bot_runs(bot_id: str, limit: int = 30):
        """The recent turns of a bot, from its event logs: when, how long, which tools, what it used."""
        bot = await need(bot_id)
        rows = []
        for t in await store.list_threads(bot.id):
            for r in observe.runs_of(observe.read_log(turns.log_dir / f"{t['id']}.ndjson"), t["id"]):
                rows.append({**r, "thread": t["title"] or "Main conversation"})
        rows.sort(key=lambda r: r["startedAt"] or 0, reverse=True)
        return {"runs": rows[: min(max(limit, 1), 200)]}

    @app.get("/api/threads/{thread_id}/trace")
    async def thread_trace(thread_id: str, turn: str):
        events = observe.read_log(turns.log_dir / f"{thread_id}.ndjson")
        if not any(e.get("turnId") == turn for e in events):
            raise HTTPException(404, "turn not found")
        return observe.trace_of(events, turn)

    @app.get("/api/usage")
    async def usage(since: int = 0, until: int | None = None, by: str = "day"):
        """Tokens and cost by day, bot or model, with the total; the totals are sums of the recorded turns."""
        from datetime import datetime as _dt

        rows = await store.usage_rows(since, until)
        names = {b.id: b.name for b in await store.list_bots()}
        keyf = {"day": lambda r: _dt.fromtimestamp(r["at"] / 1000).strftime("%Y-%m-%d"), "bot": lambda r: names.get(r["botId"], "(deleted bot)"), "model": lambda r: r["model"]}.get(by)
        if not keyf:
            raise HTTPException(400, "group by day, bot or model")
        groups: dict[str, dict] = {}
        for r in rows:
            g = groups.setdefault(keyf(r), {"key": keyf(r), "input": 0, "output": 0, "cost": 0.0, "turns": 0})
            g["input"] += r["input"]; g["output"] += r["output"]; g["cost"] = round(g["cost"] + r["cost"], 6); g["turns"] += 1
        total = {"input": sum(r["input"] for r in rows), "output": sum(r["output"] for r in rows), "cost": round(sum(r["cost"] for r in rows), 6), "turns": len(rows)}
        return {"rows": sorted(groups.values(), key=lambda g: g["key"]), "total": total, "limits": config.data.get("limits", {})}

    @app.get("/api/bots/{bot_id}/export")
    async def export_transcript(bot_id: str, thread: str | None = None, format: str = "md"):
        from fastapi.responses import PlainTextResponse

        bot = await need(bot_id)
        tid = await need_thread(bot, thread)
        msgs, _ = await store.page(tid, None, 100_000)
        data = [m.model_dump() for m in msgs]
        title = ((await store.get_thread(tid)) or {}).get("title", "")
        if format == "json":
            return PlainTextResponse(json.dumps({"bot": bot.name, "thread": title, "messages": data}, ensure_ascii=False, indent=1), media_type="application/json",
                                     headers={"content-disposition": f'attachment; filename="{bot.name}-transcript.json"'})
        if format != "md":
            raise HTTPException(400, "format is md or json")
        return PlainTextResponse(observe.to_markdown(bot.name, title, data), media_type="text/markdown", headers={"content-disposition": f'attachment; filename="{bot.name}-transcript.md"'})

    @app.get("/api/threads/{thread_id}/events")
    async def thread_events(thread_id: str, limit: int = 500):
        path = turns.log_dir / f"{thread_id}.ndjson"
        if not path.exists():
            return {"events": []}
        lines = path.read_text(encoding="utf8").splitlines()[-limit:]
        return {"events": [json.loads(x) for x in lines if x]}

    # ---- the computer panel: the bot's built-in browser ---------------------------------------------------------------
    async def computer_state(bot_id: str) -> dict:
        await need(bot_id)
        return {**browser.state(bot_id), **(await browser.availability())}

    @app.get("/api/bots/{bot_id}/computer")
    async def computer_get(bot_id: str):
        return await computer_state(bot_id)

    @app.post("/api/bots/{bot_id}/computer/wake")
    async def computer_wake(bot_id: str):
        await need(bot_id)
        try:
            await browser.wake(bot_id)
        except BrowserUnavailable as e:
            raise HTTPException(503, str(e))
        return await computer_state(bot_id)

    @app.post("/api/bots/{bot_id}/computer/sleep")
    async def computer_sleep(bot_id: str):
        await need(bot_id)
        await browser.sleep(bot_id)
        return await computer_state(bot_id)

    @app.post("/api/bots/{bot_id}/computer/control")
    async def computer_control(bot_id: str, body: ControlBody):
        await need(bot_id)
        if body.holder not in ("person", "bot"):
            raise HTTPException(400, "holder is person or bot")
        try:
            await browser.set_control(bot_id, body.holder)
        except BrowserUnavailable as e:
            raise HTTPException(409, str(e))
        return await computer_state(bot_id)

    @app.post("/api/bots/{bot_id}/computer/input")
    async def computer_input(bot_id: str, body: InputBody):
        await need(bot_id)
        try:
            ok = await browser.person_input(bot_id, body.model_dump(exclude_none=True))
        except BrowserUnavailable as e:
            raise HTTPException(400, str(e))
        if not ok:
            raise HTTPException(409, "take control of the browser first")
        return {"ok": True}

    @app.post("/api/bots/{bot_id}/computer/watch")
    async def computer_watch(bot_id: str, body: WatchBody):
        await need(bot_id)
        return {"ok": await browser.watch(bot_id, body.on)}

    @app.get("/api/bots/{bot_id}/computer/screen")
    async def computer_screen(bot_id: str):
        from fastapi.responses import Response

        await need(bot_id)
        try:
            data, _url, _title = await browser.screenshot(bot_id)
        except BrowserUnavailable as e:
            raise HTTPException(404, str(e))
        return Response(data, media_type="image/jpeg")

    @app.put("/api/computer/settings")
    async def computer_settings(body: ComputerSettings):
        config.data.setdefault("browser", {})["allowLocal"] = body.allowLocal
        config.save()
        browser.allow_local = body.allowLocal
        return {"allowLocal": body.allowLocal}

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
    app.state.scheduler = app.state.routines = routines
    app.state.webhooks, app.state.hook_app = webhooks, make_hook_app(webhooks)
    app.state.runtime, app.state.host, app.state.agents, app.state.groups, app.state.notify = runtime, host, agents, groups, notify
    app.state.mcp = mcp

    static = web_dir or (Path(os.environ["BOTTEAM_WEB_DIR"]) if os.environ.get("BOTTEAM_WEB_DIR") else None)
    if static is None:
        for cand in (Path(__file__).resolve().parent / "webui", Path(__file__).resolve().parents[2] / "web" / ".next-export"):
            if (cand / "index.html").exists():
                static = cand
                break
    if static and (static / "index.html").exists():
        from fastapi.staticfiles import StaticFiles

        app.mount("/", StaticFiles(directory=str(static), html=True), name="web")  # added after every route above: /api answers first
    app.state.web_dir = static
    app.state.pairing = pairing
    app.state.memory, app.state.skills = memory, skills
    app.state.browser = browser
    app.state.composio = composio
    _ = now_ms
    return app


app = create_app(serve_hooks=True)
