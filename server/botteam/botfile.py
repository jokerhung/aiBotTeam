"""One bot as one file: Markdown with YAML frontmatter (`format: botteam.bot`), to move a bot to another BotTeam.

The file holds what the bot *is*: its name, title, description, colour, instructions and skills (their text), and the connections it uses as empty slots (name, kind,
address with anything key-like removed, the *names* of the headers it needs, and what it may do there: read or write, the tools it may use, how long it keeps answers).
It never holds memory, chat history, keys, tokens, the model, the approval level, the working folder, who may see it, or what a messaging channel gave it.

Importing is cautious, like a team file: the new bot starts at the Ask level and outside any section, its skills are switched off, and a connection is assigned again
by itself where this computer has one of the same name (a Composio connection by being Composio): then it uses that one's own credentials; where there is none,
an empty connection is made, switched off. Sending out is always set to Ask, whatever the file says. A failure removes everything the import made.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any, Optional

import yaml

from .mcp_servers import SpecError
from .teams import COLORS, FRONT, MAX_FILE, MAX_SKILLS_PER_BOT, MAX_TEXT, PackageError, _str, safe_url, scrub

FORMAT = "botteam.bot"
VERSION = 1
TOOL_PATTERN = re.compile(r"^[A-Za-z0-9_*?]{1,80}$")
MAX_CONNECTIONS = 20


# ---- export ----------------------------------------------------------------------------------------------------------------
async def export_bot(store, mcp, skills, bot_id: str) -> dict:
    """{"file": text, "filename": ..., "report": {...}} for one bot."""
    bot = await store.get_bot(bot_id)
    if not bot:
        raise PackageError("bot not found")
    changed: list[str] = []
    left_out: list[str] = []
    servers = {i: s for i, s in await mcp.list()}
    have_skills = {s["id"]: s for s in skills.list()}
    d: dict[str, Any] = {"name": scrub(bot.name, changed, "the name")[:60], "title": scrub(bot.title, changed, "the title")[:80],
                         "description": scrub(bot.description, changed, "the description")[:400], "color": bot.color if bot.color in COLORS else "green",
                         "instructions": scrub(bot.soul, changed, "the instructions")[:MAX_TEXT]}
    sk = []
    for sid in bot.skills:
        s = have_skills.get(sid)
        if not s:
            continue
        if len(sk) >= MAX_SKILLS_PER_BOT:
            left_out.append(f"skill {s['name']}: over the limit of the file")
            continue
        sk.append({"name": scrub(s["name"], changed, "a skill name")[:80], "description": scrub(s["description"], changed, f"skill {s['name']}")[:300],
                   "instructions": scrub(s["body"], changed, f"skill {s['name']}")[:MAX_TEXT]})
    if sk:
        d["skills"] = sk
    conns = []
    for sid in bot.mcpServers[:MAX_CONNECTIONS]:
        sp = servers.get(sid)
        if not sp:
            continue
        if sp["transport"] == "stdio":
            left_out.append(f"{sp['name']} (a program that runs on this computer) is not shared")
            continue
        acc = bot.mcpAccess.get(sid) or {}
        access: dict[str, Any] = {"scope": acc.get("scope") if acc.get("scope") in ("read", "write") else "read"}  # sending out is not carried: it is Ask on arrival
        tools = [t for t in acc.get("allowTools") or [] if isinstance(t, str) and TOOL_PATTERN.match(t)]
        if tools:
            access["allowTools"] = tools
            if isinstance(acc.get("cacheMinutes"), int) and acc["cacheMinutes"] > 0:
                access["cacheMinutes"] = acc["cacheMinutes"]
        c: dict[str, Any] = {"name": scrub(sp["name"], changed, "a connection name")[:60], "transport": sp["transport"], "access": access}
        if sp.get("appId"):
            c["appId"] = str(sp["appId"])[:40]  # a catalogue connection (Composio) is found again by what it is; its address is only this computer's session
        else:
            c["url"] = safe_url(sp.get("url", ""), changed, f"connection {sp['name']}")
            c["needs"] = sorted(sp.get("headers", {}).keys())
        conns.append(c)
    if conns:
        d["connections"] = conns
    meta = {"format": FORMAT, "version": VERSION, "exported": date.today().isoformat(), **d}
    body = (f"# {d['name']}\n\n" + (f"{d['title']}\n\n" if d["title"] else "") +
            "A BotTeam bot file. Open BotTeam and choose New → Import bot to add this bot. It holds no memory, chat history, keys, model choice or working folder; "
            "connections arrive empty or are matched to the ones on that computer.\n")
    text = "---\n" + yaml.safe_dump(meta, sort_keys=False, allow_unicode=True, width=100) + "---\n" + body
    report = {"skills": len(sk), "connections": len(conns), "changed": changed, "leftOut": left_out, "bytes": len(text.encode("utf8"))}
    return {"file": text, "filename": re.sub(r"[^\w.-]+", "-", d["name"]).strip("-").lower() + f"-{meta['exported']}.bot.md", "report": report}


# ---- import ----------------------------------------------------------------------------------------------------------------
def parse(text: str) -> dict:
    """A validated bot from a file's text. Only the allowlisted fields survive."""
    if len(text.encode("utf8")) > MAX_FILE:
        raise PackageError("that file is too large")
    m = FRONT.match(text.replace("\r\n", "\n"))
    try:
        raw = yaml.safe_load(m.group(1) if m else text)
    except yaml.YAMLError as e:
        raise PackageError("that is not a valid bot file") from e
    if isinstance(raw, dict) and raw.get("format") == "botteam.team":
        raise PackageError("that is a team file: use Import team")
    if not isinstance(raw, dict) or raw.get("format") != FORMAT:
        raise PackageError("that is not a BotTeam bot file")
    if raw.get("version") != VERSION:
        raise PackageError("that file is from a version this app does not understand")
    if not _str(raw.get("name"), 60):
        raise PackageError("the bot has no name")
    report: list[str] = []
    bot = {"name": _str(raw.get("name"), 60), "title": _str(raw.get("title"), 80), "description": _str(raw.get("description"), 400),
           "color": raw.get("color") if raw.get("color") in COLORS else "green", "instructions": scrub(_str(raw.get("instructions"), MAX_TEXT), report, "the instructions")}
    bot["skills"] = [{"name": _str(s.get("name"), 80), "description": scrub(_str(s.get("description"), 300), report, "a skill"),
                      "instructions": scrub(_str(s.get("instructions"), MAX_TEXT), report, f"skill {s.get('name')}")}
                     for s in (raw.get("skills") or [])[:MAX_SKILLS_PER_BOT] if isinstance(s, dict) and _str(s.get("name"), 80)]
    conns = []
    for c in (raw.get("connections") or [])[:MAX_CONNECTIONS]:
        if not isinstance(c, dict) or not _str(c.get("name"), 60) or c.get("transport") not in ("http", "sse"):
            continue
        a = c.get("access") if isinstance(c.get("access"), dict) else {}
        access: dict[str, Any] = {"scope": a.get("scope") if a.get("scope") in ("read", "write") else "read"}
        tools = [t for t in (a.get("allowTools") or [])[:40] if isinstance(t, str) and TOOL_PATTERN.match(t)]
        if tools:
            access["allowTools"] = tools
            mins = a.get("cacheMinutes")
            if isinstance(mins, int) and not isinstance(mins, bool) and 0 < mins <= 1440:
                access["cacheMinutes"] = mins
        conns.append({"name": _str(c["name"], 60), "transport": c["transport"], "appId": _str(c.get("appId"), 40), "url": _str(c.get("url"), 500),
                      "needs": [_str(n, 60) for n in (c.get("needs") or []) if _str(n, 60)][:20], "access": access})
    bot["connections"] = conns
    bot["changed"] = report
    return bot


