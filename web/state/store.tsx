"use client";
import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import { api } from "./api";
import type { Bot, InstanceInfo, Message, ServerFrame } from "@/lib/wire";

export interface AppState {
  bots: Bot[];
  /** Transcripts by conversation (thread) id: the active branch, oldest first. */
  messages: Record<string, Message[]>;
  hasMore: Record<string, boolean>;
  loaded: Record<string, number>; // thread -> reload generation last fetched
  reload: Record<string, number>; // thread -> bumped when the branch moves or a refetch is needed
  instances: InstanceInfo[];
  selectedId: string;
  connected: boolean;
  hydrated: boolean;
  drawerOpen: boolean;
  newBotOpen: boolean;
  settingsOpen: boolean;
  /** When the person last read the selected bot, captured as it was opened: the unread divider sits after it. */
  dividerAt: Record<string, number>;
}

export type Action =
  | { type: "hydrate"; bots: Bot[]; instances: InstanceInfo[] }
  | { type: "instances"; instances: InstanceInfo[] }
  | { type: "connected"; connected: boolean }
  | { type: "select"; id: string }
  | { type: "history"; threadId: string; messages: Message[]; hasMore: boolean; generation: number }
  | { type: "older"; threadId: string; messages: Message[]; hasMore: boolean }
  | { type: "optimistic"; threadId: string; message: Message }
  | { type: "optimisticFailed"; threadId: string; sendId: string }
  | { type: "drawer"; open: boolean }
  | { type: "newBot"; open: boolean }
  | { type: "settings"; open: boolean }
  | { type: "frame"; frame: ServerFrame };

export const initialState: AppState = {
  bots: [], messages: {}, hasMore: {}, loaded: {}, reload: {}, instances: [], selectedId: "", connected: false,
  hydrated: false, drawerOpen: false, newBotOpen: false, settingsOpen: false, dividerAt: {},
};

function upsertMessage(list: Message[], m: Message): Message[] {
  const i = list.findIndex((x) => x.id === m.id || (m.sendId && x.sendId === m.sendId));
  if (i >= 0) {
    const c = list.slice();
    c[i] = { ...list[i], ...m, pending: false };
    return c;
  }
  return [...list, m];
}

function patchMessage(list: Message[], p: Partial<Message> & { id: string }): Message[] {
  return list.map((m) => (m.id === p.id ? { ...m, ...p, tool: p.tool ? { ...m.tool, ...p.tool } as Message["tool"] : m.tool } : m));
}

