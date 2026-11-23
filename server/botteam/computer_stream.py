"""Send a view-only noVNC stream through the BotTeam server."""
from __future__ import annotations

import asyncio
from urllib.parse import urlsplit, urlunsplit

from fastapi import WebSocket

from .computer_host import ComputerUnavailable

PORT = 6080


def ensure_viewer(machine) -> None:
    # The runtime denies public ingress. BotTeam sends input over its separately
    # authorized endpoint and the VNC server itself rejects any client input.
    machine.commands.run(
        "curl -fsS http://127.0.0.1:6080/vnc.html >/dev/null 2>&1 || "
        "x11vnc -bg -display :0 -forever -wait 50 -shared -localhost -viewonly -nopw -rfbport 5900 "
        ">/tmp/botteam-vnc.log 2>&1",
        timeout=10,
    )
    machine.commands.run(
        "curl -fsS http://127.0.0.1:6080/vnc.html >/dev/null 2>&1 || "
        "(cd /opt/noVNC/utils && ./novnc_proxy --vnc localhost:5900 --listen 6080 --web /opt/noVNC) "
        ">/tmp/botteam-novnc.log 2>&1",
        background=True, timeout=0,
    ).disconnect()
    machine.commands.run(
        "curl --retry 6 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:6080/vnc.html >/dev/null",
        timeout=10,
    )


def upstream(machine, connection) -> tuple[str, dict[str, str]]:
    token = machine.traffic_access_token
    if not token:
        raise ComputerUnavailable("E2B did not issue a private stream access token")
    headers = {"E2b-Traffic-Access-Token": token}
    if not connection.sandbox_url:
        return f"wss://{machine.get_host(PORT)}/websockify", headers
    proxy = urlsplit(connection.sandbox_url)
    headers.update({"E2b-Sandbox-Id": machine.sandbox_id, "E2b-Sandbox-Port": str(PORT)})
    return urlunsplit(("wss" if proxy.scheme == "https" else "ws", proxy.netloc, proxy.path + "/websockify", "", "")), headers


async def relay(websocket: WebSocket, url: str, headers: dict[str, str]) -> None:
    from websockets.asyncio.client import connect

    async with connect(url, additional_headers=headers, subprotocols=["binary"], open_timeout=10, max_size=8 * 1024 * 1024, proxy=None) as remote:
        protocols = websocket.scope.get("subprotocols") or []
        await websocket.accept(subprotocol="binary" if "binary" in protocols else None)

        async def down():
            async for message in remote:
                if not isinstance(message, bytes):
                    break
                await websocket.send_bytes(message)

        async def up():
            async for message in websocket.iter_bytes():
                if len(message) > 64 * 1024:
                    break
                await remote.send(message)

        tasks = (asyncio.create_task(down()), asyncio.create_task(up()))
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
