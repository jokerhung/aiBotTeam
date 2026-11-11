"""Memory (notes between tasks, the recall block, the budget, the team's memory) and skills (the library, bots, the turn's directory)."""
import asyncio
import json
import os
import stat
from pathlib import Path

from botteam.drivers.base import SendTurnInput
from botteam.drivers.claude import ClaudeDriver
from botteam.memory import BYTE_BUDGET, LINE_BUDGET, Memory, redact
from botteam.skills import Skills, parse, render

from .test_api import ctx, make_bot, wait_idle  # noqa: F401  (fixture)
from .test_teams import wait_until

GHP = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4"


def stand_in(bot):
    from botteam.turns import ThreadRun

    return ThreadRun(bot_id=bot["id"], inp=SendTurnInput(thread_id=bot["threadId"], bot_id=bot["id"], text=""))


def test_a_note_is_dated_redacted_and_capped(tmp_path):
    m = Memory(tmp_path)
    out = m.remember("b1", f"deploy key is {GHP} and password: hunter2hunter2 — remember the Friday freeze " + "x" * 3000, today="2026-11-11")
    assert out["ok"]
    text = m.read(m.main_path("b1"))
    assert text.startswith("- [2026-11-11] deploy key is «redacted") and GHP not in text and "hunter2hunter2" not in text
    assert len(text) <= 1000 + 40  # one entry is at most 1000 characters
    assert "«redacted" in redact("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----")
    if os.name != "nt":
        assert stat.S_IMODE(m.main_path("b1").stat().st_mode) == 0o600
    assert not list(m.folder("b1").glob(".tmp-*")), "an atomic write leaves no temporary file behind"
    assert m.remember("b1", "   ")["ok"] is False


def test_memory_md_never_outgrows_its_budget_and_what_moves_goes_to_the_archive(tmp_path):
    m = Memory(tmp_path)
    m.main_path("b").parent.mkdir(parents=True)
    m.main_path("b").write_text("# Notes I wrote by hand\nnever moves\n", encoding="utf8")
    for i in range(260):
        m.remember("b", f"entry number {i}", today="2026-11-11")
    text = m.read(m.main_path("b"))
    lines = text.rstrip("\n").split("\n")
    assert len(lines) <= LINE_BUDGET and len(text.encode()) <= BYTE_BUDGET
    assert lines[0] == "# Notes I wrote by hand" and lines[1] == "never moves"  # hand-written lines never move
    assert "entry number 259" in text and "entry number 0 " not in text and not text.endswith("entry number 0\n")  # the oldest moved out
    archive = m.read(m.folder("b") / "memory" / "archive.md")
    assert "entry number 0 · moved 2026-11-11" in archive
    # every entry is in one of the two files
    both = text + archive
    assert all(f"entry number {i}" in both for i in range(260))
    assert m.gauge("b")["state"] in ("amber", "ok") and m.gauge("b")["notLoaded"] == 0


def test_only_the_first_200_lines_load_and_the_gauge_says_so(tmp_path):
    m = Memory(tmp_path)
    m.main_path("b").parent.mkdir(parents=True)
    m.main_path("b").write_text("\n".join(f"line {i}" for i in range(260)), encoding="utf8")  # edited by hand, past the budget
    g = m.gauge("b")
    assert g["state"] == "red" and g["notLoaded"] == 60 and g["lineBudget"] == 200
    block = m.recall_block("b")
    assert "line 199" in block and "line 200" not in block and "60 more lines were not loaded" in block
    assert m.resolve("b", "memory/../../secrets.md") is None and m.resolve("b", "../MEMORY.md") is None and m.resolve("b", "MEMORY.md")


async def test_the_recall_block_goes_before_the_turn_and_not_into_the_transcript(ctx):
    c, app = ctx
    bot = await make_bot(c)
    app.state.memory.remember(bot["id"], "the person prefers short answers", today="2026-11-11")
    await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "hello there"})
    await wait_idle(c, bot["id"])
    msgs = (await c.get(f"/api/bots/{bot['id']}/messages")).json()["messages"]
    mine = next(m for m in msgs if m["role"] == "user")
    reply = next(m for m in msgs if m["role"] == "bot" and m["kind"] == "text")
    assert mine["text"] == "hello there"  # the transcript keeps what the person wrote
    assert "the person prefers short answers" in reply["text"] and "Your memory" in reply["text"]  # the engine was given the notes first
    # switched off: nothing is loaded and the tools refuse
    await c.patch(f"/api/bots/{bot['id']}", json={"memory": False})
    await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "again"})
    await wait_idle(c, bot["id"])
    last = [m for m in (await c.get(f"/api/bots/{bot['id']}/messages")).json()["messages"] if m["role"] == "bot" and m["kind"] == "text"][-1]
    assert "prefers short answers" not in last["text"]
    app.state.turns.runs["tm"] = stand_in(bot)
    refused = await app.state.agents.call("tm", "remember", {"note": "x y z"})
    app.state.turns.runs.pop("tm")
    assert refused["ok"] is False and refused["reason"] == "memory_off"


