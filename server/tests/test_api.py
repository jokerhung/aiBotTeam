import asyncio

import httpx
import pytest
from asgi_lifespan import LifespanManager  # noqa: F401

from botteam.main import create_app


@pytest.fixture
async def client(tmp_path):
    app = create_app(str(tmp_path / "t.db"))
    async with LifespanManager(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            yield c


async def test_bot_crud(client):
    r = await client.post("/api/bots", json={"name": "Brody"})
    assert r.status_code == 201
    bid = r.json()["id"]
    assert [b["name"] for b in (await client.get("/api/bots")).json()["bots"]] == ["Brody"]
    r = await client.patch(f"/api/bots/{bid}", json={"pinned": True})
    assert r.json()["pinned"] is True
    assert (await client.delete(f"/api/bots/{bid}")).status_code == 200
    assert (await client.get("/api/bots")).json()["bots"] == []


async def test_turn_streams_and_persists(client):
    bid = (await client.post("/api/bots", json={"name": "A"})).json()["id"]
    assert (await client.post(f"/api/bots/{bid}/messages", json={"text": "hi there"})).status_code == 202
    for _ in range(100):
        await asyncio.sleep(0.05)
        bot = (await client.get("/api/bots")).json()["bots"][0]
        if not bot["busy"]:
            break
    msgs = (await client.get(f"/api/bots/{bid}/messages")).json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "bot"]
    assert msgs[1]["text"].strip() == "You said: hi there"
    assert bot["unread"] is True
    await client.post(f"/api/bots/{bid}/read")
    assert (await client.get("/api/bots")).json()["bots"][0]["unread"] is False
