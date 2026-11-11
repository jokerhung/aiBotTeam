"""The tools a bot calls to work with its teammates (the MCP server "agents" of docs/runtime-contract.md §9).

The list is the same on every turn; what a turn may not do it is told when it calls the tool. Every refusal is a typed result.
"""
from __future__ import annotations

from typing import Any, Optional

from .approval import normalize_mode
from .runtime import LEVELS

TOOL_NAMES = ["list_bots", "coordinate_bots", "assignment_status", "start_thread", "list_threads", "post_to_room", "list_rooms",
              "trigger_info", "trigger", "delete_trigger"]


class AgentTools:
    def __init__(self, store, turns, runtime, host, groups=None, routines=None) -> None:
        self.store, self.turns, self.runtime, self.host = store, turns, runtime, host
        self.groups = groups  # set by the app once rooms exist
        self.routines = routines

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

    # ---- dispatch ----------------------------------------------------------------------------------------------------
    async def call(self, thread_id: str, tool: str, args: dict[str, Any]) -> dict[str, Any]:
        try:
            fn = getattr(self, f"t_{tool}", None)
            if not fn:
                return {"ok": False, "reason": "unknown_tool", "detail": f"no tool {tool}; the tools are {', '.join(TOOL_NAMES)}"}
            return await fn(thread_id, args if isinstance(args, dict) else {})
        except Exception as e:  # the runtime never throws into a turn
            return {"ok": False, "reason": "internal", "detail": f"{type(e).__name__}: {e}"}

    async def t_list_bots(self, thread_id: str, args: dict) -> dict:
        me = (self.turns.runs.get(thread_id).bot_id if self.turns.runs.get(thread_id) else None)
        out = []
        for b in await self.store.list_bots():
            out.append({"id": b.id, "name": b.name, "title": b.title, "description": b.description, "chief": b.chief,
                        "you": b.id == me, "busy": any(self.turns.runs.get(t) for t in [b.mainThreadId])})
        return {"ok": True, "bots": out}

    async def t_coordinate_bots(self, thread_id: str, args: dict) -> dict:
        node = await self._node(thread_id)
        if not node:
            return {"ok": False, "reason": "no_turn", "detail": "work can only be handed out from a running turn"}
        message = args.get("message")
        refs = args.get("bot_ids") or args.get("bots") or []
        if isinstance(refs, str):
            refs = [refs]
        answers = args.get("answers")
        if answers:
            return await self._answer(thread_id, str(answers), str(message or ""))
        ids, results = [], []
        for ref in refs:
            bid = await self._resolve(str(ref))
            if bid:
                ids.append(bid)
            else:
                results.append({"bot": str(ref), "ok": False, "reason": "unknown_bot", "detail": "no such bot; list_bots shows the team"})
        reply = args.get("reply") or "resume"
        if reply not in ("resume", "none"):
            reply = "resume"
        got = await self.runtime.enqueue(node["id"], ids, message, reply=reply, consult=bool(args.get("consult")), thread=args.get("thread") or "new",
                                         done_when=args.get("done_when"), rework=bool(args.get("rework")), chief_level=await self._chief_level(node))
        for g in got:
            results.append({"bot": self.host.bot_name(g["bot"]), **{k: v for k, v in g.items() if k != "bot"}})
        accepted = [r for r in results if r.get("ok")]
        note = ("Work was handed out. Finish your turn now and say what you handed to whom; you will be woken once with every result."
                if accepted and reply == "resume" else ("Notice sent; it is not awaited." if accepted else "Nothing was handed out."))
        return {"ok": bool(accepted), "results": results, "note": note}

    async def _answer(self, thread_id: str, assignment_id: str, message: str) -> dict:
        a = await self.runtime.get(assignment_id)
        if not a or a["status"] != "needs_input":
            return {"ok": False, "reason": "not_asking", "detail": "that work no longer asks a question"}
        broker = self.turns.broker
        open_ = broker.open_for(a["thread_id"]) if broker else []
        asker = [r for r in open_ if r["type"] == "question"]
        if not asker:
            return {"ok": False, "reason": "not_asking", "detail": "no open question on that work"}
        await broker.resolve(asker[0]["id"], "allow", message, source="team")
        return {"ok": True, "note": f"Answered {a['id']} for the person; the work runs on."}

    async def t_assignment_status(self, thread_id: str, args: dict) -> dict:
        node = await self._node(thread_id)
        return await self.runtime.status(args.get("id"), node["id"] if node else None)

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
