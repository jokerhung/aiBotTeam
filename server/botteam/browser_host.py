"""Launch private Chromium profiles and attach the preview through loopback CDP."""
from __future__ import annotations

import asyncio
import hashlib
import os
import plistlib
import re
import shutil
import sys
import time
from contextlib import suppress
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .browser_egress import BrowserEgress
from .drivers.proc import kill_tree, run_text

VIEWPORT = {"width": 1280, "height": 800}
MIN_FRAME_GAP = 0.4
HELP_TIMEOUT = 15 * 60


class BrowserUnavailable(RuntimeError):
    pass


class BrowserProfile:
    def __init__(self, bot_id: str, context: Any, page: Any) -> None:
        self.bot_id, self.context, self.page = bot_id, context, page
        self.signature = None
        self.idle_seconds = 900
        self.control = "bot"
        self.help_reason: str | None = None
        self.watchers = 0
        self.active_until = 0.0
        self.last_hash = ""
        self.pump: asyncio.Task | None = None
        self.hand_back = asyncio.Event()
        self.operation = asyncio.Lock()
        self.title = ""


def browser_executables(channel: str) -> list[Path]:
    edge = channel == "msedge"
    if sys.platform == "win32":
        relative = "Microsoft/Edge/Application/msedge.exe" if edge else "Google/Chrome/Application/chrome.exe"
        roots = (os.environ.get(key) for key in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"))
        return [Path(root) / relative for root in roots if root]
    if sys.platform == "darwin":
        app = "Microsoft Edge" if edge else "Google Chrome"
        return [root / f"{app}.app/Contents/MacOS/{app}" for root in (Path("/Applications"), Path.home() / "Applications")]
    names = ("microsoft-edge", "microsoft-edge-stable") if edge else ("google-chrome", "google-chrome-stable")
    return [Path(path) for name in names if (path := shutil.which(name))]


async def installed_version(path: Path) -> str | None:
    try:
        if sys.platform == "win32":
            return max(
                (entry.name for entry in path.parent.iterdir() if entry.is_dir() and re.fullmatch(r"\d+(?:\.\d+){3}", entry.name)),
                key=lambda value: tuple(map(int, value.split("."))), default=None,
            )
        if sys.platform == "darwin":
            with (path.parent.parent / "Info.plist").open("rb") as file:
                return plistlib.load(file).get("CFBundleShortVersionString")
        _, output = await run_text([str(path), "--version"], timeout=3)
        match = re.search(r"\d+(?:\.\d+){2,3}", output)
        return match.group() if match else None
    except (OSError, plistlib.InvalidFileException):
        return None


class BrowserHost:
    def __init__(self, home: Path, bus, allow_local: bool = False, channel: str | None = None) -> None:
        self.home, self.bus = home, bus
        self.allow_local, self.channel = allow_local, channel
        self.pw = None
        self.browsers: dict[str, BrowserProfile] = {}
        self.lock = asyncio.Lock()
        self.playwright_lock = asyncio.Lock()
        self.processes: dict[str, asyncio.subprocess.Process] = {}
        self.connections = {}
        self.gateways: dict[str, BrowserEgress] = {}
        self.endpoints: dict[str, str] = {}
        self.versions: dict[str, str] = {}
        self.debug_ports: set[int] = set()
        self.idle_tasks: dict[str, asyncio.Task] = {}
        self.on_close = None
        self.settings = None
        self.taking: set[str] = set()
        try:
            self.idle_seconds = max(0, int(os.environ.get("BOTTEAM_BROWSER_IDLE_SECONDS", "900")))
        except ValueError:
            self.idle_seconds = 900

    async def _start(self):
        async with self.playwright_lock:
            if not self.pw:
                try:
                    from playwright.async_api import async_playwright
                except ImportError as exc:
                    raise BrowserUnavailable("Playwright is not installed.") from exc
                self.pw = await async_playwright().start()
            return self.pw

    async def shutdown(self) -> None:
        async with self.lock:
            for bot_id in list(self.browsers):
                await self._sleep(bot_id)
            if self.pw:
                await self.pw.stop()
                self.pw = None

    async def availability(self, bot_id: str | None = None, *, inventory: bool = False) -> dict:
        try:
            pw = await self._start()
        except BrowserUnavailable as exc:
            return {"available": False, "reason": str(exc)}
        settings = await self.settings(bot_id) if bot_id and self.settings else None
        choice = (settings or {}).get("browser", "auto")
        paths = {
            "msedge": browser_executables("msedge"),
            "chrome": browser_executables("chrome"),
            "chromium": [Path(pw.chromium.executable_path)],
        }
        installed = {channel: path for channel, candidates in paths.items() if (path := next((candidate for candidate in candidates if candidate.is_file()), None))}
        chosen = (self.channel if choice == "auto" else choice) or next(iter(installed), None)
        enabled = (settings or {}).get("surface", "browser") == "browser" and (settings or {}).get("enabled", True)
        version = self.versions.get(bot_id) if bot_id else None
        result = {"available": enabled and chosen in installed, "enabled": enabled, "installed": list(installed),
                  "reason": None if chosen in installed else "Install Microsoft Edge or Chrome, or run `playwright install chromium`.",
                  "browser": chosen, "version": version}
        if inventory:
            versions = await asyncio.gather(*(installed_version(path) for path in installed.values()))
            result["versions"] = dict(zip(installed, versions))
            result["mcpAvailable"] = bool(shutil.which("node") and shutil.which("npx"))
            if chosen and version:
                result["versions"][chosen] = version
        return result

    async def _launch(self, bot_id: str, *, channel: str | None = None, headed: bool = False, allow_local: bool | None = None):
        pw = await self._start()
        profile = self.home / "browser" / bot_id
        if profile.parent != self.home / "browser" or not bot_id or bot_id in (".", "..") or "/" in bot_id or "\\" in bot_id:
            raise BrowserUnavailable("Invalid browser profile")
        profile.mkdir(parents=True, exist_ok=True)
        marker = profile / "DevToolsActivePort"
        gateway = BrowserEgress(self.allow_local if allow_local is None else allow_local, self.debug_ports)
        port = await gateway.start()
        channels = [channel or self.channel] if channel or self.channel else ["msedge", "chrome", "chromium"]
        try:
            for candidate in channels:
                paths = [Path(pw.chromium.executable_path)] if candidate == "chromium" else browser_executables(candidate)
                for executable in dict.fromkeys(paths):
                    if not executable.is_file():
                        continue
                    marker.unlink(missing_ok=True)
                    cmd = [
                        str(executable), f"--user-data-dir={profile.resolve()}",
                        "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
                        "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
                        "--disable-extensions", "--disable-quic",
                        f"--proxy-server=socks5://127.0.0.1:{port}", "--proxy-bypass-list=<-loopback>",
                        "--webrtc-ip-handling-policy=disable_non_proxied_udp",
                        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
                        f"--window-size={VIEWPORT['width']},{VIEWPORT['height']}",
                    ]
                    if sys.platform == "darwin":
                        cmd.append("--use-mock-keychain")
                    elif sys.platform != "win32":
                        cmd.append("--password-store=basic")
                    if not headed:
                        cmd.append("--headless=new")
                    cmd.append("about:blank")
                    proc = None
                    connection = None
                    try:
                        proc = await asyncio.create_subprocess_exec(
                            *cmd, stdin=asyncio.subprocess.DEVNULL,
                            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                        )
                        endpoint = await asyncio.wait_for(self._endpoint(proc, marker), 10)
                        connection = await pw.chromium.connect_over_cdp(endpoint, timeout=5000, no_defaults=True)
                        context = connection.contexts[0]
                        self.processes[bot_id] = proc
                        self.connections[bot_id] = connection
                        self.gateways[bot_id] = gateway
                        self.endpoints[bot_id] = endpoint
                        self.debug_ports.add(int(endpoint.rsplit(":", 1)[-1]))
                        self.versions[bot_id] = connection.version
                        return context
                    except (Exception, asyncio.CancelledError) as exc:
                        if proc:
                            await kill_tree(proc)
                        if connection:
                            with suppress(Exception):
                                await asyncio.wait_for(connection.close(), 2)
                        if isinstance(exc, asyncio.CancelledError):
                            raise
        finally:
            if bot_id not in self.gateways:
                await gateway.close()
        raise BrowserUnavailable("No browser could be started. Install Edge or Chrome, or run `playwright install chromium`.")

    @staticmethod
    async def _endpoint(proc: asyncio.subprocess.Process, marker: Path) -> str:
        while proc.returncode is None:
            try:
                lines = marker.read_text(encoding="ascii").splitlines()
                port = int(lines[0])
                if 0 < port < 65536 and lines[1].startswith("/devtools/browser/"):
                    return f"http://127.0.0.1:{port}"
            except (OSError, ValueError, IndexError):
                pass
            await asyncio.sleep(0.05)
        raise BrowserUnavailable("The browser exited before opening its debugging connection")

    async def wake(self, bot_id: str) -> BrowserProfile:
        async with self.lock:
            settings = await self.settings(bot_id) if self.settings else None
            if settings and (not settings["enabled"] or settings.get("surface", "browser") != "browser"):
                raise BrowserUnavailable("The browser is disabled for this agent")
            browser = self.browsers.get(bot_id)
            signature = ((settings or {}).get("headed", False), (settings or {}).get("allowLocal", self.allow_local))
            if browser and self.processes[bot_id].returncode is None and browser.signature == signature:
                browser.idle_seconds = (settings or {}).get("idleSeconds", self.idle_seconds)
                return browser
            if browser:
                await self._sleep(bot_id)
            channel = (settings or {}).get("browser", "auto")
            headed = settings["headed"] if settings else os.environ.get("BOTTEAM_BROWSER_HEADLESS") == "0"
            local = settings["allowLocal"] if settings else self.allow_local
            context = await self._launch(bot_id, channel=None if channel == "auto" else channel, headed=headed, allow_local=local)
            try:
                page = context.pages[-1] if context.pages else await context.new_page()
                await page.set_viewport_size(VIEWPORT)
                browser = BrowserProfile(bot_id, context, page)
                browser.signature = signature
                browser.idle_seconds = (settings or {}).get("idleSeconds", self.idle_seconds)
                context.on("page", lambda opened: setattr(browser, "page", opened))
                self.browsers[bot_id] = browser
                session = await context.new_cdp_session(page)
                downloads = (settings or {}).get("allowDownloads", False)
                parameters = {"behavior": "deny"}
                if downloads:
                    destination = (self.home / "browser" / bot_id / "Downloads").resolve()
                    destination.mkdir(exist_ok=True)
                    parameters = {"behavior": "allow", "downloadPath": str(destination)}
                await session.send("Browser.setDownloadBehavior", parameters)
                await session.detach()
            except BaseException:
                await self._sleep(bot_id)
                raise
            self._publish_state(browser)
            self.idle_tasks[bot_id] = asyncio.create_task(self._idle(browser))
            return browser

    async def _idle(self, browser: BrowserProfile) -> None:
        idle_since = time.monotonic()
        while True:
            await asyncio.sleep(min(10, browser.idle_seconds or 10))
            async with self.lock:
                if self.browsers.get(browser.bot_id) is not browser:
                    return
                if self.processes[browser.bot_id].returncode is not None:
                    await self._sleep(browser.bot_id)
                    return
                if browser.watchers or browser.control == "person" or browser.operation.locked() or browser.active_until > time.time():
                    idle_since = time.monotonic()
                elif browser.idle_seconds and time.monotonic() - idle_since >= browser.idle_seconds:
                    await self._sleep(browser.bot_id)
                    return

    async def sleep(self, bot_id: str) -> bool:
        async with self.lock:
            return await self._sleep(bot_id)

    async def clear_profile(self, bot_id: str) -> None:
        root = (self.home / "browser").resolve()
        profile = (root / bot_id).resolve()
        if profile.parent != root:
            raise BrowserUnavailable("Invalid browser profile")
        async with self.lock:
            await self._sleep(bot_id)
            if profile.exists():
                await asyncio.to_thread(shutil.rmtree, profile)

    async def _sleep(self, bot_id: str) -> bool:
        idle = self.idle_tasks.pop(bot_id, None)
        if idle and idle is not asyncio.current_task():
            idle.cancel()
        browser = self.browsers.pop(bot_id, None)
        connection = self.connections.pop(bot_id, None)
        proc = self.processes.pop(bot_id, None)
        gateway = self.gateways.pop(bot_id, None)
        endpoint = self.endpoints.pop(bot_id, None)
        self.versions.pop(bot_id, None)
        try:
            if browser:
                browser.hand_back.set()
                if browser.pump:
                    browser.pump.cancel()
                    await asyncio.gather(browser.pump, return_exceptions=True)
                async with browser.operation:
                    if self.on_close:
                        await self.on_close(bot_id)
            if connection and proc and proc.returncode is None:
                session = await asyncio.wait_for(connection.new_browser_cdp_session(), 3)
                await asyncio.wait_for(session.send("Browser.close"), 3)
                await asyncio.wait_for(proc.wait(), 3)
        except Exception:
            pass
        finally:
            if proc:
                with suppress(OSError):
                    await kill_tree(proc)
            if gateway:
                await gateway.close()
            if connection:
                with suppress(Exception):
                    await asyncio.wait_for(connection.close(), 2)
            if endpoint:
                self.debug_ports.discard(int(endpoint.rsplit(":", 1)[-1]))
            if browser:
                self._publish_state(browser)
        return proc is not None

    def state(self, bot_id: str) -> dict:
        browser = self.browsers.get(bot_id)
        gateway = self.gateways.get(bot_id)
        return {
            "running": browser is not None, "held": bool(browser and browser.control == "person"),
            "helpReason": browser.help_reason if browser else None,
            "url": self._page(browser).url if browser else None, "title": browser.title if browser else None,
            "watching": browser.watchers if browser else 0,
            "allowLocal": gateway.allow_local if gateway else self.allow_local,
            "busy": self.is_busy(bot_id),
        }

    def _publish_state(self, browser: BrowserProfile) -> None:
        state = self.state(browser.bot_id)
        self.bus.publish({"kind": "browser-control", "botId": browser.bot_id, **state})

    def poke(self, browser: BrowserProfile) -> None:
        browser.active_until = time.time() + 4

    async def _pump(self, browser: BrowserProfile) -> None:
        session = None
        page = None
        latest = None
        acknowledgements: set[asyncio.Task] = set()

        async def acknowledge(cdp, session_id: int) -> None:
            try:
                await asyncio.wait_for(cdp.send("Page.screencastFrameAck", {"sessionId": session_id}), 2)
            except Exception:
                pass

        def on_frame(frame: dict) -> None:
            nonlocal latest
            latest = frame
            task = asyncio.create_task(acknowledge(session, frame["sessionId"]))
            acknowledgements.add(task)
            task.add_done_callback(acknowledgements.discard)

        try:
            while browser.watchers:
                current = self._page(browser)
                if current and current is not page:
                    if session:
                        await asyncio.wait_for(session.detach(), 2)
                    page = browser.page = current
                    latest = None
                    session = await browser.context.new_cdp_session(page)
                    session.on("Page.screencastFrame", on_frame)
                    await session.send("Page.startScreencast", {
                        "format": "jpeg", "quality": 60, "maxWidth": VIEWPORT["width"], "maxHeight": VIEWPORT["height"],
                    })
                if latest and page:
                    frame, latest = latest, None
                    url = page.url
                    digest = hashlib.sha256((url + frame["data"]).encode("ascii", "replace")).hexdigest()
                    if digest != browser.last_hash:
                        browser.last_hash = digest
                        browser.title = await page.title()
                        metadata = frame["metadata"]
                        self.bus.publish({
                            "kind": "screen", "botId": browser.bot_id, "image": frame["data"], "url": url,
                            "title": browser.title, "at": int(time.time() * 1000),
                            "width": round(metadata["deviceWidth"]), "height": round(metadata["deviceHeight"]),
                        })
                await asyncio.sleep(MIN_FRAME_GAP)
        except Exception:
            # Chromium may close or replace the page while a frame is being sent.
            pass
        finally:
            if session:
                try:
                    await asyncio.wait_for(session.detach(), 2)
                except Exception:
                    pass
            await asyncio.gather(*acknowledgements, return_exceptions=True)
            browser.pump = None

    async def watch(self, bot_id: str, on: bool) -> bool:
        browser = self.browsers.get(bot_id)
        if not browser:
            return False
        browser.watchers = max(0, browser.watchers + (1 if on else -1))
        if on:
            browser.last_hash = ""
            if not browser.pump:
                browser.pump = asyncio.create_task(self._pump(browser))
        return True

    async def screenshot(self, bot_id: str) -> tuple[bytes, str, str]:
        browser = self.browsers.get(bot_id)
        if not browser:
            raise BrowserUnavailable("The browser is not open")
        page = self._page(browser)
        try:
            image = await page.screenshot(type="jpeg", quality=70, timeout=5000)
            return image, page.url, await page.title()
        except Exception as exc:
            raise BrowserUnavailable("The browser could not capture a preview") from exc

    @staticmethod
    def _page(browser: BrowserProfile):
        pages = browser.context.pages
        if browser.page not in pages and pages:
            browser.page = pages[-1]
        return browser.page

    def is_busy(self, bot_id: str) -> bool:
        instance = self.browsers.get(bot_id)
        return bool(instance and instance.control != "person" and (instance.operation.locked() or instance.active_until > time.time()))

    async def person_input(self, bot_id: str, event: dict) -> bool:
        browser = self.browsers.get(bot_id)
        if not browser:
            return False
        async with browser.operation:
            if self.browsers.get(bot_id) is not browser or browser.control != "person":
                return False
            page = self._page(browser)
            try:
                match event.get("type"):
                    case "click":
                        await page.mouse.click(float(event["x"]), float(event["y"]))
                    case "text":
                        await page.keyboard.insert_text(str(event["text"])[:2000])
                    case "key":
                        await page.keyboard.press(str(event["key"])[:40])
                    case "scroll":
                        await page.mouse.wheel(0, max(-5000, min(5000, float(event["dy"]))))
                    case "goto":
                        url = urlsplit(event.get("url", ""))
                        if url.scheme not in ("http", "https") or not url.hostname or url.username is not None:
                            raise BrowserUnavailable("Only HTTP and HTTPS addresses without embedded credentials are allowed")
                        await page.goto(url.geturl(), wait_until="domcontentloaded", timeout=30_000)
                    case _:
                        return False
            except BrowserUnavailable:
                raise
            except Exception as exc:
                raise BrowserUnavailable("Could not send input to the browser") from exc
            return True

    async def set_control(self, bot_id: str, holder: str, reason: str | None = None) -> dict:
        browser = self.browsers.get(bot_id)
        if not browser:
            raise BrowserUnavailable("The browser is not open")
        if holder == "person":
            self.taking.add(bot_id)
        try:
            async with browser.operation:
                if self.browsers.get(bot_id) is not browser:
                    raise BrowserUnavailable("The browser is not open")
                browser.control = "person" if holder == "person" else "bot"
                if browser.control == "person":
                    browser.help_reason = reason or browser.help_reason
                    browser.hand_back.clear()
                else:
                    browser.help_reason = None
                    browser.hand_back.set()
                self.poke(browser)
                self._publish_state(browser)
                return self.state(bot_id)
        finally:
            if holder == "person":
                self.taking.discard(bot_id)

    async def ask_for_help(self, bot_id: str, reason: str) -> dict:
        browser = self.browsers.get(bot_id)
        if not browser:
            raise BrowserUnavailable("The browser is not open")
        await self.set_control(bot_id, "person", reason[:300])
        try:
            await asyncio.wait_for(browser.hand_back.wait(), HELP_TIMEOUT)
        except asyncio.TimeoutError:
            return {"ok": False, "reason": "no_answer", "detail": "Nobody helped in time. Say what you could not verify or complete."}
        if self.browsers.get(bot_id) is not browser:
            return {"ok": False, "reason": "closed", "detail": "The browser was closed before the person handed it back."}
        return {"ok": True, "detail": "The person handed the browser back. Take a new snapshot."}
