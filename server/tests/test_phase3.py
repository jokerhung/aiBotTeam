"""Phase 3: permission broker, approval modes, security of keys and attachments, sections, search."""
import asyncio
import json
import os

import httpx
import pytest
from asgi_lifespan import LifespanManager

from botteam.approval import claude_permission_mode, codex_sandbox, is_readonly_command, normalize_mode
from botteam.broker import Broker, Policy
from botteam.config import ConfigStore
from botteam.main import create_app

from .test_api import ctx, make_bot  # noqa: F401  (fixture)

CWD = os.path.abspath(os.sep)


def make_broker(tmp_path, mode="ask", expire=5.0):
    cfg = ConfigStore(tmp_path / "config.json")
    opened, resolved = [], []

    async def policy(_tid):
        return Policy(mode, CWD, "claude")

    async def on_open(tid, req):
        opened.append((tid, req))

    async def on_res(tid, req):
        resolved.append((tid, req))

    return Broker(cfg, policy, on_open, on_res, expire_after=expire), opened, resolved


async def settle():
    for _ in range(5):
        await asyncio.sleep(0.01)


# ---- approval modes -----------------------------------------------------------------------------
def test_mode_normalization_fails_closed():
    assert normalize_mode(None) == "full"
    assert normalize_mode("auto") == "auto"
    assert normalize_mode("everything") == "ask"


def test_engine_mapping():
    assert claude_permission_mode("full") == "bypassPermissions"
    assert claude_permission_mode("edits") == "acceptEdits"
    assert claude_permission_mode("ask") == "default"
    assert codex_sandbox("ask") == "read-only" and codex_sandbox("full") == "danger-full-access"


@pytest.mark.parametrize("cmd,ok", [
    ("ls -la", True), ("git status", True), ("git log --oneline", True), ("cat a.txt", True),
    ("rm -rf x", False), ("ls; rm x", False), ("cat a > b", False), ("echo $(whoami)", False),
    ("ls | sh", False), ("find . -delete", False), ("find . -name x", True), ("git push", False),
    ("sed -i s/a/b/ f", False), ("", False), ("git branch -D x", False),
])
def test_readonly_allowlist(cmd, ok):
    assert is_readonly_command(cmd) is ok


# ---- broker -----------------------------------------------------------------------------------
async def test_allow_and_deny(tmp_path):
    b, opened, resolved = make_broker(tmp_path)
    t = asyncio.create_task(b.ask("th1", "r1", "permission", "Bash", {"command": "mkdir x"}))
    await settle()
    assert opened and opened[0][1]["status"] == "open" and opened[0][1]["command"] == "mkdir x"
    assert await b.resolve("r1", "allow")
    assert (await t)["behavior"] == "allow" and resolved[0][1]["source"] == "user"

    t = asyncio.create_task(b.ask("th1", "r2", "permission", "Bash", {"command": "mkdir y"}))
    await settle()
    await b.resolve("r2", "deny", "no")
    assert (await t)["behavior"] == "deny"


async def test_resolve_twice_and_unknown(tmp_path):
    b, *_ = make_broker(tmp_path)
    t = asyncio.create_task(b.ask("th", "r", "permission", "Bash", {"command": "mkdir x"}))
    await settle()
    assert await b.resolve("r", "allow") is True
    assert await b.resolve("r", "deny") is False  # already answered
    assert await b.resolve("nope", "allow") is False
    await t


async def test_expiry_denies(tmp_path):
    b, _, resolved = make_broker(tmp_path, expire=0.05)
    ans = await b.ask("th", "r", "permission", "Bash", {"command": "mkdir x"})
    assert ans["behavior"] == "deny" and ans["source"] == "expired"
    assert resolved[0][1]["source"] == "expired"


async def test_duplicate_id_refused_first_stays_open(tmp_path):
    b, opened, _ = make_broker(tmp_path)
    t1 = asyncio.create_task(b.ask("th", "same", "permission", "Bash", {"command": "mkdir x"}))
    await settle()
    dup = await b.ask("th", "same", "permission", "Bash", {"command": "mkdir y"})
    assert dup["behavior"] == "deny"
    assert len(opened) == 1 and "same" in b.open
    await b.resolve("same", "allow")
    assert (await t1)["behavior"] == "allow"