def _match(c: dict, servers: dict[str, dict]) -> Optional[str]:
    """The id of a connection on this computer that is the same one: a catalogue connection by what it is, any other by name and kind."""
    if c["appId"]:
        return next((i for i, s in servers.items() if s.get("appId") == c["appId"]), None)
    return next((i for i, s in servers.items() if not s.get("appId") and s["name"].casefold() == c["name"].casefold() and s["transport"] == c["transport"]), None)


def review(pkg: dict, servers: dict[str, dict], bot_names: set[str]) -> dict:
    """What the review screen shows before anything is created."""
    name = pkg["name"]
    final, n = name, 2
    while final in bot_names:
        final, n = f"{name} ({n})", n + 1
    conns = []
    for c in pkg["connections"]:
        sid = _match(c, servers)
        if sid:
            conns.append({"name": c["name"], "action": "use", "with": servers[sid]["name"], "scope": c["access"]["scope"], "tools": c["access"].get("allowTools", [])})
        elif c["appId"]:
            conns.append({"name": c["name"], "action": "missing", "scope": c["access"]["scope"], "tools": c["access"].get("allowTools", [])})
        else:
            conns.append({"name": c["name"], "action": "create", "url": c["url"], "needs": c["needs"], "scope": c["access"]["scope"], "tools": c["access"].get("allowTools", [])})
    return {"name": final, "title": pkg["title"], "description": pkg["description"], "skills": [s["name"] for s in pkg["skills"]], "connections": conns, "changed": pkg["changed"],
            "willDo": ["the new bot starts at the Ask level, outside any section", "skills are switched off", "sending out is always Ask",
                       "a connection is matched to the one of the same name here; a missing one is made empty and switched off"]}


