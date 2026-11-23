"""OpenSandbox (Docker runtime) as a computer-use provider.

A machine is a container made from the desktop image of docs/opensandbox-desktop. The agent's mouse, keyboard and screenshots are
`xdotool` and `scrot` commands run inside it; the person's live view is the container's view-only noVNC stream, reached through
the OpenSandbox server.
"""
from __future__ import annotations

import io
import shlex
import time
from datetime import timedelta
from types import SimpleNamespace
from urllib.parse import urlsplit

from .computer_provider import (
    METADATA_BOT, METADATA_OWNER, PRIVATE_NETWORKS, ComputerUnavailable, Provider, call,
)

START = "botteam-desktop-start"
STREAM_PORT = 6080
VIEWER_TRUST_S = 300  # how long a checked (or just started) screen stream is trusted without asking the machine again
# What the screen stream needs, checked in a fraction of a second. The [w] keeps pgrep from matching its own command line.
VIEWER_UP = "pgrep -x Xvfb >/dev/null && pgrep -x xfce4-panel >/dev/null && pgrep -x x11vnc >/dev/null && pgrep -f '[w]ebsockify.*6080' >/dev/null && echo up"
SHOT = "/tmp/botteam-shot.png"
PASTE = "/tmp/botteam-paste.txt"
IMAGE_HINT = "Build the desktop image on the OpenSandbox server (see the setup guide)"


class SdkCall:
    """The few OpenSandbox SDK names the provider needs, loaded together so a test can replace them."""

    def __init__(self) -> None:
        try:
            from opensandbox import SandboxManagerSync, SandboxSync
            from opensandbox.config import ConnectionConfigSync
            from opensandbox.models.execd import RunCommandOpts
            from opensandbox.models.filesystem import WriteEntry
            from opensandbox.models.sandboxes import NetworkPolicy, NetworkRule, SandboxFilter
        except ImportError:
            raise ComputerUnavailable("Computer use with OpenSandbox needs the opensandbox package") from None
        self.Sandbox, self.Manager, self.Config = SandboxSync, SandboxManagerSync, ConnectionConfigSync
        self.RunCommandOpts, self.WriteEntry = RunCommandOpts, WriteEntry
        self.NetworkPolicy, self.NetworkRule, self.Filter = NetworkPolicy, NetworkRule, SandboxFilter


class _Commands:
    def __init__(self, sandbox, sdk) -> None:
        self.sandbox, self.sdk = sandbox, sdk

    def run(self, command: str, timeout: float | None = None, background: bool = False, envs: dict | None = None):
        opts = self.sdk.RunCommandOpts(
            background=background, **({"timeout": timedelta(seconds=timeout)} if timeout and not background else {}),
            **({"envs": envs} if envs else {}),
        )
        execution = self.sandbox.commands.run(command, opts=opts)
        stdout = "".join(message.text for message in execution.logs.stdout)
        stderr = "".join(message.text for message in execution.logs.stderr)
        if execution.error is not None and not background:
            stderr += f"{execution.error.name}: {execution.error.value}"
        return SimpleNamespace(stdout=stdout, stderr=stderr, error=execution.error, disconnect=lambda: None)


class _Files:
    def __init__(self, sandbox, sdk) -> None:
        self.sandbox, self.sdk = sandbox, sdk

    def get_info(self, path: str):
        info = self.sandbox.files.get_file_info([path])[path]
        return SimpleNamespace(size=info.size)

    def read(self, path: str, format: str = "bytes"):
        return self.sandbox.files.read_bytes(path)

    def write(self, path: str, data: bytes) -> None:
        self.sandbox.files.write_file(path, data, mode=644)


