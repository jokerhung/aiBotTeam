"""Where the computer-use machines come from: E2B (Cloud or a self-hosted Embed) or OpenSandbox (Docker).

A provider creates, finds, pauses and kills machines. A machine is the small desktop facade the agent tools use (`perform` in
computer_mcp.py): `screenshot`, `left_click`, `right_click`, `double_click`, `move_mouse`, `drag`, `scroll`, `write`, `press`,
`launch`, `wait`, `commands.run`, `files.get_info/read/write`. The E2B desktop sandbox already has that shape and is used as it is;
OpenSandbox gets an adapter (computer_opensandbox.py). Machine calls block, so the host runs them in worker threads.
"""
from __future__ import annotations

import asyncio

DEFAULT_RESOLUTION = (1280, 800)
PRIVATE_NETWORKS = [
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16",
    "100.64.0.0/10", "127.0.0.0/8", "::1/128", "fc00::/7", "fe80::/10",
]
METADATA_OWNER = "botteamInstance"
METADATA_BOT = "botteam"
# The desktop's screensaver blanks the screen after five idle minutes, and then both the agent's screenshots and the person's
# live view are black: it is switched off whenever a machine is started or resumed.
KEEP_AWAKE = (
    "export DISPLAY=:0; xfce4-screensaver-command --deactivate >/dev/null 2>&1; pkill -x xfce4-screensaver; "
    "xset s off s noblank >/dev/null 2>&1; true"
)


class ComputerUnavailable(RuntimeError):
    pass


async def call(function, *args, **kwargs):
    """Run a blocking SDK call in a worker thread. A cancelled caller still waits for the call to end: it has already started."""
    task = asyncio.create_task(asyncio.to_thread(function, *args, **kwargs))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        return await task


class Provider:
    """What every machine provider offers. `record` is the saved entry of a machine (computerMachines in the config)."""

    kind = ""
    label = ""

    def __init__(self, connection) -> None:
        self.connection = connection

    def identity(self) -> list[str]:
        return self.connection.identity()

    def capabilities(self) -> dict:
        """How this provider differs from the others, in terms the settings page can show:
        pause: snapshot (memory and disk kept) | freeze (processes stopped in place) | none (the machine is removed when idle);
        persistentLogin: snapshot | volume | none; egressPolicy: whether outbound traffic is limited per machine;
        isolation: vm | gvisor | container."""
        raise NotImplementedError

    async def create(self, bot_id: str, owner: str, resolution: tuple[int, int], timeout: int):
        raise NotImplementedError

    async def connect(self, record: dict, timeout: int):
        """The machine of a saved record, running again; None when it no longer exists."""
        raise NotImplementedError

    async def renew(self, machine, timeout: int) -> None:
        """Keep a running machine from expiring while it is used."""

    async def pause(self, machine, record: dict) -> None:
        raise NotImplementedError

    async def kill(self, record: dict) -> None:
        raise NotImplementedError

    async def list_owned(self, owner: str) -> list[dict]:
        """The machines this BotTeam made: [{"sandboxId", "bot", "state"}]."""
        raise NotImplementedError

    def ensure_viewer(self, machine) -> None:
        """Make sure the machine serves its screen (blocking)."""
        raise NotImplementedError

    def viewer(self, machine) -> tuple[str, dict[str, str]]:
        """The WebSocket address of the machine's screen stream, and the headers to send to it."""
        raise NotImplementedError

    def forget_viewer(self, machine) -> None:
        """The screen stream failed: a provider that remembers a stream as running should check the machine again."""

    def keep_awake(self, machine) -> None:
        machine.commands.run(KEEP_AWAKE, timeout=10)

    async def probe_machine(self) -> str | None:
        """An optional deeper check run by the connection test; a status such as no_image, or None when fine."""
        return None


class E2BProvider(Provider):
    kind = "e2b"
    label = "E2B"

    def __init__(self, connection, sdk=None) -> None:
        super().__init__(connection)
        self._sdk = sdk

    def backend(self):
        if self._sdk is None:
            try:
                from e2b_desktop import Sandbox
            except ImportError:
                raise ComputerUnavailable("Install optional Computer packages: uv sync --project server --extra computer (Python 3.11 or later)") from None
            self._sdk = Sandbox
        return self._sdk

    def options(self) -> dict:
        return {**self.connection.sdk_options(), "request_timeout": 30, "retries": 0}

    def capabilities(self) -> dict:
        return {"pause": "snapshot", "persistentLogin": "snapshot", "egressPolicy": True, "isolation": "vm"}

    async def create(self, bot_id, owner, resolution, timeout):
        sandbox = await call(
            self.backend().create, template=self.connection.template, resolution=resolution, timeout=timeout,
            metadata={METADATA_OWNER: owner, METADATA_BOT: bot_id}, secure=True,
            lifecycle={"on_timeout": "pause"},
            network={"allow_public_traffic": False, "deny_out": PRIVATE_NETWORKS},
            **self.options(),
        )
        # The SDK waits for Xfce processes, then the desktop still needs to paint.
        await asyncio.sleep(2.5)
        return sandbox

    async def connect(self, record, timeout):
        try:
            return await call(self.backend().connect, record["sandboxId"], timeout=timeout, **self.options())
        except Exception as exc:
            from e2b.exceptions import NotFoundException

            if not isinstance(exc, NotFoundException):
                raise
            return None

    async def pause(self, machine, record):
        await call(machine.pause, mode="full")

    async def kill(self, record):
        await call(self.backend().kill, record["sandboxId"], **self.options())

    async def list_owned(self, owner):
        options = self.options()

        def entries():
            paginator = self.backend().list(query={"metadata": {METADATA_OWNER: owner}}, **options)
            while paginator.has_next:
                yield from paginator.next_items()

        found = []
        for sandbox in await call(lambda: list(entries())):
            metadata = sandbox.metadata or {}
            if metadata.get(METADATA_OWNER) == owner:
                found.append({"sandboxId": sandbox.sandbox_id, "bot": metadata.get(METADATA_BOT),
                              "state": getattr(sandbox.state, "value", sandbox.state)})
        return found

    def ensure_viewer(self, machine):
        from .computer_stream import ensure_viewer

        ensure_viewer(machine)

    def viewer(self, machine):
        from .computer_stream import upstream

        return upstream(machine, self.connection)


def provider_for(connection, *, e2b_sdk=None, opensandbox_sdk=None) -> Provider:
    """The provider the saved connection asks for."""
    if connection.source == "opensandbox":
        from .computer_opensandbox import OpenSandboxProvider

        return OpenSandboxProvider(connection, sdk=opensandbox_sdk)
    return E2BProvider(connection, sdk=e2b_sdk)
