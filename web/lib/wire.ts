export type MausColor =
  | "green" | "blue" | "red" | "orange" | "purple" | "cyan" | "pink" | "yellow" | "teal" | "coral" | "silver" | "chrome";

export interface ModelSelection {
  instanceId: string;
  model: string;
  effort?: string | null;
}

export interface Bot {
  id: string;
  threadId: string;
  name: string;
  title: string;
  description: string;
  color: MausColor;
  notifications: boolean;
  unread: boolean;
  busy: boolean;
  activity: "working" | "waiting-on-you" | "idle" | "no-signal" | "dead";
  turnStartedAt: number | null;
  modelSelection: ModelSelection;
  pinned: boolean;
  hidden: boolean;
  section: string | null;
  lastText: string;
  lastAt: number | null;
}

export interface Message {
  id: string;
  role: "bot" | "user";
  kind: "text" | "activity";
  text: string;
  at: number;
  sendId?: string | null;
  streaming?: boolean;
  pending?: boolean;
}

export type ServerFrame =
  | { kind: "config"; [k: string]: unknown }
  | { kind: "bot"; bot: Bot }
  | { kind: "bot.deleted"; botId: string }
  | { kind: "bots.order"; botIds: string[] }
  | { kind: "message"; botId: string; threadId: string; message: Message }
  | { kind: "message.patch"; botId: string; threadId: string; message: Partial<Message> & { id: string } };

export interface InstanceInfo {
  id: string;
  driver: string;
  displayName: string;
  snapshot: { state: "available" | "unavailable"; version?: string };
  models: { id: string; label: string; default?: boolean }[];
}