class OpenSandboxMachine:
    """The desktop facade of computer_mcp.perform over an OpenSandbox container."""

    def __init__(self, sandbox, sdk) -> None:
        self.sandbox, self.sdk = sandbox, sdk
        self.sandbox_id = sandbox.id
        self.commands = _Commands(sandbox, sdk)
        self.files = _Files(sandbox, sdk)
        self.traffic_access_token = None
        self.viewer_ok = 0.0  # when the screen stream was last known to be running (time.monotonic)

    def _xdo(self, args: str) -> None:
        result = self.commands.run(f"export DISPLAY=:0; xdotool {args}", timeout=20)
        if result.error is not None:
            raise ComputerUnavailable(f"The computer could not do that: {(result.stderr or 'xdotool failed')[:200]}")

    def screenshot(self) -> bytes:
        result = self.commands.run(f"export DISPLAY=:0; scrot -o -z {SHOT}", timeout=20)
        if result.error is not None:
            raise ComputerUnavailable("The computer could not take a screenshot")
        return self.files.read(SHOT)

    def left_click(self, x: int, y: int) -> None:
        self._xdo(f"mousemove {int(x)} {int(y)} click 1")

    def right_click(self, x: int, y: int) -> None:
        self._xdo(f"mousemove {int(x)} {int(y)} click 3")

    def double_click(self, x: int, y: int) -> None:
        self._xdo(f"mousemove {int(x)} {int(y)} click --repeat 2 --delay 80 1")

    def move_mouse(self, x: int, y: int) -> None:
        self._xdo(f"mousemove {int(x)} {int(y)}")

    def drag(self, start: tuple[int, int], end: tuple[int, int]) -> None:
        self._xdo(f"mousemove {int(start[0])} {int(start[1])} mousedown 1 mousemove {int(end[0])} {int(end[1])} mouseup 1")

    def scroll(self, direction: str, amount: int = 1) -> None:
        self._xdo(f"click --repeat {int(amount)} --delay 40 {5 if direction == 'down' else 4}")

    def write(self, text: str, delay_in_ms: int = 5) -> None:
        if text.isascii():
            self._xdo(f"type --delay {int(delay_in_ms)} -- {shlex.quote(text)}")
            return
        # xdotool types non-ASCII text unreliably (it depends on the keyboard layout): paste it through the clipboard.
        self.files.write(PASTE, text.encode("utf8"))
        result = self.commands.run(f"export DISPLAY=:0; xclip -selection clipboard -i {PASTE} && xdotool key --clearmodifiers ctrl+v", timeout=20)
        if result.error is not None:
            raise ComputerUnavailable("The computer could not paste that text")

    def press(self, keys: list[str]) -> None:
        self._xdo(f"key --clearmodifiers {shlex.quote('+'.join(keys))}")

    def launch(self, application: str, uri: str | None = None) -> None:
        target = f"{application} {uri}" if uri else application  # uri is already shell-quoted by the caller
        self.commands.run(f"export DISPLAY=:0; setsid -f sh -c '(gtk-launch {target} || {target})' >/dev/null 2>&1", timeout=15)

    def wait(self, milliseconds: int) -> None:
        time.sleep(milliseconds / 1000)


