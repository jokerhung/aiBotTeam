"""Per-agent delegation policies, synchronous tasks and specialist lifecycle."""
from __future__ import annotations

import asyncio
import time

from .approval import normalize_mode
from .runtime import LIVE, TERMINAL
from .store import new_id, now_ms
from .toolbox import Specialist, Toolbox, Web, settings
from .wire import WireMessage


class Delegation:
    def __init__(self, store, turns, runtime, host, agents):
        self.store, self.turns, self.runtime, self.host, self.agents = store, turns, runtime, host, agents

    async def chain(self, node):
        chain = []
        while node:
            chain.append(node)
            node = await self.runtime.get(node["parent_id"]) if node["parent_id"] else None
        return chain

    async def remaining(self, bot, node=None):
        if not settings(bot).subagents.enabled or bot.inline or bot.ephemeral:
            return 0
        remaining = settings(bot).subagents.maxDepth
        for ancestor in await self.chain(node):
            owner = await self.store.get_bot(ancestor["assignee_bot"])
            if owner:
                distance = (node["depth"] if node else 0) - ancestor["depth"]
                remaining = min(remaining, settings(owner).subagents.maxDepth - distance)
        return max(0, remaining)

    async def allowed(self, bot, node=None, origin="person"):
        policy = settings(bot).subagents
        explicit = {d.bot for d in policy.delegates} | {s.botId for s in policy.inline if s.botId}
        ancestors = {item["assignee_bot"] for item in await self.chain(node)} | {bot.id}
        candidates = []
        for target in await self.store.list_bots():
            if target.admin or target.id in ancestors:
                continue
            owned = target.owner == bot.id and (target.inline or (target.ephemeral and origin == "person"))
            selected = target.id in explicit or owned
            if not selected and policy.allowAnyAgent and origin == "person" and not target.inline and not target.ephemeral:
                selected = True
            if selected and (not bot.chief or self.host.in_scope(bot.id, target.id)):
                candidates.append(target)
        return candidates

    async def check(self, node, target_id):
        bot = await self.store.get_bot(node["assignee_bot"])
        if not bot or await self.remaining(bot, node) <= 0:
            return {"ok": False, "reason": "depth", "detail": "Subagents is disabled or this delegation has reached its depth limit"}
        if target_id in {item["assignee_bot"] for item in await self.chain(node)}:
            return {"ok": False, "reason": "ancestor", "detail": "Delegation cannot return to an ancestor"}
        if bot.chief and not self.host.in_scope(bot.id, target_id):
            return {"ok": False, "reason": "outside_scope", "detail": "This delegate is outside the chief's scope"}
        if target_id not in {b.id for b in await self.allowed(bot, node, node["origin"])}:
            return {"ok": False, "reason": "not_a_delegate", "detail": "Choose a declared delegate. Unattended runs only use explicitly selected delegates."}
        active = [child for child in await self.runtime.children(node["id"]) if child["status"] in LIVE]
        if len(active) >= settings(bot).subagents.maxFanout:
            return {"ok": False, "reason": "fanout", "detail": "The delegation fan-out limit is reached. Wait for existing work or continue this task yourself."}
        return None

    async def prompt(self, bot, node, origin):
        if not await self.remaining(bot, node):
            return "\n\nSubagents is off or the delegation depth is exhausted. Do this work yourself; no delegation tools are available."
        policy = settings(bot).subagents
        delegates = await self.allowed(bot, node, origin)
        overrides = {d.bot: d.handBack for d in policy.delegates if d.handBack}
        overrides.update({s.botId: s.handBack for s in policy.inline if s.botId and s.handBack})
        rows = [f"- {b.id} ({b.name}): {b.description or b.title}. Hand-back: {overrides.get(b.id, policy.mode)}" for b in delegates]
        return ("\n\nSubagents: only delegate to the following agents, using their current setup (no pinned versions).\n"
                + "\n".join(rows) + f"\nPolicy: {policy.mode}; fan-out {policy.maxFanout}; answer limit {policy.maxResultChars} characters. "
                "The configured policy and each delegate's hand-back override win over your requested mode. "
                "Use task for work to collect within this turn; use coordinate_bots for background work when offered. "
                "Never work around a refused delegation. " + ("You may create temporary specialists with create_agent and delegate; their instructions require approval." if policy.allowDynamic else "Dynamic specialists are disabled."))

    async def coordinate(self, thread, args, *, task=False):
        bot = await self.agents._me(thread)
        node = await self.agents._node(thread)
        if not bot or not node:
            return {"ok": False, "reason": "no_turn", "detail": "Delegation requires an active turn"}
        if args.get("answers"):
            return await self.agents._answer(thread, str(args["answers"]), str(args.get("message") or ""))
        policy = settings(bot).subagents
        refs = args.get("bot_ids") or args.get("bots") or [args.get("bot")]
        refs = [refs] if isinstance(refs, str) else refs
        message = str(args.get("description") or args.get("message") or "")
        overrides = {d.bot: d.handBack for d in policy.delegates}
        overrides.update({s.botId: s.handBack for s in policy.inline if s.botId})
        results, waits = [], []
        for ref in refs:
            target = await self.agents._resolve(str(ref or ""))
            if not target:
                results.append({"ok": False, "bot": str(ref), "reason": "unknown_bot", "detail": "No such delegate"}); continue
            mode = overrides.get(target) or policy.mode
            wait = mode == "sync" or (mode == "auto" and bool(args.get("wait", task)))
            got = (await self.runtime.enqueue(node["id"], [target], message, reply="sync" if wait else "resume",
                                              consult=wait and policy.allowQuestions, chief_level=await self.agents._chief_level(node)))[0]
            got["bot"] = self.host.bot_name(target)
            if got.get("ok"):
                got["mode"] = "sync" if wait else "async"
                child = await self.runtime.get(got["id"])
                await self.notice(bot, thread, target, got, child)
                if wait:
                    waits.append((got, asyncio.create_task(self.wait(child, policy.maxWaitSeconds, policy.maxResultChars))))
            results.append(got)
        try:
            for result, pending in waits:
                result.update(await pending)
        finally:
            for _, pending in waits:
                if not pending.done():
                    pending.cancel()
            await asyncio.gather(*(pending for _, pending in waits), return_exceptions=True)
        return {"ok": any(row.get("ok") for row in results), "results": results,
                "note": "Use the collected answers. Background tasks will report when complete; do not start duplicate work."}

    async def wait(self, child, seconds, chars):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            current = await self.runtime.get(child["id"])
            if not current or current["status"] in TERMINAL:
                result = (current or {}).get("result") or (current or {}).get("outcome_detail") or ""
                return {"status": (current or {}).get("status", "cancelled"), "answer": result[:chars], "truncated": len(result) > chars}
            await asyncio.sleep(.05)
        async with self.runtime.lock:
            current = await self.runtime.get(child["id"])
            if current and current["status"] in TERMINAL:
                result = current.get("result") or current.get("outcome_detail") or ""
                return {"status": current["status"], "answer": result[:chars], "truncated": len(result) > chars}
            if current and current["status"] not in TERMINAL:
                await self.runtime.db.execute("UPDATE assignments SET reply='resume' WHERE id=?", (child["id"],))
                await self.runtime.db.execute("UPDATE assignments SET children_since_turn=children_since_turn+1 WHERE id=?", (child["parent_id"],))
                await self.runtime.db.commit()
        return {"status": "background", "mode": "async", "detail": "The wait limit was reached. Work continues in the background and will report later."}

    async def notice(self, bot, thread, target, result, child):
        target_bot = await self.store.get_bot(target)
        msg = WireMessage(id=new_id("msg"), role="bot", kind="notice", author=bot.id, at=now_ms(), text=f"Handed work to {result['bot']}",
                          threadRef={"botId": target, "bot": result["bot"], "threadId": result["threadId"], "assignmentId": result["id"],
                                     "parentAssignment": child["parent_id"], "rootAssignment": child["root_id"], "ephemeral": bool(target_bot and target_bot.ephemeral)})
        await self.store.add_message(self.turns._owner_for(thread, bot.id), thread, msg)
        self.turns._frame("message", bot.id, thread, msg)

    def inherited(self, parent, specialist):
        shared = set(settings(parent).subagents.shareWithDelegates) & set(specialist.capabilities)
        result = Toolbox(web=Web(enabled="web" in shared and settings(parent).web.enabled))
        if "web" in shared:
            result.web = settings(parent).web.model_copy(deep=True)
        if "computer" in shared and settings(parent).computer.enabled:
            result.computer = settings(parent).computer.model_copy(deep=True)
        return result, "memory" in shared and parent.memory, [s for s in specialist.skills if s in parent.skills] if "skills" in shared else []

    async def sync(self, parent):
        config = settings(parent)
        keep = set()
        for specialist in config.subagents.inline:
            existing = await self.store.get_bot(specialist.botId) if specialist.botId else None
            if existing and existing.inline and existing.owner != parent.id:
                raise ValueError("Specialist belongs to a different parent")
            if existing and not existing.inline:  # promoted: its current setup now belongs to the person
                keep.add(existing.id); continue
            child = existing or await self.store.create_bot(specialist.name, "Specialist", specialist.description, parent.color,
                                                           specialist.modelSelection or parent.modelSelection.model_dump())
            child.hidden, child.inline, child.owner, child.specialistId = True, True, parent.id, specialist.id
            child.name, child.description, child.soul, child.maxSteps = specialist.name, specialist.description, specialist.instructions, specialist.maxSteps
            child.toolbox, child.memory, child.skills = self.inherited(parent, specialist)
            child.mcpServers = list(parent.mcpServers) if "apps" in specialist.capabilities and "apps" in config.subagents.shareWithDelegates else []
            child.mcpAccess = dict(parent.mcpAccess) if child.mcpServers else {}
            child.approvalMode = parent.approvalMode
            child.section, child.reportsTo = parent.section, parent.id
            child.modelSelection = type(parent.modelSelection).model_validate(specialist.modelSelection or parent.modelSelection.model_dump())
            if specialist.knowledge:
                child.soul += "\n\nKnowledge references:\n" + "\n".join(specialist.knowledge)
            self.store.assign_workspace(child)
            await self.store.save_bot(child)
            self.host.note(child)
            specialist.botId = child.id
            keep.add(child.id)
        for child in await self.store.list_bots():
            if child.owner == parent.id and child.inline and child.id not in keep:
                await self.delete_specialist(child)
        parent.toolbox = config
        await self.store.save_bot(parent)

    async def create(self, thread, args):
        parent = await self.agents._me(thread)
        if not parent or not settings(parent).subagents.allowDynamic:
            return {"ok": False, "reason": "dynamic_off", "detail": "Dynamic specialists are disabled"}
        node = await self.agents._node(thread)
        if node["origin"] != "person":
            return {"ok": False, "reason": "not_allowed", "detail": "Unattended runs use only declared delegates"}
        existing = [bot for bot in await self.store.list_bots() if bot.ephemeral and bot.owner == parent.id and bot.ephemeralRoot == node["root_id"]]
        if len(existing) >= settings(parent).subagents.maxFanout:
            return {"ok": False, "reason": "fanout", "detail": "The temporary specialist limit is reached"}
        definition = Specialist.model_validate({"id": new_id("specialist"), "name": args.get("name"), "description": args.get("description", ""),
                                               "instructions": args.get("instructions", ""), "modelSelection": args.get("modelSelection"),
                                               "capabilities": args.get("capabilities", []), "skills": args.get("skills", [])})
        child = await self.store.create_bot(definition.name, "Temporary specialist", definition.description, parent.color,
                                            definition.modelSelection or parent.modelSelection.model_dump())
        child.hidden, child.ephemeral, child.owner, child.ephemeralRoot = True, True, parent.id, node["root_id"]
        child.soul, child.maxSteps, child.approvalMode = definition.instructions, definition.maxSteps, parent.approvalMode
        child.section, child.reportsTo = parent.section, parent.id
        child.toolbox, child.memory, child.skills = self.inherited(parent, definition)
        child.mcpServers = list(parent.mcpServers) if "apps" in definition.capabilities and "apps" in settings(parent).subagents.shareWithDelegates else []
        child.mcpAccess = dict(parent.mcpAccess) if child.mcpServers else {}
        self.store.assign_workspace(child)
        await self.store.save_bot(child); self.host.note(child)
        return {"ok": True, "bot": child.id, "name": child.name, "instructions": child.soul, "temporary": True}

    async def delegate(self, thread, args):
        parent = await self.agents._me(thread)
        target = await self.agents._resolve(str(args.get("bot") or ""))
        child = await self.store.get_bot(target) if target else None
        node = await self.agents._node(thread)
        if not parent or not child or not child.ephemeral or child.owner != parent.id or not node or child.ephemeralRoot != node["root_id"]:
            return {"ok": False, "reason": "not_allowed", "detail": "Choose a temporary specialist created by this run"}
        from .store import new_id
        answer = await self.turns.broker.ask(thread, new_id("dynamic"), "permission", "Delegate", {
            "summary": f"Delegate to {child.name}\nInstructions:\n{child.soul}", "description": child.soul,
        })
        if answer.get("behavior") != "allow":
            return {"ok": False, "reason": "declined", "detail": "The person did not approve these specialist instructions"}
        return await self.coordinate(thread, args, task=bool(args.get("wait", True)))

    async def promote(self, child):
        child.hidden = child.inline = child.ephemeral = False
        child.owner = child.ephemeralRoot = None
        await self.store.save_bot(child)
        await self.turns.publish_bot(child)
        return child

    async def delete_specialist(self, bot):
        for thread, run in list(self.turns.runs.items()):
            if run.bot_id == bot.id:
                await self.turns.interrupt(bot, thread)
        await self.store.delete_bot(bot.id)

    async def remove_owned(self, owner):
        for bot in await self.store.list_bots():
            if bot.owner == owner and (bot.inline or bot.ephemeral):
                await self.delete_specialist(bot)

    async def cleanup(self, root_id):
        for bot in await self.store.list_bots():
            if bot.ephemeral and bot.ephemeralRoot == root_id:
                await self.delete_specialist(bot)
