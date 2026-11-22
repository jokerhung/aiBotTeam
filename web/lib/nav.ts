import { BookOpen, Bot, CalendarClock, FileText, Folders, Inbox, LayoutDashboard, MessagesSquare, Plug, RadioTower, Sparkles, Workflow, type LucideIcon } from "lucide-react";

/** Every page of the workspace layout. `chat` and `project` keep the chat list beside them; the others use the whole width. */
export type View =
  | "chat" | "dashboard" | "inbox" | "project" | "section" | "projects"
  | "agents" | "workflows" | "routines"
  | "bases" | "documents" | "skills"
  | "apps" | "input" | "team-map";

export const VIEWS: readonly View[] = ["chat", "dashboard", "inbox", "project", "section", "projects", "agents", "workflows", "routines", "bases", "documents", "skills", "apps", "input", "team-map"];
export const isView = (v: unknown): v is View => typeof v === "string" && (VIEWS as readonly string[]).includes(v);
/** The views that show the chat list as a second column (a project shows the same list, only with its own bots). */
export const hasChatList = (v: View) => v === "chat" || v === "project" || v === "section";

export interface NavItem {
  view: View;
  /** English label; the Vietnamese dictionary translates it. */
  label: string;
  icon: LucideIcon;
  /** Nothing is built behind this item yet: it opens an empty page. */
  placeholder?: boolean;
  testid: string;
}

export interface NavGroup { label?: string; items: NavItem[] }

/** The main menu, in one place: adding a page later is one line here. Projects are listed by the rail itself (the rooms), so they are not in this table. */
export const NAV: NavGroup[] = [
  { items: [
    { view: "dashboard", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
    { view: "chat", label: "Chat", icon: MessagesSquare, testid: "nav-chat" },
    { view: "inbox", label: "Inbox", icon: Inbox, testid: "nav-inbox" },
  ] },
  { label: "Build", items: [
    { view: "agents", label: "Agents", icon: Bot, testid: "nav-agents" },
    { view: "workflows", label: "Workflows", icon: Workflow, placeholder: true, testid: "nav-workflows" },
    { view: "routines", label: "Routines", icon: CalendarClock, testid: "nav-routines" },
  ] },
  { label: "Knowledge", items: [
    { view: "bases", label: "Knowledge bases", icon: BookOpen, placeholder: true, testid: "nav-bases" },
    { view: "documents", label: "Documents", icon: FileText, placeholder: true, testid: "nav-documents" },
    { view: "skills", label: "Skills", icon: Sparkles, testid: "nav-skills" },
  ] },
  { label: "Connect", items: [
    { view: "apps", label: "Apps", icon: Plug, testid: "nav-apps" },
    { view: "input", label: "Input", icon: RadioTower, testid: "nav-input" },
  ] },
];

/** `g` then a letter opens a page (like Gmail's go-to keys). */
export const GO_KEYS: Record<string, View> = {
  d: "dashboard", c: "chat", i: "inbox", p: "projects", a: "agents", w: "workflows", r: "routines",
  b: "bases", o: "documents", s: "skills", n: "apps", u: "input",
};

export const PROJECTS_ITEM: NavItem = { view: "projects", label: "All projects", icon: Folders, testid: "nav-projects" };

export const itemOf = (view: View): NavItem | undefined => [...NAV.flatMap((g) => g.items), PROJECTS_ITEM].find((i) => i.view === view);

/** `#/chat/<bot id>`, `#/project/<room id>`, `#/section/<section id>`, `#/agents` … The app is one static page, so the route lives in the hash. */
export function toHash(view: View, id?: string): string {
  return `#/${view}${id && (view === "chat" || view === "project" || view === "section") ? `/${encodeURIComponent(id)}` : ""}`;
}

export function parseHash(hash: string): { view: View; id?: string } | null {
  const m = /^#\/([a-z-]+)(?:\/([^/?#]+))?\/?$/.exec(hash);
  if (!m || !isView(m[1])) return null;
  let id: string | undefined;
  try { id = m[2] ? decodeURIComponent(m[2]) : undefined; } catch { id = undefined; }
  return { view: m[1], id };
}