const threadsOf = (bot: Bot) => [...new Set([bot.threadId, bot.mainThreadId, ...bot.tasks.map((t) => t.threadId)])];

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate": {
      const selectedId = action.bots.some((b) => b.id === state.selectedId) ? state.selectedId : (action.bots[0]?.id ?? "");
      return { ...state, bots: action.bots, instances: action.instances, hydrated: true, selectedId,
        dividerAt: selectedId && !state.dividerAt[selectedId] ? { ...state.dividerAt, [selectedId]: action.bots.find((b) => b.id === selectedId)?.readAt ?? 0 } : state.dividerAt };
    }
    case "instances":
      return { ...state, instances: action.instances };
    case "connected":
      return { ...state, connected: action.connected };
    case "select": {
      const bot = state.bots.find((b) => b.id === action.id);
      return { ...state, selectedId: action.id, drawerOpen: false,
        dividerAt: { ...state.dividerAt, [action.id]: bot?.readAt ?? 0 } };
    }
    case "drawer":
      return { ...state, drawerOpen: action.open };
    case "newBot":
      return { ...state, newBotOpen: action.open };
    case "settings":
      return { ...state, settingsOpen: action.open };
    case "history":
      return { ...state, messages: { ...state.messages, [action.threadId]: action.messages },
        hasMore: { ...state.hasMore, [action.threadId]: action.hasMore },
        loaded: { ...state.loaded, [action.threadId]: action.generation } };
    case "older": {
      const have = new Set((state.messages[action.threadId] ?? []).map((m) => m.id));
      return { ...state, messages: { ...state.messages,
        [action.threadId]: [...action.messages.filter((m) => !have.has(m.id)), ...(state.messages[action.threadId] ?? [])] },
        hasMore: { ...state.hasMore, [action.threadId]: action.hasMore } };
    }
    case "optimistic":
      return { ...state, messages: { ...state.messages, [action.threadId]: [...(state.messages[action.threadId] ?? []), action.message] } };
    case "optimisticFailed":
      return { ...state, messages: { ...state.messages,
        [action.threadId]: (state.messages[action.threadId] ?? []).filter((m) => m.sendId !== action.sendId) } };
    case "frame": {
      const f = action.frame;
      switch (f.kind) {
        case "bot": {
          const exists = state.bots.some((b) => b.id === f.bot.id);
          const bots = exists ? state.bots.map((b) => (b.id === f.bot.id ? f.bot : b)) : [...state.bots, f.bot];
          const selectedId = state.selectedId || f.bot.id;
          // A conversation the bot moved to that we have not loaded yet needs a fetch.
          return { ...state, bots, selectedId };
        }
        case "bot.deleted": {
          const gone = state.bots.find((b) => b.id === f.botId);
          const bots = state.bots.filter((b) => b.id !== f.botId);
          const messages = { ...state.messages };
          for (const t of gone ? threadsOf(gone) : []) delete messages[t];
          return { ...state, bots, messages, selectedId: state.selectedId === f.botId ? (bots[0]?.id ?? "") : state.selectedId };
        }
        case "bots.order": {
          const by = new Map(state.bots.map((b) => [b.id, b]));
          const ordered = f.botIds.map((id) => by.get(id)).filter((b): b is Bot => !!b);
          return { ...state, bots: [...ordered, ...state.bots.filter((b) => !f.botIds.includes(b.id))] };
        }
        case "thread":
          return { ...state, reload: { ...state.reload, [f.threadId]: (state.reload[f.threadId] ?? 0) + 1 } };
        case "message":
          return { ...state, messages: { ...state.messages, [f.threadId]: upsertMessage(state.messages[f.threadId] ?? [], f.message) } };
        case "message.patch":
          return { ...state, messages: { ...state.messages, [f.threadId]: patchMessage(state.messages[f.threadId] ?? [], f.message) } };
        case "message.deleted":
          return { ...state, messages: { ...state.messages, [f.threadId]: (state.messages[f.threadId] ?? []).filter((m) => m.id !== f.messageId) } };
        default:
          return state;
      }
    }
  }
}

const Ctx = createContext<{ state: AppState; dispatch: Dispatch<Action> } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    let dead = false;
    const load = async () => {
      const [b, i] = await Promise.all([
        api<{ bots: Bot[] }>("/api/bots"),
        api<{ instances: InstanceInfo[] }>("/api/instances"),
      ]);
      dispatch({ type: "hydrate", bots: b.bots, instances: i.instances });
    };
    const connect = () => {
      es = new EventSource("/api/events");
      es.onopen = () => {
        tries = 0;
        dispatch({ type: "connected", connected: true });
        load().catch(() => {});
      };
      es.onmessage = (e) => {
        try {
          const frame = JSON.parse(e.data) as ServerFrame;
          if (frame.kind === "instances") api<{ instances: InstanceInfo[] }>("/api/instances").then((r) => dispatch({ type: "instances", instances: r.instances })).catch(() => {});
          dispatch({ type: "frame", frame });
        } catch {
          /* ignore a malformed frame */
        }
      };
      es.onerror = () => {
        es?.close();
        dispatch({ type: "connected", connected: false });
        if (!dead) retry = setTimeout(connect, Math.min(1000 * 2 ** tries++, 10_000));
      };
    };
    connect();
    return () => {
      dead = true;
      clearTimeout(retry);
      es?.close();
    };
  }, []);

  // Fetch the transcript of the conversation on screen, again after a reconnect or a branch switch.
  const bot = state.bots.find((b) => b.id === state.selectedId);
  const threadId = bot?.threadId ?? "";
  const generation = (state.reload[threadId] ?? 0) + (state.connected ? 1 : 0) * 1000;
  const botId = bot?.id;
  useEffect(() => {
    if (!threadId || !botId || !state.connected) return;
    let cancelled = false;
    api<{ messages: Message[]; hasMore: boolean }>(`/api/bots/${botId}/messages?thread=${threadId}`)
      .then((r) => !cancelled && dispatch({ type: "history", threadId, messages: r.messages, hasMore: r.hasMore, generation }))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [threadId, botId, generation, state.connected]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}
