import asyncio
import io
from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest

from botteam.bus import Bus
from botteam.computer_host import ComputerHost, ComputerUnavailable, METADATA_BOT, METADATA_OWNER
from botteam.computer_opensandbox import PASTE, START, VIEWER_UP, OpenSandboxMachine, OpenSandboxProvider
from botteam.computer_settings import ComputerHostSettings, ComputerSettingsPatch
from botteam.config import ConfigStore

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 2000


class FakeSandbox:
    """The part of opensandbox.SandboxSync the provider uses, recording what it is asked to run."""

    def __init__(self, sandbox_id, metadata, state="Running"):
        self.id = sandbox_id
        self.metadata = metadata
        self.state = state
        self.ran = []
        self.files_written = {}
        self.renewed = []
        self.pause_fails = False
        self.killed = False
        self.commands = SimpleNamespace(run=self._run)
        self.files = SimpleNamespace(
            get_file_info=lambda paths: {path: SimpleNamespace(size=len(PNG)) for path in paths},
            read_bytes=lambda path: PNG,
            write_file=lambda path, data, mode=755: self.files_written.__setitem__(path, data),
        )

    def _run(self, command, opts=None):
        self.ran.append((command, opts))
        out = ("ready\n" if command == START else "/usr/bin/tool\n" if command.startswith("command -v")
               else "up\n" if command == VIEWER_UP and getattr(self, "desktop_up", False) else "")
        return SimpleNamespace(logs=SimpleNamespace(stdout=[SimpleNamespace(text=out)] if out else [], stderr=[]), error=None)

    def is_healthy(self):
        return self.state != "Paused"

    def check_ready(self, timeout, polling_interval):
        pass

    def get_info(self):
        return SimpleNamespace(status=SimpleNamespace(state=self.state), metadata=self.metadata)

    def get_endpoint(self, port):
        return SimpleNamespace(endpoint=f"server:8080/sandboxes/{self.id}/proxy/{port}", headers={"X-Test": "1"})

    def pause(self):
        if self.pause_fails:
            raise RuntimeError("not supported")
        self.state = "Paused"

    def renew(self, timeout):
        self.renewed.append(timeout)

    def kill(self):
        self.killed = True
        getattr(self, "on_kill", lambda: None)()

    def close(self):
        pass


class FakeServer:
    def __init__(self):
        self.sandboxes = {}
        self.created = []
        self.pause_fails = False
        self.counter = 0

    def made_for_bots(self):
        """What was made for a bot (the connection test also makes a machine, which is removed again)."""
        return [(image, options) for image, options in self.created if options.get("metadata")]


def fake_sdk(server):
    class Sandbox:
        @staticmethod
        def create(image, **options):
            assert options["entrypoint"] == ["sleep", "infinity"]
            assert options["env"]["RESOLUTION"] == "1280x800"
            targets = [rule.target for rule in options["network_policy"].egress]
            assert "100.64.0.0/10" in targets and "192.168.0.0/16" in targets and all(":" not in t for t in targets)
            assert options["network_policy"].default_action == "allow"
            server.counter += 1
            sandbox = FakeSandbox(f"os-{server.counter}", options.get("metadata") or {})
            sandbox.pause_fails = server.pause_fails
            sandbox.on_kill = lambda: server.sandboxes.pop(sandbox.id, None)
            server.sandboxes[sandbox.id] = sandbox
            server.created.append((image, options))
            return sandbox

        @staticmethod
        def connect(sandbox_id, connection_config=None, **options):
            if sandbox_id not in server.sandboxes:
                raise RuntimeError("sandbox not found (404)")
            return server.sandboxes[sandbox_id]

        @staticmethod
        def resume(sandbox_id, connection_config=None):
            server.sandboxes[sandbox_id].state = "Running"
            return server.sandboxes[sandbox_id]

    class Manager:
        @staticmethod
        def create(connection_config=None):
            return Manager()

        def list_sandbox_infos(self, filter):
            items = [SimpleNamespace(id=s.id, metadata=s.metadata, status=SimpleNamespace(state=s.state)) for s in server.sandboxes.values()
                     if all(s.metadata.get(k) == v for k, v in filter.metadata.items())]
            return SimpleNamespace(sandbox_infos=items, pagination=SimpleNamespace(has_next_page=False))

        def kill_sandbox(self, sandbox_id):
            if sandbox_id not in server.sandboxes:
                raise RuntimeError("not found")
            server.sandboxes.pop(sandbox_id).killed = True

        def close(self):
            pass

    ns = lambda **kw: SimpleNamespace(**kw)  # noqa: E731
    return SimpleNamespace(
        Sandbox=Sandbox, Manager=Manager, Config=ns, RunCommandOpts=ns, WriteEntry=ns,
        NetworkPolicy=ns, NetworkRule=ns, Filter=ns,
    )