async def test_a_bot_remembers_recalls_and_forgets_through_its_tools(ctx):
    c, app = ctx
    bot = await make_bot(c)
    app.state.turns.runs["tm"] = stand_in(bot)
    call = lambda tool, **a: app.state.agents.call("tm", tool, a)
    assert (await call("remember", note="the staging server is at example.test"))["ok"]
    assert (await call("remember", note="release checklist: tag, build, announce", topic="release"))["where"] == "release.md"
    assert (await call("recall"))["files"][0]["name"] == "MEMORY.md" and any(f["name"] == "memory/release.md" for f in (await call("recall"))["files"])
    assert "tag, build, announce" in (await call("recall", topic="release"))["text"]
    assert (await call("recall", topic="nope"))["reason"] == "not_found"
    assert (await call("forget", match="ab"))["reason"] == "too_short"
    assert (await call("forget", match="staging server"))["removed"] == 1
    app.state.turns.runs.pop("tm")
    view = (await c.get(f"/api/bots/{bot['id']}/memory")).json()
    assert view["entries"] == [] and view["enabled"] is True and view["gauge"]["lineBudget"] == 200


async def test_the_person_reads_edits_and_deletes_notes(ctx):
    c, app = ctx
    bot = await make_bot(c)
    app.state.memory.remember(bot["id"], "first note", today="2026-11-10")
    app.state.memory.remember(bot["id"], "second note", today="2026-11-11")
    view = (await c.get(f"/api/bots/{bot['id']}/memory")).json()
    assert [e["text"] for e in view["entries"]] == ["first note", "second note"] and view["entries"][0]["date"] == "2026-11-10"
    assert (await c.delete(f"/api/bots/{bot['id']}/memory/entries/{view['entries'][0]['id']}")).status_code == 200
    assert (await c.delete(f"/api/bots/{bot['id']}/memory/entries/{view['entries'][0]['id']}")).status_code == 404
    put = (await c.put(f"/api/bots/{bot['id']}/memory/file", json={"name": "memory/ideas.md", "text": "# ideas\n- one"})).json()
    assert put["ok"]
    assert (await c.get(f"/api/bots/{bot['id']}/memory/file", params={"name": "memory/ideas.md"})).json()["text"].startswith("# ideas")
    assert (await c.get(f"/api/bots/{bot['id']}/memory/file", params={"name": "../../etc/passwd"})).status_code == 404
    assert (await c.put(f"/api/bots/{bot['id']}/memory/file", json={"name": "memory/../escape.md", "text": "x"})).status_code == 404


async def test_the_team_memory_changes_only_through_an_approval_card_even_at_full_access(ctx):
    c, app = ctx
    sec = (await c.post("/api/sidebar-sections", json={"name": "Crew"})).json()
    a, b = await make_bot(c, "Ann"), await make_bot(c, "Ben")
    for x in (a, b):
        await c.patch(f"/api/bots/{x['id']}", json={"section": sec["id"], "approvalMode": "full"})
    loner = await make_bot(c, "Loner")
    tid = a["threadId"]  # the broker knows a bot by its real conversation
    app.state.turns.runs[tid] = stand_in(a)
    assert (await app.state.agents.call(tid, "team_remember", {"note": "  "}))["reason"] == "empty"
    task = asyncio.create_task(app.state.agents.call(tid, "team_remember", {"note": "we never deploy on Fridays"}))
    broker = app.state.turns.broker

    async def card():
        return next((r for _, r in broker.all_open() if r["tool"] == "TeamMemory"), None)
    req = await wait_until(card)  # a card, although Ann runs at full access
    assert "we never deploy on Fridays" in req["summary"]
    await broker.resolve(req["id"], "deny")
    res = await task
    assert res["reason"] == "declined", res
    assert not app.state.memory.team_path(sec["id"]).exists()
    task = asyncio.create_task(app.state.agents.call(tid, "team_remember", {"note": "we never deploy on Fridays"}))
    req = await wait_until(card)
    await broker.resolve(req["id"], "allow")
    assert (await task)["ok"] is True
    app.state.turns.runs.pop(tid)
    assert "we never deploy on Fridays (from Ann)" in app.state.memory.read(app.state.memory.team_path(sec["id"]))
    # Ben, in the same section, is told; a bot with no section has none
    bot_b = await app.state.store.get_bot(b["id"])
    assert "we never deploy on Fridays" in app.state.memory.recall_block(b["id"], bot_b.section)
    app.state.turns.runs[loner["threadId"]] = stand_in(loner)
    assert (await app.state.agents.call(loner["threadId"], "team_remember", {"note": "hi there"}))["reason"] == "no_section"
    app.state.turns.runs.pop(loner["threadId"])


