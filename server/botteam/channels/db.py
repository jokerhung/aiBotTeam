"""Storage of the channel layer: accounts (one token each), grants (which bot an account serves, and for which chats) and batches."""
from __future__ import annotations

import json
from typing import Any, Optional

from ..store import new_id, now_ms

SCHEMA = """
CREATE TABLE IF NOT EXISTS channel_accounts(
  id TEXT PRIMARY KEY, app TEXT NOT NULL, label TEXT NOT NULL, remote_id TEXT NOT NULL, username TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1, cursor TEXT NOT NULL DEFAULT '', last_at INTEGER, last_error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS channel_grants(
  account_id TEXT NOT NULL, bot_id TEXT NOT NULL, chats TEXT NOT NULL DEFAULT '[]', admin_chats TEXT NOT NULL DEFAULT '[]',
  max_photos INTEGER NOT NULL DEFAULT 40, timeout_sec INTEGER NOT NULL DEFAULT 900, remind_at TEXT NOT NULL DEFAULT '',
  retention_days INTEGER NOT NULL DEFAULT 60, prompt TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
  PRIMARY KEY(account_id, bot_id));
CREATE TABLE IF NOT EXISTS channel_batches(
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, bot_id TEXT NOT NULL, chat_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL, parked INTEGER NOT NULL DEFAULT 0, machine TEXT NOT NULL DEFAULT '', dir TEXT NOT NULL, thread_id TEXT,
  status_message_id TEXT NOT NULL DEFAULT '', files TEXT NOT NULL DEFAULT '[]', error TEXT NOT NULL DEFAULT '', purged INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER, finished_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, card_id TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS channel_events(
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, bot_id TEXT NOT NULL DEFAULT '', batch_id TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, chat_id TEXT NOT NULL,
  kind TEXT NOT NULL, outcome TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', preview TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS ce_account ON channel_events(account_id, at);
CREATE INDEX IF NOT EXISTS cb_open ON channel_batches(account_id, chat_id, user_id, status);
CREATE INDEX IF NOT EXISTS cb_bot ON channel_batches(bot_id, status);
"""

ACCOUNT_COLS = {"label": "label", "username": "username", "enabled": "enabled", "cursor": "cursor", "lastAt": "last_at", "lastError": "last_error"}
GRANT_COLS = {"chats": "chats", "adminChats": "admin_chats", "maxPhotos": "max_photos", "timeoutSec": "timeout_sec", "remindAt": "remind_at",
              "retentionDays": "retention_days", "prompt": "prompt"}
BATCH_COLS = {"status": "status", "parked": "parked", "machine": "machine", "dir": "dir", "threadId": "thread_id", "statusMessageId": "status_message_id",
              "files": "files", "error": "error", "purged": "purged", "startedAt": "started_at", "finishedAt": "finished_at", "userName": "user_name", "cardId": "card_id"}
JSON_COLS = {"chats", "adminChats", "files"}


def _account(r) -> dict[str, Any]:
    return {"id": r[0], "app": r[1], "label": r[2], "remoteId": r[3], "username": r[4], "enabled": bool(r[5]), "cursor": r[6], "lastAt": r[7],
            "lastError": r[8], "createdAt": r[9]}


def _grant(r) -> dict[str, Any]:
    return {"accountId": r[0], "botId": r[1], "chats": json.loads(r[2]), "adminChats": json.loads(r[3]), "maxPhotos": r[4], "timeoutSec": r[5],
            "remindAt": r[6], "retentionDays": r[7], "prompt": r[8], "createdAt": r[9]}


def _batch(r) -> dict[str, Any]:
    return {"id": r[0], "accountId": r[1], "botId": r[2], "chatId": r[3], "userId": r[4], "userName": r[5], "status": r[6], "parked": bool(r[7]), "machine": r[8],
            "dir": r[9], "threadId": r[10], "statusMessageId": r[11], "files": json.loads(r[12]), "error": r[13], "purged": bool(r[14]),
            "startedAt": r[15], "finishedAt": r[16], "createdAt": r[17], "updatedAt": r[18], "cardId": r[19]}


ACC_SEL = "id, app, label, remote_id, username, enabled, cursor, last_at, last_error, created_at"
GRANT_SEL = "account_id, bot_id, chats, admin_chats, max_photos, timeout_sec, remind_at, retention_days, prompt, created_at"
BATCH_SEL = ("id, account_id, bot_id, chat_id, user_id, user_name, status, parked, machine, dir, thread_id, status_message_id, files, error, purged, "
             "started_at, finished_at, created_at, updated_at, card_id")


