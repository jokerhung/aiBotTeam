# Agents page of the reference app — what was seen

Reference: agenticos 1.89.1 at the address in `AGENTS.md` (checked 2026-11-22, signed in as the organization owner; the login is kept out of git in `AGENTS.local.md`).

## Menu of the reference
Overview, Chat, Inbox · **Build & manage:** Agents, Workflows, Routines, Datasets, Apps · **Projects:** All projects · **Knowledge:** Knowledge bases, Tables, Skills, Context · foot: bell, version, user card. First visit shows an announcement banner, a "What's new" dialog and a floating helper bubble (none of these are copied).

## /agents (list)
- Header: `Agents (i)`, buttons **Agent templates** (outline) and **New agent** (dark, primary).
- Controls row under the header: search field, status select (All, Published, Drafts, Archived), count at the far right ("2 agents").
- Card grid directly on the page, 3 columns at 1500 px: round coloured avatar, name, access chip with icon ("Organization"), description clamped at three lines, divider, status dot + word ("draft"), "edited <date>", pencil and `…`.

## New agent dialog
Title "New agent", subtitle "It starts as a draft. Nothing runs until you publish it." Name (+ note about the `@handle`), "Who can find it" as three cards (Everyone, Only me, Some people), folded **More options** (Description, Categories, Tags), footer "Starts with 20 recommended tools" with Cancel and Create.

## /agents/<id>
Breadcrumb `Agents > name`; avatar, large name with `(i)`, status chip; buttons Test, Open in chat, `…`, Publish. Tabs: Build, Toolbox, MCP servers, Limits, Availability, Evals, Knowledge gaps, History.
- Build: Instructions card (Preview, expand), Model card (Provider + Model selects, Add model), folded Model access and Model settings.
- Toolbox: Capabilities, search, horizontally scrolling groups of picture cards with switches.
- MCP servers: Connect a server, search, two filter boxes, grid of server cards with switches.
- Limits: Run limits (Monthly USD, Max steps, loop guard, Code mode), folded Run reviewers, Alerts, Tracing.
- Availability: Where people reach this agent (Website widget, Hosted page, Raw WebSocket, Public API), Chat apps (Slack, Teams, Telegram, Mattermost, SMS, Email, iMessage, Discord, Matrix).
- History: Versions, Improvement history.

Nothing was created, changed or published in the reference app during this check (the New agent dialog was opened and closed).
