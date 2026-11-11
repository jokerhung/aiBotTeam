"""The built-in browser a bot works in ("where it runs" = a browser, in this version).

One persistent context per bot (its own profile folder, so sign-ins stay between tasks), driven with Playwright. The bot reaches it
through tools (open, look, click, type, scroll, go back, ask for help); what a person sees is a live picture of the page, sent as `screen`
frames at a limited rate while someone is watching. A person can take the browser over at any time, and a bot that meets a sign-in or
a CAPTCHA asks for help and waits: it never gets past one itself.

Navigation is limited: http(s) only, and never an internal address unless the person allowed local addresses (a bot testing a site on
this computer needs that; a bot reading a stranger's page must not be able to reach this app's own API through it).
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import re
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit

from .netguard import BlockedAddress, check_url

VIEWPORT = {"width": 1280, "height": 800}
MIN_FRAME_GAP = 0.4  # seconds between pictures: a limit on how much is sent
IDLE_AFTER = 4.0  # stop taking pictures this long after the last watcher or action
HELP_TIMEOUT = 15 * 60
SNAPSHOT_JS = """() => {
  const sel = 'a[href], button, input, select, textarea, [role=button], [role=link], [role=tab], [role=menuitem], [onclick]';
  const out = []; let n = 0;
  document.querySelectorAll('[data-bt-ref]').forEach(e => e.removeAttribute('data-bt-ref'));
  for (const e of document.querySelectorAll(sel)) {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none') continue;
    e.setAttribute('data-bt-ref', String(++n));
    out.push({ref: n, tag: e.tagName.toLowerCase(), type: e.getAttribute('type') || undefined, text: (e.innerText || e.value || e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.getAttribute('title') || '').trim().slice(0, 80),
               name: e.getAttribute('name') || undefined, href: e.tagName === 'A' ? e.getAttribute('href') : undefined});
    if (n >= 80) break;
  }
  return {title: document.title, url: location.href, text: (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 6000), elements: out};
}"""


class BrowserUnavailable(RuntimeError):
    pass


class BotBrowser:
    def __init__(self, bot_id: str, context: Any, page: Any) -> None:
        self.bot_id, self.context, self.page = bot_id, context, page
        self.control = "bot"  # who holds the browser: the bot, or the person who took it over
        self.help_reason: Optional[str] = None
        self.watchers = 0
        self.active_until = 0.0
        self.last_hash = ""
        self.pump: Optional[asyncio.Task] = None
        self.hand_back = asyncio.Event()


class BrowserService:
    def __init__(self, home: Path, bus, allow_local: bool = False, channel: Optional[str] = None) -> None:
        self.home, self.bus = home, bus
        self.allow_local = allow_local
        self.channel = channel
        self.pw: Any = None
        self.browsers: dict[str, BotBrowser] = {}
        self.lock = asyncio.Lock()
        self.unavailable: Optional[str] = None
        self._used_channel: Optional[str] = None

    # ---- lifecycle -----------------------------------------------------------------------------------------------------------
    async def _start(self) -> Any:
        if self.pw:
            return self.pw
        try:
            from playwright.async_api import async_playwright
        except ImportError as e:
            raise BrowserUnavailable("Playwright is not installed (pip install playwright)") from e
        self.pw = await async_playwright().start()
        return self.pw

    async def _launch(self, bot_id: str) -> Any:
        pw = await self._start()
        profile = self.home / "browser" / re.sub(r"[^\w-]", "_", bot_id)
        profile.mkdir(parents=True, exist_ok=True)
        errors = []
        order = [self.channel] if self.channel else ["msedge", "chrome", None]
        if self._used_channel in order:  # the one that worked last time goes first
            order.remove(self._used_channel)
            order.insert(0, self._used_channel)
        for ch in order:
            try:
                kw: dict[str, Any] = {"headless": True, "viewport": VIEWPORT, "accept_downloads": False}
                if ch:
                    kw["channel"] = ch
                ctx = await pw.chromium.launch_persistent_context(str(profile), **kw)
                self._used_channel = ch
                return ctx
            except Exception as e:  # this channel is not installed: try the next
                errors.append(f"{ch or 'chromium'}: {str(e).splitlines()[0][:100]}")
        self.unavailable = "No browser could be started. Install Microsoft Edge or Chrome, or run `playwright install chromium`."
        raise BrowserUnavailable(self.unavailable)

    async def availability(self) -> dict:
        try:
            await self._start()
        except BrowserUnavailable as e:
            return {"available": False, "reason": str(e)}
        return {"available": self.unavailable is None, "reason": self.unavailable, "browser": self._used_channel or "chromium"}

    async def wake(self, bot_id: str) -> BotBrowser:
        async with self.lock:
            b = self.browsers.get(bot_id)
            if b:
                return b
            ctx = await self._launch(bot_id)
            page = ctx.pages[0] if ctx.pages else await ctx.new_page()
            b = BotBrowser(bot_id, ctx, page)
            await ctx.route("**/*", lambda route: asyncio.ensure_future(self._gate(b, route)))
            self.browsers[bot_id] = b
        self._publish_state(b)
        return b

    async def sleep(self, bot_id: str) -> bool:
        b = self.browsers.pop(bot_id, None)
        if not b:
            return False
        if b.pump:
            b.pump.cancel()
        b.hand_back.set()
        try:
            await b.context.close()
        except Exception:
            pass
        self.bus.publish({"kind": "computer-control", "botId": bot_id, "running": False, "held": False, "helpReason": None})
        return True

    async def shutdown(self) -> None:
        for bot_id in list(self.browsers):
            await self.sleep(bot_id)
        if self.pw:
            try:
                await self.pw.stop()
            except Exception:
                pass
            self.pw = None

    # ---- navigation rules ------------------------------------------------------------------------------------------------------
    def check(self, url: str) -> str:
        try:
            return check_url(url, allow_loopback=self.allow_local, allow_private=self.allow_local)
        except BlockedAddress as e:
            raise BrowserUnavailable(f"that address is not allowed: {e}")

    async def _gate(self, b: BotBrowser, route: Any) -> None:
        """Every page the browser is sent to (a redirect, a link) is checked again; other requests of a page pass."""
        req = route.request
        try:
            if req.is_navigation_request() and req.frame == b.page.main_frame:
                u = urlsplit(req.url)
                if u.scheme in ("http", "https"):
                    self.check(req.url)
                elif u.scheme not in ("about", "data", "blob"):
                    raise BrowserUnavailable("only http and https pages can be opened")
            await route.continue_()
        except BrowserUnavailable:
            await route.abort("blockedbyclient")
        except Exception:
            try:
                await route.continue_()
            except Exception:
                pass

    # ---- state and pictures ------------------------------------------------------------------------------------------------------
    def state(self, bot_id: str) -> dict:
        b = self.browsers.get(bot_id)
        if not b:
            return {"running": False, "held": False, "helpReason": None, "url": None, "title": None, "allowLocal": self.allow_local}
        return {"running": True, "held": b.control == "person", "helpReason": b.help_reason, "url": b.page.url, "title": None, "watching": b.watchers, "allowLocal": self.allow_local}

    def _publish_state(self, b: BotBrowser) -> None:
        self.bus.publish({"kind": "computer-control", "botId": b.bot_id, "running": True, "held": b.control == "person", "helpReason": b.help_reason})

    async def picture(self, b: BotBrowser, quality: int = 60) -> tuple[bytes, str, str]:
        png = await b.page.screenshot(type="jpeg", quality=quality)
        try:
            title = await b.page.title()
        except Exception:
            title = ""
        return png, b.page.url, title

    async def _pump(self, b: BotBrowser) -> None:
        """While someone watches (or the bot just acted): a picture of the page, at most every 0.4 s, only when it changed."""
        try:
            while b.bot_id in self.browsers and (b.watchers > 0 or time.time() < b.active_until):
                try:
                    data, url, title = await self.picture(b)
                    h = hashlib.sha1(data).hexdigest()
                    if h != b.last_hash:
                        b.last_hash = h
                        self.bus.publish({"kind": "screen", "botId": b.bot_id, "image": base64.b64encode(data).decode(), "url": url, "title": title, "at": int(time.time() * 1000),
                                          "width": VIEWPORT["width"], "height": VIEWPORT["height"]})
                except Exception:
                    pass
                await asyncio.sleep(MIN_FRAME_GAP)
        finally:
            b.pump = None

    def poke(self, b: BotBrowser) -> None:
        b.active_until = time.time() + IDLE_AFTER
        if b.pump is None:
            b.pump = asyncio.create_task(self._pump(b))

    async def watch(self, bot_id: str, on: bool) -> bool:
        b = self.browsers.get(bot_id)
        if not b:
            return False
        b.watchers = max(0, b.watchers + (1 if on else -1))
        if on:
            self.poke(b)
        return True

    # ---- what a bot does ---------------------------------------------------------------------------------------------------------
    def _bot(self, bot_id: str) -> BotBrowser:
        b = self.browsers.get(bot_id)
        if not b:
            raise BrowserUnavailable("the browser is not open; call browser_open with an address first")
        if b.control == "person":
            raise PersonInControl()
        return b

    async def open(self, bot_id: str, url: str) -> dict:
        self.check(url)
        b = await self.wake(bot_id)
        if b.control == "person":
            raise PersonInControl()
        self.poke(b)
        try:
            await b.page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        except Exception as e:
            if "blockedbyclient" in str(e).lower():
                raise BrowserUnavailable("that address is not allowed")
            raise BrowserUnavailable(f"could not open the page: {str(e).splitlines()[0][:160]}")
        return await self.snapshot(bot_id)

    async def snapshot(self, bot_id: str) -> dict:
        b = self._bot(bot_id)
        self.poke(b)
        snap = await b.page.evaluate(SNAPSHOT_JS)
        return {"title": snap["title"], "url": snap["url"], "text": snap["text"], "elements": snap["elements"]}

    async def _target(self, b: BotBrowser, ref: Optional[int], text: Optional[str]):
        if ref is not None:
            loc = b.page.locator(f'[data-bt-ref="{int(ref)}"]')
            if await loc.count():
                return loc.first
        if text:
            loc = b.page.get_by_text(text, exact=False)
            if await loc.count():
                return loc.first
        raise BrowserUnavailable("no such element; take a new snapshot and use a ref from it")

    async def describe(self, bot_id: str, ref: Optional[int], text: Optional[str]) -> str:
        """What a click or typing would act on, in words, for the approval card."""
        b = self._bot(bot_id)
        el = await self._target(b, ref, text)
        label = (await el.inner_text() if await el.evaluate("e => e.tagName !== 'INPUT'") else await el.get_attribute("value") or "")[:60]
        label = label or await el.get_attribute("aria-label") or await el.get_attribute("placeholder") or await el.get_attribute("name") or "an element"
        return f"“{label.strip()}” on {urlsplit(b.page.url).netloc or b.page.url}"

    async def click(self, bot_id: str, ref: Optional[int] = None, text: Optional[str] = None) -> dict:
        b = self._bot(bot_id)
        el = await self._target(b, ref, text)
        self.poke(b)
        await el.click(timeout=10_000)
        await asyncio.sleep(0.4)  # a click may start a navigation; let it begin before the page is read
        return await self.snapshot(bot_id)

    async def type(self, bot_id: str, ref: Optional[int], text: str, submit: bool = False) -> dict:
        b = self._bot(bot_id)
        el = await self._target(b, ref, None)
        self.poke(b)
        await el.fill(text, timeout=10_000)
        if submit:
            await el.press("Enter")
            await asyncio.sleep(0.4)
        return await self.snapshot(bot_id)

    async def scroll(self, bot_id: str, dy: int) -> dict:
        b = self._bot(bot_id)
        self.poke(b)
        await b.page.mouse.wheel(0, max(-5000, min(5000, dy)))
        await asyncio.sleep(0.2)
        return await self.snapshot(bot_id)

    async def back(self, bot_id: str) -> dict:
        b = self._bot(bot_id)
        self.poke(b)
        await b.page.go_back(wait_until="domcontentloaded", timeout=15_000)
        return await self.snapshot(bot_id)

    async def screenshot(self, bot_id: str) -> tuple[bytes, str, str]:
        b = self.browsers.get(bot_id)
        if not b:
            raise BrowserUnavailable("the browser is not open")
        return await self.picture(b, 70)

    # ---- the person --------------------------------------------------------------------------------------------------------------
    async def set_control(self, bot_id: str, holder: str, reason: Optional[str] = None) -> dict:
        b = self.browsers.get(bot_id)
        if not b:
            raise BrowserUnavailable("the browser is not open")
        b.control = "person" if holder == "person" else "bot"
        b.help_reason = reason if b.control == "person" else None
        if b.control == "bot":
            b.hand_back.set()
        else:
            b.hand_back.clear()
        self._publish_state(b)
        self.poke(b)
        return self.state(bot_id)

    async def person_input(self, bot_id: str, ev: dict) -> bool:
        """A click, text, key or scroll from the person who holds the browser; refused while the bot holds it."""
        b = self.browsers.get(bot_id)
        if not b or b.control != "person":
            return False
        t = ev.get("type")
        if t == "click":
            await b.page.mouse.click(float(ev["x"]), float(ev["y"]))
        elif t == "text":
            await b.page.keyboard.type(str(ev["text"])[:2000])
        elif t == "key":
            await b.page.keyboard.press(str(ev["key"])[:40])
        elif t == "scroll":
            await b.page.mouse.wheel(0, float(ev.get("dy", 0)))
        elif t == "goto":
            self.check(str(ev["url"]))
            await b.page.goto(str(ev["url"]), wait_until="domcontentloaded", timeout=30_000)
        else:
            return False
        self.poke(b)
        return True

    async def ask_for_help(self, bot_id: str, reason: str) -> dict:
        """The bot meets a sign-in or a CAPTCHA: the person is asked, the browser is theirs, and the bot waits until they hand it back."""
        b = self.browsers.get(bot_id)
        if not b:
            raise BrowserUnavailable("the browser is not open")
        await self.set_control(bot_id, "person", reason[:300])
        try:
            await asyncio.wait_for(b.hand_back.wait(), HELP_TIMEOUT)
        except asyncio.TimeoutError:
            return {"ok": False, "reason": "no_answer", "detail": "nobody helped in time; carry on without it or say what you could not do"}
        return {"ok": True, "detail": "the person finished and handed the browser back; take a new snapshot"}


class PersonInControl(BrowserUnavailable):
    def __init__(self) -> None:
        super().__init__("the person has taken over the browser; wait for them to hand it back")
