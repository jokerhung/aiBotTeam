"""Sharing a team: one Markdown file with YAML frontmatter (bots, instructions, looks, rooms, routines, connection slots).

What goes in is an allowlist: the format has no field for chat history, keys, model choices, the working folder, approval levels or
who may see a bot, so none can travel. Every text is run through the secret filter; a connection keeps its address (with anything that
looks like a key replaced) and the *names* of the headers it needs, never their values. Importing is additive and cautious: new bots
at the Ask level, skills switched off, routines paused, connections switched off with empty values, and a failure removes everything
the import made.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import parse_qsl, quote, urlsplit, urlunsplit

import httpx
import yaml

from .memory import redact
from .netguard import BlockedAddress, check_url

FORMAT = "botteam.team"
VERSION = 1
MAX_FILE = 512 * 1024
MAX_BOTS = 40
MAX_SKILLS_PER_BOT = 30
MAX_SKILLS = 60
MAX_TEXT = 40_000
FRONT = re.compile(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", re.S)
KEYISH = re.compile(r"^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_\-]{16,}$|^[A-Za-z0-9]{24,}$")
COLORS = {"green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral", "silver", "chrome"}
RESPONDERS = {"leader", "auto", "mention"}
KINDS = {"interval", "weekly", "once"}


class PackageError(ValueError):
    pass


# ---- secret filtering ------------------------------------------------------------------------------------------------------
def scrub(text: Any, report: list[str], where: str) -> str:
    """The text with anything key-shaped replaced; what changed is added to the report."""
    s = text if isinstance(text, str) else ""
    out = redact(s)
    if out != s:
        report.append(f"{where}: something that looked like a key or password was replaced")
    return out


def safe_url(url: str, report: list[str], where: str) -> str:
    """An address with no sign-in, no #fragment, query values emptied, and any key-looking part replaced by `redacted`."""
    parts = urlsplit(url.strip())
    host = parts.hostname or ""
    changed = bool(parts.username or parts.password or parts.fragment)
    labels = host.split(".")
    keep = labels[-2:]
    head = ["redacted" if KEYISH.match(p) else p for p in labels[:-2]]
    changed |= head != labels[:-2]
    netloc = ".".join(head + keep) + (f":{parts.port}" if parts.port else "")
    segs = []
    for seg in parts.path.split("/"):
        ok = not KEYISH.match(seg)
        changed |= not ok
        segs.append(seg if ok else "redacted")
    names = [k for k, _ in parse_qsl(parts.query, keep_blank_values=True)]
    changed |= bool(names)
    query = "&".join(f"{quote(k)}=" for k in names)
    out = urlunsplit((parts.scheme, netloc, "/".join(segs), query, ""))
    if changed:
        report.append(f"{where}: the address was shortened to {out} (a sign-in, a value or a key-looking part was removed)")
    return out


