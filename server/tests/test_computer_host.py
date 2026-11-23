import asyncio
import io
from types import SimpleNamespace

import httpx
import pytest

from botteam.bus import Bus
from botteam.computer_host import ComputerHost, ComputerUnavailable, METADATA_BOT, METADATA_OWNER
from botteam.computer_mcp import ComputerMcp
from botteam.computer_settings import ComputerHostSettings, ComputerSettingsPatch
from botteam.config import ConfigStore


class FakeSandbox:
    def __init__(self, sandbox_id, metadata):
        self.sandbox_id = sandbox_id
        self.metadata = metadata
        self.state = "running"
        self.clicks = []

    def pause(self, *, mode):
        assert mode == "full"
        self.state = "paused"

    def screenshot(self):
        from PIL import Image

        output = io.BytesIO()
        Image.new("RGB", (1280, 800)).save(output, "PNG")
        return output.getvalue()

    def left_click(self, x, y):
        self.clicks.append((x, y))

    right_click = double_click = left_click


class FakeSDK:
    def __init__(self):
        self.sandboxes = {}
        self.created = 0

    def create(self, **options):
        assert options["template"] == "desktop"
        assert options["sandbox_url"] == "http://fake.test:3002"
        assert options["secure"] and not options["network"]["allow_public_traffic"]
        assert "100.64.0.0/10" in options["network"]["deny_out"]
        self.created += 1
        sandbox = FakeSandbox(str(self.created), options["metadata"])
        self.sandboxes[sandbox.sandbox_id] = sandbox
        return sandbox

    def connect(self, sandbox_id, **options):
        sandbox = self.sandboxes[sandbox_id]
        sandbox.state = "running"
        return sandbox

    def kill(self, sandbox_id, **options):
        return self.sandboxes.pop(sandbox_id, None) is not None

    def list(self, *, query, **options):
        assert METADATA_OWNER in query["metadata"]
        page = SimpleNamespace(has_next=True)

        def next_items():
            page.has_next = False
            return list(self.sandboxes.values())

        page.next_items = next_items
        return page


@pytest.fixture
async def host(tmp_path, monkeypatch):
    for name in ("E2B_API_KEY", "E2B_API_URL", "E2B_SANDBOX_URL", "E2B_DOMAIN", "BOTTEAM_COMPUTER_TEMPLATE", "BOTTEAM_COMPUTER_IDLE_S"):
        monkeypatch.delenv(name, raising=False)
    config = ConfigStore(tmp_path / "config.json")
    transport = httpx.MockTransport(lambda _: httpx.Response(200, json=[{"aliases": ["desktop"], "buildStatus": "ready"}]))
    settings = ComputerHostSettings(config, transport)
    settings.update(ComputerSettingsPatch(source="embed", apiUrl="http://fake.test:3000", apiKey="fake", maxMachines=1))
    sdk = FakeSDK()
    computer = ComputerHost(settings, Bus(), sdk)
    try:
        yield computer, sdk
    finally:
        await computer.shutdown()


async def test_checks_connection_and_reuses_paused_machine(host):
    computer, sdk = host
    with pytest.raises(ComputerUnavailable, match="Check the computer host connection"):
        await computer.wake("bot")
    await computer.settings.test()

    first, second = await asyncio.gather(computer.wake("bot"), computer.wake("bot"))
    assert first is second
    assert sdk.created == 1
    with pytest.raises(ComputerUnavailable, match="machine limit"):
        await computer.wake("other")
    with pytest.raises(ValueError, match="Delete existing computers"):
        await computer.update_settings(ComputerSettingsPatch(apiUrl="http://other.test"))
    assert (await computer.pause("bot"))["status"] == "paused"
    assert first.state == "paused"
    assert await computer.wake("bot") is first
    assert first.state == "running"
    await computer.destroy("bot")
    assert computer.state("bot")["status"] == "none"
    assert not sdk.sandboxes


async def test_recover_keeps_tracked_and_reaps_only_own_orphans(host):
    computer, sdk = host
    await computer.settings.test()
    tracked = await computer.wake("bot")
    owner = tracked.metadata[METADATA_OWNER]
    sdk.sandboxes["orphan"] = FakeSandbox("orphan", {METADATA_OWNER: owner, METADATA_BOT: "other"})
    sdk.sandboxes["foreign"] = FakeSandbox("foreign", {METADATA_OWNER: "another-instance", METADATA_BOT: "other"})
    await computer.shutdown()

    reopened = ConfigStore(computer.config.path)
    replacement = ComputerHost(ComputerHostSettings(reopened, computer.settings.transport), Bus(), sdk)
    try:
        await replacement.recover()
        assert set(sdk.sandboxes) == {tracked.sandbox_id, "foreign"}
        assert replacement.state("bot")["status"] == "paused"
        assert await replacement.wake("bot") is tracked
    finally:
        await replacement.shutdown()


async def test_computer_mcp_images_approvals_and_control(host, tmp_path):
    pytest.importorskip("PIL")
    computer, sdk = host
    await computer.settings.test()
    allowed = False

    async def policy(*args):
        return {"behavior": "allow" if allowed else "deny"}

    async def bot(bot_id):
        return SimpleNamespace(id=bot_id, cwd=str(tmp_path))

    async def settings(bot_id):
        return {"enabled": True, "resolution": (1280, 800), "runCommands": False}

    turn = SimpleNamespace(bot_id="bot", inp=SimpleNamespace(custom_mcp={"computer": {}}, cwd=str(tmp_path)))
    mcp = ComputerMcp(computer, SimpleNamespace(get_bot=bot), SimpleNamespace(runs={"thread": turn}, computer_settings=settings),
                      SimpleNamespace(ask=policy), tmp_path)

    async def call(name, **args):
        return (await mcp.request("thread", "tools/call", {"name": name, "arguments": args}))["result"]

    assert (await call("computer_click", x=20, y=20))["isError"]
    assert not sdk.sandboxes
    read = await call("computer_screenshot")
    assert read["content"][1]["mimeType"] == "image/jpeg"
    assert (await call("computer_run_command", command="id"))["isError"]
    allowed = True
    machine = computer.live("bot")

    waiting = asyncio.create_task(call("computer_request_help", reason="Sign in"))
    for _ in range(20):
        if computer.state("bot")["held"]:
            break
        await asyncio.sleep(0.005)
    assert computer.state("bot")["helpReason"] == "Sign in"
    assert (await call("computer_click", x=20, y=20))["isError"]
    assert not machine.clicks
    await computer.set_control("bot", False)
    assert (await waiting)["content"][0]["text"] == "The person returned control."
    await call("computer_click", x=20, y=20)
    assert machine.clicks == [(20, 20)]
