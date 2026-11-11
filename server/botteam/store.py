from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import aiosqlite

from .wire import MAUS_COLORS, WireBot, WireGroup, WireMessage


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
CREATE TABLE IF NOT EXISTS groups(id TEXT PRIMARY KEY, pos INTEGER NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', target_kind TEXT NOT NULL DEFAULT 'bot', target_id TEXT NOT NULL DEFAULT '', thread_id TEXT, read INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', target_kind TEXT NOT NULL DEFAULT 'bot', target_id TEXT NOT NULL DEFAULT '', thread_id TEXT, read INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', target_kind TEXT NOT NULL DEFAULT 'bot', target_id TEXT NOT NULL DEFAULT '', thread_id TEXT, read INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS webhooks(id TEXT PRIMARY KEY, target_id TEXT NOT NULL, name TEXT NOT NULL, prompt TEXT NOT NULL DEFAULT '', auth TEXT NOT NULL DEFAULT 'bearer', secret_hash TEXT NOT NULL, pending_secret TEXT, enabled INTEGER NOT NULL DEFAULT 1, last_at INTEGER, created_by TEXT NOT NULL DEFAULT 'person', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_attempts(id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL, at INTEGER NOT NULL, status INTEGER NOT NULL, result TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, ip TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS wa_hook ON webhook_attempts(webhook_id, at);
CREATE TABLE IF NOT EXISTS sections(id TEXT PRIMARY KEY, name TEXT NOT NULL, pos INTEGER NOT NULL, collapsed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS routine_defs(id TEXT PRIMARY KEY, target_kind TEXT NOT NULL, target_id TEXT NOT NULL, name TEXT NOT NULL, prompt TEXT NOT NULL, kind TEXT NOT NULL,
  every_min INTEGER, at TEXT, days TEXT, run_at INTEGER, tz TEXT NOT NULL DEFAULT 'UTC', anchor INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  last_run INTEGER, next_run INTEGER, max_run_min INTEGER, created_by TEXT NOT NULL DEFAULT 'person', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS routine_runs(id TEXT PRIMARY KEY, routine_id TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL,
  thread_id TEXT, detail TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS rr_routine ON routine_runs(routine_id, started_at);
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
        await self.migrate_phase3_routines()
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
                                      "activity": "idle", "usage": {}, "waitingFor": []}).model_dump_json()
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
        await self.db.execute("DELETE FROM notes WHERE bot_id=?", (bot_id,))
        await self.db.execute("DELETE FROM routine_defs WHERE target_kind='bot' AND target_id=?", (bot_id,))
        await self.db.execute("DELETE FROM webhooks WHERE target_id=?", (bot_id,))
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

    async def reset_cursor(self, thread_id: str) -> None:
        """Forget the engine's session so the next turn starts a fresh one (the transcript stays)."""
        await self.db.execute("UPDATE threads SET cursor=NULL WHERE id=?", (thread_id,))
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

    # ---- library notes ------------------------------------------------------------
    async def list_notes(self, bot_id: str) -> list[dict[str, Any]]:
        cur = await self.db.execute("SELECT id, title, text, updated_at FROM notes WHERE bot_id=? ORDER BY updated_at DESC", (bot_id,))
        return [{"id": r[0], "title": r[1], "text": r[2], "updatedAt": r[3]} for r in await cur.fetchall()]

    async def create_note(self, bot_id: str, title: str, text: str) -> dict[str, Any]:
        nid = new_id("note")
        await self.db.execute("INSERT INTO notes(id,bot_id,title,text,updated_at) VALUES(?,?,?,?,?)", (nid, bot_id, title, text, now_ms()))
        await self.db.commit()
        return {"id": nid, "title": title, "text": text, "updatedAt": now_ms()}

    async def patch_note(self, bot_id: str, note_id: str, title: Optional[str], text: Optional[str]) -> bool:
        cur = await self.db.execute("SELECT title, text FROM notes WHERE id=? AND bot_id=?", (note_id, bot_id))
        row = await cur.fetchone()
        if not row:
            return False
        await self.db.execute("UPDATE notes SET title=?, text=?, updated_at=? WHERE id=?",
                              (row[0] if title is None else title, row[1] if text is None else text, now_ms(), note_id))
        await self.db.commit()
        return True

    async def delete_note(self, bot_id: str, note_id: str) -> bool:
        cur = await self.db.execute("DELETE FROM notes WHERE id=? AND bot_id=?", (note_id, bot_id))
        await self.db.commit()
        return cur.rowcount > 0


    # ---- groups (rooms with several bots) -------------------------------------------------------------------------
    async def list_groups(self) -> list[WireGroup]:
        cur = await self.db.execute("SELECT body FROM groups ORDER BY pos")
        return [WireGroup.model_validate_json(r[0]) for r in await cur.fetchall()]

    async def get_group(self, group_id: str) -> Optional[WireGroup]:
        cur = await self.db.execute("SELECT body FROM groups WHERE id=?", (group_id,))
        r = await cur.fetchone()
        return WireGroup.model_validate_json(r[0]) if r else None

    async def group_of_thread(self, thread_id: str) -> Optional[WireGroup]:
        cur = await self.db.execute("SELECT bot_id FROM threads WHERE id=?", (thread_id,))
        r = await cur.fetchone()
        return await self.get_group(r[0]) if r else None

    async def save_group(self, g: WireGroup) -> None:
        body = g.model_copy(update={"memberInfo": [], "busy": False, "activity": "idle", "queue": [], "tasks": []}).model_dump_json()
        cur = await self.db.execute("SELECT pos FROM groups WHERE id=?", (g.id,))
        if await cur.fetchone():
            await self.db.execute("UPDATE groups SET body=? WHERE id=?", (body, g.id))
        else:
            cur = await self.db.execute("SELECT COALESCE(MAX(pos),-1)+1 FROM groups")
            await self.db.execute("INSERT INTO groups(id,pos,body) VALUES(?,?,?)", (g.id, (await cur.fetchone())[0], body))
        await self.db.commit()

    async def create_group(self, name: str, members: list[str], leader: Optional[str], instructions: str, cwd: Optional[str], responder: str) -> WireGroup:
        gid, tid = new_id("grp"), new_id("th")
        g = WireGroup(id=gid, threadId=tid, mainThreadId=tid, name=name, members=members, leader=leader, instructions=instructions, cwd=cwd, responder=responder)  # type: ignore[arg-type]
        await self.db.execute("INSERT INTO threads(id,bot_id,title,main,created_at,updated_at) VALUES(?,?,?,?,?,?)", (tid, gid, "", 1, now_ms(), now_ms()))
        await self.save_group(g)
        return g

    async def delete_group(self, group_id: str) -> bool:
        cur = await self.db.execute("DELETE FROM groups WHERE id=?", (group_id,))
        await self.db.execute("DELETE FROM messages WHERE bot_id=?", (group_id,))
        await self.db.execute("DELETE FROM msg_fts WHERE bot_id=?", (group_id,))
        await self.db.execute("DELETE FROM threads WHERE bot_id=?", (group_id,))
        await self.db.commit()
        return cur.rowcount > 0

    # ---- routines (Phase 4: bots and rooms, schedules, runs) ----------------------------------------------------------
    _RCOLS = "id, target_kind, target_id, name, prompt, kind, every_min, at, days, run_at, tz, anchor, enabled, last_run, next_run, max_run_min, created_by, created_at"

    @staticmethod
    def _routine(r) -> dict[str, Any]:
        return {"id": r[0], "targetKind": r[1], "targetId": r[2], "name": r[3], "prompt": r[4], "kind": r[5], "everyMin": r[6], "at": r[7],
                "days": json.loads(r[8]) if r[8] else None, "runAt": r[9], "tz": r[10], "anchor": r[11], "enabled": bool(r[12]), "lastRun": r[13],
                "nextRun": r[14], "maxRunMin": r[15], "createdBy": r[16], "createdAt": r[17]}

    async def list_routines(self, target_kind: Optional[str] = None, target_id: Optional[str] = None) -> list[dict[str, Any]]:
        q, args = f"SELECT {self._RCOLS} FROM routine_defs", []
        if target_kind:
            q += " WHERE target_kind=?"
            args.append(target_kind)
            if target_id:
                q += " AND target_id=?"
                args.append(target_id)
        cur = await self.db.execute(q + " ORDER BY COALESCE(next_run, 9e18), created_at", args)
        return [self._routine(r) for r in await cur.fetchall()]

    async def get_routine(self, rid: str) -> Optional[dict[str, Any]]:
        cur = await self.db.execute(f"SELECT {self._RCOLS} FROM routine_defs WHERE id=?", (rid,))
        r = await cur.fetchone()
        return self._routine(r) if r else None

    async def create_routine(self, target_kind: str, target_id: str, name: str, prompt: str, kind: str, every_min: Optional[int], at: Optional[str],
                             days: Optional[list[int]], run_at: Optional[int], tz: str, next_run: Optional[int], anchor: int, max_run_min: Optional[int],
                             created_by: str) -> dict[str, Any]:
        rid = new_id("rt")
        await self.db.execute(f"INSERT INTO routine_defs({self._RCOLS}) VALUES({','.join('?' * 18)})",
                              (rid, target_kind, target_id, name, prompt, kind, every_min, at, json.dumps(days) if days else None, run_at, tz, anchor, 1, None, next_run,
                               max_run_min, created_by, now_ms()))
        await self.db.commit()
        return (await self.get_routine(rid)) or {}

    async def update_routine(self, rid: str, **f: Any) -> bool:
        cols = {"name": "name", "prompt": "prompt", "kind": "kind", "everyMin": "every_min", "at": "at", "days": "days", "runAt": "run_at", "tz": "tz", "anchor": "anchor",
                "enabled": "enabled", "lastRun": "last_run", "nextRun": "next_run", "maxRunMin": "max_run_min"}
        sets, args = [], []
        for k, col in cols.items():
            if k in f:
                v = f[k]
                sets.append(f"{col}=?")
                args.append(json.dumps(v) if k == "days" and v is not None else (int(v) if isinstance(v, bool) else v))
        if not sets:
            return await self.get_routine(rid) is not None
        cur = await self.db.execute(f"UPDATE routine_defs SET {', '.join(sets)} WHERE id=?", [*args, rid])
        await self.db.commit()
        return cur.rowcount > 0

    async def delete_routine(self, rid: str) -> bool:
        cur = await self.db.execute("DELETE FROM routine_defs WHERE id=?", (rid,))
        await self.db.execute("DELETE FROM routine_runs WHERE routine_id=?", (rid,))
        await self.db.commit()
        return cur.rowcount > 0

    async def due_routines(self, now: int) -> list[dict[str, Any]]:
        cur = await self.db.execute(f"SELECT {self._RCOLS} FROM routine_defs WHERE enabled=1 AND next_run IS NOT NULL AND next_run<=? ORDER BY next_run", (now,))
        return [self._routine(r) for r in await cur.fetchall()]

    @staticmethod
    def _run(r) -> dict[str, Any]:
        return {"id": r[0], "routineId": r[1], "startedAt": r[2], "finishedAt": r[3], "status": r[4], "threadId": r[5], "detail": r[6],
                "durationMs": (r[3] - r[2]) if r[3] else None}

    async def create_run(self, routine_id: str, started_at: int, status: str, thread_id: Optional[str], detail: str) -> dict[str, Any]:
        rid = new_id("rr")
        done = started_at if status in ("skipped",) else None
        await self.db.execute("INSERT INTO routine_runs(id, routine_id, started_at, finished_at, status, thread_id, detail) VALUES(?,?,?,?,?,?,?)",
                              (rid, routine_id, started_at, done, status, thread_id, detail))
        await self.db.commit()
        return (await self.get_run(rid)) or {}

    async def get_run(self, run_id: str) -> Optional[dict[str, Any]]:
        cur = await self.db.execute("SELECT id, routine_id, started_at, finished_at, status, thread_id, detail FROM routine_runs WHERE id=?", (run_id,))
        r = await cur.fetchone()
        return self._run(r) if r else None

    async def finish_run(self, run_id: str, finished_at: Optional[int], status: str, detail: str, thread_id: Optional[str] = None) -> dict[str, Any]:
        sets, args = ["status=?", "detail=?"], [status, detail]
        if finished_at is not None or status != "running":
            sets.append("finished_at=?")
            args.append(finished_at)
        if thread_id:
            sets.append("thread_id=?")
            args.append(thread_id)
        await self.db.execute(f"UPDATE routine_runs SET {', '.join(sets)} WHERE id=?", [*args, run_id])
        await self.db.commit()
        return (await self.get_run(run_id)) or {}

    async def set_run_thread(self, run_id: str, thread_id: str) -> dict[str, Any]:
        await self.db.execute("UPDATE routine_runs SET thread_id=? WHERE id=?", (thread_id, run_id))
        await self.db.commit()
        return (await self.get_run(run_id)) or {}

    async def running_run_of(self, routine_id: str) -> Optional[dict[str, Any]]:
        cur = await self.db.execute("SELECT id, routine_id, started_at, finished_at, status, thread_id, detail FROM routine_runs WHERE routine_id=? AND status='running' LIMIT 1", (routine_id,))
        r = await cur.fetchone()
        return self._run(r) if r else None

    async def running_runs(self) -> list[dict[str, Any]]:
        cur = await self.db.execute("SELECT id, routine_id, started_at, finished_at, status, thread_id, detail FROM routine_runs WHERE status='running'")
        return [self._run(r) for r in await cur.fetchall()]

    async def interrupt_running_routine_runs(self, now: int) -> list[str]:
        ids = [r["id"] for r in await self.running_runs()]
        for rid in ids:
            await self.finish_run(rid, now, "failed", "interrupted by a restart")
        return ids

    async def list_runs(self, routine_id: Optional[str] = None, status: Optional[str] = None, since: Optional[int] = None, until: Optional[int] = None, limit: int = 200) -> list[dict[str, Any]]:
        q, args = "SELECT id, routine_id, started_at, finished_at, status, thread_id, detail FROM routine_runs WHERE 1=1", []
        for cond, v in (("routine_id=?", routine_id), ("status=?", status), ("started_at>=?", since), ("started_at<=?", until)):
            if v is not None:
                q += f" AND {cond}"
                args.append(v)
        cur = await self.db.execute(q + " ORDER BY started_at DESC LIMIT ?", [*args, min(limit, 500)])
        return [self._run(r) for r in await cur.fetchall()]

    async def migrate_phase3_routines(self) -> int:
        """Per-bot routines of Phase 3 (table `routines`) become Phase 4 routines on the same bot."""
        cur = await self.db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='routines'")
        if not await cur.fetchone():
            return 0
        cur = await self.db.execute("SELECT id, bot_id, title, text, kind, every_min, at, enabled, last_run, next_run FROM routines")
        n = 0
        for rid, bot_id, title, text, kind, every, at, enabled, last_run, next_run in await cur.fetchall():
            await self.db.execute(f"INSERT OR IGNORE INTO routine_defs({self._RCOLS}) VALUES({','.join('?' * 18)})",
                                  (rid, "bot", bot_id, title, text, "weekly" if kind == "daily" else kind, every, at, json.dumps(list(range(7))) if kind == "daily" else None, None,
                                   "UTC", next_run or now_ms(), enabled, last_run, next_run, None, "person", now_ms()))
            n += 1
        await self.db.execute("DROP TABLE routines")
        await self.db.commit()
        return n

    # ---- notifications --------------------------------------------------------------------------------------------------
    @staticmethod
    def _note(r) -> dict[str, Any]:
        return {"id": r[0], "at": r[1], "kind": r[2], "title": r[3], "body": r[4], "targetKind": r[5], "targetId": r[6], "threadId": r[7], "read": bool(r[8])}

    async def add_notification(self, kind: str, title: str, body: str, target_kind: str, target_id: str, thread_id: Optional[str]) -> dict[str, Any]:
        nid = new_id("nt")
        await self.db.execute("INSERT INTO notifications(id, at, kind, title, body, target_kind, target_id, thread_id) VALUES(?,?,?,?,?,?,?,?)",
                              (nid, now_ms(), kind, title, body, target_kind, target_id, thread_id))
        await self.db.execute("DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY at DESC LIMIT 300)")  # the log is bounded
        await self.db.commit()
        cur = await self.db.execute("SELECT id, at, kind, title, body, target_kind, target_id, thread_id, read FROM notifications WHERE id=?", (nid,))
        return self._note(await cur.fetchone())

    async def list_notifications(self, limit: int = 100) -> list[dict[str, Any]]:
        cur = await self.db.execute("SELECT id, at, kind, title, body, target_kind, target_id, thread_id, read FROM notifications ORDER BY at DESC, id DESC LIMIT ?", (limit,))
        return [self._note(r) for r in await cur.fetchall()]

    async def mark_notifications_read(self, ids: Optional[list[str]]) -> list[str]:
        if ids is None:
            cur = await self.db.execute("SELECT id FROM notifications WHERE read=0")
            ids = [r[0] for r in await cur.fetchall()]
        for i in ids:
            await self.db.execute("UPDATE notifications SET read=1 WHERE id=?", (i,))
        await self.db.commit()
        return ids

    async def clear_notifications(self) -> None:
        await self.db.execute("DELETE FROM notifications")
        await self.db.commit()


    # ---- webhooks ------------------------------------------------------------------------------------------------------------
    _WCOLS = "id, target_id, name, prompt, auth, secret_hash, pending_secret, enabled, last_at, created_by, created_at"

    @staticmethod
    def _webhook(r) -> dict[str, Any]:
        return {"id": r[0], "targetId": r[1], "name": r[2], "prompt": r[3], "auth": r[4], "secretHash": r[5], "pendingSecret": r[6], "enabled": bool(r[7]),
                "lastAt": r[8], "createdBy": r[9], "createdAt": r[10]}

    async def list_webhooks(self) -> list[dict[str, Any]]:
        cur = await self.db.execute(f"SELECT {self._WCOLS} FROM webhooks ORDER BY created_at")
        return [self._webhook(r) for r in await cur.fetchall()]

    async def get_webhook(self, wid: str) -> Optional[dict[str, Any]]:
        cur = await self.db.execute(f"SELECT {self._WCOLS} FROM webhooks WHERE id=?", (wid,))
        r = await cur.fetchone()
        return self._webhook(r) if r else None

    async def create_webhook(self, target_id: str, name: str, prompt: str, auth: str, secret_hash: str, pending: Optional[str], created_by: str) -> dict[str, Any]:
        wid = new_id("wh")
        await self.db.execute(f"INSERT INTO webhooks({self._WCOLS}) VALUES({','.join('?' * 11)})", (wid, target_id, name, prompt, auth, secret_hash, pending, 1, None, created_by, now_ms()))
        await self.db.commit()
        return (await self.get_webhook(wid)) or {}

    async def update_webhook(self, wid: str, **f: Any) -> bool:
        cols = {"name": "name", "prompt": "prompt", "enabled": "enabled", "secretHash": "secret_hash", "pendingSecret": "pending_secret", "lastAt": "last_at", "targetId": "target_id", "auth": "auth"}
        sets, args = [], []
        for k, col in cols.items():
            if k in f:
                sets.append(f"{col}=?")
                args.append(int(f[k]) if isinstance(f[k], bool) else f[k])
        if not sets:
            return True
        cur = await self.db.execute(f"UPDATE webhooks SET {', '.join(sets)} WHERE id=?", [*args, wid])
        await self.db.commit()
        return cur.rowcount > 0

    async def delete_webhook(self, wid: str) -> bool:
        cur = await self.db.execute("DELETE FROM webhooks WHERE id=?", (wid,))
        await self.db.execute("DELETE FROM webhook_attempts WHERE webhook_id=?", (wid,))
        await self.db.commit()
        return cur.rowcount > 0

    async def add_webhook_attempt(self, wid: str, status: int, result: str, size: int, ip: str) -> dict[str, Any]:
        aid = new_id("wa")
        await self.db.execute("INSERT INTO webhook_attempts(id, webhook_id, at, status, result, size, ip) VALUES(?,?,?,?,?,?,?)", (aid, wid, now_ms(), status, result[:200], size, ip))
        await self.db.execute("DELETE FROM webhook_attempts WHERE webhook_id=? AND id NOT IN (SELECT id FROM webhook_attempts WHERE webhook_id=? ORDER BY at DESC LIMIT 200)", (wid, wid))
        await self.db.commit()
        cur = await self.db.execute("SELECT id, webhook_id, at, status, result, size, ip FROM webhook_attempts WHERE id=?", (aid,))
        r = await cur.fetchone()
        return {"id": r[0], "webhookId": r[1], "at": r[2], "status": r[3], "result": r[4], "size": r[5], "ip": r[6]}

    async def list_webhook_attempts(self, wid: str, limit: int = 100) -> list[dict[str, Any]]:
        cur = await self.db.execute("SELECT id, webhook_id, at, status, result, size, ip FROM webhook_attempts WHERE webhook_id=? ORDER BY at DESC, id DESC LIMIT ?", (wid, limit))
        return [{"id": r[0], "webhookId": r[1], "at": r[2], "status": r[3], "result": r[4], "size": r[5], "ip": r[6]} for r in await cur.fetchall()]
