"""Any OpenAI-compatible /chat/completions endpoint (Ollama, OpenRouter, a private gateway). Replays the transcript each turn."""
from __future__ import annotations

import asyncio
import json

import httpx

from .base import Capabilities, Emitter, SendTurnInput, new_turn_id


class OpenAICompatDriver(Emitter):
    provider = "openai-compat"
    engine_caps = {"edits": False, "nativeReviewer": False, "agentsMcp": False, "resume": False}
    capabilities = Capabilities(sessionModelSwitch="in-session")

    def __init__(self, base_url: str, api_key: str | None = None, transport: httpx.AsyncBaseTransport | None = None) -> None:
        super().__init__()
        self.transport = transport
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.tasks: dict[str, asyncio.Task] = {}

    def _headers(self) -> dict[str, str]:
        return {"authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    async def list_models(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=10, transport=self.transport) as c:
            r = await c.get(f"{self.base_url}/models", headers=self._headers())
            r.raise_for_status()
            return [{"id": m["id"], "label": m["id"]} for m in r.json().get("data", [])]

    async def send_turn(self, inp: SendTurnInput) -> str:
        turn_id = new_turn_id()
        self.emit("turn.started", inp.thread_id, turn_id)
        self.tasks[inp.thread_id] = asyncio.create_task(self._run(inp, turn_id))
        return turn_id

    async def interrupt_turn(self, thread_id: str) -> None:
        t = self.tasks.get(thread_id)
        if t and not t.done():
            t.cancel()

    async def stop_all(self) -> None:
        for t in self.tasks.values():
            t.cancel()

    async def _run(self, inp: SendTurnInput, turn_id: str) -> None:
        tid = inp.thread_id
        messages = ([{"role": "system", "content": inp.system}] if inp.system else []) + [
            {"role": r, "content": c} for r, c in inp.transcript
        ] + [{"role": "user", "content": inp.text}]
        body = {"model": inp.model, "messages": messages, "stream": True, "stream_options": {"include_usage": True}}
        text, usage, ok = "", None, True
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=10), transport=self.transport) as c:
                async with c.stream("POST", f"{self.base_url}/chat/completions", json=body, headers=self._headers()) as r:
                    if r.status_code >= 400:
                        detail = (await r.aread()).decode("utf8", "replace")[:300]
                        raise RuntimeError(f"{r.status_code}: {detail}")
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if payload == "[DONE]":
                            break
                        chunk = json.loads(payload)
                        usage = chunk.get("usage") or usage
                        for ch in chunk.get("choices") or []:
                            piece = (ch.get("delta") or {}).get("content")
                            if piece:
                                text += piece
                                self.emit("content.delta", tid, turn_id, streamKind="assistant_text", delta=piece)
            if text:
                self.emit("item.completed", tid, turn_id, itemType="assistant_text", text=text)
        except asyncio.CancelledError:
            self.emit("turn.completed", tid, turn_id, ok=False, stopReason="interrupted")
            raise
        except (httpx.HTTPError, RuntimeError, ValueError) as e:
            ok = False
            self.emit("runtime.error", tid, turn_id, message=f"Endpoint error: {e}")
        self.emit("turn.completed", tid, turn_id, ok=ok, usage=(
            {"input": usage.get("prompt_tokens", 0), "output": usage.get("completion_tokens", 0)} if usage else None))
