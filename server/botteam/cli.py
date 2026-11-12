"""`botteam`: one command to start everything, and the same team from a script.

    botteam [serve] [--host H] [--port P] [--no-open]   start the API and the web app (127.0.0.1 only unless you say otherwise)
    botteam team apply FILE [--json]                      add a team file (Markdown with frontmatter, or YAML) as new bots
    botteam team export SECTION [--out FILE]              save a section as a team file
    botteam run BOT "TASK" [--export DIR] [--json]        give a bot a job, wait, print what it said
    botteam mcp                                           BotTeam as an MCP server on stdio (Claude Desktop, Cursor)
    botteam backup FILE / restore FILE [--force]          zip the data folder / put it back

Exit codes: 0 done · 1 the work failed · 2 the arguments or the file are wrong · 3 timed out · 4 it is waiting for a person's answer.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import threading
import time
import webbrowser
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Optional

import httpx

EXIT_OK, EXIT_FAILED, EXIT_USAGE, EXIT_TIMEOUT, EXIT_NEEDS_PERSON = 0, 1, 2, 3, 4
DEFAULT_PORT = int(os.environ.get("SERVER_PORT", "8899"))


# ---- serve -----------------------------------------------------------------------------------------------------------------
def cmd_serve(a: argparse.Namespace) -> int:
    import uvicorn

    from .auth import is_loopback

    os.environ["BOTTEAM_REMOTE"] = "0" if is_loopback(a.host) else "1"  # listening beyond this computer means a pairing code is needed
    if a.web_dir:
        os.environ["BOTTEAM_WEB_DIR"] = str(Path(a.web_dir).resolve())
    from .main import app  # imported after the environment is set: the app reads it when it is made

    web = getattr(app.state, "web_dir", None)
    url = f"http://{'127.0.0.1' if a.host in ('0.0.0.0', '::') else a.host}:{a.port}"
    print(f"BotTeam on {url}" + ("" if web else "  (no web build found: run `pnpm build:static`, or use `pnpm dev` for the UI)"), flush=True)
    if not is_loopback(a.host):
        print("Domain access needs browser pairing; localhost and LAN/Tailscale IPs open directly. The code is printed below.", flush=True)
    if not a.no_open and web:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=a.host, port=a.port, proxy_headers=False, loop="botteam.loop:loop_factory", log_level="warning")
    return EXIT_OK


# ---- talking to a server, running or not -----------------------------------------------------------------------------------
@asynccontextmanager
async def open_api(url: Optional[str]) -> AsyncIterator[httpx.AsyncClient]:
    """The API of a running BotTeam; when none answers, the app itself, started inside this process for as long as the command runs."""
    base = (url or os.environ.get("BOTTEAM_URL") or f"http://127.0.0.1:{DEFAULT_PORT}").rstrip("/")
    try:
        async with httpx.AsyncClient(base_url=base, timeout=300) as c:
            r = await c.get("/api/auth/status", timeout=1.5)
            if r.status_code == 200:
                yield c
                return
    except httpx.HTTPError:
        pass
    from asgi_lifespan import LifespanManager

    from .main import create_app

    app = create_app()
    async with LifespanManager(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://botteam", timeout=300) as c:
            yield c


def out(args: argparse.Namespace, data: dict, text: str) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=1) if args.json else text)


def err(msg: str) -> None:
    print(msg, file=sys.stderr)


# ---- team ------------------------------------------------------------------------------------------------------------------
async def team_apply(a: argparse.Namespace) -> int:
    path = Path(a.file)
    if not path.is_file():
        err(f"no such file: {path}")
        return EXIT_USAGE
    async with open_api(a.url) as c:
        r = await c.post("/api/teams/import", json={"text": path.read_text(encoding="utf8")})
        if r.status_code == 401:
            err("this server needs a pairing code; use the web app, or run the command on the machine itself")
            return EXIT_USAGE
        if r.status_code == 400:
            err(r.json().get("detail", "that file cannot be used"))
            return EXIT_USAGE
        if r.status_code >= 400:
            err(r.json().get("detail", f"the server answered {r.status_code}"))
            return EXIT_FAILED
        d = r.json()
        out(a, d, f"Added {d['bots']} bots to “{d['section']}” ({d['skills']} skills switched off, {d['routines']} routines paused, {d['connections']} connections switched off).")
        return EXIT_OK


async def team_export(a: argparse.Namespace) -> int:
    async with open_api(a.url) as c:
        secs = (await c.get("/api/sidebar-sections")).json()["sections"]
        sec = next((s for s in secs if s["name"].lower() == a.section.lower() or s["id"] == a.section), None)
        if not sec:
            err(f"no section called {a.section!r}")
            return EXIT_USAGE
        r = await c.post("/api/teams/export", json={"sectionId": sec["id"], "options": {"notes": not a.no_notes}})
        d = r.json()
        dest = Path(a.out or d["filename"])
        dest.write_text(d["file"], encoding="utf8")
        out(a, {"file": str(dest), "report": d["report"]}, f"Saved {dest} ({d['report']['bots']} bots).")
        return EXIT_OK


# ---- run -------------------------------------------------------------------------------------------------------------------
async def run_job(a: argparse.Namespace) -> int:
    async with open_api(a.url) as c:
        bots = (await c.get("/api/bots")).json()["bots"]
        bot = next((b for b in bots if b["id"] == a.bot or b["name"].lower() == a.bot.lower()), None)
        if not bot:
            err(f"no bot called {a.bot!r}; the bots are: {', '.join(b['name'] for b in bots) or '(none)'}")
            return EXIT_USAGE
        thread = bot["threadId"]
        if a.new_thread:
            thread = (await c.post(f"/api/bots/{bot['id']}/tasks", json={"title": a.task[:40]})).json()["threadId"]
        sent = await c.post(f"/api/bots/{bot['id']}/messages", json={"text": a.task, "threadId": thread})
        if sent.status_code >= 400:
            err(sent.json().get("detail", "could not send the job"))
            return EXIT_FAILED
        deadline = time.time() + a.timeout
        status, code = "done", EXIT_OK
        await asyncio.sleep(0.4)
        while True:
            cur = next(b for b in (await c.get("/api/bots")).json()["bots"] if b["id"] == bot["id"])
            if cur["activity"] == "waiting-on-you":
                await c.post(f"/api/bots/{bot['id']}/interrupt", params={"thread": thread})  # nobody here to answer: stop the turn
                status, code = "needs_person", EXIT_NEEDS_PERSON
                break
            if not any(t["threadId"] == thread and t["busy"] for t in cur["tasks"]):
                break
            if time.time() > deadline:
                await c.post(f"/api/bots/{bot['id']}/interrupt", params={"thread": thread})
                status, code = "timeout", EXIT_TIMEOUT
                break
            await asyncio.sleep(0.5)
        msgs = (await c.get(f"/api/bots/{bot['id']}/messages", params={"thread": thread})).json()["messages"]
        after = [m for m in msgs if m["at"] >= sent.json().get("message", {}).get("at", 0)]
        reply = next((m["text"] for m in reversed(after) if m["role"] == "bot" and m["kind"] == "text" and m["text"]), "")
        failure = next((m["text"] for m in reversed(after) if m["kind"] == "error"), None)
        if failure and status == "done":
            status, code = "failed", EXIT_FAILED
        result: dict[str, Any] = {"bot": bot["name"], "thread": thread, "status": status, "reply": reply, "error": failure}
        if a.export:
            d = Path(a.export)
            d.mkdir(parents=True, exist_ok=True)
            stem = "".join(ch if ch.isalnum() else "-" for ch in bot["name"]).strip("-") or "bot"
            for fmt in ("md", "json"):
                body = (await c.get(f"/api/bots/{bot['id']}/export", params={"thread": thread, "format": fmt})).text
                (d / f"{stem}-transcript.{fmt}").write_text(body, encoding="utf8")
            (d / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf8")
            result["exportDir"] = str(d.resolve())
        out(a, result, reply or (failure or f"({status})"))
        if status == "needs_person":
            err("the bot is waiting for an approval or an answer; open the web app, or use a higher approval level for this bot")
        return code


# ---- data ------------------------------------------------------------------------------------------------------------------
def cmd_backup(a: argparse.Namespace) -> int:
    from .backup import BackupError, make_backup
    from .store import data_dir

    try:
        r = make_backup(data_dir(), Path(a.file))
    except BackupError as e:
        err(str(e))
        return EXIT_USAGE
    print(f"Backed up {r['files']} files to {a.file} ({r['bytes']} bytes).")
    return EXIT_OK


def cmd_restore(a: argparse.Namespace) -> int:
    from .backup import BackupError, restore
    from .store import data_dir

    try:
        r = restore(Path(a.file), data_dir(), force=a.force)
    except BackupError as e:
        err(str(e))
        return EXIT_USAGE
    print(f"Restored {r['files']} files.")
    return EXIT_OK


def cmd_mcp(a: argparse.Namespace) -> int:
    if a.url:
        os.environ["BOTTEAM_URL"] = a.url
    from . import mcp_app

    mcp_app.main()
    return EXIT_OK


# ---- the parser ------------------------------------------------------------------------------------------------------------
def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="botteam", description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__.split("\n\n", 1)[1])
    sub = p.add_subparsers(dest="cmd")
    s = sub.add_parser("serve", help="start BotTeam (the default)")
    s.add_argument("--host", default=os.environ.get("BOTTEAM_HOST", "127.0.0.1"))
    s.add_argument("--port", type=int, default=DEFAULT_PORT)
    s.add_argument("--no-open", action="store_true", help="do not open a browser")
    s.add_argument("--web-dir", help="the static web build to serve")
    s.set_defaults(fn=cmd_serve)
    t = sub.add_parser("team", help="share or add a team file")
    ts = t.add_subparsers(dest="team_cmd", required=True)
    ap = ts.add_parser("apply", help="add the bots of a team file")
    ap.add_argument("file")
    ap.set_defaults(fn=lambda a: asyncio.run(team_apply(a)))
    ex = ts.add_parser("export", help="save a section as a team file")
    ex.add_argument("section")
    ex.add_argument("--out")
    ex.add_argument("--no-notes", action="store_true", help="leave the bots' notes out")
    ex.set_defaults(fn=lambda a: asyncio.run(team_export(a)))
    r = sub.add_parser("run", help="give a bot a job and wait for it")
    r.add_argument("bot")
    r.add_argument("task")
    r.add_argument("--export", metavar="DIR", help="save the transcript (Markdown and JSON) and the result here")
    r.add_argument("--timeout", type=int, default=600, help="seconds to wait (default 600)")
    r.add_argument("--new-thread", action="store_true", help="work in a new conversation")
    r.set_defaults(fn=lambda a: asyncio.run(run_job(a)))
    m = sub.add_parser("mcp", help="BotTeam as an MCP server on stdio")
    m.set_defaults(fn=cmd_mcp)
    b = sub.add_parser("backup", help="zip the data folder")
    b.add_argument("file")
    b.set_defaults(fn=cmd_backup)
    rs = sub.add_parser("restore", help="put a backup back (stop the server first)")
    rs.add_argument("file")
    rs.add_argument("--force", action="store_true", help="replace a data folder that already holds data")
    rs.set_defaults(fn=cmd_restore)
    for sp in (ap, ex, r, m):
        sp.add_argument("--url", help="a running BotTeam (default: http://127.0.0.1:8899; if none answers, the app runs inside this command)")
    for sp in (ap, ex, r):
        sp.add_argument("--json", action="store_true", help="print the result as JSON")
    return p


def main(argv: Optional[list[str]] = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0].startswith("--") and argv[0] not in ("--help", "-h"):
        argv = ["serve", *argv]  # `botteam` and `botteam --no-open` start the server
    a = parser().parse_args(argv)
    if not getattr(a, "fn", None):
        parser().print_help()
        return EXIT_USAGE
    return int(a.fn(a) or 0)


if __name__ == "__main__":
    sys.exit(main())
