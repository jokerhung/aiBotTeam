# Toolbox: what Claude Code and Codex already do

A Toolbox card is shown **on and locked** (it cannot be turned off) for an agent that runs on Claude Code or Codex when **both** CLIs do the thing by themselves. The list is `NATIVE_CAPABILITIES` in `web/components/agents/toolbox/native.ts`; engines other than Claude Code and Codex (Antigravity, OpenAI-compatible endpoints, the demo engine) keep the normal cards.

Checked 2026-11-23 on Claude Code (the tool list in its `init` message) and `codex-cli 0.166.0` (`codex debug prompt-input`, `codex features list`, `codex --help`).

## Locked on (both engines)

| Card | Claude Code | Codex |
|---|---|---|
| Calculations | `Bash` | `exec_command` |
| Coding agent | the CLI itself | the CLI itself |
| Sandbox | `Bash`, `Read`, `Write`, `Edit` | `exec_command`, `apply_patch` |
| Work while tools run | `Bash` in the background, `Monitor` | `exec_command`, `write_stdin`, `sleep` |
| Web search | `WebSearch` | `web_search` (off in the CLI by default; **BotTeam starts the Codex app server with `-c web_search="live"`**, `drivers/codex_app.py`) |
| Skills | `Skill` | skills (`skill_search`) |
| Connected apps | MCP servers | MCP servers |
| Long conversations | automatic compaction | automatic compaction |
| Date and time | the current date in its context | the `clock` tools |

For Skills and Connected apps the card is locked on, but which skills and servers an agent gets is still chosen in the card's panel.

## Not locked, and why

| Card | Reason |
|---|---|
| Planning | Codex 0.166 has no `update_plan` tool in `prompt-input` (Claude Code has its task tools) |
| Ask the user | both have it (`AskUserQuestion`, `request_user_input`), but the Codex app-server driver does not carry `request_user_input` through yet |
| Subagents | Claude Code (`Task`) and Codex (`spawn_agent`) have their own, but BotTeam's Subagents is bot-to-bot delegation with its own settings |
| Read web pages | Claude Code only (`WebFetch`) |
| Image generation | Codex only (`image_generation`) |
| Web browser, Computer use | Codex has `browser_use` and `computer_use` features; Claude Code has neither; BotTeam's Web use and Computer use are separate |
| Memory | BotTeam's own notes; Codex memories are off by default |
| Tool search | Claude Code only |
| Context, Knowledge search, Past conversations, Charts, Visuals, Text to speech, Video generation, Mirage, Telephone calls, Apps, Drafts, Follow-ups, Guardrails, Instruction reminders, Media offload, Tool output limits, Background topics | neither CLI has it as a tool |