async def test_cancel_thread_is_fail_closed(tmp_path):
    b, _, resolved = make_broker(tmp_path)
    t = asyncio.create_task(b.ask("th", "r", "permission", "Bash", {"command": "mkdir x"}))
    await settle()
    await b.cancel_thread("th")
    ans = await t
    assert ans["behavior"] == "deny" and ans["source"] == "unavailable"
    assert resolved[0][1]["behavior"] == "deny"


async def test_client_disconnect_resolves_unavailable(tmp_path):
    b, opened, resolved = make_broker(tmp_path)
    port = await b.start()
    r, w = await asyncio.open_connection("127.0.0.1", port)
    w.write((json.dumps({"t": "hello", "token": b.token, "thread": "th"}) + "\n").encode())
    w.write((json.dumps({"t": "ask", "id": "c1", "tool": "Bash", "input": {"command": "mkdir x"}}) + "\n").encode())
    await w.drain()
    for _ in range(50):
        if opened:
            break
        await asyncio.sleep(0.02)
    assert opened
    w.close()
    for _ in range(50):
        if resolved:
            break
        await asyncio.sleep(0.02)
    assert resolved and resolved[0][1]["behavior"] == "deny" and resolved[0][1]["source"] == "unavailable"
    await b.stop()


async def test_bad_token_gets_nothing(tmp_path):
    b, opened, _ = make_broker(tmp_path)
    port = await b.start()
    r, w = await asyncio.open_connection("127.0.0.1", port)
    w.write((json.dumps({"t": "hello", "token": "wrong", "thread": "th"}) + "\n").encode())
    w.write((json.dumps({"t": "ask", "id": "x", "tool": "Bash", "input": {"command": "mkdir x"}}) + "\n").encode())
    await w.drain()
    assert await asyncio.wait_for(r.read(10), 2) == b""  # closed without an answer
    assert not opened
    await b.stop()


async def test_socket_roundtrip(tmp_path):
    b, opened, _ = make_broker(tmp_path)
    port = await b.start()
    r, w = await asyncio.open_connection("127.0.0.1", port)
    w.write((json.dumps({"t": "hello", "token": b.token, "thread": "th"}) + "\n").encode())
    w.write((json.dumps({"t": "ask", "id": "s1", "tool": "Bash", "input": {"command": "mkdir x"}}) + "\n").encode())
    await w.drain()
    for _ in range(50):
        if opened:
            break
        await asyncio.sleep(0.02)
    await b.resolve("s1", "allow")
    line = json.loads(await asyncio.wait_for(r.readline(), 2))
    assert line["t"] == "answer" and line["id"] == "s1" and line["behavior"] == "allow"
    w.close()
    await b.stop()


async def test_auto_approval_rules(tmp_path):
    b, opened, _ = make_broker(tmp_path, mode="auto")
    assert (await b.ask("th", "a", "permission", "Bash", {"command": "git status"}))["source"] == "auto"
    assert (await b.ask("th", "b", "permission", "Edit", {"file_path": "x"}))["source"] == "auto"
    assert not opened
    t = asyncio.create_task(b.ask("th", "c", "permission", "Bash", {"command": "rm -rf x"}))
    await settle()
    assert opened  # not on the list: a person decides
    await b.resolve("c", "deny")
    await t


async def test_ask_mode_never_auto_approves_reads(tmp_path):
    b, opened, _ = make_broker(tmp_path, mode="ask")
    t = asyncio.create_task(b.ask("th", "a", "permission", "Bash", {"command": "ls"}))
    await settle()
    assert opened
    await b.resolve("a", "deny")
    await t


async def test_explicit_approval_only_full_answers(tmp_path):
    inp = {"command": "ls", "dangerouslyDisableSandbox": True}
    b, opened, _ = make_broker(tmp_path, mode="auto")
    t = asyncio.create_task(b.ask("th", "a", "permission", "Bash", inp))
    await settle()
    assert opened  # a read-only command, but it asks to leave the sandbox
    await b.resolve("a", "deny")
    await t
    f, opened_f, _ = make_broker(tmp_path, mode="full")
    assert (await f.ask("th", "b", "permission", "Bash", inp))["behavior"] == "allow" and not opened_f


