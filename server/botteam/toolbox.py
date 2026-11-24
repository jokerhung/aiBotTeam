"""Validated per-agent capabilities and the one-time migration from implicit tools."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Mode = Literal["sync", "async", "auto"]
SharedCapability = Literal["web", "computer", "memory", "skills", "apps"]


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class Delegate(Settings):
    bot: str = Field(min_length=1, max_length=100)
    handBack: Mode | None = None


class Specialist(Settings):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    name: str = Field(min_length=1, max_length=60)
    description: str = Field(default="", max_length=5000)
    instructions: str = Field(default="", max_length=100_000)
    maxSteps: int = Field(default=20, ge=1, le=200)
    modelSelection: dict[str, str | None] | None = None
    handBack: Mode | None = None
    capabilities: list[SharedCapability] = Field(default_factory=list, max_length=5)
    knowledge: list[str] = Field(default_factory=list, max_length=100)
    skills: list[str] = Field(default_factory=list, max_length=100)
    botId: str | None = None


class Subagents(Settings):
    enabled: bool = False
    allowAnyAgent: bool = False
    delegates: list[Delegate] = Field(default_factory=list, max_length=100)
    inline: list[Specialist] = Field(default_factory=list, max_length=30)
    allowDynamic: bool = False
    mode: Mode = "async"
    allowQuestions: bool = False
    maxDepth: int = Field(default=2, ge=1, le=3)
    maxFanout: int = Field(default=3, ge=1, le=10)
    maxResultChars: int = Field(default=10000, ge=500, le=20000)
    maxWaitSeconds: int = Field(default=300, ge=1, le=1800)
    shareWithDelegates: list[SharedCapability] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def unique(self):
        if len({d.bot for d in self.delegates}) != len(self.delegates):
            raise ValueError("delegates must be unique")
        if len({s.id for s in self.inline}) != len(self.inline):
            raise ValueError("specialist ids must be unique")
        return self


class Web(Settings):
    enabled: bool = True
    headed: bool = False
    allowLocal: bool = False
    idleSeconds: int = Field(default=900, ge=0, le=86400)


class Computer(Settings):
    enabled: bool = False
    resolution: tuple[int, int] = (1280, 800)
    idleSeconds: int = Field(default=600, ge=30, le=86400)
    allowCommands: bool = False

    @model_validator(mode="after")
    def dimensions(self):
        if any(not 640 <= n <= 3840 for n in self.resolution):
            raise ValueError("resolution dimensions must be between 640 and 3840")
        return self


class ResourcesSettings(Settings):
    enabled: bool = True
    allowHtml: bool = True
    chatCards: bool = True
    maxHtmlBytes: int = Field(default=2 * 1024**2, ge=1024, le=2 * 1024**2)
    maxMarkdownBytes: int = Field(default=500 * 1024, ge=1024, le=500 * 1024)
    maxImageBytes: int = Field(default=10 * 1024**2, ge=1024, le=10 * 1024**2)


RESOURCE_TOOLS = {"publish_resource", "read_resource", "update_resource", "list_resources", "list_resource_versions", "set_resource_status"}


class Toolbox(Settings):
    resources: ResourcesSettings = Field(default_factory=ResourcesSettings)
    subagents: Subagents = Field(default_factory=Subagents)
    web: Web = Field(default_factory=Web)
    computer: Computer = Field(default_factory=Computer)


def settings(bot) -> Toolbox:
    value = bot.toolbox
    return value if isinstance(value, Toolbox) else Toolbox.model_validate(value or {})


DELEGATION_TOOLS = {"list_bots", "coordinate_bots", "assignment_status", "cancel_assignment", "task", "create_agent", "delegate"}


def tools_for(bot, names: list[str], *, depth_remaining: int | None = None) -> list[str]:
    config = settings(bot).subagents
    if bot.inline or bot.ephemeral:
        allowed = {"remember", "recall", "forget", "team_remember"} if bot.memory else set()
        if settings(bot).web.enabled:
            allowed.add("browser_request_help")
        if bot.mcpServers:
            allowed.add("sheet_rows")
        return [name for name in names if name in allowed]
    allowed = set(names) - DELEGATION_TOOLS
    if not settings(bot).resources.enabled:
        allowed -= RESOURCE_TOOLS
    if config.enabled and not bot.inline and not bot.ephemeral and (depth_remaining is None or depth_remaining > 0):
        allowed |= {"list_bots", "task"}
        if config.mode != "sync" or any(d.handBack == "async" for d in config.delegates) or any(s.handBack == "async" for s in config.inline):
            allowed |= {"coordinate_bots", "assignment_status", "cancel_assignment"}
        if config.allowDynamic:
            allowed |= {"create_agent", "delegate"}
    if not bot.memory:
        allowed -= {"remember", "recall", "forget", "team_remember"}
    return [name for name in names if name in allowed]


async def migrate(store, runtime, config, home: Path) -> list[str]:
    """Back up before changing any bot; replay after a crash never overwrites saved settings."""
    if config.data.get("toolboxMigrated"):
        return []
    bots = await store.list_bots()
    existing = [b for b in bots if b.toolbox is None]
    if existing:
        backup = home / "backup" / "toolbox-before-migration.json"
        backup.parent.mkdir(parents=True, exist_ok=True)
        if not backup.exists():
            from .memory import write_atomic
            write_atomic(backup, json.dumps([b.model_dump() for b in bots], ensure_ascii=False, indent=2))
        coordinated = {b.id for b in bots if b.chief or b.managedSections or b.reportsTo}
        coordinated |= {b.reportsTo for b in bots if b.reportsTo}
        cursor = await runtime.db.execute("SELECT assignee_bot, requester FROM assignments")
        for target, requester in await cursor.fetchall():
            coordinated.add(target)
            try:
                source = json.loads(requester)
                if isinstance(source, dict) and source.get("bot"):
                    coordinated.add(source["bot"])
            except (ValueError, TypeError):
                pass
        activated = []
        for bot in existing:
            bot.toolbox = Toolbox()
            if bot.id in coordinated and not bot.admin:
                bot.toolbox.subagents.enabled = True
                bot.toolbox.subagents.allowAnyAgent = True
                bot.toolbox.subagents.delegates = [Delegate(bot=b.id) for b in bots if b.id != bot.id and not b.admin and not b.inline and not b.ephemeral]
                activated.append(bot.id)
            await store.save_bot(bot)
    else:
        activated = []
    config.data["toolboxMigrated"] = True
    config.data["toolboxMigrationNotice"] = {"botIds": activated, "dismissed": False}
    config.save()
    return activated
