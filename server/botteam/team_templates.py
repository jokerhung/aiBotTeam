"""Portable team definition adapted from aiSocialTeam d832236; no campaign HTTP tools."""
from .toolbox import Delegate, settings
from .social_workflow import WORKFLOW

TEAM = [('master', 'Master Agent', 'Plans your requests, assigns the team and reports back', 'purple', "You lead a social-media team for one campaign. Turn the person's request into small tasks and hand each one to the right teammate (Research, Creator, Scheduler, Analytics). Report back briefly when the work is done."), ('research', 'Research Agent', 'Finds trends and topics your audience cares about', 'cyan', 'You research trends, topics and hashtags for social-media campaigns. Give findings with their sources.'), ('creator', 'Creator Agent', 'Writes captions and designs the posts', 'pink', "You write captions, hooks and hashtag sets for the social platforms of the campaign (Instagram, TikTok, YouTube, X and others), matching each platform's rules."), ('scheduler', 'Scheduler Agent', 'Plans the best time to post and schedules posts', 'orange', 'You choose the best times to post and schedule posts for the campaign.'), ('analytics', 'Analytics Agent', 'Reports on post performance, on request or on a schedule you set', 'green', 'You report on how posts performed: views, likes, comments, shares and saves, and what to do next.')]

TEMPLATE = {"id": "teams--social-media-team", "kind": "team", "industry": "teams", "name": "Social media team",
    "description": "Master, Research, Creator, Scheduler and Analytics working together.",
    "instructions": "Master delegates to four specialists. Creator uses assigned writing skills. Scheduler requires connected publishing apps; it does not call an internal posting API."}

async def install(store, turns, skills, selection):
    bots = []
    skill = skills.save(None, "Social media writing", "Write captions, hooks and hashtag sets for social platforms.",
        "Research the audience and platform. Draft original captions, hooks and hashtag sets. Follow the person's brand voice and verify claims. Ask for approval before publishing. Return drafts when no publishing app is connected.")
    for role, name, title, color, soul in TEAM:
        bot = await store.create_bot(name, title, title, color, selection)
        bot.soul, bot.approvalMode = soul + ("\n\n" + WORKFLOW[role] if role in WORKFLOW else ""), "ask"
        if role == "creator":
            bot.skills = [skill["id"]]
        if role == "scheduler":
            bot.soul += " Use connected publishing apps only when configured and permitted. Otherwise return a proposed schedule and explain which connection is needed."
        store.assign_workspace(bot)
        bots.append(bot)
    master = bots[0]
    config = settings(master)
    config.subagents.enabled, config.subagents.maxFanout, config.subagents.mode = True, 4, "async"
    config.subagents.delegates = [Delegate(bot=b.id) for b in bots[1:]]
    master.toolbox = config
    for bot in bots:
        if bot is not master:
            bot.reportsTo = master.id
        await store.save_bot(bot)
        await turns.publish_bot(bot)
    return master

async def duplicate(store, turns, delegation, source, *, with_delegates=False):
    originals, pending = {}, [source]
    while pending:
        bot = pending.pop()
        if bot.id in originals or bot.inline or bot.ephemeral or bot.admin:
            continue
        originals[bot.id] = bot
        if with_delegates:
            for item in settings(bot).subagents.delegates:
                child = await store.get_bot(item.bot)
                if child:
                    pending.append(child)
    copies = {}
    for key, src in originals.items():
        bot = await store.create_bot(f"{src.name} copy"[:60], src.title, src.description, src.color, src.modelSelection.model_dump())
        for field in ("approvalMode", "soul", "fallbackSelection", "notifications", "section", "memory", "skills", "mcpServers", "mcpAccess", "chief", "managedSections"):
            import copy
            setattr(bot, field, copy.deepcopy(getattr(src, field)))
        bot.toolbox = settings(src).model_copy(deep=True)
        for item in bot.toolbox.subagents.inline:
            item.botId = None
        if not with_delegates:
            bot.cwd = src.cwd
        store.assign_workspace(bot)
        copies[key] = bot
    for key, bot in copies.items():
        src = originals[key]
        bot.reportsTo = copies[src.reportsTo].id if src.reportsTo in copies else src.reportsTo
        for item in bot.toolbox.subagents.delegates:
            if item.bot in copies:
                item.bot = copies[item.bot].id
        await store.save_bot(bot)
        await delegation.sync(bot)
        await turns.publish_bot(bot)
    return copies[source.id]