class OpenSandboxProvider(Provider):
    kind = "opensandbox"
    label = "OpenSandbox"

    def __init__(self, connection, sdk=None) -> None:
        super().__init__(connection)
        self._sdk = sdk

    @property
    def sdk(self) -> SdkCall:
        if self._sdk is None:
            self._sdk = SdkCall()
        return self._sdk

    def config(self):
        url = urlsplit(self.connection.api_url)
        return self.sdk.Config(
            api_key=self.connection.key or None, domain=url.netloc, protocol=url.scheme or "http",
            request_timeout=timedelta(seconds=30), use_server_proxy=True,
        )

    def capabilities(self) -> dict:
        # Docker containers: removed or frozen when idle, not snapshotted. gVisor or Kata can be turned on in the server.
        return {"pause": "freeze", "persistentLogin": "freeze", "egressPolicy": True, "isolation": "container"}

    def _policy(self):
        sdk = self.sdk
        return sdk.NetworkPolicy(default_action="allow", egress=[sdk.NetworkRule(action="deny", target=cidr) for cidr in PRIVATE_NETWORKS if ":" not in cidr])

    async def create(self, bot_id, owner, resolution, timeout):
        sdk = self.sdk

        def build():
            sandbox = sdk.Sandbox.create(
                self.connection.template, connection_config=self.config(), timeout=timedelta(seconds=timeout),
                ready_timeout=timedelta(seconds=90), entrypoint=["sleep", "infinity"],
                env={"RESOLUTION": f"{resolution[0]}x{resolution[1]}"}, metadata={METADATA_OWNER: owner, METADATA_BOT: bot_id},
                network_policy=self._policy(),
            )
            try:
                machine = OpenSandboxMachine(sandbox, sdk)
                result = machine.commands.run(START, timeout=60)
                if result.error is not None or "ready" not in result.stdout:
                    raise ComputerUnavailable("The computer's desktop did not start: " + (result.stderr or result.stdout)[:200])
                machine.viewer_ok = time.monotonic()
                return machine
            except BaseException:
                try:
                    sandbox.kill()
                finally:
                    raise

        try:
            return await call(build)
        except ComputerUnavailable:
            raise
        except Exception as exc:
            raise ComputerUnavailable(f"OpenSandbox could not start the computer ({IMAGE_HINT if 'image' in str(exc).lower() else str(exc)[:160]})") from exc

    async def connect(self, record, timeout):
        sdk = self.sdk

        def attach():
            try:
                # A frozen machine does not answer its health check: look at its state first, resume it, then wait for it.
                sandbox = sdk.Sandbox.connect(record["sandboxId"], connection_config=self.config(), skip_health_check=True)
            except Exception as exc:
                if any(word in str(exc).lower() for word in ("not found", "404", "does not exist", "not_found")):
                    return None
                raise
            info = sandbox.get_info()
            if str(getattr(info.status, "state", "")).lower() in ("paused", "pausing"):
                sandbox.close()
                sandbox = sdk.Sandbox.resume(record["sandboxId"], connection_config=self.config())
            elif not sandbox.is_healthy():
                sandbox.check_ready(timedelta(seconds=30), timedelta(seconds=1))
            machine = OpenSandboxMachine(sandbox, sdk)
            result = machine.commands.run(START, timeout=60)  # leaves what already runs alone
            if result.error is not None or "ready" not in result.stdout:
                raise ComputerUnavailable("The computer's desktop did not start again")
            machine.viewer_ok = time.monotonic()
            return machine

        return await call(attach)

    async def renew(self, machine, timeout):
        await call(machine.sandbox.renew, timedelta(seconds=timeout))

    async def pause(self, machine, record):
        try:
            await call(machine.sandbox.pause)
        except Exception:
            # This runtime cannot freeze a machine: it is removed instead, and the next wake makes a new one.
            await call(machine.sandbox.kill)

    async def kill(self, record):
        sdk = self.sdk

        def remove():
            manager = sdk.Manager.create(connection_config=self.config()) if hasattr(sdk.Manager, "create") else sdk.Manager(self.config())
            try:
                manager.kill_sandbox(record["sandboxId"])
            finally:
                manager.close()

        try:
            await call(remove)
        except Exception as exc:
            if not any(word in str(exc).lower() for word in ("not found", "404", "does not exist", "not_found")):
                raise

    async def list_owned(self, owner):
        sdk = self.sdk

        def entries():
            manager = sdk.Manager.create(connection_config=self.config()) if hasattr(sdk.Manager, "create") else sdk.Manager(self.config())
            try:
                page, found = 1, []
                while True:
                    result = manager.list_sandbox_infos(sdk.Filter(metadata={METADATA_OWNER: owner}, page=page, page_size=50))
                    for info in result.sandbox_infos if hasattr(result, "sandbox_infos") else result.items:
                        metadata = info.metadata or {}
                        if metadata.get(METADATA_OWNER) == owner:
                            found.append({"sandboxId": info.id, "bot": metadata.get(METADATA_BOT),
                                          "state": str(getattr(info.status, "state", "") or "running").lower()})
                    if not getattr(result.pagination, "has_next_page", False):
                        return found
                    page += 1
            finally:
                manager.close()

        return await call(entries)

    def ensure_viewer(self, machine) -> None:
        # Opening the stream is done each time the person looks at the screen, and every command costs about a second: a machine that
        # was just started, or whose stream was checked a moment ago, is not asked again. Otherwise a quick check runs first, and the
        # start script (with its waits) only when something it starts has stopped.
        if time.monotonic() - machine.viewer_ok < VIEWER_TRUST_S:
            return
        if machine.commands.run(VIEWER_UP, timeout=10).stdout.strip() != "up":
            result = machine.commands.run(START, timeout=60)
            if result.error is not None:
                raise ComputerUnavailable("The computer's screen stream did not start")
        machine.viewer_ok = time.monotonic()

    def forget_viewer(self, machine) -> None:
        """The stream failed: the next one checks the machine again."""
        machine.viewer_ok = 0.0

    def viewer(self, machine):
        endpoint = machine.sandbox.get_endpoint(STREAM_PORT)
        base = endpoint.endpoint
        scheme = "wss" if self.connection.api_url.startswith("https") else "ws"
        return f"{scheme}://{base.split('://')[-1].rstrip('/')}/websockify", dict(endpoint.headers or {})

    async def probe_machine(self) -> str | None:
        """Make a machine, check the desktop tools and a screenshot, and remove it: the answer for the connection test."""
        sdk = self.sdk

        def probe():
            try:
                sandbox = sdk.Sandbox.create(
                    self.connection.template, connection_config=self.config(), timeout=timedelta(seconds=120),
                    ready_timeout=timedelta(seconds=90), entrypoint=["sleep", "infinity"], env={"RESOLUTION": "1280x800"},
                    network_policy=self._policy(),
                )
            except Exception as exc:
                text = str(exc).lower()
                if any(word in text for word in ("egress", "network policy", "networkpolicy")):
                    return "no_egress_policy"
                return "no_image"
            try:
                machine = OpenSandboxMachine(sandbox, sdk)
                tools = machine.commands.run("command -v xdotool scrot Xvfb x11vnc websockify xclip >/dev/null && command -v " + START, timeout=20)
                if tools.error is not None or not tools.stdout.strip():
                    return "no_desktop_tools"
                started = machine.commands.run(START, timeout=60)
                if started.error is not None or "ready" not in started.stdout:
                    return "no_desktop_tools"
                picture = machine.screenshot()
                if not picture.startswith(b"\x89PNG") or len(picture) < 1000:
                    return "no_desktop_tools"
                return None
            finally:
                try:
                    sandbox.kill()
                finally:
                    sandbox.close()

        return await call(probe)
