import { describe, expect, it } from "vitest";
import { TOOLBOX_CATALOG } from "./catalog";
import { NATIVE_CAPABILITIES, nativeSupport } from "./native";

describe("capabilities Claude Code and Codex have by themselves", () => {
  it("only names capabilities of the catalog, with the tool of both engines", () => {
    const ids = new Set(TOOLBOX_CATALOG.map((entry) => entry.id));
    for (const [id, tools] of Object.entries(NATIVE_CAPABILITIES)) {
      expect(ids.has(id), id).toBe(true);
      expect(tools.claude.length, id).toBeGreaterThan(0);
      expect(tools.codex.length, id).toBeGreaterThan(0);
    }
  });

  it("does not claim what only one engine, or BotTeam alone, provides", () => {
    for (const id of ["web_fetch", "image_generation", "text_to_speech", "video_generation", "planning", "ask_user", "subagents", "web", "computer", "browser_use", "computer_use", "memory_files", "knowledge", "tool_search"]) {
      expect(NATIVE_CAPABILITIES[id], id).toBeUndefined();
    }
  });

  it("applies to agents on Claude Code and Codex and to no other engine", () => {
    expect(nativeSupport("code_execution", "claude")).toEqual({ claude: "Bash", codex: "exec_command" });
    expect(nativeSupport("skills", "codex")).not.toBeNull();
    for (const driver of ["antigravity", "openai-compat", "echo", undefined]) expect(nativeSupport("code_execution", driver)).toBeNull();
    expect(nativeSupport("charts", "claude")).toBeNull();
  });
});
