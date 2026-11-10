import { describe, expect, it } from "vitest";
import { initialState, reducer, type AppState } from "./store";
import type { Bot, Message } from "@/lib/wire";

const bot = (id: string, over: Partial<Bot> = {}): Bot => ({
  id, threadId: `t-${id}`, name: id, title: "", description: "", color: "green", notifications: true,
  unread: false, busy: false, activity: "idle", turnStartedAt: null,
  modelSelection: { instanceId: "echo", model: "echo-1" }, pinned: false, hidden: false, section: null,
  lastText: "", lastAt: null, ...over,
});
const msg = (id: string, over: Partial<Message> = {}): Message => ({ id, role: "bot", kind: "text", text: "", at: 1, ...over });

describe("reducer", () => {
  it("hydrate selects the first bot", () => {
    const s = reducer(initialState, { type: "hydrate", bots: [bot("a"), bot("b")], instances: [] });
    expect(s.selectedId).toBe("a");
    expect(s.hydrated).toBe(true);
  });

  it("a bot frame upserts and keeps order", () => {
    let s = reducer(initialState, { type: "hydrate", bots: [bot("a"), bot("b")], instances: [] });
    s = reducer(s, { type: "frame", frame: { kind: "bot", bot: bot("a", { busy: true }) } });
    s = reducer(s, { type: "frame", frame: { kind: "bot", bot: bot("c") } });
    expect(s.bots.map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(s.bots[0].busy).toBe(true);
  });

  it("deleting the selected bot selects another", () => {
    let s = reducer(initialState, { type: "hydrate", bots: [bot("a"), bot("b")], instances: [] });
    s = reducer(s, { type: "frame", frame: { kind: "bot.deleted", botId: "a" } });
    expect(s.selectedId).toBe("b");
  });

  it("the server echo replaces the optimistic message by sendId", () => {
    let s = reducer(initialState, { type: "optimistic", botId: "a", message: msg("pending-1", { role: "user", sendId: "1", pending: true }) });
    s = reducer(s, { type: "frame", frame: { kind: "message", botId: "a", threadId: "t", message: msg("m1", { role: "user", sendId: "1", text: "hi" }) } });
    expect(s.messages.a).toHaveLength(1);
    expect(s.messages.a[0]).toMatchObject({ id: "m1", pending: false, text: "hi" });
  });

  it("streams a reply through message then patches", () => {
    let s = reducer(initialState, { type: "frame", frame: { kind: "message", botId: "a", threadId: "t", message: msg("r", { streaming: true }) } });
    s = reducer(s, { type: "frame", frame: { kind: "message.patch", botId: "a", threadId: "t", message: { id: "r", text: "Hello", streaming: true } } });
    s = reducer(s, { type: "frame", frame: { kind: "message.patch", botId: "a", threadId: "t", message: { id: "r", text: "Hello world", streaming: false } } });
    expect(s.messages.a).toEqual([expect.objectContaining({ text: "Hello world", streaming: false })]);
  });

  it("a failed send removes only that optimistic message", () => {
    let s = reducer(initialState, { type: "optimistic", botId: "a", message: msg("p1", { sendId: "1" }) });
    s = reducer(s, { type: "optimistic", botId: "a", message: msg("p2", { sendId: "2" }) });
    s = reducer(s, { type: "optimisticFailed", botId: "a", sendId: "1" });
    expect(s.messages.a.map((m) => m.id)).toEqual(["p2"]);
  });

  it("bots.order reorders and keeps unknown bots last", () => {
    let s = reducer(initialState, { type: "hydrate", bots: [bot("a"), bot("b"), bot("c")], instances: [] });
    s = reducer(s, { type: "frame", frame: { kind: "bots.order", botIds: ["c", "a"] } });
    expect(s.bots.map((b) => b.id)).toEqual(["c", "a", "b"]);
  });
});
