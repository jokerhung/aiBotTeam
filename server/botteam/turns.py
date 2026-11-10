"""Host-side turn orchestration: RuntimeEvent -> WireMessage / WireBot frames, queueing, retry, logging."""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from .bus import Bus
from .drivers.base import SendTurnInput
from .events import RuntimeEvent
from .registry import Registry
from .store import Store, data_dir, new_id, now_ms
from .wire import ErrorInfo, ToolInfo, WireBot, WireMessage, WireTask

RETRY_DELAYS = (1.0, 3.0)
LIVE_ONLY = {"content.delta", "item.output", "item.updated"}  # never written to the thread log


@dataclass
class ThreadRun:
    bot_id: str
    inp: SendTurnInput
    turn_id: Optional[str] = None
    started_at: int = field(default_factory=now_ms)
    live: Optional[WireMessage] = None
    tools: dict[str, WireMessage] = field(default_factory=dict)
    label: Optional[str] = None
    had_output: bool = False
    retries: int = 0
    retry_pending: bool = False
    failed: bool = False
    interrupted: bool = False


def persona(bot: WireBot) -> str:
    parts = [f"You are {bot.name}, a bot in the user's team."]
    if bot.title:
        parts.append(f"Your role: {bot.title}.")
    if bot.description:
        parts.append(bot.description)
    return " ".join(parts)