# ---- export ----------------------------------------------------------------------------------------------------------------
async def export_team(store, mcp, skills, memory, section_id: str, options: Optional[dict] = None) -> dict:
    """{"file": text, "filename": ..., "report": {...}} for one section. The same call gives the preview the dialog shows."""
    opts = {"notes": True, "skills": True, **(options or {})}
    sections = {s["id"]: s for s in await store.list_sections()}
    if section_id not in sections:
        raise PackageError("section not found")
    changed: list[str] = []
    left_out: list[str] = []
    bots = [b for b in await store.list_bots() if b.section == section_id and not b.hidden][:MAX_BOTS]
    key_of = {b.id: f"b{i + 1}" for i, b in enumerate(bots)}
    have_skills = {s["id"]: s for s in skills.list()}
    total_skills = 0
    out_bots: list[dict] = []
    servers = {i: s for i, s in await mcp.list()}
    conns: dict[str, dict] = {}
    for b in bots:
        d: dict[str, Any] = {"key": key_of[b.id], "name": scrub(b.name, changed, f"bot {b.name}")[:60], "title": scrub(b.title, changed, f"{b.name}'s title")[:80],
                             "description": scrub(b.description, changed, f"{b.name}'s description")[:400], "color": b.color if b.color in COLORS else "green",
                             "instructions": scrub(b.soul, changed, f"{b.name}'s instructions")[:MAX_TEXT]}
        if b.chief:
            d["chief"] = True
        if opts["skills"]:
            sk = []
            for sid in b.skills:
                s = have_skills.get(sid)
                if not s:
                    continue
                if len(sk) >= MAX_SKILLS_PER_BOT or total_skills >= MAX_SKILLS:
                    left_out.append(f"skill {s['name']} of {b.name}: over the limit of the file")
                    continue
                sk.append({"name": scrub(s["name"], changed, "a skill name")[:80], "description": scrub(s["description"], changed, f"skill {s['name']}")[:300],
                           "instructions": scrub(s["body"], changed, f"skill {s['name']}")[:MAX_TEXT]})
                total_skills += 1
            if sk:
                d["skills"] = sk
        used = []
        for sid in b.mcpServers:
            sp = servers.get(sid)
            if not sp:
                continue
            if sp["transport"] == "stdio":
                left_out.append(f"{sp['name']} (a program that runs on this computer) is not shared")
                continue
            c = conns.setdefault(sp["name"], {"name": sp["name"][:60], "transport": sp["transport"], "url": safe_url(sp.get("url", ""), changed, f"connection {sp['name']}"),
                                              "needs": sorted(sp.get("headers", {}).keys())})
            used.append(c["name"])
        if used:
            d["connections"] = used
        if opts["notes"]:
            main = memory.read(memory.main_path(b.id)).strip()
            topics = {}
            tdir = memory.folder(b.id) / "memory"
            if tdir.exists():
                for f in sorted(tdir.glob("*.md")):
                    if f.name != "archive.md":
                        topics[f.name] = scrub(memory.read(f), changed, f"{b.name}'s note {f.name}")[:MAX_TEXT]
            if main or topics:
                d["notes"] = {"memory": scrub(main, changed, f"{b.name}'s MEMORY.md")[:MAX_TEXT], **({"topics": topics} if topics else {})}
        out_bots.append(d)
    groups = []
    for g in await store.list_groups():
        if g.members and all(m in key_of for m in g.members):
            groups.append({"name": scrub(g.name, changed, "a room name")[:60], "members": [key_of[m] for m in g.members], "leader": key_of.get(g.leader or "", None),
                           "instructions": scrub(g.instructions, changed, f"room {g.name}")[:MAX_TEXT], "responder": g.responder})
    gkey = {g.id: i for i, g in enumerate([g for g in await store.list_groups() if g.members and all(m in key_of for m in g.members)])}
    routines = []
    for r in await store.list_routines():
        target = key_of.get(r["targetId"]) if r["targetKind"] == "bot" else None
        room = gkey.get(r["targetId"]) if r["targetKind"] == "group" else None
        if target is None and room is None:
            continue
        routines.append({"name": scrub(r["name"], changed, "a routine name")[:120], "prompt": scrub(r["prompt"], changed, f"routine {r['name']}")[:MAX_TEXT], "kind": r["kind"],
                         **({"bot": target} if target else {"room": room}), **{k: v for k, v in {"everyMin": r["everyMin"], "at": r["at"], "days": r["days"], "tz": r["tz"]}.items() if v is not None}})
    meta = {"format": FORMAT, "version": VERSION, "name": scrub(sections[section_id]["name"], changed, "the team name")[:60], "exported": date.today().isoformat(),
            "bots": out_bots, **({"rooms": groups} if groups else {}), **({"routines": routines} if routines else {}), **({"connections": list(conns.values())} if conns else {})}
    body = "# " + meta["name"] + "\n\nA BotTeam team file. Open it in BotTeam (New bot → Import team) to add these bots. It holds no chat history, keys or model choices.\n\n" + "\n".join(
        f"- **{b['name']}**" + (f" — {b['title']}" if b["title"] else "") for b in out_bots) + "\n"
    text = "---\n" + yaml.safe_dump(meta, sort_keys=False, allow_unicode=True, width=100) + "---\n" + body
    report = counts(meta) | {"changed": changed, "leftOut": left_out, "bytes": len(text.encode("utf8"))}
    return {"file": text, "filename": re.sub(r"[^\w.-]+", "-", meta["name"]).strip("-").lower() + f"-{meta['exported']}.botteam.md", "report": report}


def counts(pkg: dict) -> dict:
    bots = pkg.get("bots", [])
    return {"bots": len(bots), "skills": sum(len(b.get("skills", [])) for b in bots), "rooms": len(pkg.get("rooms", [])), "routines": len(pkg.get("routines", [])),
            "connections": len(pkg.get("connections", [])), "notes": sum(1 for b in bots if b.get("notes"))}


# ---- import ----------------------------------------------------------------------------------------------------------------
def _str(v: Any, limit: int) -> str:
    return v.strip()[:limit] if isinstance(v, str) else ""


