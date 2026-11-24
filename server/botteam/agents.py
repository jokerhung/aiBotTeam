"""The tools a bot calls to work with its teammates (the MCP server "agents" of docs/runtime-contract.md §9).

The list is the same on every turn; what a turn may not do it is told when it calls the tool. Every refusal is a typed result.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from .approval import normalize_mode
from .runtime import LEVELS

TOOL_NAMES = ["publish_resource", "read_resource", "update_resource", "list_resources", "list_resource_versions", "set_resource_status", "remember", "recall", "forget", "team_remember", "list_bots", "coordinate_bots", "assignment_status", "task", "cancel_assignment", "create_agent", "delegate", "start_thread", "list_threads", "post_to_room", "list_rooms", "trigger_info", "trigger", "delete_trigger", "browser_request_help", "sheet_rows", "admin_list_bots", "admin_create_bot", "admin_update_bot"]


class AgentTools:
    def __init__(self, store, turns, runtime, host, groups=None, routines=None) -> None:
        self.store, self.turns, self.runtime, self.host = store, turns, runtime, host
        self.groups = groups  # set by the app once rooms exist
        self.routines = routines
        self.composio = None  # set by the app: reads of Google Sheets go through its Session
        self.admin = None  # set by the app: what the Administrator's tools do (create, update, overview)

    # ---- helpers -----------------------------------------------------------------------------------------------------
    async def _resolve(self, ref: str) -> Optional[str]:
        ref = (ref or "").strip().lstrip("@")
        bots = await self.store.list_bots()
        for b in bots:
            if b.id == ref:
                return b.id
        for b in bots:
            if b.name.lower() == ref.lower():
                return b.id
        return None

    async def _node(self, thread_id: str) -> Optional[dict]:
        n = await self.runtime.node_for_thread(thread_id)
        if n and n["status"] in ("running", "resume"):
            return n
        run = self.turns.runs.get(thread_id)
        if not run or run.assignment_id:
            return n
        bot = await self.store.get_bot(run.bot_id)
        if not bot:
            return None
        origin = run.origin or "person"
        who = {"person": {"kind": "person", "name": "the person"}, "routine": {"kind": "routine", "name": "a routine"}}.get(origin, {"kind": "outside", "name": "an outside event"})
        rid = await self.runtime.begin_root(origin, {**who, "chief": bot.chief, "bot": bot.id}, bot.id, thread_id, normalize_mode(run.level or bot.approvalMode))
        return await self.runtime.get(rid)

    async def _chief_level(self, node: dict) -> Optional[str]:
        """The level of the nearest Chief conversation in this node's chain."""
        n: Optional[dict] = node
        while n:
            if self.host.is_chief(n["assignee_bot"]):
                return n["level"]
            n = await self.runtime.get(n["parent_id"]) if n["parent_id"] else None
        return None

    CHANNEL_CHAT_TOOLS = {"sheet_rows", "recall"}

    # ---- dispatch ----------------------------------------------------------------------------------------------------
    async def call(self, thread_id: str, tool: str, args: dict[str, Any]) -> dict[str, Any]:
        try:
            run = self.turns.runs.get(thread_id)
            if run and (getattr(run, "channel_batch_id", None) or "").startswith("chat:") and tool not in self.CHANNEL_CHAT_TOOLS:
                # an answering bot talks to strangers: whatever they write, it cannot hand work to other bots, make routines, post, browse or write notes
                return {"ok": False, "reason": "not_allowed", "detail": "this tool is not available while answering a customer"}
            me = await self._me(thread_id)
            if self.admin is not None:  # the Administrator uses only its own tools; no other bot may use them
                me = await self._me(thread_id)
                if tool.startswith("admin_") != bool(me and me.admin):
                    return {"ok": False, "reason": "not_allowed", "detail": "the admin tools belong to the Administrator, and the Administrator has no other tools" if me and me.admin else "only the Administrator can use this tool"}
            fn = getattr(self, f"t_{tool}", None)
            if not fn:
                return {"ok": False, "reason": "unknown_tool", "detail": f"no tool {tool}"}
            from .toolbox import tools_for, settings
            configured = getattr(getattr(run, "inp", None), "allowed_tools", None)
            remaining = await self.turns.delegation.remaining(me, await self.runtime.node_for_thread(thread_id)) if me and getattr(self.turns, "delegation", None) else None
            permitted = configured if configured is not None else tools_for(me, TOOL_NAMES, depth_remaining=remaining) if me else []
            if tool in {"remember", "recall", "forget", "team_remember"} and me and not me.memory:
                return {"ok": False, "reason": "memory_off", "detail": "memory is not available"}
            if tool not in permitted or (tool == "browser_request_help" and not settings(me).web.enabled):
                return {"ok": False, "reason": "capability_disabled", "detail": "This tool is not enabled for this agent and turn"}
            return await fn(thread_id, args if isinstance(args, dict) else {})
        except Exception as e:  # the runtime never throws into a turn
            return {"ok": False, "reason": "internal", "detail": f"{type(e).__name__}: {e}"}

    async def _resource_tool(self, thread, name, args):
        from .resources import ResourceError, split_ref
        from .toolbox import settings
        from .wire import WireMessage
        from .store import new_id, now_ms
        run = self.turns.runs.get(thread)
        bot = await self._me(thread)
        if not run or not bot or not settings(bot).resources.enabled:
            return {"ok": False, "reason": "capability_disabled", "detail": "Resources requires an enabled capability and active turn"}
        service = self.resources
        workspace = getattr(getattr(run, "inp", None), "cwd", None) or bot.cwd
        prefs = settings(bot).resources
        try:
            if name == "list_resources":
                return {"ok": True, "resources": await service.list(kind=args.get("kind"), status=args.get("status"), bot=bot.id if args.get("mine") else None, query=str(args.get("query") or ""))}
            if name == "list_resource_versions":
                return {"ok": True, "id": args["id"], "versions": (await service.versions(args["id"]))[:10]}
            if name == "publish_resource":
                result = await service.publish(args, owner=bot.id, thread=thread, workspace=workspace, settings=prefs)
            elif name == "update_resource":
                result = await service.update(args["id"], args, owner=bot.id, workspace=workspace, settings=prefs)
            elif name == "read_resource":
                item = await service.resolve(args, bot.id)
                result = await service.read(item)
                if item["kind"] == "image":
                    copied = await service.materialize(item, workspace)
                    result["file"] = copied["file"]
                return {"ok": True, **result}
            else:
                rid, number = split_ref(args.get("ref"))
                pinned = None
                if getattr(run, "routine_run_id", None):
                    record = await self.store.get_run(run.routine_run_id)
                    if record and record["status"] == "running":
                        pinned = record["detail"]
                item = await service.version(rid, number)
                if args.get("status") == "draft" and item["owner_bot"] != bot.id:
                    raise ResourceError("Only the resource owner can edit it", 403)
                result = await service.set_status(rid, number, args.get("status"), published_ref=pinned)
            if name in {"publish_resource", "update_resource"} and result.get("kind") == "post":
                post = (await service.read(result)).get("post") or {}
                if not post.get("media"):  # a post with no picture is usually a forgotten one: say so, once, in the tool's own answer
                    result["warning"] = ("This post has NO images. If the post should have a picture (it usually does, unless the person asked for text only): "
                                         "create the image file in your workspace with your image skill, then call update_resource with base_version and images=[<absolute path>] and alts=[<description>] "
                                         "to save it as the next version, and hand off the NEW ref. If the person asked for text only, say so in your report.")
            if prefs.chatCards and name in {"publish_resource", "update_resource"}:
                card = WireMessage(id=new_id("msg"), role="bot", kind="resource", author=bot.id, at=now_ms(), resource={"resource_id": result["id"], "version": result["version"], "kind": result["kind"], "title": result["title"]})
                owner = self.turns._owner_for(thread, bot.id)
                await self.store.add_message(owner, thread, card)
                self.turns._frame("message", owner, thread, card)
            return {"ok": True, **result}
        except (ResourceError, KeyError) as exc:
            return {"ok": False, "reason": "resource", "detail": str(exc)}

    async def t_publish_resource(self, thread, args):
        return await self._resource_tool(thread, "publish_resource", args)

    async def t_read_resource(self, thread, args):
        return await self._resource_tool(thread, "read_resource", args)

    async def t_update_resource(self, thread, args):
        return await self._resource_tool(thread, "update_resource", args)

    async def t_list_resources(self, thread, args):
        return await self._resource_tool(thread, "list_resources", args)

    async def t_list_resource_versions(self, thread, args):
        return await self._resource_tool(thread, "list_resource_versions", args)

    async def t_set_resource_status(self, thread, args):
        return await self._resource_tool(thread, "set_resource_status", args)

    # ---- memory -----------------------------------------------------------------------------------------------------------
    async def _me(self, thread_id: str):
        run = self.turns.runs.get(thread_id)
        bot = await self.store.get_bot(run.bot_id) if run else await self.store.bot_of_thread(thread_id)
        snapshot = getattr(getattr(run, "inp", None), "toolbox", None)
        if bot and snapshot:
            from .toolbox import Toolbox
            bot.toolbox = Toolbox.model_validate(snapshot)
        return bot

    async def t_remember(self, thread_id: str, args: dict) -> dict:
        bot = await self._me(thread_id)
        if not bot or not self.turns.memory:
            return {"ok": False, "reason": "unavailable", "detail": "memory is not available"}
        if not bot.memory:
            return {"ok": False, "reason": "memory_off", "detail": "the person turned memory off for you"}
        return self.turns.memory.remember(bot.id, str(args.get("note") or ""), str(args["topic"]) if args.get("topic") else None)

    async def t_recall(self, thread_id: str, args: dict) -> dict:
        bot = await self._me(thread_id)
        if not bot or not self.turns.memory or not bot.memory:
            return {"ok": False, "reason": "memory_off", "detail": "memory is not available"}
        mem = self.turns.memory
        topic = str(args.get("topic") or "").strip()
        if not topic:
            return {"ok": True, "files": mem.files(bot.id)}
        name = topic if topic.startswith(("memory/", "MEMORY")) else f"memory/{topic}"
        path = mem.resolve(bot.id, name if name.endswith(".md") else name + ".md")
        text = mem.read(path) if path else ""
        return {"ok": True, "topic": topic, "text": text[:20000]} if text else {"ok": False, "reason": "not_found", "detail": "no such note"}

    async def t_forget(self, thread_id: str, args: dict) -> dict:
        bot = await self._me(thread_id)
        if not bot or not self.turns.memory or not bot.memory:
            return {"ok": False, "reason": "memory_off", "detail": "memory is not available"}
        needle = str(args.get("match") or "").strip().lower()
        if len(needle) < 4:
            return {"ok": False, "reason": "too_short", "detail": "say enough of the note to tell it apart (at least 4 characters)"}
        gone = [e for e in self.turns.memory.entries(bot.id) if needle in e["line"].lower()]
        for e in gone:
            self.turns.memory.delete_entry(bot.id, e["id"])
        return {"ok": True, "removed": len(gone)}

    async def t_team_remember(self, thread_id: str, args: dict) -> dict:
        """A note for the whole section: it is written only if the person approves the card."""
        bot = await self._me(thread_id)
        if not bot or not self.turns.memory:
            return {"ok": False, "reason": "unavailable", "detail": "memory is not available"}
        if not bot.section:
            return {"ok": False, "reason": "no_section", "detail": "you are not in a section, so there is no team memory"}
        note = self.turns.memory.clean_entry(str(args.get("note") or ""))
        if not note:
            return {"ok": False, "reason": "empty", "detail": "there is nothing to remember"}
        broker = self.turns.broker
        if not broker:
            return {"ok": False, "reason": "unavailable", "detail": "no one can approve this"}
        from .store import new_id

        ans = await broker.ask(thread_id, new_id("tm"), "permission", "TeamMemory", {"command": f"Add to the team memory: {note}", "summary": f"Add to the team memory: {note}"})
        if ans.get("behavior") != "allow":
            return {"ok": False, "reason": "declined", "detail": "the person did not approve it"}
        from datetime import date

        path = self.turns.memory.team_path(bot.section)
        from .memory import write_atomic

        old = self.turns.memory.read(path)
        write_atomic(path, (old.rstrip("\n") + "\n" if old else "") + f"- [{date.today().isoformat()}] {note} (from {bot.name})\n")
        return {"ok": True, "where": "team memory"}

    async def t_browser_request_help(self, thread_id: str, args: dict) -> dict:
        bot = await self._me(thread_id)
        if not bot or not self.turns.browser or not self.turns.toolbox_settings(bot).web.enabled:
            return {"ok": False, "reason": "disabled", "detail": "Web use is disabled"}
        return {"ok": True, "returned": await self.turns.browser.ask_for_help(bot.id, str(args.get("reason") or "Please help")[:400])}

    # ---- reading a spreadsheet the same way every time ----------------------------------------------------------------------------------
    SHEET_TOOLS = ("GOOGLESHEETS_SEARCH_SPREADSHEETS", "GOOGLESHEETS_GET_SHEET_NAMES", "GOOGLESHEETS_VALUES_GET")
    MAX_TABS = 8
    MAX_MATCHES = 30

    @staticmethod
    def _norm(x: Any) -> str:
        return re.sub(r"\s+", " ", str(x if x is not None else "")).strip().casefold()

    @staticmethod
    def _letters(i: int) -> str:
        out = ""
        i += 1
        while i:
            i, r = divmod(i - 1, 26)
            out = chr(65 + r) + out
        return out

    async def t_sheet_rows(self, thread_id: str, args: dict) -> dict:
        """Rows of a Google Sheets file whose cells equal what was asked, as {column title: value} with the empty cells left out. The columns are found by
        their titles and the rows are matched in code, so no one has to count columns; the answers are kept for the bot's cache time."""
        from .composio import ComposioError
        from .mcp_proxy import refusal

        bot = await self._me(thread_id)
        comp = self.composio
        if not bot or not comp or not comp.configured():
            return {"ok": False, "reason": "unavailable", "detail": "Google Sheets is not connected"}
        sid = await comp._mcp_id()
        access = bot.mcpAccess.get(sid or "") or {}
        allow = list(access.get("allowTools") or [])
        if not sid or sid not in bot.mcpServers or not allow or any(refusal(allow, {"name": "COMPOSIO_MULTI_EXECUTE_TOOL", "arguments": {"tools": [{"tool_slug": t}]}}) for t in self.SHEET_TOOLS):
            return {"ok": False, "reason": "not_allowed", "detail": "this bot may not read Google Sheets"}
        name, match = str(args.get("spreadsheet") or "").strip(), args.get("match")
        if not name or not isinstance(match, dict) or not match or len(match) > 4:
            return {"ok": False, "reason": "bad_request", "detail": "give the spreadsheet name and match, such as {\"lô\": \"1401 AO\", \"CTN NO.\": \"291\"}"}
        minutes = int(access.get("cacheMinutes") or 0)
        fetched: list[float] = []
        sheet_id = ""

        async def tool(slug: str, arguments: dict) -> dict:
            data, at = await comp.run_tool(slug, arguments, minutes)
            fetched.append(at)
            return data

        async def values(rng: str) -> list:
            return (await tool("GOOGLESHEETS_VALUES_GET", {"spreadsheet_id": sheet_id, "range": rng})).get("values") or []

        try:
            found = (await tool("GOOGLESHEETS_SEARCH_SPREADSHEETS", {"query": name, "max_results": 20})).get("spreadsheets") or []
            exact = sorted((f for f in found if self._norm(f.get("name")) == self._norm(name)), key=lambda f: str(f.get("modifiedTime") or ""), reverse=True)
            if not exact:
                return {"ok": False, "reason": "not_found", "detail": f"no spreadsheet named “{name}”", "similar": [f.get("name") for f in found][:5]}
            sheet_id = exact[0]["id"]
            names = (await tool("GOOGLESHEETS_GET_SHEET_NAMES", {"spreadsheet_id": sheet_id})).get("sheet_names") or []
            want_tab = str(args.get("tab") or "").strip()
            if want_tab:
                tabs = [n for n in names if self._norm(n) == self._norm(want_tab)]
            else:  # the tabs named by a day (ddmmyy), the newest first
                days = [n for n in names if re.fullmatch(r"\d{6}", n.strip())]
                tabs = sorted(days, key=lambda n: n.strip()[4:6] + n.strip()[2:4] + n.strip()[0:2], reverse=True)[: self.MAX_TABS]
            if not tabs:
                return {"ok": False, "reason": "no_tab", "detail": "no such tab", "tabs": names[:30]}
            searched: list[str] = []
            for tab in tabs:
                q = "'" + tab.replace("'", "''") + "'"
                searched.append(tab)
                head = (await values(f"{q}!A1:ZZ1") or [[]])[0]
                index: dict[str, int] = {}
                for i, h in enumerate(head):
                    index.setdefault(self._norm(h), i)
                cols: dict[str, int] = {}
                for k in match:
                    if self._norm(k) not in index:
                        return {"ok": False, "reason": "no_column", "detail": f"tab {tab} has no column “{k}”", "columns": [h for h in head if h][:60]}
                    cols[k] = index[self._norm(k)]
                col_values: dict[int, list] = {}
                for ci in set(cols.values()):
                    letter, rows, start = self._letters(ci), [], 1
                    while True:
                        chunk = await values(f"{q}!{letter}{start}:{letter}{start + 1499}")
                        rows += [(r[0] if r else "") for r in chunk]
                        if len(chunk) < 1500:
                            break
                        start += 1500
                    col_values[ci] = rows

                def cell(k: str, n: int) -> str:
                    column = col_values[cols[k]]
                    return self._norm(column[n - 1]) if n - 1 < len(column) else ""

                top = max((len(v) for v in col_values.values()), default=0)
                hits = [n for n in range(2, top + 1) if all(cell(k, n) == self._norm(want) for k, want in match.items())]
                if not hits:
                    continue
                if len(hits) > self.MAX_MATCHES:
                    return {"ok": False, "reason": "too_many", "detail": f"{len(hits)} rows match; add more to match"}
                out = []
                for n in hits:
                    row = (await values(f"{q}!A{n}:ZZ{n}") or [[]])[0]
                    out.append({str(head[i]): str(v).strip() for i, v in enumerate(row) if i < len(head) and head[i] and str(v).strip() != ""})
                return {"ok": True, "spreadsheet": exact[0]["name"], "tab": tab, "rows": out, "rowNumbers": hits, "searchedTabs": searched,
                        "fetchedAt": int(min(fetched) * 1000), "cacheMinutes": minutes}
            return {"ok": True, "spreadsheet": exact[0]["name"], "tab": None, "rows": [], "searchedTabs": searched, "fetchedAt": int(min(fetched) * 1000), "cacheMinutes": minutes}
        except ComposioError as e:
            return {"ok": False, "reason": "sheets", "detail": str(e)}

    async def t_admin_list_bots(self, thread_id: str, args: dict) -> dict:
        return {"ok": True, **await self.admin.overview()}

    async def t_admin_create_bot(self, thread_id: str, args: dict) -> dict:
        return await self.admin.create(args)

    async def t_admin_update_bot(self, thread_id: str, args: dict) -> dict:
        return await self.admin.update(args)

    async def t_list_bots(self, thread_id: str, args: dict) -> dict:
        me = await self._me(thread_id)
        node = await self._node(thread_id)
        bots = await self.turns.delegation.allowed(me, node, node["origin"] if node else "person")
        return {"ok": True, "bots": [{"id": b.id, "name": b.name, "title": b.title, "description": b.description,
                                      "busy": any(r.bot_id == b.id for r in self.turns.runs.values())} for b in bots]}

    async def t_coordinate_bots(self, thread_id: str, args: dict) -> dict:
        return await self.turns.delegation.coordinate(thread_id, args)

    async def t_task(self, thread_id: str, args: dict) -> dict:
        return await self.turns.delegation.coordinate(thread_id, args, task=True)

    async def t_create_agent(self, thread_id: str, args: dict) -> dict:
        return await self.turns.delegation.create(thread_id, args)

    async def t_delegate(self, thread_id: str, args: dict) -> dict:
        return await self.turns.delegation.delegate(thread_id, args)

    async def t_cancel_assignment(self, thread_id: str, args: dict) -> dict:
        node = await self._node(thread_id)
        target = await self.runtime.get(str(args.get("id") or ""))
        if not target or not node or target["parent_id"] != node["id"]:
            return {"ok": False, "reason": "not_allowed", "detail": "Only cancel work handed out by this turn"}
        return {"ok": True, "cancelled": await self.runtime.cancel(target["id"])}

    async def _answer(self, thread_id: str, assignment_id: str, message: str) -> dict:
        a = await self.runtime.get(assignment_id)
        if not a or a["status"] != "needs_input":
            return {"ok": False, "reason": "not_asking", "detail": "that work no longer asks a question"}
        run = self.turns.runs.get(thread_id)
        me = run.bot_id if run else None
        parent = await self.runtime.get(a["parent_id"]) if a["parent_id"] else None
        if not me or not (self.host.is_chief(me) or (parent and parent["assignee_bot"] == me)):
            return {"ok": False, "reason": "not_allowed", "detail": "only the Chief of Staff, or the bot that handed this work out, may answer for the person"}
        broker = self.turns.broker
        open_ = broker.open_for(a["thread_id"]) if broker else []
        asker = [r for r in open_ if r["type"] == "question"]
        if not asker:
            return {"ok": False, "reason": "not_asking", "detail": "no open question on that work"}
        await broker.resolve(asker[0]["id"], "allow", message, source="team", by=self.host.bot_name(me))
        return {"ok": True, "note": f"Answered {a['id']} for the person; the work runs on."}

    async def t_assignment_status(self, thread_id: str, args: dict) -> dict:
        node = await self._node(thread_id)
        target = await self.runtime.get(str(args["id"])) if args.get("id") else None
        if not node or (target and target["root_id"] != node["root_id"]):
            return {"ok": False, "reason": "not_allowed", "detail": "Only work in this assignment tree is accessible"}
        return await self.runtime.status(args.get("id"), node["id"])

    async def t_start_thread(self, thread_id: str, args: dict) -> dict:
        node = await self._node(thread_id)
        if not node:
            return {"ok": False, "reason": "no_turn", "detail": "start_thread needs a running turn"}
        brief = str(args.get("message") or args.get("title") or "").strip()
        report_back = bool(args.get("report_back"))
        got = await self.runtime.enqueue(node["id"], [node["assignee_bot"]], brief, reply="resume" if report_back else "none", thread="new", own_thread=True,
                                         chief_level=await self._chief_level(node))
        return {"ok": got[0]["ok"], **{k: v for k, v in got[0].items() if k != "ok"}}

    async def t_list_threads(self, thread_id: str, args: dict) -> dict:
        run = self.turns.runs.get(thread_id)
        bid = await self._resolve(str(args.get("bot") or "")) if args.get("bot") else (run.bot_id if run else None)
        if not bid:
            return {"ok": False, "reason": "unknown_bot", "detail": "name a bot"}
        return {"ok": True, "threads": [{"id": t["id"], "title": t["title"] or "Main conversation", "main": t["main"]} for t in await self.store.list_threads(bid)]}

    async def t_list_rooms(self, thread_id: str, args: dict) -> dict:
        if not self.groups:
            return {"ok": True, "rooms": []}
        return {"ok": True, "rooms": [{"id": g["id"], "name": g["name"], "members": g["members"]} for g in await self.groups.list()]}

    async def t_post_to_room(self, thread_id: str, args: dict) -> dict:
        if not self.groups:
            return {"ok": False, "reason": "no_rooms", "detail": "there are no rooms"}
        return await self.groups.post_from_bot(thread_id, str(args.get("room") or ""), str(args.get("message") or ""))

    async def t_trigger_info(self, thread_id: str, args: dict) -> dict:
        if not self.routines:
            return {"ok": False, "reason": "unavailable", "detail": "routines are not available"}
        return await self.routines.tool_info(thread_id)

    async def t_trigger(self, thread_id: str, args: dict) -> dict:
        if not self.routines:
            return {"ok": False, "reason": "unavailable", "detail": "routines are not available"}
        return await self.routines.tool_trigger(thread_id, args)

    async def t_delete_trigger(self, thread_id: str, args: dict) -> dict:
        if not self.routines:
            return {"ok": False, "reason": "unavailable", "detail": "routines are not available"}
        return await self.routines.tool_delete(thread_id, args)