class Turns:
    def __init__(self, store: Store, bus: Bus, registry: Registry, log_dir: Path | None = None) -> None:
        self.store, self.bus, self.registry = store, bus, registry
        self.log_dir = log_dir or data_dir() / "threads"
        self.runs: dict[str, ThreadRun] = {}
        self.queues: dict[str, list[str]] = {}  # thread -> queued message ids
        self._events: asyncio.Queue[RuntimeEvent] = asyncio.Queue()
        self._consumer: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()
        registry.on_event(self._events.put_nowait)

    def start(self) -> None:
        self._consumer = asyncio.create_task(self._consume())

    async def stop(self) -> None:
        if self._consumer:
            self._consumer.cancel()

    # ---- bot frames -----------------------------------------------------------
    async def bot_dict(self, bot: WireBot) -> dict[str, Any]:
        threads = await self.store.list_threads(bot.id)
        tasks = [
            WireTask(threadId=t["id"], title=t["title"], busy=t["id"] in self.runs, pinned=t["pinned"],
                     closed=t["closed"], at=t["updatedAt"], main=t["main"])
            for t in threads
        ]
        runs = [self.runs[t["id"]] for t in threads if t["id"] in self.runs]
        active = self.runs.get(bot.threadId)
        usage = next((t["usage"] for t in threads if t["id"] == bot.threadId), {})
        out = bot.model_copy(update={
            "tasks": tasks, "busy": bool(runs), "threadBusy": active is not None,
            "activity": "working" if runs else "idle",
            "turnStartedAt": min((r.started_at for r in runs), default=None),
            "statusLine": active.label if active else None, "usage": usage,
        })
        return out.model_dump()

    async def publish_bot(self, bot: WireBot) -> None:
        self.bus.publish({"kind": "bot", "bot": await self.bot_dict(bot)})

    def _frame(self, kind: str, bot_id: str, thread_id: str, m: WireMessage | dict) -> None:
        payload = m.model_dump() if isinstance(m, WireMessage) else m
        self.bus.publish({"kind": kind, "botId": bot_id, "threadId": thread_id, "message": payload})

    # ---- sending ----------------------------------------------------------------
    async def send(self, bot: WireBot, thread_id: str, text: str, send_id: Optional[str],
                   branch: bool = False, parent_id: Optional[str] = None) -> WireMessage:
        async with self._lock:
            inst = self.registry.get(bot.modelSelection.instanceId)
            msg = WireMessage(id=new_id("msg"), role="user", text=text, at=now_ms(), sendId=send_id, parentId=parent_id)
            busy = thread_id in self.runs
            if busy and not branch:
                steered = await self._try_steer(inst, thread_id, text)
                msg.steered, msg.queued = steered, not steered
            elif busy:
                raise RuntimeError("busy")
            await self.store.add_message(bot.id, thread_id, msg, explicit_parent=branch)
            if branch:
                await self.store.patch_thread(thread_id, leafId=msg.id)
            self._frame("message", bot.id, thread_id, msg)
            await self._after_user_message(bot, thread_id, msg)
            if msg.queued:
                self.queues.setdefault(thread_id, []).append(msg.id)
            elif not msg.steered:
                await self._start_turn(bot, thread_id, text)
            else:
                await self.publish_bot(bot)
            return msg

    async def _try_steer(self, inst, thread_id: str, text: str) -> bool:
        if not inst or not inst.driver or not inst.driver.capabilities.queueing:
            return False
        return await inst.driver.steer(thread_id, text) == "steered"

    async def _after_user_message(self, bot: WireBot, thread_id: str, msg: WireMessage) -> None:
        t = await self.store.get_thread(thread_id)
        if t and not t["main"] and t["title"] in ("", "New task"):
            await self.store.patch_thread(thread_id, title=msg.text.strip().splitlines()[0][:48])
        bot.lastText, bot.lastAt = msg.text, msg.at

    async def _start_turn(self, bot: WireBot, thread_id: str, text: str, run: Optional[ThreadRun] = None) -> None:
        inst = self.registry.get(bot.modelSelection.instanceId)
        if not inst or not inst.driver or inst.state != "available" or not inst.enabled:
            reason = inst.reason if inst and inst.reason else "that engine is not available"
            await self._add_error(bot, thread_id, f"{inst.display_name if inst else bot.modelSelection.instanceId} is unavailable: {reason}", setup=True)
            await self.publish_bot(bot)
            return
        t = await self.store.get_thread(thread_id) or {}
        transcript: list[tuple[str, str]] = []
        if inst.driver.provider == "openai-compat":
            rows, _ = await self.store.page(thread_id, None, 60)
            transcript = [("user" if m.role == "user" else "assistant", m.text) for m in rows[:-1] if m.kind == "text" and m.text]
        inp = SendTurnInput(
            thread_id=thread_id, bot_id=bot.id, text=text, model=bot.modelSelection.model,
            effort=bot.modelSelection.effort, system=persona(bot), resume_cursor=t.get("cursor"),
            cwd=bot.cwd, transcript=transcript,
        )
        self.runs[thread_id] = run or ThreadRun(bot_id=bot.id, inp=inp)
        await self.publish_bot(bot)
        try:
            self.runs[thread_id].turn_id = await inst.driver.send_turn(inp)
        except Exception as e:  # a driver must not take the host down
            await self._add_error(bot, thread_id, f"Could not start the turn: {e}", terminal=True)
            self.runs.pop(thread_id, None)
            await self.publish_bot(bot)

    async def interrupt(self, bot: WireBot, thread_id: str) -> None:
        run = self.runs.get(thread_id)
        inst = self.registry.get(bot.modelSelection.instanceId)
        if not run or not inst or not inst.driver:
            return
        run.interrupted = True
        run.retry_pending = False
        for qid in self.queues.pop(thread_id, []):  # Stop clears what was waiting behind the turn
            await self.store.delete_message(qid)
            self.bus.publish({"kind": "message.deleted", "botId": bot.id, "threadId": thread_id, "messageId": qid})
        await inst.driver.interrupt_turn(thread_id)

    async def drop_queued(self, bot_id: str, thread_id: str, message_id: str) -> bool:
        q = self.queues.get(thread_id, [])
        if message_id not in q:
            return False
        q.remove(message_id)
        await self.store.delete_message(message_id)
        self.bus.publish({"kind": "message.deleted", "botId": bot_id, "threadId": thread_id, "messageId": message_id})
        return True

    # ---- event pipeline ---------------------------------------------------------
    async def _consume(self) -> None:
        while True:
            ev = await self._events.get()
            try:
                await self._handle(ev)
            except Exception as e:  # keep the pipeline alive
                print(f"[turns] event {ev.type} failed: {type(e).__name__}: {e}")

    def _log(self, ev: RuntimeEvent) -> None:
        if ev.type in LIVE_ONLY:
            return
        try:
            self.log_dir.mkdir(parents=True, exist_ok=True)
            with open(self.log_dir / f"{ev.threadId}.ndjson", "a", encoding="utf8") as f:
                f.write(ev.model_dump_json() + "\n")
        except OSError:
            pass

    async def _handle(self, ev: RuntimeEvent) -> None:
        self._log(ev)
        run = self.runs.get(ev.threadId)
        if not run:
            return
        bot = await self.store.get_bot(run.bot_id)
        if not bot:
            return
        d, t = ev.data, ev.threadId
        if ev.type == "session.started":
            if d.get("sessionId"):
                await self.store.patch_thread(t, cursor=d["sessionId"])
        elif ev.type == "content.delta":
            await self._delta(bot, t, run, d)
        elif ev.type == "item.started" and d.get("itemType") == "tool":
            await self._tool_started(bot, t, run, d)
        elif ev.type == "item.completed" and d.get("itemType") == "tool":
            await self._tool_completed(bot, t, run, d)
        elif ev.type == "item.completed" and d.get("itemType") == "assistant_text":
            await self._final_text(bot, t, run, d.get("text", ""))
        elif ev.type == "runtime.error":
            await self._error(bot, t, run, d)
        elif ev.type == "turn.completed":
            await self._completed(bot, t, run, d)

    async def _set_label(self, bot: WireBot, run: ThreadRun, label: Optional[str]) -> None:
        if run.label != label:
            run.label = label
            await self.publish_bot(bot)

    async def _finalize_live(self, bot: WireBot, thread_id: str, run: ThreadRun, text: Optional[str] = None) -> None:
        live = run.live
        if not live:
            return
        if text is not None and text.strip():
            live.text = text
        live.streaming = False
        await self.store.update_message(live)
        self._frame("message.patch", bot.id, thread_id, {"id": live.id, "text": live.text, "streaming": False})
        bot.lastText, bot.lastAt = live.text, now_ms()
        run.live = None

    async def _delta(self, bot: WireBot, thread_id: str, run: ThreadRun, d: dict) -> None:
        if d.get("streamKind") == "reasoning_text":
            await self._set_label(bot, run, "Thinking…")
            return
        run.had_output = True
        if run.label:
            await self._set_label(bot, run, None)
        if run.live is None:
            run.live = WireMessage(id=new_id("msg"), role="bot", text="", at=now_ms(), streaming=True)
            await self.store.add_message(bot.id, thread_id, run.live)
            self._frame("message", bot.id, thread_id, run.live)
        run.live.text += d.get("delta", "")
        self._frame("message.patch", bot.id, thread_id, {"id": run.live.id, "text": run.live.text, "streaming": True})

    async def _final_text(self, bot: WireBot, thread_id: str, run: ThreadRun, text: str) -> None:
        if run.live is None and text.strip():
            run.live = WireMessage(id=new_id("msg"), role="bot", text="", at=now_ms(), streaming=True)
            await self.store.add_message(bot.id, thread_id, run.live)
            self._frame("message", bot.id, thread_id, run.live)
        await self._finalize_live(bot, thread_id, run, text)

    async def _tool_started(self, bot: WireBot, thread_id: str, run: ThreadRun, d: dict) -> None:
        run.had_output = True
        await self._finalize_live(bot, thread_id, run)
        m = WireMessage(id=new_id("msg"), role="bot", kind="activity", at=now_ms(), tool=ToolInfo(
            name=d.get("title") or "tool", itemId=d.get("itemId"), summary=d.get("summary") or "", input=d.get("input") or ""))
        await self.store.add_message(bot.id, thread_id, m)
        if m.tool and m.tool.itemId:
            run.tools[m.tool.itemId] = m
        self._frame("message", bot.id, thread_id, m)
        await self._set_label(bot, run, m.tool.name if m.tool else None)

    async def _tool_completed(self, bot: WireBot, thread_id: str, run: ThreadRun, d: dict) -> None:
        m = run.tools.get(d.get("itemId") or "")
        if not m or not m.tool:
            return
        m.tool.ok, m.tool.output = bool(d.get("ok")), d.get("output") or ""
        await self.store.update_message(m)
        self._frame("message.patch", bot.id, thread_id, {"id": m.id, "tool": m.tool.model_dump()})
        await self._set_label(bot, run, None)

    async def _add_error(self, bot: WireBot, thread_id: str, text: str, **info: Any) -> None:
        m = WireMessage(id=new_id("msg"), role="bot", kind="error", text=text, at=now_ms(), error=ErrorInfo(**info))
        await self.store.add_message(bot.id, thread_id, m)
        self._frame("message", bot.id, thread_id, m)

    async def _error(self, bot: WireBot, thread_id: str, run: ThreadRun, d: dict) -> None:
        if d.get("retryable") and not run.had_output and run.retries < len(RETRY_DELAYS) and not run.interrupted:
            run.retry_pending = True  # the turn.completed that follows restarts the turn instead of ending it
            return
        run.failed = True
        await self._finalize_live(bot, thread_id, run)
        await self._add_error(bot, thread_id, d.get("message") or "The turn failed.", setup=bool(d.get("setup")),
                              terminal=bool(d.get("terminal")), limit=d.get("limit"), limitResetsAt=d.get("limitResetsAt"))

    async def _completed(self, bot: WireBot, thread_id: str, run: ThreadRun, d: dict) -> None:
        if run.retry_pending and not run.interrupted:
            attempt = run.retries
            delay = RETRY_DELAYS[attempt]
            run.retries += 1
            run.retry_pending = False
            await self._set_label(bot, run, "Retrying…")
            self._log(RuntimeEvent(type="turn.retrying", eventId=new_id("ev"), provider="host", threadId=thread_id,
                                   createdAt="", data={"attempt": attempt + 1, "delayMs": int(delay * 1000)}))
            asyncio.create_task(self._retry_later(bot.id, thread_id, run, delay))
            return
        await self._finalize_live(bot, thread_id, run)
        for m in run.tools.values():
            if m.tool and m.tool.ok is None:
                m.tool.ok = False
                await self.store.update_message(m)
                self._frame("message.patch", bot.id, thread_id, {"id": m.id, "tool": m.tool.model_dump()})
        if run.interrupted or d.get("stopReason") == "interrupted":
            m = WireMessage(id=new_id("msg"), role="bot", kind="stopped", text="Stopped", at=now_ms())
            await self.store.add_message(bot.id, thread_id, m)
            self._frame("message", bot.id, thread_id, m)
        usage = d.get("usage")
        if usage:
            t = await self.store.get_thread(thread_id) or {}
            u = t.get("usage", {})
            u["input"], u["output"] = u.get("input", 0) + usage.get("input", 0), u.get("output", 0) + usage.get("output", 0)
            u["turns"] = u.get("turns", 0) + 1
            if d.get("cost"):
                u["cost"] = round(u.get("cost", 0) + d["cost"], 6)
            await self.store.patch_thread(thread_id, usage=u)
        self.runs.pop(thread_id, None)
        bot = await self.store.get_bot(bot.id) or bot
        bot.unread = True
        await self.store.save_bot(bot)
        await self.publish_bot(bot)
        await self._run_next_queued(bot, thread_id)

    async def _retry_later(self, bot_id: str, thread_id: str, run: ThreadRun, delay: float) -> None:
        await asyncio.sleep(delay)
        bot = await self.store.get_bot(bot_id)
        inst = self.registry.get(bot.modelSelection.instanceId) if bot else None
        if not bot or not inst or not inst.driver or thread_id not in self.runs or run.interrupted:
            return
        run.label = None
        try:
            run.turn_id = await inst.driver.send_turn(run.inp)
        except Exception as e:
            await self._add_error(bot, thread_id, f"Could not retry: {e}", terminal=True)
            self.runs.pop(thread_id, None)
            await self.publish_bot(bot)

    async def _run_next_queued(self, bot: WireBot, thread_id: str) -> None:
        q = self.queues.get(thread_id, [])
        while q:
            mid = q.pop(0)
            m = await self.store.get_message(mid)
            if not m:
                continue
            m.queued = False
            await self.store.update_message(m)
            self._frame("message.patch", bot.id, thread_id, {"id": m.id, "queued": False})
            await self._start_turn(bot, thread_id, m.text)
            return
