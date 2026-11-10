from __future__ import annotations

import os
import time
import uuid
from pathlib import Path
from typing import Optional

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


class Store:
    def __init__(self, path: Path | str) -> None:
        self.path = str(path)
        self.db: aiosqlite.Connection

    async def open(self) -> None:
        self.db = await aiosqlite.connect(self.path)
        await self.db.execute("PRAGMA journal_mode=WAL")
        await self.db.execute(
            "CREATE TABLE IF NOT EXISTS bots(id TEXT PRIMARY KEY, pos INTEGER NOT NULL, body TEXT NOT NULL)"
        )
        await self.db.execute(
            "CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, at INTEGER NOT NULL,"
            " seq INTEGER NOT NULL, body TEXT NOT NULL)"
        )
        await self.db.execute("CREATE INDEX IF NOT EXISTS msg_bot ON messages(bot_id, seq)")
        await self.db.commit()

    async def close(self) -> None:
        await self.db.close()

    async def list_bots(self) -> list[WireBot]:
        cur = await self.db.execute("SELECT body FROM bots ORDER BY pos")
        return [WireBot.model_validate_json(r[0]) for r in await cur.fetchall()]

    async def get_bot(self, bot_id: str) -> Optional[WireBot]:
        cur = await self.db.execute("SELECT body FROM bots WHERE id=?", (bot_id,))
        r = await cur.fetchone()
        return WireBot.model_validate_json(r[0]) if r else None

    async def save_bot(self, bot: WireBot) -> None:
        cur = await self.db.execute("SELECT pos FROM bots WHERE id=?", (bot.id,))
        if await cur.fetchone():
            await self.db.execute("UPDATE bots SET body=? WHERE id=?", (bot.model_dump_json(), bot.id))
        else:
            cur = await self.db.execute("SELECT COALESCE(MAX(pos),-1)+1 FROM bots")
            pos = (await cur.fetchone())[0]
            await self.db.execute("INSERT INTO bots(id,pos,body) VALUES(?,?,?)", (bot.id, pos, bot.model_dump_json()))
        await self.db.commit()

    async def create_bot(self, name: str, title: str, description: str, color: Optional[str]) -> WireBot:
        n = len(await self.list_bots())
        bot = WireBot(
            id=new_id("bot"), threadId=new_id("th"), name=name, title=title, description=description,
            color=color or MAUS_COLORS[n % 8],  # type: ignore[arg-type]
        )
        await self.save_bot(bot)
        return bot

    async def delete_bot(self, bot_id: str) -> bool:
        cur = await self.db.execute("DELETE FROM bots WHERE id=?", (bot_id,))
        await self.db.execute("DELETE FROM messages WHERE bot_id=?", (bot_id,))
        await self.db.commit()
        return cur.rowcount > 0

    async def set_order(self, ids: list[str]) -> None:
        for i, bid in enumerate(ids):
            await self.db.execute("UPDATE bots SET pos=? WHERE id=?", (i, bid))
        await self.db.commit()

    async def add_message(self, bot_id: str, m: WireMessage) -> None:
        cur = await self.db.execute("SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE bot_id=?", (bot_id,))
        seq = (await cur.fetchone())[0]
        await self.db.execute(
            "INSERT INTO messages(id,bot_id,at,seq,body) VALUES(?,?,?,?,?)",
            (m.id, bot_id, m.at, seq, m.model_dump_json()),
        )
        await self.db.commit()

    async def update_message(self, bot_id: str, m: WireMessage) -> None:
        await self.db.execute("UPDATE messages SET body=? WHERE id=? AND bot_id=?", (m.model_dump_json(), m.id, bot_id))
        await self.db.commit()

    async def page(self, bot_id: str, before: Optional[str], limit: int = 200) -> tuple[list[WireMessage], bool]:
        args: list = [bot_id]
        cond = ""
        if before:
            cond = "AND seq < (SELECT seq FROM messages WHERE id=?)"
            args.append(before)
        args.append(limit + 1)
        cur = await self.db.execute(
            f"SELECT body FROM messages WHERE bot_id=? {cond} ORDER BY seq DESC LIMIT ?", args
        )
        rows = [WireMessage.model_validate_json(r[0]) for r in await cur.fetchall()]
        return list(reversed(rows[:limit])), len(rows) > limit
