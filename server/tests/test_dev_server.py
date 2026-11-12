"""Real Windows sockets and subprocesses before and after repeated dev reloads."""
import asyncio
import json
import multiprocessing
import os
import socket
import sys
import time

import httpx
import pytest

from botteam.dev import run


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        while True:
            event = await receive()
            await send({"type": event["type"] + ".complete"})
            if event["type"] == "lifespan.shutdown":
                return
    else:
        process = await asyncio.create_subprocess_exec(sys.executable, "-c", "print('engine subprocess works')", stdout=asyncio.subprocess.PIPE)
        stdout, _ = await process.communicate()
        body = json.dumps({"pid": os.getpid(), "loop": type(asyncio.get_running_loop()).__name__, "output": stdout.decode().strip()}).encode()
        await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": body})


@pytest.mark.skipif(sys.platform != "win32", reason="Windows Proactor/shared socket regression")
def test_server_accepts_connections_and_spawns_engines_after_two_reloads(tmp_path):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    context = multiprocessing.get_context("spawn")
    stopped = context.Event()
    supervisor = context.Process(target=run, args=("127.0.0.1", port, str(tmp_path), "tests.test_dev_server:app", stopped))
    supervisor.start()

    def ready(previous=None):
        deadline = time.monotonic() + 25
        with httpx.Client(trust_env=False, timeout=1) as client:
            while time.monotonic() < deadline:
                assert supervisor.is_alive(), "the dev supervisor exited unexpectedly"
                try:
                    data = client.get(f"http://127.0.0.1:{port}/").json()
                    if data["pid"] != previous:
                        assert data["loop"] == "ProactorEventLoop"
                        assert data["output"] == "engine subprocess works"
                        return data["pid"]
                except (httpx.HTTPError, ValueError):
                    pass
                time.sleep(0.1)
        pytest.fail("server did not accept a connection after reload")

    try:
        pid = ready()
        for version in range(2):
            (tmp_path / "reload_trigger.py").write_text(f"version = {version}\n", encoding="utf8")
            pid = ready(pid)
    finally:
        stopped.set()
        supervisor.join(timeout=20)
        if supervisor.is_alive():
            supervisor.terminate()
            supervisor.join(timeout=5)
    assert supervisor.exitcode == 0
