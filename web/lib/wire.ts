export type MausColor =
  | "green" | "blue" | "red" | "orange" | "purple" | "cyan" | "pink" | "yellow" | "teal" | "coral" | "silver" | "chrome";

export interface ModelSelection {
  instanceId: string;
  model: string;
  effort?: string | null;
}

export type ApprovalMode = "ask" | "edits" | "auto" | "full";
export const APPROVAL_MODES: { id: ApprovalMode; label: string; hint: string }[] = [
  { id: "ask", label: "Ask", hint: "Ask before running commands or editing files" },
  { id: "edits", label: "Edits", hint: "Edit files freely, ask before commands" },
  { id: "auto", label: "Auto", hint: "Run safe read-only commands and edits automatically" },
  { id: "full", label: "Full", hint: "Never ask — full access" },
];

export interface RequestQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: ({ label: string; description?: string } | string)[];
}

export interface RequestInfo {
  id: string;
  type: "permission" | "question";
  tool: string;
  summary: string;
  command?: string | null;
  cwd?: string | null;
  canAlways: boolean;
  status: "open" | "resolved";
  openedAt: number;
  choices: string[];
  questions: RequestQuestion[];
  behavior?: "allow" | "deny" | null;
  source?: "user" | "auto" | "rule" | "expired" | "unavailable" | "system" | null;
  answer?: string | null;
}

export interface Attachment {
  name: string;
  filename: string;
  mime: string;
  size: number;
  image: boolean;
}

export interface Section {
  id: string;
  name: string;
  collapsed: boolean;
}

export interface KeyInfo {
  id: string;
  label: string;
  purpose: string;
}

export interface AppSettings {
  displayName: string;
  uiMode: "simple" | "advanced";
  skin: string;
  font: string;
  chatWidth: "narrow" | "default" | "wide";
  reduceMotion: boolean;
  language: string;
}

export interface AppConfig {
  settings: AppSettings;
  keys: Record<string, { configured: boolean }>;
  keyCatalog: KeyInfo[];
}

export interface SearchHit {
  messageId: string;
  botId: string;
  botName: string;
  threadId: string;
  snippet: string;
  at: number;
  role: string;
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
  approvalMode: ApprovalMode;
  soul: string;
  chief: boolean;
  fallbackSelection: ModelSelection | null;
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
  kind: "text" | "activity" | "error" | "stopped" | "notice" | "request";
  text: string;
  at: number;
  sendId?: string | null;
  parentId?: string | null;
  streaming?: boolean;
  queued?: boolean;
  steered?: boolean;
  tool?: ToolInfo | null;
  error?: ErrorInfo | null;
  request?: RequestInfo | null;
  attachments?: Attachment[];
  siblings?: string[];
  pending?: boolean;
}

export type ServerFrame =
  | ({ kind: "config" } & Partial<AppConfig> & { [k: string]: unknown })
  | { kind: "sections"; sections: Section[] }
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