async def test_always_allow_matches_exact_command_and_dir(tmp_path):
    b, opened, _ = make_broker(tmp_path)
    t = asyncio.create_task(b.ask("th", "a", "permission", "Bash", {"command": "make build"}))
    await settle()
    await b.resolve("a", "allow", always=True)
    await t
    assert b.rules and b.rules[0]["command"] == "make build" and b.rules[0]["cwd"] == CWD
    n = len(opened)
    assert (await b.ask("th", "b", "permission", "Bash", {"command": "make build"}))["source"] == "rule"
    assert len(opened) == n
    t = asyncio.create_task(b.ask("th", "c", "permission", "Bash", {"command": "make build "}))  # one byte different
    await settle()
    assert len(opened) == n + 1
    await b.resolve("c", "deny")
    await t


async def test_always_from_non_user_is_ignored(tmp_path):
    b, *_ = make_broker(tmp_path)
    t = asyncio.create_task(b.ask("th", "a", "permission", "Bash", {"command": "make build"}))
    await settle()
    await b.resolve("a", "allow", always=True, source="auto")
    await t
    assert not b.rules


async def test_questions_carry_choices_and_answers(tmp_path):
    b, opened, _ = make_broker(tmp_path)
    t = asyncio.create_task(b.ask("th", "q", "question", "ask_user", {"question": "Color?", "choices": ["Red", "Blue"]}))
    await settle()
    req = opened[0][1]
    assert req["type"] == "question" and req["choices"] == ["Red", "Blue"] and req["summary"] == "Color?"
    await b.resolve("q", "allow", "Blue")
    assert (await t)["message"] == "Blue"


# ---- API -------------------------------------------------------------------------------------------
async def test_config_never_returns_key_values(ctx):
    c, app = ctx
    secret = "sk-test-SUPERSECRET-123456"
    r = await c.put("/api/config", json={"keys": {"anthropic": secret}})
    assert r.status_code == 200
    for path in ("/api/config", "/api/instances"):
        assert secret not in (await c.get(path)).text
    assert (await c.get("/api/config")).json()["keys"]["anthropic"] == {"configured": True}
    assert secret in (app.state.registry.config.path.read_text(encoding="utf8"))  # stored in config.json
    if os.name != "nt":
        assert oct(app.state.registry.config.path.stat().st_mode & 0o777) == "0o600"
    await c.put("/api/config", json={"keys": {"anthropic": None}})
    assert (await c.get("/api/config")).json()["keys"]["anthropic"] == {"configured": False}
    assert (await c.put("/api/config", json={"keys": {"bogus": "x"}})).status_code == 400


async def test_saving_endpoint_key_lights_up_provider(ctx):
    c, app = ctx
    await c.put("/api/config", json={"keys": {"groq": "gsk-test"}})
    ids = [i["id"] for i in (await c.get("/api/instances")).json()["instances"]]
    assert "key-groq" in ids
    await c.put("/api/config", json={"keys": {"groq": ""}})
    ids = [i["id"] for i in (await c.get("/api/instances")).json()["instances"]]
    assert "key-groq" not in ids


async def test_settings_persist(ctx):
    c, _ = ctx
    await c.put("/api/config", json={"skin": "midnight", "displayName": "Hung", "uiMode": "advanced"})
    s = (await c.get("/api/config")).json()["settings"]
    assert s["skin"] == "midnight" and s["displayName"] == "Hung" and s["uiMode"] == "advanced"


async def test_bot_approval_mode_and_defaults(ctx):
    c, _ = ctx
    bot = await make_bot(c)
    assert bot["approvalMode"] == "full"
    r = await c.patch(f"/api/bots/{bot['id']}", json={"approvalMode": "ask"})
    assert r.json()["approvalMode"] == "ask"
    assert (await c.patch(f"/api/bots/{bot['id']}", json={"approvalMode": "yolo"})).status_code == 400
    await c.put("/api/bot-defaults", json={"approvalMode": "edits"})
    b2 = (await c.post("/api/bots", json={"name": "B", "modelSelection": {"instanceId": "echo", "model": "echo-1"}})).json()
    assert b2["approvalMode"] == "edits"


