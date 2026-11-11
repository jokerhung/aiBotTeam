"use client";
import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import { api } from "./api";
import type { AppConfig, AppSettings, Bot, Group, InboxItem, InstanceInfo, Message, Notification, Routine, RoutineRun, Section, ServerFrame, Webhook, WebhookAttempt } from "@/lib/wire";

export type SettingsPage = "general" | "connections" | "engines" | "appearance";
export const DEFAULT_SETTINGS: AppSettings = {
  displayName: "", uiMode: "simple", skin: "daylight", font: "skin", chatWidth: "default", reduceMotion: false, language: "en",
};

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
  settingsPage: SettingsPage;
  config: AppConfig;
  /** False until the server has answered: the default settings must never be applied to the page. */
  configLoaded: boolean;
  sections: Section[];
  panelBotId: string | null;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  findOpen: boolean;
  /** Message to scroll to and highlight after a search hit. */
  focusMessage: { threadId: string; messageId: string } | null;
  selecting: boolean;
  picked: string[];
  /** When the person last read the selected bot, captured as it was opened: the unread divider sits after it. */
  dividerAt: Record<string, number>;
  groups: Group[];
  /** A room on screen (instead of a bot) when set. */
  selectedGroupId: string;
  groupPanelId: string | null;
  newGroupOpen: boolean;
  automationsOpen: boolean;
  teamMapOpen: boolean;
  notifOpen: boolean;
  notifPinned: boolean;
  inboxOpen: boolean;
  routines: Routine[];
  runs: RoutineRun[];
  webhooks: Webhook[];
  attempts: Record<string, WebhookAttempt[]>;
  notifications: Notification[];
  inbox: InboxItem[];
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
  | { type: "settings"; open: boolean; page?: SettingsPage }
  | { type: "config"; config: AppConfig }
  | { type: "sections"; sections: Section[] }
  | { type: "panel"; botId: string | null }
  | { type: "palette"; open: boolean }
  | { type: "shortcuts"; open: boolean }
  | { type: "find"; open: boolean }
  | { type: "focusMessage"; target: AppState["focusMessage"] }
  | { type: "selecting"; on: boolean }
  | { type: "pick"; id: string }
  | { type: "selectGroup"; id: string }
  | { type: "groupPanel"; id: string | null }
  | { type: "newGroup"; open: boolean }
  | { type: "automations"; open: boolean }
  | { type: "teamMap"; open: boolean }
  | { type: "notifPanel"; open?: boolean; pinned?: boolean }
  | { type: "inboxPanel"; open: boolean }
  | { type: "teamData"; groups?: Group[]; routines?: Routine[]; runs?: RoutineRun[]; webhooks?: Webhook[]; notifications?: Notification[]; inbox?: InboxItem[] }
  | { type: "attempts"; webhookId: string; attempts: WebhookAttempt[] }
  | { type: "frame"; frame: ServerFrame };

