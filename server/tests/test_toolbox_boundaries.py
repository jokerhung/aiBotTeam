import asyncio
import json
from pathlib import Path

from .test_api import ctx, make_bot  # noqa: F401


async def test_bridge_token_is_scoped_to_one_conversation(ctx):
    client, app = ctx
    first, second = await make_bot(client, "First"), await make_bot(client, "Second")
    broker = app.state.broker
    reader, writer = await asyncio.open_connection("127.0.0.1", broker.port)
    writer.write((json.dumps({"t": "hello", "token": broker.token_for(first["threadId"]), "thread": second["threadId"]}) + "\n").encode())
    await writer.drain()
    assert await asyncio.wait_for(reader.readline(), 2) == b""
    writer.close()
    await writer.wait_closed()


async def test_team_template_and_graph_duplication(ctx):
    client, app = ctx
    result = await client.post("/api/templates/teams--social-media-team/install")
    assert result.status_code == 201, result.text
    master = result.json()
    bots = (await client.get("/api/bots")).json()["bots"]
    assert len(bots) == 5
    policy = master["toolbox"]["subagents"]
    assert policy["enabled"] and policy["maxFanout"] == 4 and policy["mode"] == "async"
    delegates = {d["bot"] for d in policy["delegates"]}
    assert delegates == {b["id"] for b in bots if b["reportsTo"] == master["id"]}
    creator = next(b for b in bots if b["name"] == "Creator Agent")
    assert app.state.skills.for_bot(creator["skills"])
    assert all("/api/social" not in b["soul"] for b in bots)
    clone = (await client.post(f"/api/bots/{master['id']}/duplicate?withDelegates=true")).json()
    copies = {d["bot"] for d in clone["toolbox"]["subagents"]["delegates"]}
    assert len(copies) == 4 and not copies & delegates
    after = (await client.get("/api/bots")).json()["bots"]
    assert len(after) == 10
    assert len({b["cwd"] for b in after}) == 10
    assert all(Path(b["cwd"]).is_dir() for b in after)
    assert {b["id"] for b in after if b["reportsTo"] == clone["id"]} == copies


async def test_missing_computer_host_is_specific_and_key_is_write_only(ctx):
    client, app = ctx
    bot = await make_bot(client)
    result = await client.patch("/api/computer/host", json={"source": "opensandbox", "apiUrl": "http://sandbox.invalid:8080", "apiKey": "private-test-key"})
    assert result.status_code == 200
    assert "private-test-key" not in result.text and result.json()["keySet"]
    assert result.json()["keyHint"] is None
    state = (await client.get(f"/api/bots/{bot['id']}/computer/capability")).json()
    assert not state["available"] and state["reason"]
    assert (await client.patch(f"/api/bots/{bot['id']}", json={"toolbox": {"computer": {"enabled": True}}})).status_code == 400
    disabled = await app.state.computer_mcp.request(bot["threadId"], "tools/list", {})
    assert disabled["result"]["isError"]
