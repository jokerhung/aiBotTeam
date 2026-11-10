import { describe, expect, it } from "vitest";
import { initialState, reducer, type AppState } from "./store";
import type { Bot, Message, ServerFrame } from "@/lib/wire";

const bot = (id: string, over: Partial<Bot> = {}): Bot => ({
  id, threadId: `t-${id}`, mainThreadId: `t-${id}`, name: id, title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, threadBusy: false, activity: "idle", turnStartedAt: null,
  statusLine: null, modelSelection: { instanceId: "echo", model: "echo-1" }, pinned: false, hidden: false,
  section: null, cwd: null, lastText: "", lastAt: null, readAt: 0, tasks: [], usage: {}, ...over,
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