export const initialState: AppState = {
  bots: [], messages: {}, hasMore: {}, loaded: {}, reload: {}, instances: [], selectedId: "", connected: false,
  hydrated: false, drawerOpen: false, newBotOpen: false, settingsOpen: false, dividerAt: {},
  groups: [], selectedGroupId: "", groupPanelId: null, newGroupOpen: false, automationsOpen: false, teamMapOpen: false, notifOpen: false, notifPinned: false, inboxOpen: false,
  routines: [], runs: [], webhooks: [], attempts: {}, notifications: [], inbox: [],
  settingsPage: "general", config: { settings: DEFAULT_SETTINGS, keys: {}, keyCatalog: [] }, configLoaded: false, sections: [], panelBotId: null,
  paletteOpen: false, shortcutsOpen: false, findOpen: false, focusMessage: null, selecting: false, picked: [],
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
      return { ...state, selectedId: action.id, selectedGroupId: "", automationsOpen: false, teamMapOpen: false, inboxOpen: false, drawerOpen: false, findOpen: false, panelBotId: state.panelBotId === action.id ? state.panelBotId : null,
        dividerAt: { ...state.dividerAt, [action.id]: bot?.readAt ?? 0 } };
    }
    case "selectGroup":
      return { ...state, selectedGroupId: action.id, automationsOpen: false, teamMapOpen: false, inboxOpen: false, drawerOpen: false, findOpen: false, groupPanelId: state.groupPanelId === action.id ? action.id : null,
        dividerAt: { ...state.dividerAt, [action.id]: state.groups.find((g) => g.id === action.id)?.readAt ?? 0 } };
    case "groupPanel":
      return { ...state, groupPanelId: action.id };
    case "newGroup":
      return { ...state, newGroupOpen: action.open };
    case "automations":
      return { ...state, automationsOpen: action.open, teamMapOpen: false, inboxOpen: false, drawerOpen: false };
    case "teamMap":
      return { ...state, teamMapOpen: action.open, automationsOpen: false, inboxOpen: false, drawerOpen: false };
    case "notifPanel":
      return { ...state, notifOpen: action.open ?? state.notifOpen, notifPinned: action.pinned ?? state.notifPinned };
    case "inboxPanel":
      return { ...state, inboxOpen: action.open, automationsOpen: false, teamMapOpen: false, drawerOpen: false };
    case "teamData":
      return { ...state, groups: action.groups ?? state.groups, routines: action.routines ?? state.routines, runs: action.runs ?? state.runs,
        webhooks: action.webhooks ?? state.webhooks, notifications: action.notifications ?? state.notifications, inbox: action.inbox ?? state.inbox };
    case "attempts":
      return { ...state, attempts: { ...state.attempts, [action.webhookId]: action.attempts } };
    case "drawer":
      return { ...state, drawerOpen: action.open };
    case "newBot":
      return { ...state, newBotOpen: action.open };
    case "settings":
      return { ...state, settingsOpen: action.open, settingsPage: action.page ?? state.settingsPage };
    case "config":
      return { ...state, config: action.config, configLoaded: true };
    case "sections":
      return { ...state, sections: action.sections };
    case "panel":
      return { ...state, panelBotId: action.botId };
    case "palette":
      return { ...state, paletteOpen: action.open };
    case "shortcuts":
      return { ...state, shortcutsOpen: action.open };
    case "find":
      return { ...state, findOpen: action.open };
    case "focusMessage":
      return { ...state, focusMessage: action.target };
    case "selecting":
      return { ...state, selecting: action.on, picked: [] };
    case "pick":
      return { ...state, picked: state.picked.includes(action.id) ? state.picked.filter((x) => x !== action.id) : [...state.picked, action.id] };
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
        case "sections":
          return { ...state, sections: f.sections };
        case "config":
          return f.settings ? { ...state, configLoaded: true, config: { settings: { ...DEFAULT_SETTINGS, ...f.settings }, keys: f.keys ?? {}, keyCatalog: f.keyCatalog ?? [] } } : state;
        case "thread":
          return { ...state, reload: { ...state.reload, [f.threadId]: (state.reload[f.threadId] ?? 0) + 1 } };
        case "message":
          return { ...state, messages: { ...state.messages, [f.threadId]: upsertMessage(state.messages[f.threadId] ?? [], f.message) } };
        case "message.patch":
          return { ...state, messages: { ...state.messages, [f.threadId]: patchMessage(state.messages[f.threadId] ?? [], f.message) } };
        case "message.deleted":
          return { ...state, messages: { ...state.messages, [f.threadId]: (state.messages[f.threadId] ?? []).filter((m) => m.id !== f.messageId) } };
        case "group": {
          const exists = state.groups.some((g) => g.id === f.group.id);
          return { ...state, groups: exists ? state.groups.map((g) => (g.id === f.group.id ? f.group : g)) : [...state.groups, f.group] };
        }
        case "group.deleted":
          return { ...state, groups: state.groups.filter((g) => g.id !== f.groupId), selectedGroupId: state.selectedGroupId === f.groupId ? "" : state.selectedGroupId,
            groupPanelId: state.groupPanelId === f.groupId ? null : state.groupPanelId };
        case "routine": {
          const exists = state.routines.some((r) => r.id === f.routine.id);
          return { ...state, routines: exists ? state.routines.map((r) => (r.id === f.routine.id ? f.routine : r)) : [...state.routines, f.routine] };
        }
        case "routine.deleted":
          return { ...state, routines: state.routines.filter((r) => r.id !== f.routineId), runs: state.runs.filter((r) => r.routineId !== f.routineId) };
        case "routine.run": {
          const exists = state.runs.some((r) => r.id === f.run.id);
          return { ...state, runs: exists ? state.runs.map((r) => (r.id === f.run.id ? f.run : r)) : [f.run, ...state.runs] };
        }
        case "webhook": {
          const exists = state.webhooks.some((w) => w.id === f.webhook.id);
          return { ...state, webhooks: exists ? state.webhooks.map((w) => (w.id === f.webhook.id ? f.webhook : w)) : [...state.webhooks, f.webhook] };
        }
        case "webhook.deleted":
          return { ...state, webhooks: state.webhooks.filter((w) => w.id !== f.webhookId) };
        case "webhook.attempt":
          return { ...state, attempts: { ...state.attempts, [f.attempt.webhookId]: [f.attempt, ...(state.attempts[f.attempt.webhookId] ?? [])].slice(0, 100) } };
        case "notify":
          return { ...state, notifications: [f.notification, ...state.notifications.filter((n) => n.id !== f.notification.id)].slice(0, 300) };
        case "notifications.read":
          return { ...state, notifications: f.cleared ? [] : state.notifications.map((n) => (f.ids.includes(n.id) ? { ...n, read: true } : n)) };
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
      const [b, i, c, sec] = await Promise.all([
        api<{ bots: Bot[] }>("/api/bots"),
        api<{ instances: InstanceInfo[] }>("/api/instances"),
        api<AppConfig>("/api/config"),
        api<{ sections: Section[] }>("/api/sidebar-sections"),
      ]);
      dispatch({ type: "hydrate", bots: b.bots, instances: i.instances });
      dispatch({ type: "config", config: { settings: { ...DEFAULT_SETTINGS, ...c.settings }, keys: c.keys, keyCatalog: c.keyCatalog } });
      dispatch({ type: "sections", sections: sec.sections });
      const [g, r, ru, w, n, ib] = await Promise.all([
        api<{ groups: Group[] }>("/api/groups").catch(() => ({ groups: [] as Group[] })),
        api<{ routines: Routine[] }>("/api/routines").catch(() => ({ routines: [] as Routine[] })),
        api<{ runs: RoutineRun[] }>("/api/routine-runs").catch(() => ({ runs: [] as RoutineRun[] })),
        api<{ webhooks: Webhook[] }>("/api/webhooks").catch(() => ({ webhooks: [] as Webhook[] })),
        api<{ notifications: Notification[] }>("/api/notifications").catch(() => ({ notifications: [] as Notification[] })),
        api<{ items: InboxItem[] }>("/api/inbox").catch(() => ({ items: [] as InboxItem[] })),
      ]);
      dispatch({ type: "teamData", groups: g.groups, routines: r.routines, runs: ru.runs, webhooks: w.webhooks, notifications: n.notifications, inbox: ib.items });
    };
    let inboxTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshInbox = () => {
      clearTimeout(inboxTimer);
      inboxTimer = setTimeout(() => api<{ items: InboxItem[] }>("/api/inbox").then((r) => dispatch({ type: "teamData", inbox: r.items })).catch(() => {}), 250);
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
          // the inbox follows the cards: a frame that may open or close one refreshes it, lightly
          if (["message", "message.patch", "bot", "group"].includes(frame.kind)) refreshInbox();
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

  const group = state.groups.find((g) => g.id === state.selectedGroupId);
  const gThread = group?.threadId ?? "";
  const gGeneration = (state.reload[gThread] ?? 0) + (state.connected ? 1 : 0) * 1000;
  const gId = group?.id;
  useEffect(() => {
    if (!gThread || !gId || !state.connected) return;
    let cancelled = false;
    api<{ messages: Message[]; hasMore: boolean }>(`/api/groups/${gId}/messages?thread=${gThread}`)
      .then((r) => !cancelled && dispatch({ type: "history", threadId: gThread, messages: r.messages, hasMore: r.hasMore, generation: gGeneration }))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [gThread, gId, gGeneration, state.connected]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}