async def test_request_route_resolves_open_request(ctx):
    c, app = ctx
    bot = await make_bot(c)
    await c.patch(f"/api/bots/{bot['id']}", json={"approvalMode": "ask"})
    broker = app.state.broker
    t = asyncio.create_task(broker.ask(bot["threadId"], "rq1", "permission", "Bash", {"command": "mkdir z"}))
    await settle()
    bots = (await c.get("/api/bots")).json()["bots"]
    assert next(b for b in bots if b["id"] == bot["id"])["activity"] == "waiting-on-you"
    msgs = (await c.get(f"/api/bots/{bot['id']}/messages")).json()["messages"]
    card = next(m for m in msgs if m["kind"] == "request")
    assert card["request"]["status"] == "open" and card["request"]["command"] == "mkdir z"
    r = await c.post(f"/api/threads/{bot['threadId']}/requests/rq1", json={"behavior": "allow"})
    assert r.status_code == 200
    assert (await t)["behavior"] == "allow"
    msgs = (await c.get(f"/api/bots/{bot['id']}/messages")).json()["messages"]
    card = next(m for m in msgs if m["kind"] == "request")
    assert card["request"]["status"] == "resolved" and card["request"]["source"] == "user"
    assert (await c.post(f"/api/threads/{bot['threadId']}/requests/rq1", json={"behavior": "allow"})).status_code == 404
    bots = (await c.get("/api/bots")).json()["bots"]
    assert next(b for b in bots if b["id"] == bot["id"])["activity"] == "idle"


async def test_attachments_roundtrip_and_containment(ctx):
    c, app = ctx
    r = await c.post("/api/attachments", content=b"\x89PNG\r\n\x1a\nfake", headers={"x-filename": "pic.png", "content-type": "image/png"})
    assert r.status_code == 201
    info = r.json()
    assert info["image"] and info["filename"] == "pic.png"
    got = await c.get(f"/api/attachments/{info['name']}")
    assert got.status_code == 200 and got.content.startswith(b"\x89PNG")
    # a non-image never renders inline
    r2 = await c.post("/api/attachments", content=b"<script>1</script>", headers={"x-filename": "x.html", "content-type": "text/html"})
    html = await c.get(f"/api/attachments/{r2.json()['name']}")
    assert html.headers["content-type"].startswith("application/octet-stream")
    # nothing outside the store resolves
    secret = app.state.turns.attachments_dir.parent / "config.json"
    secret.write_text("{}", encoding="utf8")
    for evil in ("..%2Fconfig.json", "..%5Cconfig.json", "%2e%2e%2fconfig.json", "config.json", ".hidden", "att_x.json"):
        assert (await c.get(f"/api/attachments/{evil}")).status_code == 404, evil
    assert app.state.turns.attachment_meta("../config.json") is None
    assert app.state.turns.attachment_meta(str(secret)) is None


async def test_empty_upload_rejected(ctx):
    c, _ = ctx
    assert (await c.post("/api/attachments", content=b"", headers={"x-filename": "a.txt"})).status_code == 400


async def test_send_with_attachment_and_image_gate(ctx):
    c, _ = ctx
    bot = await make_bot(c)
    up = (await c.post("/api/attachments", content=b"hello", headers={"x-filename": "n.txt", "content-type": "text/plain"})).json()
    r = await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "see file", "attachments": [up["name"]]})
    assert r.status_code == 202 and r.json()["message"]["attachments"][0]["filename"] == "n.txt"
    img = (await c.post("/api/attachments", content=b"\x89PNGxxxx", headers={"x-filename": "p.png", "content-type": "image/png"})).json()
    r = await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "look", "attachments": [img["name"]]})
    assert r.status_code == 400  # the echo engine cannot read images


