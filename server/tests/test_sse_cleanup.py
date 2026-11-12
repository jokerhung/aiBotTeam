"""Disconnects must drain the pending bus read before closing the subscription."""
import asyncio

import anyio
import pytest

from botteam.main import create_app


async def response_and_bus(tmp_path):
    app = create_app(home=tmp_path)
    endpoint = next(route.endpoint for route in app.routes if getattr(route, "path", None) == "/api/events")
    return await endpoint(), app.state.turns.bus


async def wait_for_subscription(bus):
    with anyio.fail_after(2):
        while not bus._subs:
            await asyncio.sleep(0)


@pytest.mark.parametrize("mode", ["idle", "frame_ready"])
async def test_generator_close_drains_its_pending_read(tmp_path, mode):
    response, bus = await response_and_bus(tmp_path)
    stream = response.body_iterator
    assert "config" in (await anext(stream))["data"]
    read = asyncio.create_task(anext(stream))
    await wait_for_subscription(bus)
    if mode == "frame_ready":
        bus.publish({"kind": "ping"})
        await read
        # The generator is suspended at yield and its next read is pending.
        await asyncio.sleep(0)
        await stream.aclose()
    else:
        read.cancel()
        with pytest.raises(asyncio.CancelledError):
            await read
        await stream.aclose()
    assert not bus._subs


@pytest.mark.parametrize("mode", ["idle", "during_send", "request_cancelled"])
async def test_sse_disconnect_cleans_up_inside_anyio_cancel_scope(tmp_path, mode):
    response, bus = await response_and_bus(tmp_path)
    disconnect = asyncio.Event()
    scope = {"type": "http", "asgi": {"version": "3.0"}, "method": "GET", "path": "/api/events", "headers": []}

    async def receive():
        await disconnect.wait()
        return {"type": "http.disconnect"}

    async def send(message):
        if mode == "during_send" and message["type"] == "http.response.body" and b'"kind": "ping"' in message.get("body", b""):
            disconnect.set()
            await asyncio.Future()  # simulate a backpressured connection

    task = asyncio.create_task(response(scope, receive, send))
    try:
        await wait_for_subscription(bus)
        if mode == "during_send":
            bus.publish({"kind": "ping"})
        elif mode == "request_cancelled":
            task.cancel()
        else:
            disconnect.set()
        with anyio.fail_after(2):
            if mode == "request_cancelled":
                with pytest.raises(asyncio.CancelledError):
                    await task
            else:
                await task
        assert not bus._subs
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
