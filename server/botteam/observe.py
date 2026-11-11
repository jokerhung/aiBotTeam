"""Looking at what happened: the runs of a bot, the waterfall of one turn, usage over time, and a transcript as Markdown or JSON.

Everything here reads what was already recorded (the per-thread event log, the usage table, the stored messages); it changes nothing.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

# a model's context window in tokens, by name fragment (the first that matches); the engines do not all report it
WINDOWS = [("opus", 200_000), ("sonnet", 200_000), ("haiku", 200_000), ("gpt-6", 400_000), ("gpt-5", 400_000), ("gpt", 200_000), ("grok", 256_000), ("gemini", 1_000_000)]
DEFAULT_WINDOW = 128_000


def context_window(model: str) -> int:
    m = (model or "").lower()
    return next((w for frag, w in WINDOWS if frag in m), DEFAULT_WINDOW)


def read_log(path: Path, limit: int = 5000) -> list[dict]:
    try:
        lines = path.read_text(encoding="utf8").splitlines()[-limit:]
    except OSError:
        return []
    out = []
    for ln in lines:
        try:
            out.append(json.loads(ln))
        except ValueError:
            continue
    return out


def _ms(iso: str) -> Optional[int]:
    try:
        return int(datetime.fromisoformat(iso).timestamp() * 1000)
    except (ValueError, TypeError):
        return None


def runs_of(events: list[dict], thread_id: str) -> list[dict]:
    """One row per turn: when it ran, how long, the tools it used (with their time), whether it worked, and what it cost in tokens."""
    by: dict[str, dict] = {}
    order: list[str] = []
    for e in events:
        tid = e.get("turnId")
        if not tid:
            continue
        r = by.get(tid)
        if r is None:
            r = by[tid] = {"turnId": tid, "threadId": thread_id, "startedAt": None, "endedAt": None, "durationMs": None, "ok": None, "tools": [], "usage": {}, "error": None, "_open": {}}
            order.append(tid)
        at = _ms(e.get("createdAt", ""))
        t, d = e.get("type"), e.get("data") or {}
        if t == "turn.started":
            r["startedAt"] = at
        elif t == "item.started" and d.get("itemType") == "tool":
            r["_open"][d.get("itemId")] = {"name": d.get("title") or "tool", "startedAt": at, "summary": d.get("summary", "")}
            if r["startedAt"] is None:
                r["startedAt"] = at
        elif t == "item.completed" and d.get("itemType") == "tool":
            o = r["_open"].pop(d.get("itemId"), None) or {"name": "tool", "startedAt": at, "summary": ""}
            r["tools"].append({"name": o["name"], "summary": o["summary"], "ms": (at - o["startedAt"]) if at is not None and o["startedAt"] is not None else None, "ok": d.get("ok")})
        elif t == "runtime.error":
            r["error"] = d.get("message")
        elif t == "turn.completed":
            r["endedAt"], r["ok"], r["usage"] = at, bool(d.get("ok")), d.get("usage") or {}
    out = []
    for tid in order:
        r = by[tid]
        r.pop("_open", None)
        if r["startedAt"] is not None and r["endedAt"] is not None:
            r["durationMs"] = r["endedAt"] - r["startedAt"]
        out.append(r)
    return out


def trace_of(events: list[dict], turn_id: str) -> dict:
    """The waterfall of one turn: its tool calls as bars on a time line, the first words of the reply, and the whole turn."""
    mine = [e for e in events if e.get("turnId") == turn_id]
    times = [t for t in (_ms(e.get("createdAt", "")) for e in mine) if t is not None]
    if not times:
        return {"turnId": turn_id, "spans": [], "totalMs": 0}
    t0 = min(times)
    spans: list[dict[str, Any]] = []
    open_: dict[str, dict] = {}
    first_text = None
    for e in mine:
        at, t, d = _ms(e.get("createdAt", "")), e.get("type"), e.get("data") or {}
        if at is None:
            continue
        if t == "item.started" and d.get("itemType") == "tool":
            open_[d.get("itemId")] = {"kind": "tool", "name": d.get("title") or "tool", "detail": d.get("summary", ""), "startMs": at - t0}
        elif t == "item.completed" and d.get("itemType") == "tool":
            s = open_.pop(d.get("itemId"), None)
            if s:
                spans.append({**s, "endMs": at - t0, "ok": d.get("ok")})
        elif t == "item.completed" and d.get("itemType") == "assistant_text" and first_text is None:
            first_text = at - t0
        elif t == "turn.retrying":
            spans.append({"kind": "retry", "name": "retry", "detail": f"attempt {d.get('attempt')}", "startMs": at - t0, "endMs": at - t0 + int(d.get("delayMs") or 0), "ok": None})
    for s in open_.values():  # a call that never finished runs to the end of the turn
        spans.append({**s, "endMs": max(times) - t0, "ok": False})
    end = max(times) - t0
    spans.sort(key=lambda s: s["startMs"])
    return {"turnId": turn_id, "startedAt": t0, "totalMs": end, "firstTextMs": first_text, "spans": spans}


def to_markdown(bot_name: str, thread_title: str, messages: list[dict]) -> str:
    out = [f"# {bot_name}" + (f" — {thread_title}" if thread_title else ""), ""]
    for m in messages:
        if m.get("kind") in ("activity", "request", "routine") and not m.get("text"):
            continue
        when = datetime.fromtimestamp((m.get("at") or 0) / 1000).strftime("%Y-%m-%d %H:%M")
        who = (m.get("sender") or ("You" if m.get("role") == "user" else bot_name)) if m.get("kind") == "text" else "Note"
        out += [f"**{who}** · {when}", "", (m.get("text") or "").strip(), ""]
    return "\n".join(out).rstrip() + "\n"
