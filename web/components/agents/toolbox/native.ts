/**
 * Capabilities that Claude Code and Codex already have by themselves.
 *
 * An agent that runs on one of these two engines gets them whatever its Toolbox says, so the gallery shows them on and does not let
 * them be turned off. Only what BOTH engines do natively is listed: what one of them lacks (Claude Code has no image generation, Codex
 * has no web fetch) stays a normal card. The tool names are what each CLI calls it, shown in the card's panel as the evidence.
 *
 * Checked 2026-11-23 against Claude Code's `init` tool list and `codex 0.166` (`codex debug prompt-input`, `codex features list`):
 *   - Codex has no `update_plan` tool in this build, so Planning is not listed; `request_user_input` and `spawn_agent` exist in Codex
 *     but BotTeam does not carry them through yet, and BotTeam's Subagents is its own bot-to-bot feature, so Ask the user and
 *     Subagents are not listed either.
 *   - Codex's `web_search` is off in the CLI by default; BotTeam starts the Codex app server with it on (drivers/codex_app.py).
 */
export type NativeEngine = "claude" | "codex";

export const NATIVE_CAPABILITIES: Readonly<Record<string, Readonly<Record<NativeEngine, string>>>> = {
  code_execution: { claude: "Bash", codex: "exec_command" },
  coding_agent: { claude: "the CLI itself", codex: "the CLI itself" },
  sandbox: { claude: "Bash, Read, Write, Edit", codex: "exec_command, apply_patch" },
  background_tools: { claude: "Bash (run in background), Monitor", codex: "exec_command, write_stdin, sleep" },
  web_research: { claude: "WebSearch", codex: "web_search" },
  skills: { claude: "Skill", codex: "skills" },
  connected_apps: { claude: "MCP servers", codex: "MCP servers" },
  compaction: { claude: "automatic compaction", codex: "automatic compaction" },
  clock: { claude: "the current date in its context", codex: "clock" },
};

/** The native tools of a capability for an agent whose engine is `driver` (the engine's kind: "claude", "codex"…); null when it has none. */
export function nativeSupport(id: string, driver: string | undefined): Readonly<Record<NativeEngine, string>> | null {
  if (driver !== "claude" && driver !== "codex") return null;
  return NATIVE_CAPABILITIES[id] ?? null;
}
