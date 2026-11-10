export type MausColor =
  | "green" | "blue" | "red" | "orange" | "purple" | "cyan" | "pink" | "yellow" | "teal" | "coral" | "silver" | "chrome";

export interface ModelSelection {
  instanceId: string;
  model: string;
  effort?: string | null;
}

export interface Task {
  threadId: string;
  title: string;
  busy: boolean;
  pinned: boolean;
  closed: boolean;
  at: number;
  main: boolean;
}

export interface Bot {
  id: string;
  threadId: string;
  mainThreadId: string;
  name: string;
  title: string;
  description: string;
  color: MausColor;
  notifications: boolean;
  unread: boolean;
  busy: boolean;
  threadBusy: boolean;
  activity: "working" | "waiting-on-you" | "idle" | "no-signal" | "dead";
  turnStartedAt: number | null;
  statusLine: string | null;
  modelSelection: ModelSelection;
  pinned: boolean;
  hidden: boolean;
  section: string | null;
  cwd: string | null;
  lastText: string;
  lastAt: number | null;
  readAt: number;
  tasks: Task[];
  usage: { input?: number; output?: number; turns?: number; cost?: number };
}

export interface ToolInfo {
  name: string;
  itemId?: string | null;
  ok: boolean | null;
  summary: string;
  input: string;
  output: string;
}

export interface ErrorInfo {
  setup: boolean;
  terminal: boolean;
  limit?: string | null;
  limitResetsAt?: number | null;
}

export interface Message {
  id: string;
  role: "bot" | "user";
  kind: "text" | "activity" | "error" | "stopped" | "notice";
  text: string;
  at: number;
  sendId?: string | null;
  parentId?: string | null;
  streaming?: boolean;
  queued?: boolean;
  steered?: boolean;
  tool?: ToolInfo | null;
  error?: ErrorInfo | null;
  siblings?: string[];
  pending?: boolean;
}

export type ServerFrame =
  | { kind: "config"; [k: string]: unknown }
  | { kind: "instances" }
  | { kind: "bot"; bot: Bot }
  | { kind: "bot.deleted"; botId: string }
  | { kind: "bots.order"; botIds: string[] }
  | { kind: "thread"; botId: string; threadId: string; activeLeafId: string }
  | { kind: "message"; botId: string; threadId: string; message: Message }
  | { kind: "message.patch"; botId: string; threadId: string; message: Partial<Message> & { id: string } }
  | { kind: "message.deleted"; botId: string; threadId: string; messageId: string };

export interface ModelOption {
  id: string;
  label: string;
  default?: boolean;
}

export interface InstanceInfo {
  id: string;
  driver: string;
  displayName: string;
  enabled: boolean;
  hidden: boolean;
  snapshot: { state: "available" | "unavailable"; version?: string | null; reason?: string | null; signedIn?: boolean | null };
  models: ModelOption[];
  capabilities: { effortLevels?: string[]; queueing?: boolean; images?: boolean };
}