async def test_sections_and_move(ctx):
    c, _ = ctx
    a, b = await make_bot(c, "A"), await make_bot(c, "B")
    sec = (await c.post("/api/sidebar-sections", json={"name": "Work"})).json()
    assert (await c.patch(f"/api/sidebar-sections/{sec['id']}", json={"name": "Office", "collapsed": True})).json()["sections"][0]["name"] == "Office"
    moved = (await c.post(f"/api/bots/{a['id']}/move", json={"section": sec["id"], "botIds": [b["id"], a["id"]]})).json()
    assert moved["section"] == sec["id"]
    assert [x["id"] for x in (await c.get("/api/bots")).json()["bots"]] == [b["id"], a["id"]]
    assert (await c.post(f"/api/bots/{a['id']}/move", json={"section": "sec_missing"})).status_code == 404
    await c.delete(f"/api/sidebar-sections/{sec['id']}")
    assert next(x for x in (await c.get("/api/bots")).json()["bots"] if x["id"] == a["id"])["section"] is None


async def test_duplicate_bot(ctx):
    c, _ = ctx
    bot = await make_bot(c, "Orig")
    await c.patch(f"/api/bots/{bot['id']}", json={"approvalMode": "ask", "soul": "Be brief."})
    dup = (await c.post(f"/api/bots/{bot['id']}/duplicate")).json()
    assert dup["id"] != bot["id"] and dup["name"] == "Orig copy" and dup["approvalMode"] == "ask" and dup["soul"] == "Be brief."


async def test_full_text_search(ctx):
    c, _ = ctx
    bot = await make_bot(c)
    await c.post(f"/api/bots/{bot['id']}/messages", json={"text": "remember the pineapple deployment"})
    await asyncio.sleep(0.6)
    res = (await c.get("/api/search", params={"q": "pineap"})).json()["results"]
    assert res and res[0]["botId"] == bot["id"] and "[[" in res[0]["snippet"] and res[0]["botName"] == "A"
    assert (await c.get("/api/search", params={"q": "zzzznotthere"})).json()["results"] == []
    assert (await c.get("/api/search", params={"q": '" OR 1=1 --'})).status_code == 200  # no FTS syntax injection


async def test_soul_is_in_the_persona(ctx):
    from botteam.turns import persona
    c, _ = ctx
    bot = await make_bot(c)
    await c.patch(f"/api/bots/{bot['id']}", json={"soul": "Always answer in haiku."})
    b = (await c.get("/api/bots")).json()["bots"][0]
    from botteam.wire import WireBot
    assert "haiku" in persona(WireBot(**b))


async def test_stale_open_requests_expire_on_startup(tmp_path):
    app = create_app(str(tmp_path / "t.db"), home=tmp_path)
    async with LifespanManager(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            bot = await make_bot(c)
            await c.patch(f"/api/bots/{bot['id']}", json={"approvalMode": "ask"})
            t = asyncio.create_task(app.state.broker.ask(bot["threadId"], "r1", "permission", "Bash", {"command": "mkdir q"}))
            for _ in range(100):
                if app.state.turns.req_msgs:
                    break
                await asyncio.sleep(0.02)
            t.cancel()
            await settle()
            # simulate a crash: mark the stored card open again, then restart
            m = next(m for m in (await c.get(f"/api/bots/{bot['id']}/messages")).json()["messages"] if m["kind"] == "request")
            stored = await app.state.store.get_message(m["id"])
            stored.request.status, stored.request.behavior = "open", None
            await app.state.store.update_message(stored)
    app2 = create_app(str(tmp_path / "t.db"), home=tmp_path)
    async with LifespanManager(app2):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app2), base_url="http://t") as c:
            bots = (await c.get("/api/bots")).json()["bots"]
            msgs = (await c.get(f"/api/bots/{bots[0]['id']}/messages")).json()["messages"]
            card = next(m for m in msgs if m["kind"] == "request")
            assert card["request"]["status"] == "resolved" and card["request"]["source"] == "unavailable"


async def test_reading_the_attachment_store_needs_no_card(tmp_path):
    store = tmp_path / "attachments"
    store.mkdir()
    (store / "a.png").write_bytes(b"x")
    b, opened, _ = make_broker(tmp_path, mode="ask")
    b.read_dirs.append(str(store))
    assert (await b.ask("th", "r1", "permission", "Read", {"file_path": str(store / "a.png")}))["source"] == "auto"
    assert not opened
    # elsewhere, or escaping the store with .., still asks a person
    for bad in (str(tmp_path / "config.json"), str(store / ".." / "config.json")):
        t = asyncio.create_task(b.ask("th", f"r-{len(opened)}", "permission", "Read", {"file_path": bad}))
        await settle()
        assert opened and opened[-1][1]["status"] == "open"
        await b.resolve(opened[-1][1]["id"], "deny")
        await t