class ChannelDb:
    def __init__(self, store) -> None:
        self.store = store

    @property
    def db(self):
        return self.store.db

    async def open(self) -> None:
        await self.db.executescript(SCHEMA)
        cur = await self.db.execute("PRAGMA table_info(channel_batches)")
        if "card_id" not in {r[1] for r in await cur.fetchall()}:  # a database made before batches had a line in the chat
            await self.db.execute("ALTER TABLE channel_batches ADD COLUMN card_id TEXT NOT NULL DEFAULT ''")
        await self.db.commit()

    @staticmethod
    def _sets(cols: dict[str, str], fields: dict[str, Any]) -> tuple[list[str], list[Any]]:
        sets, args = [], []
        for k, v in fields.items():
            col = cols.get(k)
            if not col:
                continue
            sets.append(f"{col}=?")
            args.append(json.dumps(v) if k in JSON_COLS else (int(v) if isinstance(v, bool) else v))
        return sets, args

    # ---- accounts ------------------------------------------------------------------------------------------------------------
    async def list_accounts(self, app: Optional[str] = None) -> list[dict]:
        cur = await self.db.execute(f"SELECT {ACC_SEL} FROM channel_accounts" + (" WHERE app=?" if app else "") + " ORDER BY created_at", (app,) if app else ())
        return [_account(r) for r in await cur.fetchall()]

    async def get_account(self, account_id: str) -> Optional[dict]:
        cur = await self.db.execute(f"SELECT {ACC_SEL} FROM channel_accounts WHERE id=?", (account_id,))
        r = await cur.fetchone()
        return _account(r) if r else None

    async def add_account(self, app: str, label: str, remote_id: str, username: str) -> dict:
        aid = new_id("chn")
        await self.db.execute("INSERT INTO channel_accounts(id, app, label, remote_id, username, created_at) VALUES(?,?,?,?,?,?)", (aid, app, label, remote_id, username, now_ms()))
        await self.db.commit()
        return (await self.get_account(aid)) or {}

    async def update_account(self, account_id: str, **fields: Any) -> Optional[dict]:
        sets, args = self._sets(ACCOUNT_COLS, fields)
        if sets:
            await self.db.execute(f"UPDATE channel_accounts SET {', '.join(sets)} WHERE id=?", (*args, account_id))
            await self.db.commit()
        return await self.get_account(account_id)

    async def delete_account(self, account_id: str) -> None:
        await self.db.execute("DELETE FROM channel_accounts WHERE id=?", (account_id,))
        await self.db.execute("DELETE FROM channel_grants WHERE account_id=?", (account_id,))
        await self.db.commit()

    # ---- grants --------------------------------------------------------------------------------------------------------------
    async def list_grants(self, account_id: Optional[str] = None, bot_id: Optional[str] = None) -> list[dict]:
        where, args = [], []
        if account_id:
            where.append("account_id=?")
            args.append(account_id)
        if bot_id:
            where.append("bot_id=?")
            args.append(bot_id)
        cur = await self.db.execute(f"SELECT {GRANT_SEL} FROM channel_grants" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY created_at", args)
        return [_grant(r) for r in await cur.fetchall()]

    async def get_grant(self, account_id: str, bot_id: str) -> Optional[dict]:
        cur = await self.db.execute(f"SELECT {GRANT_SEL} FROM channel_grants WHERE account_id=? AND bot_id=?", (account_id, bot_id))
        r = await cur.fetchone()
        return _grant(r) if r else None

    async def put_grant(self, account_id: str, bot_id: str, **fields: Any) -> dict:
        if not await self.get_grant(account_id, bot_id):
            await self.db.execute("INSERT INTO channel_grants(account_id, bot_id, created_at) VALUES(?,?,?)", (account_id, bot_id, now_ms()))
        sets, args = self._sets(GRANT_COLS, fields)
        if sets:
            await self.db.execute(f"UPDATE channel_grants SET {', '.join(sets)} WHERE account_id=? AND bot_id=?", (*args, account_id, bot_id))
        await self.db.commit()
        return (await self.get_grant(account_id, bot_id)) or {}

    async def delete_grant(self, account_id: str, bot_id: str) -> bool:
        cur = await self.db.execute("DELETE FROM channel_grants WHERE account_id=? AND bot_id=?", (account_id, bot_id))
        await self.db.commit()
        return bool(cur.rowcount)

    async def delete_grants_of_bot(self, bot_id: str) -> None:
        await self.db.execute("DELETE FROM channel_grants WHERE bot_id=?", (bot_id,))
        await self.db.commit()

    # ---- batches -------------------------------------------------------------------------------------------------------------
    async def create_batch(self, account_id: str, bot_id: str, chat_id: str, user_id: str, user_name: str, dir_: str, batch_id: Optional[str] = None) -> dict:
        bid, now = batch_id or new_id("b")[:10], now_ms()
        await self.db.execute("INSERT INTO channel_batches(id, account_id, bot_id, chat_id, user_id, user_name, status, dir, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                              (bid, account_id, bot_id, chat_id, user_id, user_name, "collecting", dir_, now, now))
        await self.db.commit()
        return (await self.get_batch(bid)) or {}

    async def get_batch(self, batch_id: str) -> Optional[dict]:
        cur = await self.db.execute(f"SELECT {BATCH_SEL} FROM channel_batches WHERE id=?", (batch_id,))
        r = await cur.fetchone()
        return _batch(r) if r else None

    async def update_batch(self, batch_id: str, **fields: Any) -> Optional[dict]:
        sets, args = self._sets(BATCH_COLS, fields)
        if sets:
            sets.append("updated_at=?")
            args.append(now_ms())
            await self.db.execute(f"UPDATE channel_batches SET {', '.join(sets)} WHERE id=?", (*args, batch_id))
            await self.db.commit()
        return await self.get_batch(batch_id)

    async def list_batches(self, *, account_id: Optional[str] = None, bot_id: Optional[str] = None, chat_id: Optional[str] = None, user_id: Optional[str] = None,
                           statuses: Optional[list[str]] = None, limit: int = 200, newest_first: bool = False) -> list[dict]:
        where, args = [], []
        for col, val in (("account_id", account_id), ("bot_id", bot_id), ("chat_id", chat_id), ("user_id", user_id)):
            if val:
                where.append(f"{col}=?")
                args.append(val)
        if statuses:
            where.append("status IN (" + ",".join("?" for _ in statuses) + ")")
            args.extend(statuses)
        cur = await self.db.execute(f"SELECT {BATCH_SEL} FROM channel_batches" + (" WHERE " + " AND ".join(where) if where else "")
                                    + f" ORDER BY created_at {'DESC' if newest_first else 'ASC'}, rowid {'DESC' if newest_first else 'ASC'} LIMIT ?", (*args, limit))
        return [_batch(r) for r in await cur.fetchall()]

    async def batch_of_thread(self, thread_id: str) -> Optional[dict]:
        cur = await self.db.execute(f"SELECT {BATCH_SEL} FROM channel_batches WHERE thread_id=? ORDER BY created_at DESC LIMIT 1", (thread_id,))
        r = await cur.fetchone()
        return _batch(r) if r else None

    # ---- events: what became of each thing a person sent ------------------------------------------------------------------------
    EVENTS_KEPT = 500

    async def add_event(self, account_id: str, chat_id: str, kind: str, outcome: str, *, bot_id: str = "", batch_id: str = "", reason: str = "", preview: str = "") -> dict:
        eid, at = new_id("ev"), now_ms()
        await self.db.execute("INSERT INTO channel_events(id, account_id, bot_id, batch_id, at, chat_id, kind, outcome, reason, preview) VALUES(?,?,?,?,?,?,?,?,?,?)",
                              (eid, account_id, bot_id, batch_id, at, chat_id, kind, outcome, reason[:200], preview[:160]))
        await self.db.execute("DELETE FROM channel_events WHERE account_id=? AND id NOT IN (SELECT id FROM channel_events WHERE account_id=? ORDER BY at DESC, rowid DESC LIMIT ?)",
                              (account_id, account_id, self.EVENTS_KEPT))
        await self.db.commit()
        return {"id": eid, "accountId": account_id, "botId": bot_id, "batchId": batch_id, "at": at, "chatId": chat_id, "kind": kind, "outcome": outcome, "reason": reason[:200],
                "preview": preview[:160]}

    async def list_events(self, account_id: str, bot_id: Optional[str] = None, limit: int = 100) -> list[dict]:
        cur = await self.db.execute("SELECT id, account_id, bot_id, batch_id, at, chat_id, kind, outcome, reason, preview FROM channel_events WHERE account_id=?"
                                    + (" AND bot_id=?" if bot_id else "") + " ORDER BY at DESC, rowid DESC LIMIT ?", (account_id, *([bot_id] if bot_id else []), limit))
        return [{"id": r[0], "accountId": r[1], "botId": r[2], "batchId": r[3], "at": r[4], "chatId": r[5], "kind": r[6], "outcome": r[7], "reason": r[8], "preview": r[9]}
                for r in await cur.fetchall()]
