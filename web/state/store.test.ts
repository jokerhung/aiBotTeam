import { describe, expect, it } from "vitest";
import { initialState, reducer, type AppState } from "./store";
import type { Bot, Message, ServerFrame } from "@/lib/wire";

const bot = (id: string, over: Partial<Bot> = {}): Bot => ({
  id, threadId: `t-${id}`, mainThreadId: `t-${id}`, name: id, title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, threadBusy: false, activity: "idle", turnStartedAt: null,
  statusLine: null, modelSelection: { instanceId: "echo", model: "echo-1" }, pinned: false, hidden: false,
  section: null, cwd: null, approvalMode: "full", soul: "", chief: false, fallbackSelection: null, lastText: "", lastAt: null, readAt: 0, tasks: [], usage: {}, ...over,
});
const msg = (id: string, over: Partial<Message> = {}): Message => ({ id, role: "bot", kind: "text", text: "", at: 1, ...over });
const frame = (s: AppState, f: ServerFrame) => reducer(s, { type: "frame", frame: f });
const hydrated = (...ids: string[]) => reducer(initialState, { type: "hydrate", bots: ids.map((i) => bot(i)), instances: [] });

describe("reducer", () => {
  it("hydrate selects the first bot", () => {
    const s = hydrated("a", "b");
    expect(s.selectedId).toBe("a");
    expect(s.hydrated).toBe(true);
  });

  it("a bot frame upserts and keeps order", () => {
    let s = hydrated("a", "b");
    s = frame(s, { kind: "bot", bot: bot("a", { busy: true }) });
    s = frame(s, { kind: "bot", bot: bot("c") });
    expect(s.bots.map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(s.bots[0].busy).toBe(true);
  });

  it("deleting the selected bot selects another and forgets its transcripts", () => {
    let s = hydrated("a", "b");
    s = frame(s, { kind: "message", botId: "a", threadId: "t-a", message: msg("m") });
    s = frame(s, { kind: "bot.deleted", botId: "a" });
    expect(s.selectedId).toBe("b");
    expect(s.messages["t-a"]).toBeUndefined();
  });

  it("the server echo replaces the optimistic message by sendId", () => {
    let s = reducer(initialState, { type: "optimistic", threadId: "t", message: msg("pending-1", { role: "user", sendId: "1", pending: true }) });
    s = frame(s, { kind: "message", botId: "a", threadId: "t", message: msg("m1", { role: "user", sendId: "1", text: "hi" }) });
    expect(s.messages.t).toHaveLength(1);
    expect(s.messages.t[0]).toMatchObject({ id: "m1", pending: false, text: "hi" });
  });

  it("streams a reply through message then patches", () => {
    let s = frame(initialState, { kind: "message", botId: "a", threadId: "t", message: msg("r", { streaming: true }) });
    s = frame(s, { kind: "message.patch", botId: "a", threadId: "t", message: { id: "r", text: "Hello", streaming: true } });
    s = frame(s, { kind: "message.patch", botId: "a", threadId: "t", message: { id: "r", text: "Hello world", streaming: false } });
    expect(s.messages.t).toEqual([expect.objectContaining({ text: "Hello world", streaming: false })]);
  });

  it("a tool patch completes the running chip without losing its input", () => {
    const tool = { name: "Bash", ok: null, summary: "ls", input: "{cmd}", output: "" };
    let s = frame(initialState, { kind: "message", botId: "a", threadId: "t", message: msg("x", { kind: "activity", tool }) });
    s = frame(s, { kind: "message.patch", botId: "a", threadId: "t", message: { id: "x", tool: { ...tool, ok: true, output: "done" } } });
    expect(s.messages.t[0].tool).toMatchObject({ ok: true, output: "done", input: "{cmd}" });
  });

  it("a failed send removes only that optimistic message", () => {
    let s = reducer(initialState, { type: "optimistic", threadId: "t", message: msg("p1", { sendId: "1" }) });
    s = reducer(s, { type: "optimistic", threadId: "t", message: msg("p2", { sendId: "2" }) });
    s = reducer(s, { type: "optimisticFailed", threadId: "t", sendId: "1" });
    expect(s.messages.t.map((m) => m.id)).toEqual(["p2"]);
  });

  it("a dropped queued message disappears", () => {
    let s = frame(initialState, { kind: "message", botId: "a", threadId: "t", message: msg("q", { role: "user", queued: true }) });
    s = frame(s, { kind: "message.deleted", botId: "a", threadId: "t", messageId: "q" });
    expect(s.messages.t).toEqual([]);
  });

  it("older pages are prepended without duplicates", () => {
    let s = reducer(initialState, { type: "history", threadId: "t", messages: [msg("3"), msg("4")], hasMore: true, generation: 1 });
    s = reducer(s, { type: "older", threadId: "t", messages: [msg("1"), msg("2"), msg("3")], hasMore: false });
    expect(s.messages.t.map((m) => m.id)).toEqual(["1", "2", "3", "4"]);
    expect(s.hasMore.t).toBe(false);
  });

  it("a branch switch bumps the reload generation of that conversation only", () => {
    const s = frame(initialState, { kind: "thread", botId: "a", threadId: "t", activeLeafId: "x" });
    expect(s.reload).toEqual({ t: 1 });
  });

  it("selecting a bot captures when it was last read for the unread divider", () => {
    let s = reducer(initialState, { type: "hydrate", bots: [bot("a"), bot("b", { readAt: 500 })], instances: [] });
    s = reducer(s, { type: "select", id: "b" });
    expect(s.dividerAt.b).toBe(500);
  });

  it("bots.order reorders and keeps unknown bots last", () => {
    let s = hydrated("a", "b", "c");
    s = frame(s, { kind: "bots.order", botIds: ["c", "a"] });
    expect(s.bots.map((b) => b.id)).toEqual(["c", "a", "b"]);
  });
});

describe("phase 3 state", () => {
  it("shows a request card and settles it in place when the server patches it", () => {
    const open = { id: "r1", type: "permission" as const, tool: "Bash", summary: "mkdir x", canAlways: true, status: "open" as const, openedAt: 1, choices: [], questions: [] };
    let s = hydrated("a");
    s = frame(s, { kind: "message", botId: "a", threadId: "t-a", message: msg("m1", { kind: "request", request: open }) });
    expect(s.messages["t-a"][0].request?.status).toBe("open");
    s = frame(s, { kind: "message.patch", botId: "a", threadId: "t-a", message: { id: "m1", request: { ...open, status: "resolved", behavior: "allow", source: "user" } } });
    expect(s.messages["t-a"]).toHaveLength(1);
    expect(s.messages["t-a"][0].request).toMatchObject({ status: "resolved", behavior: "allow", source: "user" });
  });

  it("tracks sections and config frames", () => {
    let s = hydrated("a");
    s = frame(s, { kind: "sections", sections: [{ id: "s1", name: "Work", collapsed: false }] });
    expect(s.sections.map((x) => x.name)).toEqual(["Work"]);
    s = frame(s, { kind: "config", settings: { ...s.config.settings, skin: "midnight" }, keys: { groq: { configured: true } }, keyCatalog: [] });
    expect(s.config.settings.skin).toBe("midnight");
    expect(s.config.keys.groq.configured).toBe(true);
  });

  it("opens the bot panel and closes it when another bot is selected", () => {
    let s = hydrated("a", "b");
    s = reducer(s, { type: "panel", botId: "a" });
    expect(s.panelBotId).toBe("a");
    s = reducer(s, { type: "select", id: "b" });
    expect(s.panelBotId).toBeNull();
  });

  it("picks bots in select mode and clears the picks when it ends", () => {
    let s = reducer(hydrated("a", "b"), { type: "selecting", on: true });
    s = reducer(s, { type: "pick", id: "a" });
    s = reducer(s, { type: "pick", id: "b" });
    s = reducer(s, { type: "pick", id: "a" });
    expect(s.picked).toEqual(["b"]);
    expect(reducer(s, { type: "selecting", on: false }).picked).toEqual([]);
  });

  it("opens settings on a page", () => {
    const s = reducer(initialState, { type: "settings", open: true, page: "connections" });
    expect(s).toMatchObject({ settingsOpen: true, settingsPage: "connections" });
  });
});
