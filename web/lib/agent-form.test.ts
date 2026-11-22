import { describe, expect, it } from "vitest";
import { agentChanges, agentHandle, filterTemplates, filterAgents, allowAgentNavigation, registerAgentGuard } from "./agent-form";
import { parseHash, toHash } from "./nav";
import { initialState, reducer } from "../state/store";
import type { Bot } from "./wire";

const bot = { id: "a", name: "Research agent", title: "Analyst", description: "Find sources", hidden: false, section: "x", soul: "Do research", modelSelection: { instanceId: "echo", model: "echo-1" } } as Bot;
describe("Agent editor", () => {
  it("routes every tab and tolerates malformed addresses", () => {
    expect(parseHash(toHash("agent", "a/b", "knowledge-gaps"))).toEqual({ view: "agent", id: "a/b", tab: "knowledge-gaps" });
    expect(parseHash("#/agents/a/unknown")?.tab).toBe("build");
    expect(parseHash("#/agents/%ZZ")).toEqual({ view: "agents" });
    const state = reducer(initialState, { type: "openAgent", id: "a", tab: "toolbox" });
    expect([state.view, state.selectedAgentId, state.agentTab, state.panelBotId]).toEqual(["agent", "a", "toolbox", null]);
  });
  it("searches metadata and filters archived and section independently", () => {
    const archived = { ...bot, id: "b", hidden: true };
    expect(filterAgents([bot, archived], "SOURCES", "all", "x")).toHaveLength(2);
    expect(filterAgents([bot, archived], "", "active", "")).toEqual([bot]);
    expect(filterAgents([bot, archived], "", "archived", "x")).toEqual([archived]);
    expect(filterAgents([bot], "", "all", "y")).toEqual([]);
  });
  it("sends only editable changes, ignoring runtime activity", () => {
    expect(agentChanges(bot, { ...bot, busy: true, lastText: "new message" })).toEqual({});
    expect(agentChanges(bot, { ...bot, soul: "New instructions", memory: false })).toEqual({ soul: "New instructions", memory: false });
    expect(agentHandle("  Research Agent  ")).toBe("research-agent");
  });
  it("searches templates within an industry without fetching data", () => {
    const rows = [{ name: "QA", description: "Test software", industry: "software" }, { name: "Audit", description: "Check books", industry: "finance" }];
    expect(filterTemplates(rows, " TEST ", "software")).toEqual([rows[0]]);
    expect(filterTemplates(rows, "", "finance")).toEqual([rows[1]]);
    expect(filterTemplates(rows, "missing", "")).toEqual([]);
  });
  it("can deny a route without changing state and clears its guard on unmount", () => {
    registerAgentGuard((action) => action.type !== "select");
    expect(allowAgentNavigation({ type: "select", id: "other" })).toBe(false);
    expect(allowAgentNavigation({ type: "frame" })).toBe(true);
    registerAgentGuard(null);
    expect(allowAgentNavigation({ type: "select" })).toBe(true);
  });
});