def opensandbox_api(status=200, health=200):
    def handle(request):
        if request.url.path == "/health":
            return httpx.Response(health, json={"status": "healthy"})
        if request.url.path == "/v1/sandboxes":
            if request.headers.get("OPEN-SANDBOX-API-KEY") != "k1":
                return httpx.Response(401, json={"code": "INVALID_API_KEY"})
            return httpx.Response(status, json={"items": []})
        return httpx.Response(404)

    return httpx.MockTransport(handle)


@pytest.fixture
async def host(tmp_path, monkeypatch):
    for name in ("E2B_API_KEY", "E2B_API_URL", "OPENSANDBOX_URL", "OPENSANDBOX_API_KEY", "BOTTEAM_COMPUTER_IMAGE", "BOTTEAM_COMPUTER_IDLE_S"):
        monkeypatch.delenv(name, raising=False)
    config = ConfigStore(tmp_path / "config.json")
    settings = ComputerHostSettings(config, opensandbox_api())
    settings.update(ComputerSettingsPatch(source="opensandbox", apiUrl="http://server:8080", apiKey="k1", maxMachines=2))
    server = FakeServer()
    computer = ComputerHost(settings, Bus(), opensandbox_sdk=fake_sdk(server))
    try:
        yield computer, server
    finally:
        await computer.shutdown()