def parse(text: str) -> dict:
    """A validated package from a file's text (Markdown with frontmatter, or plain YAML). Only the allowlisted fields survive."""
    if len(text.encode("utf8")) > MAX_FILE:
        raise PackageError("that file is too large")
    m = FRONT.match(text.replace("\r\n", "\n"))
    try:
        raw = yaml.safe_load(m.group(1) if m else text)
    except yaml.YAMLError as e:
        raise PackageError("that is not a valid team file") from e
    if not isinstance(raw, dict) or raw.get("format") != FORMAT:
        raise PackageError("that is not a BotTeam team file")
    if raw.get("version") != VERSION:
        raise PackageError("that file is from a version this app does not understand")
    report: list[str] = []
    bots = []
    for i, b in enumerate(raw.get("bots") or []):
        if not isinstance(b, dict) or not _str(b.get("name"), 60):
            raise PackageError(f"bot {i + 1} has no name")
        d = {"key": _str(b.get("key"), 20) or f"b{i + 1}", "name": _str(b.get("name"), 60), "title": _str(b.get("title"), 80), "description": _str(b.get("description"), 400),
             "color": b.get("color") if b.get("color") in COLORS else "green", "instructions": scrub(_str(b.get("instructions"), MAX_TEXT), report, f"bot {b.get('name')}"), "chief": b.get("chief") is True}
        d["skills"] = [{"name": _str(s.get("name"), 80), "description": scrub(_str(s.get("description"), 300), report, "a skill"), "instructions": scrub(_str(s.get("instructions"), MAX_TEXT), report, f"skill {s.get('name')}")}
                       for s in (b.get("skills") or [])[:MAX_SKILLS_PER_BOT] if isinstance(s, dict) and _str(s.get("name"), 80)]
        d["connections"] = [_str(c, 60) for c in (b.get("connections") or []) if _str(c, 60)]
        n = b.get("notes") if isinstance(b.get("notes"), dict) else None
        if n:
            d["notes"] = {"memory": scrub(_str(n.get("memory"), MAX_TEXT), report, f"{d['name']}'s notes"),
                          "topics": {re.sub(r"[^\w.-]", "_", str(k))[:60]: scrub(_str(v, MAX_TEXT), report, f"{d['name']}'s note {k}") for k, v in (n.get("topics") or {}).items() if isinstance(v, str)}}
        bots.append(d)
    if not bots:
        raise PackageError("that file has no bots")
    if len(bots) > MAX_BOTS:
        raise PackageError("that file has too many bots")
    keys = {b["key"] for b in bots}
    rooms = [{"name": _str(g.get("name"), 60), "members": [k for k in (g.get("members") or []) if k in keys], "leader": g.get("leader") if g.get("leader") in keys else None,
              "instructions": scrub(_str(g.get("instructions"), MAX_TEXT), report, "a room"), "responder": g.get("responder") if g.get("responder") in RESPONDERS else "leader"}
             for g in (raw.get("rooms") or []) if isinstance(g, dict) and _str(g.get("name"), 60)]
    routines = []
    for r in raw.get("routines") or []:
        if not isinstance(r, dict) or not _str(r.get("prompt"), 10) or r.get("kind") not in KINDS:
            continue
        item = {"name": _str(r.get("name"), 120) or "Routine", "prompt": scrub(_str(r.get("prompt"), MAX_TEXT), report, "a routine"), "kind": r["kind"], "tz": _str(r.get("tz"), 64) or "UTC"}
        if r.get("bot") in keys:
            item["bot"] = r["bot"]
        elif isinstance(r.get("room"), int) and 0 <= r["room"] < len(rooms):
            item["room"] = r["room"]
        else:
            continue
        for k in ("everyMin",):
            if isinstance(r.get(k), int):
                item[k] = r[k]
        if isinstance(r.get("at"), str):
            item["at"] = r["at"][:5]
        if isinstance(r.get("days"), list):
            item["days"] = [d for d in r["days"] if isinstance(d, int) and 0 <= d <= 6]
        routines.append(item)
    conns = []
    for c in raw.get("connections") or []:
        if isinstance(c, dict) and _str(c.get("name"), 60) and c.get("transport") in ("http", "sse"):
            conns.append({"name": _str(c["name"], 60), "transport": c["transport"], "url": _str(c.get("url"), 500), "needs": [_str(n, 60) for n in (c.get("needs") or []) if _str(n, 60)][:20]})
    pkg = {"name": _str(raw.get("name"), 60) or "Imported team", "bots": bots, "rooms": rooms, "routines": routines, "connections": conns, "changed": report}
    return pkg


