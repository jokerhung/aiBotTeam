"use client";
import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import { api } from "./api";
import type { Bot, InstanceInfo, Message, ServerFrame } from "@/lib/wire";

export interface AppState {
  bots: Bot[];
  messages: Record<string, Message[]>;
  hasMore: Record<string, boolean>;
  instances: InstanceInfo[];
  selectedId: string;
  connected: boolean;
  hydrated: boolean;
  drawerOpen: boolean;
  newBotOpen: boolean;
  settingsOpen: boolean;
}

export type Action =
  | { type: "hydrate"; bots: Bot[]; instances: InstanceInfo[] }
  | { type: "connected"; connected: boolean }
  | { type: "select"; id: string }
  | { type: "history"; botId: string; messages: Message[]; hasMore: boolean }
  | { type: "optimistic"; botId: string; message: Message }
  | { type: "optimisticFailed"; botId: string; sendId: string }
  | { type: "drawer"; open: boolean }
  | { type: "newBot"; open: boolean }
  | { type: "settings"; open: boolean }
  | { type: "frame"; frame: ServerFrame };

export const initialState: AppState = {
  bots: [],
  messages: {},
  hasMore: {},
  instances: [],
  selectedId: "",
  connected: false,
  hydrated: false,
  drawerOpen: false,
  newBotOpen: false,
  settingsOpen: false,
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

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate":
      return {
        ...state,
        bots: action.bots,
        instances: action.instances,
        hydrated: true,
        selectedId: action.bots.some((b) => b.id === state.selectedId) ? state.selectedId : (action.bots[0]?.id ?? ""),
      };
    case "connected":
      return { ...state, connected: action.connected };
    case "select":
      return { ...state, selectedId: action.id, drawerOpen: false };
    case "drawer":
      return { ...state, drawerOpen: action.open };
    case "newBot":
      return { ...state, newBotOpen: action.open };
    case "settings":
      return { ...state, settingsOpen: action.open };
    case "history":
      return {
        ...state,
        messages: { ...state.messages, [action.botId]: action.messages },
        hasMore: { ...state.hasMore, [action.botId]: action.hasMore },
      };
    case "optimistic":
      return {
        ...state,
        messages: { ...state.messages, [action.botId]: [...(state.messages[action.botId] ?? []), action.message] },
      };
    case "optimisticFailed":
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.botId]: (state.messages[action.botId] ?? []).filter((m) => m.sendId !== action.sendId),
        },
      };
    case "frame": {
      const f = action.frame;
      switch (f.kind) {
        case "bot": {
          const exists = state.bots.some((b) => b.id === f.bot.id);
          const bots = exists ? state.bots.map((b) => (b.id === f.bot.id ? f.bot : b)) : [...state.bots, f.bot];
          return { ...state, bots, selectedId: state.selectedId || f.bot.id };
        }
        case "bot.deleted": {
          const bots = state.bots.filter((b) => b.id !== f.botId);
          const messages = { ...state.messages };
          delete messages[f.botId];
          return {
            ...state,
            bots,
            messages,
            selectedId: state.selectedId === f.botId ? (bots[0]?.id ?? "") : state.selectedId,
          };
        }
        case "bots.order": {
          const by = new Map(state.bots.map((b) => [b.id, b]));
          const ordered = f.botIds.map((id) => by.get(id)).filter((b): b is Bot => !!b);
          return { ...state, bots: [...ordered, ...state.bots.filter((b) => !f.botIds.includes(b.id))] };
        }
        case "message":
          return {
            ...state,
            messages: { ...state.messages, [f.botId]: upsertMessage(state.messages[f.botId] ?? [], f.message) },
          };
        case "message.patch":
          return {
            ...state,
            messages: {
              ...state.messages,
              [f.botId]: (state.messages[f.botId] ?? []).map((m) => (m.id === f.message.id ? { ...m, ...f.message } : m)),
            },
          };
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
          dispatch({ type: "frame", frame: JSON.parse(e.data) as ServerFrame });
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

  const sel = state.selectedId;
  useEffect(() => {
    if (!sel) return;
    api<{ messages: Message[]; hasMore: boolean }>(`/api/bots/${sel}/messages`)
      .then((r) => dispatch({ type: "history", botId: sel, messages: r.messages, hasMore: r.hasMore }))
      .catch(() => {});
  }, [sel, state.connected]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}