async def test_status_of_the_connection(tmp_path, monkeypatch):
    for name in ("OPENSANDBOX_URL", "OPENSANDBOX_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    settings = ComputerHostSettings(ConfigStore(tmp_path / "config.json"), opensandbox_api())
    settings.update(ComputerSettingsPatch(source="opensandbox", apiUrl="http://server:8080", apiKey="wrong"))
    assert (await settings.test())["status"] == "unauthorized"
    settings.update(ComputerSettingsPatch(apiKey="k1"))
    result = await settings.test()
    assert result["status"] == "ready" and result["image"] == "botteam/desktop:1" and result["keyHint"] is None
    assert (await settings.test(deep=lambda: asyncio.sleep(0, "no_image")))["status"] == "no_image"
    settings.transport = opensandbox_api(health=503)
    assert (await settings.test())["status"] == "unreachable"


async def test_a_key_is_kept_apart_per_provider(tmp_path, monkeypatch):
    for name in ("E2B_API_KEY", "E2B_API_URL", "OPENSANDBOX_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    settings = ComputerHostSettings(ConfigStore(tmp_path / "config.json"), opensandbox_api())
    settings.update(ComputerSettingsPatch(source="cloud", apiKey="e2b-secret"))
    settings.update(ComputerSettingsPatch(source="opensandbox", apiUrl="http://server:8080", apiKey="k1"))
    assert settings.connection().key == "k1"
    settings.update(ComputerSettingsPatch(source="cloud"))
    assert settings.connection().key == "e2b-secret"  # the other provider's key was not touched or carried over
    settings.update(ComputerSettingsPatch(source="opensandbox"))
    assert settings.connection().key == "k1"


async def test_makes_reuses_freezes_and_removes_a_machine(host):
    computer, server = host
    assert computer.capabilities()["isolation"] == "container"
    await computer.test()
    first, second = await asyncio.gather(computer.wake("bot"), computer.wake("bot"))
    assert first is second and len(server.made_for_bots()) == 1
    image, options = server.made_for_bots()[0]
    assert image == "botteam/desktop:1" and options["metadata"][METADATA_BOT] == "bot" and options["metadata"][METADATA_OWNER]
    sandbox = next(iter(server.sandboxes.values()))
    assert any(command == START for command, _ in sandbox.ran)  # the desktop is started
    with pytest.raises(ValueError, match="Delete existing computers"):
        await computer.update_settings(ComputerSettingsPatch(apiUrl="http://other:8080"))

    assert (await computer.pause("bot"))["status"] == "paused"
    assert sandbox.state == "Paused"
    assert await computer.wake("bot") is not None and sandbox.state == "Running"  # resumed, not made again
    assert len(server.made_for_bots()) == 1
    await computer.destroy("bot")
    assert computer.state("bot")["status"] == "none" and sandbox.killed and not server.sandboxes


async def test_a_machine_that_cannot_be_frozen_is_removed_and_made_again(host):
    computer, server = host
    server.pause_fails = True
    await computer.test()
    await computer.wake("bot")
    await computer.pause("bot")
    assert not server.sandboxes  # removed instead
    await computer.wake("bot")
    assert len(server.made_for_bots()) == 2 and computer.state("bot")["status"] == "running"


async def test_recover_removes_only_this_programs_orphans(host):
    computer, server = host
    await computer.test()
    await computer.wake("bot")
    mine = next(iter(server.sandboxes))
    owner = server.sandboxes[mine].metadata[METADATA_OWNER]
    server.sandboxes["orphan"] = FakeSandbox("orphan", {METADATA_OWNER: owner, METADATA_BOT: "gone"})
    server.sandboxes["foreign"] = FakeSandbox("foreign", {METADATA_OWNER: "someone-else", METADATA_BOT: "x"})
    await computer.recover()
    assert set(server.sandboxes) == {mine, "foreign"}


async def test_actions_become_xdotool_commands_and_screenshots_are_read_back():
    sandbox = FakeSandbox("m", {})
    machine = OpenSandboxMachine(sandbox, fake_sdk(FakeServer()))
    machine.left_click(10, 20)
    machine.right_click(1, 2)
    machine.double_click(3, 4)
    machine.drag((1, 2), (30, 40))
    machine.scroll("down", 3)
    machine.scroll("up", 1)
    machine.press(["ctrl", "s"])
    machine.write("hello 'world'", delay_in_ms=7)
    commands = [command for command, _ in sandbox.ran]
    assert "xdotool mousemove 10 20 click 1" in commands[0]
    assert "click 3" in commands[1] and "--repeat 2" in commands[2]
    assert "mousedown 1 mousemove 30 40 mouseup 1" in commands[3]
    assert "click --repeat 3 --delay 40 5" in commands[4] and "click --repeat 1 --delay 40 4" in commands[5]
    assert "key --clearmodifiers ctrl+s" in commands[6]
    assert "type --delay 7 -- 'hello '" in commands[7]  # quoted for the shell
    assert machine.screenshot() == PNG
    assert any("scrot" in command for command in [c for c, _ in sandbox.ran])


async def test_text_that_is_not_ascii_is_pasted_through_the_clipboard():
    sandbox = FakeSandbox("m", {})
    machine = OpenSandboxMachine(sandbox, fake_sdk(FakeServer()))
    machine.write("Xin chào, đây là tiếng Việt")
    assert sandbox.files_written[PASTE] == "Xin chào, đây là tiếng Việt".encode()
    assert "xclip -selection clipboard" in sandbox.ran[-1][0] and "ctrl+v" in sandbox.ran[-1][0]


async def test_the_screen_stream_goes_through_the_server():
    server = FakeServer()
    provider = OpenSandboxProvider(SimpleNamespace(api_url="http://server:8080", key="k1", template="botteam/desktop:1", source="opensandbox",
                                                   identity=lambda: ["opensandbox", "http://server:8080", "", ""]), sdk=fake_sdk(server))
    machine = OpenSandboxMachine(FakeSandbox("m1", {}), provider.sdk)
    url, headers = provider.viewer(machine)
    assert url == "ws://server:8080/sandboxes/m1/proxy/6080/websockify" and headers == {"X-Test": "1"}


async def test_a_missing_image_is_reported_by_the_machine_check():
    server = FakeServer()
    sdk = fake_sdk(server)

    def create(image, **options):
        raise RuntimeError("pull access denied for botteam/desktop, repository does not exist")

    sdk.Sandbox.create = staticmethod(create)
    provider = OpenSandboxProvider(SimpleNamespace(api_url="http://server:8080", key="", template="botteam/desktop:1", source="opensandbox",
                                                   identity=lambda: []), sdk=sdk)
    assert await provider.probe_machine() == "no_image"


async def test_opening_the_stream_only_runs_the_start_script_when_something_stopped():
    sandbox = FakeSandbox("m", {})
    provider = OpenSandboxProvider(SimpleNamespace(api_url="http://server:8080", key="", template="botteam/desktop:1", source="opensandbox",
                                                   identity=lambda: []), sdk=fake_sdk(FakeServer()))
    machine = OpenSandboxMachine(sandbox, provider.sdk)
    sandbox.desktop_up = True
    provider.ensure_viewer(machine)  # never checked: one quick check
    provider.ensure_viewer(machine)  # checked a moment ago: the machine is not asked at all
    assert [command for command, _ in sandbox.ran] == [VIEWER_UP]
    provider.forget_viewer(machine)  # a stream failed
    sandbox.desktop_up = False
    provider.ensure_viewer(machine)
    assert [command for command, _ in sandbox.ran][-2:] == [VIEWER_UP, START]  # something stopped: the script puts it back