async def test_library_notes_crud_and_reach_the_persona(ctx):
    c, app = ctx
    bot = await make_bot(c)
    n = (await c.post(f"/api/bots/{bot['id']}/library", json={"title": "Style", "text": "Use metric units."})).json()
    assert (await c.get(f"/api/bots/{bot['id']}/library")).json()["notes"][0]["title"] == "Style"
    assert (await c.patch(f"/api/bots/{bot['id']}/library/{n['id']}", json={"text": "Use metric units always."})).status_code == 200
    from botteam.wire import WireBot
    b = WireBot(**(await c.get("/api/bots")).json()["bots"][0])
    assert "metric units always" in await app.state.turns._system(b)
    assert (await c.delete(f"/api/bots/{bot['id']}/library/{n['id']}")).status_code == 200
    assert (await c.delete(f"/api/bots/{bot['id']}/library/{n['id']}")).status_code == 404


async def test_files_listing_stays_inside_the_working_folder(ctx, tmp_path):
    c, _ = ctx
    bot = await make_bot(c)
    work = tmp_path / "work"
    (work / "sub").mkdir(parents=True)
    (work / "a.txt").write_text("hi")
    (tmp_path / "secret.txt").write_text("nope")
    await c.patch(f"/api/bots/{bot['id']}", json={"cwd": str(work)})
    r = (await c.get(f"/api/bots/{bot['id']}/files")).json()
    assert [e["name"] for e in r["entries"]] == ["sub", "a.txt"] and r["entries"][0]["dir"]
    assert (await c.get(f"/api/bots/{bot['id']}/files", params={"path": "sub"})).json()["path"] == "sub"
    for evil in ("..", "../", "sub/../..", str(tmp_path)):
        assert (await c.get(f"/api/bots/{bot['id']}/files", params={"path": evil})).status_code in (400, 404), evil


def test_codex_policy_mapping_and_notifications():
    from botteam.drivers.codex_app import CodexAppDriver, Session, policy_for
    assert policy_for("ask") == ("untrusted", "workspace-write")
    assert policy_for("full") == ("never", "danger-full-access")
    assert policy_for("bogus")[0] == "untrusted"  # unknown fails closed
    drv = CodexAppDriver("codex")
    events = []
    drv.on_event(lambda e: events.append(e))
    s = Session(proc=None, cwd="/", mode="ask", turn_id="t1", settled=False)
    drv.handle_notification("th", s, "item/agentMessage/delta", {"delta": "hi"})
    drv.handle_notification("th", s, "item/started", {"item": {"type": "commandExecution", "id": "x", "command": "ls"}})
    drv.handle_notification("th", s, "item/completed", {"item": {"type": "commandExecution", "id": "x", "status": "declined", "exitCode": None}})
    drv.handle_notification("th", s, "turn/completed", {"turn": {"status": "completed"}})
    kinds = [e.type for e in events]
    assert kinds == ["content.delta", "item.started", "item.completed", "turn.completed"]
    assert events[2].data["ok"] is False and events[3].data["ok"] is True and s.settled


async def test_codex_approval_goes_to_the_broker(tmp_path):
    from botteam.drivers.codex_app import CodexAppDriver, Session

    class Proc:
        class stdin:
            written = []
            @staticmethod
            def write(b): Proc.stdin.written.append(b)
            @staticmethod
            async def drain(): return None

    b, opened, _ = make_broker(tmp_path, mode="ask")
    drv = CodexAppDriver("codex", broker=b)
    s = Session(proc=Proc, cwd=CWD, mode="ask")
    t = asyncio.create_task(drv._server_request("th", s, {"id": 7, "method": "item/commandExecution/requestApproval",
                                                          "params": {"command": "make build", "cwd": CWD}}))
    await settle()
    assert opened and opened[0][1]["command"] == "make build" and opened[0][1]["cwd"] == CWD
    await b.resolve(opened[0][1]["id"], "deny")
    await t
    assert json.loads(Proc.stdin.written[-1])["result"] == {"decision": "decline"}
