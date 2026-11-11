"""Scripted fake driver: replays canned RuntimeEvent sequences, no CLI needed.

Commands in the message pick the scenario: "/tool" runs a fake tool call, "/slow" streams for a long time,
"/error" fails the turn, "/md" replies with Markdown, "/approve <cmd>" asks the person to allow a shell command,
"/ask <question>" asks a question with choices A/B/C. Anything else is echoed back.
"""
from __future__ import annotations

import asyncio

from .base import Capabilities, Emitter, SendTurnInput, new_turn_id

MD_REPLY = (
    "# Heading\n\nSome **bold**, *italic* and `inline code`.\n\n- one\n- two\n\n"
    "| a | b |\n|---|---|\n| 1 | 2 |\n\n```python\nprint('hello')\n```\n\nInline math $e^{i\\pi}+1=0$."
)


class EchoDriver(Emitter):
    provider = "echo"
    capabilities = Capabilities(queueing=False)

    def __init__(self, delay: float = 0.03, broker=None) -> None:
        super().__init__()
        self.broker = broker
        self._tasks: dict[str, asyncio.Task] = {}
        self.delay = delay

    async def send_turn(self, inp: SendTurnInput) -> str:
        turn_id = new_turn_id()
        self._tasks[inp.thread_id] = asyncio.create_task(self._run(inp, turn_id))
        return turn_id

    async def _stream(self, t: str, turn_id: str, text: str, pause: float | None = None) -> None:
        for word in text.split(" "):
            self.emit("content.delta", t, turn_id, streamKind="assistant_text", delta=word + " ")
            await asyncio.sleep(self.delay if pause is None else pause)

    async def _run(self, inp: SendTurnInput, turn_id: str) -> None:
        t, text = inp.thread_id, inp.text
        try:
            self.emit("session.started", t, turn_id, sessionId=f"echo-{t}")
            self.emit("turn.started", t, turn_id)
            if text.startswith("/error"):
                self.emit("runtime.error", t, turn_id, message="Simulated failure", terminal=True)
                self.emit("turn.completed", t, turn_id, ok=False)
                return
            if text.startswith(("/approve", "/ask")) and self.broker is not None:
                if text.startswith("/approve"):
                    cmd = text[len("/approve"):].strip() or "mkdir demo"
                    ans = await self.broker.ask(t, f"echo_{turn_id}", "permission", "Bash", {"command": cmd})
                    reply = f"Allowed: ran {cmd}" if ans.get("behavior") == "allow" else f"Denied: skipped {cmd}"
                else:
                    parts = [x.strip() for x in text[len("/ask"):].split("|") if x.strip()]  # "/ask Question | A | B | C"
                    q = parts[0] if parts else "Pick one"
                    ans = await self.broker.ask(t, f"echo_{turn_id}", "question", "ask_user", {"question": q, "choices": parts[1:] or ["Alpha", "Beta", "Gamma"]})
                    reply = f"You answered: {ans.get('message')}" if ans.get("behavior") == "allow" else "No answer"
                await self._stream(t, turn_id, reply)
                self.emit("item.completed", t, turn_id, itemType="assistant_text", text=reply)
                self.emit("turn.completed", t, turn_id, ok=True)
                return
            if text.startswith("/tool"):
                self.emit("item.started", t, turn_id, itemType="tool", itemId="tool1", title="Bash",
                          summary="ls -la", input="{'command': 'ls -la'}")
                await asyncio.sleep(self.delay * 5)
                self.emit("item.completed", t, turn_id, itemType="tool", itemId="tool1", ok=True, output="total 0")
            if text.startswith("/slow"):
                await self._stream(t, turn_id, "streaming " * 200, pause=0.05)
            elif text.startswith("/md"):
                await self._stream(t, turn_id, MD_REPLY.replace("\n", " \n"))
                text_out = MD_REPLY
                self.emit("item.completed", t, turn_id, itemType="assistant_text", text=text_out)
            else:
                reply = f"You said: {text}"
                await self._stream(t, turn_id, reply)
                self.emit("item.completed", t, turn_id, itemType="assistant_text", text=reply)
            self.emit("turn.completed", t, turn_id, ok=True, usage={"input": len(text), "output": 10})
        except asyncio.CancelledError:
            self.emit("turn.completed", t, turn_id, ok=False, stopReason="interrupted")
            raise

    async def interrupt_turn(self, thread_id: str) -> None:
        task = self._tasks.get(thread_id)
        if task and not task.done():
            task.cancel()

    async def stop_all(self) -> None:
        for t in self._tasks.values():
            t.cancel()
