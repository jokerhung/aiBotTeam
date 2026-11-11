from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import aiosqlite

from .wire import MAUS_COLORS, WireBot, WireMessage


def data_dir() -> Path:
    p = Path(os.environ.get("BOTTEAM_DATA_DIR") or Path.home() / ".botteam")
    p.mkdir(parents=True, exist_ok=True)
    return p


def now_ms() -> int:
    return int(time.time() * 1000)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


SCHEMA = """
CREATE TABLE IF NOT EXISTS bots(id TEXT PRIMARY KEY, pos INTEGER NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS threads(
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, title TEXT NOT NULL, main INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  leaf_id TEXT, cursor TEXT, usage TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS thread_bot ON threads(bot_id);
CREATE TABLE IF NOT EXISTS messages(
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, thread_id TEXT, parent_id TEXT, role TEXT,
  at INTEGER NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sections(id TEXT PRIMARY KEY, name TEXT NOT NULL, pos INTEGER NOT NULL, collapsed INTEGER NOT NULL DEFAULT 0);
CREATE VIRTUAL TABLE IF NOT EXISTS msg_fts USING fts5(text, message_id UNINDEXED, bot_id UNINDEXED, thread_id UNINDEXED, tokenize='unicode61 remove_diacritics 2');
"""


class Store:
    def __init__(self, path: Path | str) -> None:
        self.path = str(path)
        self.db: aiosqlite.Connection

    async def open(self) -> None:
        self.db = await aiosqlite.connect(self.path)
        await self.db.execute("PRAGMA journal_mode=WAL")
        await self.db.executescript(SCHEMA)
        await self._migrate()
        await self.db.execute("CREATE INDEX IF NOT EXISTS msg_thread ON messages(thread_id, seq)")
        await self.db.execute("CREATE INDEX IF NOT EXISTS msg_parent ON messages(thread_id, parent_id)")
        await self._backfill_fts()
        await self.db.commit()

    async def close(self) -> None:
        await self.db.close()

    async def _migrate(self) -> None:
        """Phase 1 stored messages per bot; give each bot a main thread and chain its messages."""
        cur = await self.db.execute("PRAGMA table_info(messages)")
        cols = {r[1] for r in await cur.fetchall()}
        for col in ("thread_id", "parent_id", "role"):
            if col not in cols:
                await self.db.execute(f"ALTER TABLE messages ADD COLUMN {col} TEXT")
        for bot in await self.list_bots():
            cur = await self.db.execute("SELECT 1 FROM threads WHERE id=?", (bot.threadId,))
            if not await cur.fetchone():
                await self.db.execute(
                    "INSERT INTO threads(id,bot_id,title,main,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                    (bot.threadId, bot.id, "", 1, now_ms(), now_ms()))
            cur = await self.db.execute("SELECT id, body FROM messages WHERE bot_id=? AND thread_id IS NULL ORDER BY seq", (bot.id,))
            prev, leaf = None, None
            for mid, body in await cur.fetchall():
                role = json.loads(body).get("role")
                await self.db.execute("UPDATE messages SET thread_id=?, parent_id=?, role=? WHERE id=?", (bot.threadId, prev, role, mid))
                prev = leaf = mid
            if leaf:
                await self.db.execute("UPDATE threads SET leaf_id=? WHERE id=?", (leaf, bot.threadId))

    # ---- bots ---------------------------------------------------------------
    async def list_bots(self) -> list[WireBot]:
        cur = await self.db.execute("SELECT body FROM bots ORDER BY pos")
        return [WireBot.model_validate_json(r[0]) for r in await cur.fetchall()]

    async def get_bot(self, bot_id: str) -> Optional[WireBot]:
        cur = await self.db.execute("SELECT body FROM bots WHERE id=?", (bot_id,))
        r = await cur.fetchone()
        return WireBot.model_validate_json(r[0]) if r else None

    async def bot_of_thread(self, thread_id: str) -> Optional[WireBot]:
        cur = await self.db.execute("SELECT bot_id FROM threads WHERE id=?", (thread_id,))
        r = await cur.fetchone()
        return await self.get_bot(r[0]) if r else None

    async def save_bot(self, bot: WireBot) -> None:
        body = bot.model_copy(update={"tasks": [], "busy": False, "threadBusy": False, "statusLine": None, "turnStartedAt": None,
                                      "activity": "idle", "usage": {}}).model_dump_json()
        cur = await self.db.execute("SELECT pos FROM bots WHERE id=?", (bot.id,))
        if await cur.fetchone():
            await self.db.execute("UPDATE bots SET body=? WHERE id=?", (body, bot.id))
        else:
            cur = await self.db.execute("SELECT COALESCE(MAX(pos),-1)+1 FROM bots")
            pos = (await cur.fetchone())[0]
            await self.db.execute("INSERT INTO bots(id,pos,body) VALUES(?,?,?)", (bot.id, pos, body))
        await self.db.commit()

    async def create_bot(self, name: str, title: str, description: str, color: Optional[str], selection: dict) -> WireBot:
        n = len(await self.list_bots())
        tid = new_id("th")
        bot = WireBot(
            id=new_id("bot"), threadId=tid, mainThreadId=tid, name=name, title=title, description=description,
            color=color or MAUS_COLORS[n % 8],  # type: ignore[arg-type]
            modelSelection=selection,  # type: ignore[arg-type]
        )
        await self.db.execute(
            "INSERT INTO threads(id,bot_id,title,main,created_at,updated_at) VALUES(?,?,?,?,?,?)",
            (tid, bot.id, "", 1, now_ms(), now_ms()))
        await self.save_bot(bot)
        return bot

    async def delete_bot(self, bot_id: str) -> bool:
        cur = await self.db.execute("DELETE FROM bots WHERE id=?", (bot_id,))
        await self.db.execute("DELETE FROM messages WHERE bot_id=?", (bot_id,))
        await self.db.execute("DELETE FROM msg_fts WHERE bot_id=?", (bot_id,))
        await self.db.execute("DELETE FROM threads WHERE bot_id=?", (bot_id,))
        await self.db.commit()
        return cur.rowcount > 0

    async def set_order(self, ids: list[str]) -> None:
        for i, bid in enumerate(ids):
            await self.db.execute("UPDATE bots SET pos=? WHERE id=?", (i, bid))
        await self.db.commit()

    # ---- threads ------------------------------------------------------------
    async def list_threads(self, bot_id: str) -> list[dict[str, Any]]:
        cur = await self.db.execute(
            "SELECT id,title,main,pinned,closed,updated_at,cursor,usage,leaf_id FROM threads WHERE bot_id=? ORDER BY main DESC, pinned DESC, updated_at DESC",
            (bot_id,))
        return [self._thread(r) for r in await cur.fetchall()]

    async def get_thread(self, thread_id: str) -> Optional[dict[str, Any]]:
        cur = await self.db.execute(
            "SELECT id,title,main,pinned,closed,updated_at,cursor,usage,leaf_id,bot_id FROM threads WHERE id=?", (thread_id,))
        r = await cur.fetchone()
        return {**self._thread(r), "botId": r[9]} if r else None

    @staticmethod
    def _thread(r) -> dict[str, Any]:
        return {"id": r[0], "title": r[1], "main": bool(r[2]), "pinned": bool(r[3]), "closed": bool(r[4]),
                "updatedAt": r[5], "cursor": r[6], "usage": json.loads(r[7] or "{}"), "leafId": r[8]}

    async def create_thread(self, bot_id: str, title: str) -> dict[str, Any]:
        tid = new_id("th")
        await self.db.execute(
            "INSERT INTO threads(id,bot_id,title,main,created_at,updated_at) VALUES(?,?,?,?,?,?)",
            (tid, bot_id, title, 0, now_ms(), now_ms()))
        await self.db.commit()
        return (await self.get_thread(tid)) or {}

    async def patch_thread(self, thread_id: str, **f: Any) -> None:
        sets, args = [], []
        for k, col in (("title", "title"), ("pinned", "pinned"), ("closed", "closed"), ("cursor", "cursor"), ("leafId", "leaf_id")):
            if k in f and f[k] is not None:
                sets.append(f"{col}=?")
                args.append(int(f[k]) if isinstance(f[k], bool) else f[k])
        if "usage" in f:
            sets.append("usage=?")
            args.append(json.dumps(f["usage"]))
        sets.append("updated_at=?")
        args += [now_ms(), thread_id]
        await self.db.execute(f"UPDATE threads SET {', '.join(sets)} WHERE id=?", args)
        await self.db.commit()

    async def delete_thread(self, thread_id: str) -> None:
        await self.db.execute("DELETE FROM messages WHERE thread_id=?", (thread_id,))
        await self.db.execute("DELETE FROM msg_fts WHERE thread_id=?", (thread_id,))
        await self.db.execute("DELETE FROM threads WHERE id=?", (thread_id,))
        await self.db.commit()

    # ---- messages -----------------------------------------------------------
    async def add_message(self, bot_id: str, thread_id: str, m: WireMessage, *, advance_leaf: bool = True, explicit_parent: bool = False) -> None:
        if m.parentId is None and not explicit_parent:
            t = await self.get_thread(thread_id)
            m.parentId = t["leafId"] if t else None
        cur = await self.db.execute("SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE thread_id=?", (thread_id,))
        seq = (await cur.fetchone())[0]
        await self.db.execute(
            "INSERT INTO messages(id,bot_id,thread_id,parent_id,role,at,seq,body) VALUES(?,?,?,?,?,?,?,?)",
            (m.id, bot_id, thread_id, m.parentId, m.role, m.at, seq, m.model_dump_json()))
        if advance_leaf:
            await self.db.execute("UPDATE threads SET leaf_id=?, updated_at=? WHERE id=?", (m.id, now_ms(), thread_id))
        await self._index(m, bot_id, thread_id)
        await self.db.commit()

    async def update_message(self, m: WireMessage) -> None:
        await self.db.execute("UPDATE messages SET body=? WHERE id=?", (m.model_dump_json(), m.id))
        cur = await self.db.execute("SELECT bot_id, thread_id FROM messages WHERE id=?", (m.id,))
        row = await cur.fetchone()
        if row:
            await self._index(m, row[0], row[1])
        await self.db.commit()

    async def get_message(self, message_id: str) -> Optional[WireMessage]:
        cur = await self.db.execute("SELECT body FROM messages WHERE id=?", (message_id,))
        r = await cur.fetchone()
        return WireMessage.model_validate_json(r[0]) if r else None

    async def delete_message(self, message_id: str) -> None:
        await self.db.execute("DELETE FROM messages WHERE id=?", (message_id,))
        await self.db.execute("DELETE FROM msg_fts WHERE message_id=?", (message_id,))
        await self.db.commit()

    async def page(self, thread_id: str, before: Optional[str], limit: int = 200) -> tuple[list[WireMessage], bool]:
        """The active branch of a thread (leaf back to root), oldest first, one page at a time."""
        t = await self.get_thread(thread_id)
        if not t or not t["leafId"]:
            return [], False
        args: list[Any] = [t["leafId"]]
        cond = ""
        if before:
            cond = "WHERE seq < (SELECT seq FROM messages WHERE id=?)"
            args.append(before)
        args.append(limit + 1)
        cur = await self.db.execute(
            "WITH RECURSIVE path(id, parent_id, seq, body) AS ("
            " SELECT id, parent_id, seq, body FROM messages WHERE id=?"
            " UNION ALL SELECT m.id, m.parent_id, m.seq, m.body FROM messages m JOIN path ON m.id = path.parent_id)"
            f" SELECT body FROM path {cond} ORDER BY seq DESC LIMIT ?", args)
        rows = [WireMessage.model_validate_json(r[0]) for r in await cur.fetchall()]
        more = len(rows) > limit
        rows = list(reversed(rows[:limit]))
        await self._attach_siblings(thread_id, rows)
        return rows, more

    async def _attach_siblings(self, thread_id: str, rows: list[WireMessage]) -> None:
        users = [m for m in rows if m.role == "user"]
        if not users:
            return
        keys = {m.parentId for m in users}
        marks = ",".join("?" for _ in keys)
        cur = await self.db.execute(
            f"SELECT id, parent_id FROM messages WHERE thread_id=? AND role='user' AND ifnull(parent_id,'') IN ({marks}) ORDER BY seq",
            [thread_id, *[k or "" for k in keys]])
        by_parent: dict[str, list[str]] = {}
        for mid, pid in await cur.fetchall():
            by_parent.setdefault(pid or "", []).append(mid)
        for m in users:
            sib = by_parent.get(m.parentId or "", [])
            m.siblings = sib if len(sib) > 1 else []

    async def leaf_of_branch(self, message_id: str) -> str:
        """The newest descendant chain end below a message, so switching branches lands on that branch's latest state."""
        leaf = message_id
        while True:
            cur = await self.db.execute("SELECT id FROM messages WHERE parent_id=? ORDER BY seq DESC LIMIT 1", (leaf,))
            r = await cur.fetchone()
            if not r:
                return leaf
            leaf = r[0]

    # ---- search ---------------------------------------------------------------
    async def _index(self, m: WireMessage, bot_id: str, thread_id: str) -> None:
        await self.db.execute("DELETE FROM msg_fts WHERE message_id=?", (m.id,))
        if m.kind == "text" and m.text.strip():
            await self.db.execute("INSERT INTO msg_fts(text, message_id, bot_id, thread_id) VALUES(?,?,?,?)",
                                  (m.text, m.id, bot_id, thread_id))

    async def _backfill_fts(self) -> None:
        cur = await self.db.execute("SELECT COUNT(*) FROM msg_fts")
        if (await cur.fetchone())[0]:
            return
        cur = await self.db.execute("SELECT bot_id, thread_id, body FROM messages")
        for bot_id, thread_id, body in await cur.fetchall():
            await self._index(WireMessage.model_validate_json(body), bot_id, thread_id or "")

    async def search(self, q: str, limit: int = 30) -> list[dict[str, Any]]:
        words = [w for w in "".join(c if c.isalnum() else " " for c in q).split() if w]
        if not words:
            return []
        match = " ".join(f'"{w}"*' for w in words)
        cur = await self.db.execute(
            "SELECT message_id, bot_id, thread_id, snippet(msg_fts, 0, '[[', ']]', '...', 14) FROM msg_fts "
            "WHERE msg_fts MATCH ? ORDER BY rank LIMIT ?", (match, limit))
        out = []
        for mid, bid, tid, snip in await cur.fetchall():
            m = await self.get_message(mid)
            out.append({"messageId": mid, "botId": bid, "threadId": tid, "snippet": snip,
                        "at": m.at if m else 0, "role": m.role if m else ""})
        return out

    # ---- sections ---------------------------------------------------------------
    async def list_sections(self) -> list[dict[str, Any]]:
        cur = await self.db.execute("SELECT id, name, collapsed FROM sections ORDER BY pos")
        return [{"id": r[0], "name": r[1], "collapsed": bool(r[2])} for r in await cur.fetchall()]

    async def create_section(self, name: str) -> dict[str, Any]:
        sid = new_id("sec")
        cur = await self.db.execute("SELECT COALESCE(MAX(pos),-1)+1 FROM sections")
        pos = (await cur.fetchone())[0]
        await self.db.execute("INSERT INTO sections(id,name,pos) VALUES(?,?,?)", (sid, name, pos))
        await self.db.commit()
        return {"id": sid, "name": name, "collapsed": False}

    async def patch_section(self, sid: str, name: Optional[str], collapsed: Optional[bool]) -> bool:
        cur = await self.db.execute("SELECT 1 FROM sections WHERE id=?", (sid,))
        if not await cur.fetchone():
            return False
        if name is not None:
            await self.db.execute("UPDATE sections SET name=? WHERE id=?", (name, sid))
        if collapsed is not None:
            await self.db.execute("UPDATE sections SET collapsed=? WHERE id=?", (int(collapsed), sid))
        await self.db.commit()
        return True

    async def delete_section(self, sid: str) -> bool:
        cur = await self.db.execute("DELETE FROM sections WHERE id=?", (sid,))
        await self.db.commit()
        if cur.rowcount:
            for bot in await self.list_bots():
                if bot.section == sid:
                    bot.section = None
                    await self.save_bot(bot)
        return cur.rowcount > 0

    # ---- requests -----------------------------------------------------------------
    async def expire_open_requests(self) -> int:
        """A request still open at startup lost its CLI process with the previous run: close it as unavailable."""
        cur = await self.db.execute("SELECT id, body FROM messages WHERE body LIKE ?", ('%"status":"open"%',))
        n = 0
        for _mid, body in await cur.fetchall():
            m = WireMessage.model_validate_json(body)
            if m.request and m.request.status == "open":
                m.request.status, m.request.behavior, m.request.source = "resolved", "deny", "unavailable"
                await self.update_message(m)
                n += 1
        return n

    async def duplicate_bot(self, bot_id: str) -> Optional[WireBot]:
        src = await self.get_bot(bot_id)
        if not src:
            return None
        bot = await self.create_bot(f"{src.name} copy"[:60], src.title, src.description, src.color, src.modelSelection.model_dump())
        for k in ("cwd", "approvalMode", "soul", "fallbackSelection", "notifications", "section"):
            setattr(bot, k, getattr(src, k))
        await self.save_bot(bot)
        return bot
