"""Own the computer-use machines of the agents (E2B or OpenSandbox) and preserve their state when they are idle."""
from __future__ import annotations

import asyncio
import logging
import sys
import time
from uuid import uuid4

from .computer_provider import (  # noqa: F401  (the names other modules and tests import from here)
    DEFAULT_RESOLUTION, KEEP_AWAKE, METADATA_BOT, METADATA_OWNER, PRIVATE_NETWORKS, ComputerUnavailable, Provider, call, provider_for,
)
from .computer_settings import ComputerHostSettings, ComputerSettingsPatch

log = logging.getLogger(__name__)
RENEW_EVERY = 300  # seconds between asking the provider to keep a used machine from expiring


class ComputerHost:
    def __init__(self, settings: ComputerHostSettings, bus, sdk=None, opensandbox_sdk=None) -> None:
        self.settings = settings
        self.config = settings.config
        self.bus = bus
        self._sdk = sdk
        self._opensandbox_sdk = opensandbox_sdk
        self._lock = asyncio.Lock()
        self._live: dict[str, object] = {}
        self._idle: dict[str, asyncio.Task] = {}
        self._operations: dict[str, asyncio.Lock] = {}
        self._control: dict[str, tuple[asyncio.Event, str | None]] = {}
        self._idle_seconds: dict[str, int] = {}
        self._renewed: dict[str, float] = {}

    @staticmethod
    def supports(driver) -> bool:
        return bool(
            sys.version_info >= (3, 11) and driver
            and driver.provider in {"codex", "claude", "antigravity"} and driver.capabilities.images and getattr(driver.capabilities, "mcpImages", False)
        )

    @property
    def records(self) -> dict:
        return self.config.data.setdefault("computerMachines", {})

    def provider(self, record: dict | None = None) -> Provider:
        connection = self.settings.connection()
        if not connection.api_url or (connection.source != "opensandbox" and not connection.key):
            raise ComputerUnavailable("Set up the computer host in Settings")
        provider = provider_for(connection, e2b_sdk=self._sdk, opensandbox_sdk=self._opensandbox_sdk)
        if record and record["provider"] != provider.identity():
            raise ComputerUnavailable("This computer belongs to a different computer host")
        return provider

    def capabilities(self) -> dict:
        try:
            return self.provider().capabilities()
        except ComputerUnavailable:
            return {}

    def _owner(self) -> str:
        owner = self.config.data.get("computerInstanceId")
        if not owner:
            owner = uuid4().hex
            self.config.data["computerInstanceId"] = owner
            self.config.save()
        return owner

    def state(self, bot_id: str) -> dict:
        record = self.records.get(bot_id)
        return {
            "status": record.get("status", "paused") if record else "none",
            "running": bot_id in self._live,
            "held": bot_id in self._control,
            "helpReason": self._control[bot_id][1] if bot_id in self._control else None,
            "resolution": record.get("resolution", DEFAULT_RESOLUTION) if record else DEFAULT_RESOLUTION,
        }

    def live(self, bot_id: str):
        return self._live.get(bot_id)

    def operation(self, bot_id: str) -> asyncio.Lock:
        return self._operations.setdefault(bot_id, asyncio.Lock())

    def _publish(self, bot_id: str) -> None:
        self.bus.publish({"kind": "computer-control", "botId": bot_id, **self.state(bot_id)})

    async def invoke(self, function, *args, **kwargs):
        # The SDK operation has already started when the caller is cancelled: its caller reconciles it under the lifecycle lock.
        return await call(function, *args, **kwargs)

    async def test(self) -> dict:
        """The connection test, with a check of a real machine where the provider has one (OpenSandbox)."""
        try:
            provider = self.provider()
        except ComputerUnavailable:
            return await self.settings.test()
        return await self.settings.test(deep=provider.probe_machine)

    async def update_settings(self, patch: ComputerSettingsPatch) -> dict:
        async with self._lock:
            return self.settings.update(patch)

    async def wake(self, bot_id: str, resolution: tuple[int, int] = DEFAULT_RESOLUTION, idle_seconds: int | None = None):
        async with self._lock:
            self._idle_seconds[bot_id] = idle_seconds or self.settings.public()["idleSeconds"]
            current = self._live.get(bot_id)
            if current is not None:
                self.touch(bot_id)
                await self._renew(bot_id, current)
                return current
            if self.settings.public()["status"] != "ready":
                raise ComputerUnavailable("Check the computer host connection in Settings")
            if len(self._live) >= self.settings.public()["maxMachines"]:
                raise ComputerUnavailable("The computer host has reached its machine limit")
            record = self.records.get(bot_id)
            provider = self.provider(record)
            timeout = 3600
            if record:
                current = await provider.connect(record, timeout)
                if current is None:
                    self.records.pop(bot_id)
                    self.config.save()
            if current is None:
                current = await provider.create(bot_id, self._owner(), resolution, timeout)
            self.records[bot_id] = {
                "sandboxId": current.sandbox_id,
                "provider": provider.identity(),
                "status": "running",
                "resolution": record.get("resolution", resolution) if record and record["sandboxId"] == current.sandbox_id else resolution,
            }
            self.config.save()
            self._live[bot_id] = current
            self._renewed[bot_id] = time.monotonic()
            self.touch(bot_id)
            try:
                # The desktop's screensaver blanks the screen after five idle minutes, and then both the agent's screenshots and the
                # person's live view are black: switch it off whenever the machine is started or resumed.
                await self.invoke(provider.keep_awake, current)
            except Exception:
                log.warning("Could not keep the computer for bot %s awake", bot_id)
            self._publish(bot_id)
            return current

    async def _renew(self, bot_id: str, machine) -> None:
        if time.monotonic() - self._renewed.get(bot_id, 0) < RENEW_EVERY:
            return
        self._renewed[bot_id] = time.monotonic()
        try:
            await self.provider(self.records.get(bot_id)).renew(machine, 3600)
        except Exception:
            log.warning("Could not renew the computer of bot %s", bot_id)

    def touch(self, bot_id: str) -> None:
        self._cancel_idle(bot_id)
        if bot_id not in self._control:
            self._idle[bot_id] = asyncio.create_task(self._pause_when_idle(bot_id))

    async def set_control(self, bot_id: str, held: bool) -> dict:
        async with self.operation(bot_id):
            if held:
                if bot_id not in self._live:
                    raise ComputerUnavailable("The computer is not running")
                self._control.setdefault(bot_id, (asyncio.Event(), None))
            else:
                self._release(bot_id)
            if bot_id in self._live:
                self.touch(bot_id)
            self._publish(bot_id)
        return self.state(bot_id)

    def _release(self, bot_id: str) -> None:
        previous = self._control.pop(bot_id, None)
        if previous:
            previous[0].set()

    async def ask_for_help(self, bot_id: str, reason: str, resolution: tuple[int, int] = DEFAULT_RESOLUTION, idle_seconds: int | None = None) -> bool:
        async with self.operation(bot_id):
            if bot_id in self._control:
                return False
            await self.wake(bot_id, resolution, idle_seconds)
            event = asyncio.Event()
            self._control[bot_id] = event, reason
            self._cancel_idle(bot_id)
            self._publish(bot_id)
        try:
            await asyncio.wait_for(event.wait(), 900)
            return bot_id in self._live
        except (TimeoutError, asyncio.CancelledError):
            async with self.operation(bot_id):
                place = self._control.get(bot_id)
                if place and place[0] is event:
                    self._release(bot_id)
                    if bot_id in self._live:
                        self.touch(bot_id)
                    self._publish(bot_id)
            return False

    def _cancel_idle(self, bot_id: str) -> None:
        timer = self._idle.pop(bot_id, None)
        if timer and timer is not asyncio.current_task():
            timer.cancel()

    async def _pause_when_idle(self, bot_id: str) -> None:
        try:
            await asyncio.sleep(min(self._idle_seconds[bot_id], 3540))
            await self.pause(bot_id)
        except Exception:
            log.warning("Could not pause idle computer for bot %s", bot_id)

    async def pause(self, bot_id: str) -> dict:
        async with self.operation(bot_id), self._lock:
            current = self._live.get(bot_id)
            if current is not None:
                await self.provider(self.records.get(bot_id)).pause(current, self.records[bot_id])
                self._live.pop(bot_id)
                self.records[bot_id]["status"] = "paused"
                self.config.save()
                self._release(bot_id)
                self._publish(bot_id)
            self._cancel_idle(bot_id)
            return self.state(bot_id)

    async def destroy(self, bot_id: str) -> None:
        async with self.operation(bot_id), self._lock:
            record = self.records.get(bot_id)
            if record:
                await self.provider(record).kill(record)
                self.records.pop(bot_id)
                self._live.pop(bot_id, None)
                self._idle_seconds.pop(bot_id, None)
                self.config.save()
                self._release(bot_id)
                self._publish(bot_id)
            self._cancel_idle(bot_id)

    async def recover(self, active_bots: set[str] | None = None) -> None:
        connection = self.settings.connection()
        if not connection.api_url or (connection.source != "opensandbox" and not connection.key) or (await self.test())["status"] != "ready":
            return
        owner = self.config.data.get("computerInstanceId")
        if not owner:
            return
        provider = self.provider()
        async with self._lock:
            machines = await provider.list_owned(owner)
            tracked = {
                record["sandboxId"]: (bot_id, record) for bot_id, record in self.records.items()
                if record["provider"] == provider.identity()
            }
            for machine in machines:
                entry = tracked.get(machine["sandboxId"])
                if entry is None or machine.get("bot") != entry[0] or active_bots is not None and entry[0] not in active_bots:
                    await provider.kill({"sandboxId": machine["sandboxId"]})
                    if entry is not None:
                        self.records.pop(entry[0], None)
                else:
                    # A machine left running by a previous process is adopted lazily.
                    entry[1]["status"] = machine.get("state")
            self.config.save()

    async def shutdown(self) -> None:
        for bot_id in list(self._idle):
            self._cancel_idle(bot_id)
        for bot_id in list(self._live):
            try:
                await self.pause(bot_id)
            except Exception:
                log.warning("Could not pause computer for bot %s during shutdown", bot_id)
