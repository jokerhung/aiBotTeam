"""Browser and isolated Computer APIs; provider credentials never reach the client."""
from __future__ import annotations

import asyncio
import importlib.util
import json
import math
import os
import shutil
from urllib.parse import urlsplit

import anyio
from fastapi import HTTPException, WebSocket
from fastapi.responses import Response, PlainTextResponse
from sse_starlette.sse import EventSourceResponse

from .auth import COOKIE, direct_access_host, is_loopback, request_needs_pairing
from .browser_host import BrowserUnavailable
from .computer_host import ComputerUnavailable
from .computer_mcp import perform
from .computer_settings import ComputerSettingsPatch
from .computer_stream import relay
from .toolbox import settings


def register(app, *, store, turns, broker, browser, computer, bus, config, pairing, need, home):
    def packages_installed():
        source = computer.settings.connection().source
        injected = computer._opensandbox_sdk if source == "opensandbox" else computer._sdk
        return injected is not None or importlib.util.find_spec("opensandbox" if source == "opensandbox" else "e2b_desktop") is not None

    def host_state():
        installed = packages_installed()
        return {**computer.settings.public(), "capabilities": computer.capabilities(), "packagesInstalled": installed,
                "installCommand": "uv sync --project server --extra computer" if not installed else None}

    async def browser_state(bot_id):
        bot = await need(bot_id)
        availability = await browser.availability(bot_id)
        state = browser.state(bot_id)
        node_available = bool(shutil.which("node") and shutil.which("npx"))
        return {**state, **availability, "available": availability.get("browser") in availability.get("installed", []), "allowLocal": settings(bot).web.allowLocal, "headed": settings(bot).web.headed,
                "mcpAvailable": node_available, "reason": availability.get("reason") or ("Install Node.js 20 or later to use Playwright MCP" if not node_available else None)}

    async def computer_state(bot_id):
        bot = await need(bot_id)
        instance = turns.registry.get(bot.modelSelection.instanceId)
        supported = bool(instance and computer.supports(instance.driver))
        host = host_state()
        enabled = settings(bot).computer.enabled
        reason = None
        if not host["packagesInstalled"]:
            reason = "Install optional Computer packages: uv sync --project server --extra computer"
        elif host.get("status") != "ready":
            reason = "Test the Computer host connection in Settings first"
        elif not supported:
            reason = "This engine/model has not been verified to receive images in MCP tool results"
        return {**computer.state(bot_id), "enabled": enabled, "engineSupported": supported,
                "hostStatus": host.get("status", "unchecked"), "available": reason is None, "reason": reason,
                "providerCapabilities": host["capabilities"]}

    async def need_computer(bot_id):
        bot = await need(bot_id)
        state = await computer_state(bot_id)
        if not settings(bot).computer.enabled:
            raise HTTPException(409, "Computer use is disabled for this agent")
        if not state["available"]:
            raise HTTPException(409, state["reason"])
        return bot

    @app.get("/api/computer/guides/{provider}/{language}")
    async def setup_guide(provider: str, language: str):
        if provider not in ("e2b", "opensandbox") or language not in ("en", "vi"):
            raise HTTPException(404, "Unknown guide")
        from pathlib import Path
        path = Path(__file__).resolve().parents[2] / "docs" / f"{provider}-setup.{language}.md"
        if not path.is_file():
            raise HTTPException(404, "Read docs on the aiBotTeam repository")
        return PlainTextResponse(path.read_text(encoding="utf8"))

    @app.get("/api/computer/host")
    async def get_host():
        return host_state()

    @app.patch("/api/computer/host")
    @app.put("/api/computer/host")
    async def update_host(body: ComputerSettingsPatch):
        try:
            await computer.update_settings(body)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        return host_state()

    @app.post("/api/computer/host/test")
    async def test_host():
        if not packages_installed():
            return {**host_state(), "status": "missing_packages"}
        try:
            await computer.test()
        except Exception:
            return {**host_state(), "status": "unreachable"}
        return host_state()

    @app.get("/api/bots/{bot_id}/browser")
    async def get_browser(bot_id: str):
        return await browser_state(bot_id)

    @app.post("/api/bots/{bot_id}/browser/wake")
    async def wake_browser(bot_id: str):
        await need(bot_id)
        try:
            await browser.wake(bot_id)
        except BrowserUnavailable as exc:
            raise HTTPException(503, str(exc)) from None
        return await browser_state(bot_id)

    @app.post("/api/bots/{bot_id}/browser/sleep")
    async def sleep_browser(bot_id: str):
        await need(bot_id)
        await browser.sleep(bot_id)
        return await browser_state(bot_id)

    @app.delete("/api/bots/{bot_id}/browser/profile")
    async def reset_profile(bot_id: str):
        await need(bot_id)
        await browser.clear_profile(bot_id)
        return await browser_state(bot_id)

    @app.post("/api/bots/{bot_id}/browser/control")
    async def browser_control(bot_id: str, body: dict):
        await need(bot_id)
        holder = body.get("holder")
        if holder not in ("agent", "bot", "person"):
            raise HTTPException(400, "holder is person or agent")
        try:
            await browser.set_control(bot_id, "bot" if holder == "agent" else holder)
        except BrowserUnavailable as exc:
            raise HTTPException(409, str(exc)) from None
        return await browser_state(bot_id)

    @app.post("/api/bots/{bot_id}/browser/input")
    async def browser_input(bot_id: str, body: dict):
        await need(bot_id)
        try:
            ok = await browser.person_input(bot_id, body)
        except (BrowserUnavailable, TypeError, ValueError) as exc:
            raise HTTPException(400, str(exc)) from None
        if not ok:
            raise HTTPException(409, "Take control of the browser first")
        return {"ok": True}

    @app.post("/api/bots/{bot_id}/browser/watch")
    async def watch_toggle(bot_id: str, body: dict):
        await need(bot_id)
        return {"ok": await browser.watch(bot_id, body.get("on") is True)}

    @app.get("/api/bots/{bot_id}/browser/watch")
    async def watch_stream(bot_id: str):
        await need(bot_id)
        async def frames():
            subscription = bus.subscribe()
            pending = asyncio.ensure_future(subscription.__anext__())
            await browser.watch(bot_id, True)
            try:
                yield {"event": "state", "data": json.dumps(await browser_state(bot_id))}
                while True:
                    done, _ = await asyncio.wait({pending}, timeout=15)
                    if not done:
                        yield {"event": "ping", "data": "{}"}
                        continue
                    frame = pending.result()
                    pending = asyncio.ensure_future(subscription.__anext__())
                    if frame.get("botId") == bot_id and frame.get("kind") in ("screen", "browser-control"):
                        yield {"data": json.dumps(frame)}
            finally:
                pending.cancel()
                with anyio.CancelScope(shield=True):
                    await asyncio.gather(pending, return_exceptions=True)
                    await subscription.aclose()
                    await browser.watch(bot_id, False)
        return EventSourceResponse(frames())

    @app.get("/api/bots/{bot_id}/browser/screen")
    async def browser_screen(bot_id: str):
        await need(bot_id)
        try:
            data, _, _ = await browser.screenshot(bot_id)
        except BrowserUnavailable as exc:
            raise HTTPException(404, str(exc)) from None
        return Response(data, media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    # Old Computer preview URLs remain aliases for Web use unless this agent enables an isolated computer.
    async def is_computer(bot_id):
        return settings(await need(bot_id)).computer.enabled

    @app.get("/api/bots/{bot_id}/computer")
    async def get_computer(bot_id: str):
        return await computer_state(bot_id) if await is_computer(bot_id) else await browser_state(bot_id)

    @app.get("/api/bots/{bot_id}/computer/capability")
    async def capability_state(bot_id: str):
        return await computer_state(bot_id)

    @app.post("/api/bots/{bot_id}/computer/wake")
    async def wake_computer(bot_id: str):
        if not await is_computer(bot_id):
            return await wake_browser(bot_id)
        bot = await need_computer(bot_id)
        try:
            async with computer.operation(bot_id):
                prefs = settings(bot).computer
                await computer.wake(bot_id, prefs.resolution, prefs.idleSeconds)
        except ComputerUnavailable as exc:
            raise HTTPException(503, str(exc)) from None
        except Exception:
            raise HTTPException(503, "The computer could not start") from None
        return await computer_state(bot_id)

    @app.post("/api/bots/{bot_id}/computer/sleep")
    async def sleep_computer(bot_id: str):
        if not await is_computer(bot_id):
            return await sleep_browser(bot_id)
        try:
            await computer.pause(bot_id)
        except ComputerUnavailable as exc:
            raise HTTPException(503, str(exc)) from None
        return await computer_state(bot_id)

    @app.delete("/api/bots/{bot_id}/computer")
    async def destroy_computer(bot_id: str):
        await need(bot_id)
        try:
            await computer.destroy(bot_id)
        except ComputerUnavailable as exc:
            raise HTTPException(503, str(exc)) from None
        return await computer_state(bot_id)

    @app.post("/api/bots/{bot_id}/computer/control")
    async def computer_control(bot_id: str, body: dict):
        if not await is_computer(bot_id):
            return await browser_control(bot_id, body)
        await need_computer(bot_id)
        if body.get("holder") not in ("agent", "bot", "person"):
            raise HTTPException(400, "holder is person or agent")
        await computer.set_control(bot_id, body["holder"] == "person")
        return await computer_state(bot_id)

    @app.post("/api/bots/{bot_id}/computer/input")
    async def computer_input(bot_id: str, body: dict):
        if not await is_computer(bot_id):
            return await browser_input(bot_id, body)
        await need_computer(bot_id)
        async with computer.operation(bot_id):
            state, machine = computer.state(bot_id), computer.live(bot_id)
            if not state["held"] or machine is None:
                raise HTTPException(409, "Take control of the computer first")
            kind, name, args = body.get("type"), None, {}
            x, y, dy = body.get("x"), body.get("y"), body.get("dy")
            if kind == "click" and all(type(n) in (int, float) and math.isfinite(n) for n in (x, y)) and 0 <= x < state["resolution"][0] and 0 <= y < state["resolution"][1]:
                name, args = "computer_click", {"x": int(x), "y": int(y)}
            elif kind == "scroll" and type(dy) in (int, float) and math.isfinite(dy) and dy:
                name, args = "computer_scroll", {"direction": "down" if dy > 0 else "up", "amount": min(10, max(1, int(abs(dy) / 50)))}
            elif kind == "text" and isinstance(body.get("text"), str) and len(body["text"]) <= 2000:
                name, args = "computer_type", {"text": body["text"]}
            elif kind == "key" and isinstance(body.get("key"), str) and len(body["key"]) <= 60:
                keys = {"Enter": "Return", "ArrowLeft": "Left", "ArrowRight": "Right", "ArrowUp": "Up", "ArrowDown": "Down"}
                name, args = "computer_key", {"key": "+".join(keys.get(key, key) for key in body["key"].split("+"))}
            if not name:
                raise HTTPException(400, "Invalid computer input")
            try:
                await computer.invoke(perform, machine, name, args, home)
            except ComputerUnavailable as exc:
                raise HTTPException(400, str(exc)) from None
            except Exception:
                raise HTTPException(503, "The computer could not receive input") from None
        return {"ok": True}

    @app.post("/api/bots/{bot_id}/computer/watch")
    async def legacy_watch(bot_id: str, body: dict):
        return await watch_toggle(bot_id, body) if not await is_computer(bot_id) else {"ok": True}

    @app.get("/api/bots/{bot_id}/computer/screen")
    async def computer_screen(bot_id: str):
        if not await is_computer(bot_id):
            return await browser_screen(bot_id)
        await need_computer(bot_id)
        async with computer.operation(bot_id):
            machine = computer.live(bot_id)
            if machine is None:
                raise HTTPException(404, "The computer is not running")
            try:
                image = await computer.invoke(machine.screenshot)
            except Exception:
                raise HTTPException(503, "The computer could not provide an image") from None
        return Response(image, media_type="image/png", headers={"Cache-Control": "no-store"})

    @app.websocket("/api/bots/{bot_id}/computer/stream")
    async def computer_stream(socket: WebSocket, bot_id: str):
        forwarded = socket.headers.get("x-forwarded-host") if socket.client and is_loopback(socket.client.host) else None
        authority = forwarded or socket.headers.get("host", "")
        try:
            origin = urlsplit(socket.headers.get("origin", ""))
        except ValueError:
            await socket.close(code=1008); return
        allowed_hosts = {name.strip().lower().rstrip(".") for name in os.environ.get("WEB_ALLOWED_HOSTS", "").split(",")}
        host_allowed = direct_access_host(authority) or bool(origin.hostname and origin.hostname.lower().rstrip(".") in allowed_hosts)
        if not host_allowed or origin.scheme not in ("http", "https") or origin.netloc.lower() != authority.lower() or (request_needs_pairing(socket, pairing.required) and not pairing.valid(socket.cookies.get(COOKIE))):
            await socket.close(code=1008); return
        try:
            await need_computer(bot_id)
            async with computer.operation(bot_id):
                machine = computer.live(bot_id)
                if machine is None:
                    await socket.close(code=1008); return
                provider = computer.provider()
                await computer.invoke(provider.ensure_viewer, machine)
                metadata = await computer.invoke(provider.viewer, machine)
            await relay(socket, *metadata)
        except Exception:
            from starlette.websockets import WebSocketState
            if socket.application_state != WebSocketState.DISCONNECTED:
                await socket.close(code=1011)

    return computer_state