async def apply_import(store, bus, mcp, skills, turns, pkg: dict, selection: dict) -> dict:
    """Create the bot; if any step fails, remove what was made and raise."""
    made: dict[str, list] = {"bots": [], "skills": [], "servers": []}
    try:
        names = {b.name for b in await store.list_bots()}
        name, n = pkg["name"], 2
        while name in names:
            name, n = f"{pkg['name']} ({n})", n + 1
        servers = {i: s for i, s in await mcp.list()}
        existing_names = {s["name"] for s in servers.values()}
        used: list[str] = []
        access: dict[str, dict] = {}
        notes: list[str] = []
        for c in pkg["connections"]:
            sid = _match(c, servers)
            if sid is None and c["appId"]:
                notes.append(f"{c['name']} is not connected on this computer: connect it, then tick it in the bot's settings")
                continue
            if sid is None:  # an empty slot, switched off, named so it never picks up credentials already stored
                nm, k = c["name"], 2
                while nm in existing_names:
                    nm, k = f"{c['name']}-{k}", k + 1
                existing_names.add(nm)
                try:
                    sid, spec = await mcp.create({"name": nm, "transport": c["transport"], "url": c["url"], "headers": {h: "" for h in c["needs"]}, "enabled": False})
                except SpecError as e:  # an address that cannot be used: the bot comes without that connection, and says so
                    notes.append(f"{c['name']} was left out: {e}")
                    continue
                made["servers"].append(sid)
                servers[sid] = spec
            used.append(sid)
            access[sid] = {"scope": c["access"]["scope"], "outbound": "ask", **({k: c["access"][k] for k in ("allowTools", "cacheMinutes") if k in c["access"]})}
        bot = await store.create_bot(name, pkg["title"], pkg["description"], pkg["color"], selection)
        made["bots"].append(bot.id)
        bot.soul, bot.section, bot.approvalMode, bot.chief = pkg["instructions"], None, "ask", False
        store.assign_workspace(bot)
        sk_ids = []
        for s in pkg["skills"]:
            made_skill = skills.save(None, s["name"], s["description"], s["instructions"], enabled=False)
            made["skills"].append(made_skill["id"])
            sk_ids.append(made_skill["id"])
        bot.skills, bot.mcpServers, bot.mcpAccess = sk_ids, used, access
        await store.save_bot(bot)
        await turns.host.refresh()
        await turns.publish_bot(await store.get_bot(bot.id))
        return {"botId": bot.id, "name": name, "skills": len(sk_ids), "connections": len(used), "notes": notes}
    except Exception:
        for bid in made["bots"]:
            await store.delete_bot(bid)
        for sk in made["skills"]:
            try:
                skills.delete(sk)
            except Exception:
                pass
        for sv in made["servers"]:
            await mcp.delete(sv)
        raise