def test_a_skill_is_a_markdown_file_with_frontmatter(tmp_path):
    s = Skills(tmp_path)
    made = s.save(None, "Release notes", "Write release notes in our style", "1. List changes\n2. Thank people")
    assert made["id"] == "release-notes" and made["enabled"] is True
    assert (tmp_path / "skills" / "release-notes" / "SKILL.md").read_text().startswith("---\nname: Release notes\ndescription: Write release notes in our style\n---\n")
    assert parse(render("A", "d", "body")) == {"name": "A", "description": "d", "body": "body"}
    assert s.save(None, "Release notes", "again", "x")["id"] == "release-notes-2"  # the same name does not overwrite
    s.save("release-notes", "Release notes", "d", "b", enabled=False)
    assert s.for_bot(["release-notes", "release-notes-2", "ghost"])[0]["id"] == "release-notes-2" and len(s.for_bot(["release-notes", "ghost"])) == 0  # off and unknown are left out
    root = Path(s.turn_dir("th_1", s.for_bot(["release-notes-2"])))
    assert (root / ".claude" / "skills" / "release-notes-2" / "SKILL.md").exists()
    s.cleanup("th_1")
    assert not root.exists() and s.turn_dir("th_2", []) is None
    assert "Release notes" in Skills.as_text(s.for_bot(["release-notes-2"]))


async def test_skills_are_assigned_to_bots_and_given_to_the_turn(ctx):
    c, app = ctx
    bot = await make_bot(c)
    made = (await c.post("/api/skills", json={"name": "Greeter", "description": "Greets people", "body": "Say hello warmly."})).json()
    assert (await c.post("/api/skills", json={"name": "", "body": "x"})).status_code == 400
    assert (await c.patch(f"/api/bots/{bot['id']}", json={"skills": ["ghost"]})).status_code == 404
    assert (await c.patch(f"/api/bots/{bot['id']}", json={"skills": [made["id"]]})).json()["skills"] == [made["id"]]
    assert (await c.patch(f"/api/skills/{made['id']}", json={"enabled": False})).json()["enabled"] is False
    assert app.state.skills.for_bot([made["id"]]) == []
    await c.patch(f"/api/skills/{made['id']}", json={"enabled": True})
    # for the Claude CLI the turn gets the directory (--add-dir); the skill is in it
    class Broker:
        port, token = 1, "t"
    d = ClaudeDriver("claude", broker=Broker())
    root = app.state.skills.turn_dir("th_c", app.state.skills.for_bot([made["id"]]))
    args = d.build_args(SendTurnInput(thread_id="th_c", bot_id="b", text="hi", skills_dir=root), None)
    assert args[args.index("--add-dir") + 1] == root and (Path(root) / ".claude" / "skills" / made["id"] / "SKILL.md").exists()
    assert (await c.delete(f"/api/skills/{made['id']}")).status_code == 200
    assert (await c.get("/api/skills")).json()["skills"] == []
    mine = next(b for b in (await c.get("/api/bots")).json()["bots"] if b["id"] == bot["id"])
    assert mine["skills"] == []


async def test_a_compaction_is_marked_in_the_chat(ctx):
    c, app = ctx
    bot = await make_bot(c)
    d = ClaudeDriver("claude")
    seen = []
    d.on_event(lambda ev: seen.append(ev))
    s = type("S", (), {"turn_id": "t1", "cursor": None})()
    d.handle_frame("th_x", s, {"type": "system", "subtype": "compact_boundary", "compact_metadata": {"trigger": "auto"}})
    assert seen[0].type == "context.compacted" and seen[0].data["trigger"] == "auto"
    thread = bot["threadId"]
    app.state.turns.runs[thread] = stand_in(bot)
    app.state.turns.runs[thread].live = None
    await app.state.turns._compacted(await app.state.store.get_bot(bot["id"]), thread, app.state.turns.runs[thread])
    app.state.turns.runs.pop(thread)
    texts = [m["text"] for m in (await c.get(f"/api/bots/{bot['id']}/messages")).json()["messages"] if m["kind"] == "notice"]
    assert any("context compacted" in t for t in texts)