def review(pkg: dict) -> dict:
    """What the review screen shows before anything is created."""
    return {"name": pkg["name"], "counts": counts(pkg), "bots": [{"name": b["name"], "title": b["title"], "skills": [s["name"] for s in b["skills"]], "chief": b["chief"], "notes": bool(b.get("notes"))} for b in pkg["bots"]],
            "rooms": [g["name"] for g in pkg["rooms"]], "routines": [r["name"] for r in pkg["routines"]], "connections": [{"name": c["name"], "url": c["url"], "needs": c["needs"]} for c in pkg["connections"]],
            "changed": pkg["changed"], "willDo": ["new bots start at the Ask level", "skills are switched off", "routines are paused", "connections are switched off with empty values"]}


async def apply_import(store, bus, mcp, skills, memory, groups_service, routines_service, turns, pkg: dict, selection: dict) -> dict:
    """Create everything in a new section; if any step fails, remove what was made and raise."""
    made: dict[str, list] = {"section": [], "bots": [], "skills": [], "groups": [], "routines": [], "servers": []}
    try:
        base = pkg["name"]
        names = {s["name"] for s in await store.list_sections()}
        name, n = base, 2
        while name in names:
            name, n = f"{base} ({n})", n + 1
        section = await store.create_section(name)
        made["section"].append(section["id"])
        key_to_bot: dict[str, Any] = {}
        existing_servers = {s["name"] for _, s in await mcp.list()}
        conn_ids: dict[str, str] = {}
        for c in pkg["connections"]:  # switched off, named so they never pick up credentials already stored
            nm, k = c["name"], 2
            while nm in existing_servers:
                nm, k = f"{c['name']}-{k}", k + 1
            existing_servers.add(nm)
            sid, _ = await mcp.create({"name": nm, "transport": c["transport"], "url": c["url"], "headers": {h: "" for h in c["needs"]}, "enabled": False})
            made["servers"].append(sid)
            conn_ids[c["name"]] = sid
        for b in pkg["bots"]:
            bot = await store.create_bot(b["name"], b["title"], b["description"], b["color"], selection)
            bot.soul, bot.section, bot.approvalMode, bot.chief = b["instructions"], section["id"], "ask", False  # a package never makes a Chief or widens a level
            bot.mcpServers = [conn_ids[c] for c in b["connections"] if c in conn_ids]
            sk_ids = []
            for s in b["skills"]:
                made_skill = skills.save(None, s["name"], s["description"], s["instructions"], enabled=False)
                made["skills"].append(made_skill["id"])
                sk_ids.append(made_skill["id"])
            bot.skills = sk_ids
            await store.save_bot(bot)
            made["bots"].append(bot.id)
            key_to_bot[b["key"]] = bot
            if b.get("notes"):
                if b["notes"]["memory"]:
                    from .memory import write_atomic

                    write_atomic(memory.main_path(bot.id), b["notes"]["memory"].rstrip("\n") + "\n")
                for fn, text in b["notes"]["topics"].items():
                    from .memory import write_atomic

                    write_atomic(memory.folder(bot.id) / "memory" / (fn if fn.endswith(".md") else fn + ".md"), text)
        room_ids: list[str] = []
        for g in pkg["rooms"]:
            members = [key_to_bot[k].id for k in g["members"] if k in key_to_bot]
            if not members:
                room_ids.append("")
                continue
            grp = await store.create_group(g["name"], members, key_to_bot[g["leader"]].id if g["leader"] in key_to_bot else members[0], g["instructions"], None, g["responder"])
            made["groups"].append(grp.id)
            room_ids.append(grp.id)
        for r in pkg["routines"]:
            target = ("bot", key_to_bot[r["bot"]].id) if "bot" in r else ("group", room_ids[r["room"]]) if r.get("room") is not None and room_ids[r["room"]] else None
            if not target:
                continue
            row = await routines_service.create(target_kind=target[0], target_id=target[1], name=r["name"], prompt=r["prompt"], kind=r["kind"], every_min=r.get("everyMin"), at=r.get("at"),
                                                days=r.get("days"), tz=r.get("tz"), created_by="import")
            await routines_service.update(row["id"], enabled=False)  # always paused
            made["routines"].append(row["id"])
        await turns.host.refresh()
        for bot in key_to_bot.values():
            await turns.publish_bot(await store.get_bot(bot.id))
        for gid in made["groups"]:
            await groups_service.publish(await store.get_group(gid))
        bus.publish({"kind": "sections", "sections": await store.list_sections()})
        return {"section": name, "bots": len(made["bots"]), "skills": len(made["skills"]), "rooms": len(made["groups"]), "routines": len(made["routines"]), "connections": len(made["servers"])}
    except Exception:
        for rid in made["routines"]:
            await routines_service.delete(rid)
        for gid in made["groups"]:
            await store.delete_group(gid)
        for bid in made["bots"]:
            await store.delete_bot(bid)
            memory_dir = memory.folder(bid)
            import shutil

            shutil.rmtree(memory_dir, ignore_errors=True)
        for sk in made["skills"]:
            try:
                skills.delete(sk)
            except Exception:
                pass
        for sv in made["servers"]:
            await mcp.delete(sv)
        for sec in made["section"]:
            await store.delete_section(sec)
        raise


# ---- fetching a file from a public address ---------------------------------------------------------------------------------
HOSTS = {"github.com", "raw.githubusercontent.com", "gist.githubusercontent.com", "gist.github.com"}


def raw_address(url: str) -> str:
    """A GitHub page address turned into the address of the raw file; anything else not on the allowlist is refused."""
    u = urlsplit(url.strip())
    if u.scheme != "https" or (u.hostname or "") not in HOSTS:
        raise PackageError("only public files on GitHub can be fetched by address")
    m = re.fullmatch(r"/([^/]+)/([^/]+)/blob/(.+)", u.path)
    if u.hostname == "github.com" and m:
        return f"https://raw.githubusercontent.com/{m.group(1)}/{m.group(2)}/{m.group(3)}"
    return url.strip()


async def fetch(url: str, client: Optional[httpx.AsyncClient] = None) -> str:
    """The text of a public file, with a size limit, and never an internal address (each redirect is checked again)."""
    addr = raw_address(url)
    own = client is None
    client = client or httpx.AsyncClient(timeout=15, follow_redirects=False)
    try:
        for _ in range(4):
            try:
                check_url(addr)
            except BlockedAddress as e:
                raise PackageError(f"that address cannot be fetched: {e}") from e
            try:
                async with client.stream("GET", addr, headers={"accept": "text/plain, text/markdown, */*"}) as r:
                    if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                        addr = raw_address(str(httpx.URL(addr).join(r.headers["location"])))
                        continue
                    if r.status_code != 200:
                        raise PackageError(f"the address answered {r.status_code}")
                    body = b""
                    async for chunk in r.aiter_bytes():
                        body += chunk
                        if len(body) > MAX_FILE:
                            raise PackageError("that file is too large")
                    return body.decode("utf8", "replace")
            except httpx.HTTPError as e:
                raise PackageError(f"could not fetch that address: {e}") from e
        raise PackageError("too many redirects")
    finally:
        if own:
            await client.aclose()


# ---- presets -----------------------------------------------------------------------------------------------------------------
BUILTIN_PRESETS = [
    {"id": "researcher", "name": "Researcher", "title": "Researcher", "description": "Finds sources, reads them carefully and reports what holds up.", "color": "blue",
     "instructions": "You research questions. Look for primary sources, say how sure you are, quote exactly, and list what you could not verify."},
    {"id": "developer", "name": "Developer", "title": "Fullstack Developer", "description": "Implements features and fixes bugs with small, tested changes.", "color": "green",
     "instructions": "You write and change code. Read before you edit, keep changes small, run the tests, and say what you ran."},
    {"id": "qa", "name": "QA", "title": "QA and Release Engineer", "description": "Turns requirements into test plans and verifies releases.", "color": "orange",
     "instructions": "You test. Turn acceptance criteria into checks, reproduce defects precisely, and report what passed, what is uncertain and how to roll back."},
    {"id": "writer", "name": "Writer", "title": "Writer and Editor", "description": "Drafts and edits clear text in the person's voice.", "color": "purple",
     "instructions": "You write and edit. Ask for the audience and purpose, keep sentences plain, and show changes you made to the person's own words."},
    {"id": "assistant", "name": "Assistant", "title": "Personal Assistant", "description": "Keeps track of tasks, errands and follow-ups.", "color": "pink",
     "instructions": "You help with errands and follow-ups. Confirm before anything is sent or bought, and keep a short list of what is open."},
]
