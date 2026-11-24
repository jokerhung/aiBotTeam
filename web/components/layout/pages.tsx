"use client";
import { ArrowRight, Folders, Hash, Inbox as InboxIcon, LayoutDashboard, Pencil, Plug, Plus, RadioTower } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { Bot, Group, Section } from "@/lib/wire";
import { useStore } from "@/state/store";
import { ConnectedApps } from "../ConnectedApps";
import { InputChannels } from "../InputChannels";
import { GroupActionsButton } from "../BotContextMenu";
import { InboxPanel } from "../NotificationsPanel";
import { UsagePage } from "../Observe";
import { PageFrame } from "./PageFrame";

const PRIMARY = "flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-[13.5px] font-medium text-[var(--color-accent-ink)]";

const CARD = "flex items-center gap-3 rounded-xl bg-raised/50 px-4 py-3 text-left ring-1 ring-ink/[0.06] hover:bg-raised";
const Badge = () => <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-panel text-ink-secondary"><Hash size={17} /></span>;

function SectionCard({ section, bots }: { section: Section; bots: Bot[] }) {
  const { dispatch } = useStore();
  return (
    <button type="button" data-testid="section-card" onClick={() => dispatch({ type: "openSection", id: section.id })} className={CARD}>
      <Badge />
      <span className="min-w-0 flex-1">
        <span data-no-i18n="" className="block truncate text-[14.5px] font-medium text-ink">{section.name}</span>
        <span data-no-i18n="" className="block truncate text-[12.5px] text-ink-tertiary">{bots.map((b) => b.name).join(", ") || "—"}</span>
      </span>
      <span className="text-[12px] tabular-nums text-ink-tertiary">{bots.length}</span>
    </button>
  );
}

function RoomCard({ group: g }: { group: Group }) {
  const { dispatch } = useStore();
  const t = useT();
  return (
    <article data-testid="project-card" className="group relative flex items-center gap-3 rounded-xl bg-raised/50 px-4 py-3 ring-1 ring-ink/[0.06] hover:bg-raised">
      <button type="button" aria-label={`${t("Open")}: ${g.name}`} onClick={() => dispatch({ type: "selectGroup", id: g.id })} className="absolute inset-0 rounded-xl focus-visible:ring-2 focus-visible:ring-accent" />
      <Badge />
      <span className="pointer-events-none min-w-0 flex-1">
        <span data-no-i18n="" className="block truncate text-[14.5px] font-medium text-ink">{g.name}</span>
        <span data-no-i18n="" className="block truncate text-[12.5px] text-ink-tertiary">{g.memberInfo.map((m) => m.name).join(", ") || "—"}</span>
      </span>
      {g.unread && <span aria-label={t("Unread")} className="pointer-events-none size-2 shrink-0 rounded-full bg-accent" />}
      <span className="relative flex shrink-0 items-center gap-1">
        <button type="button" data-testid="edit-team" title={t("Edit team")} aria-label={`${t("Edit team")}: ${g.name}`}
          onClick={() => { dispatch({ type: "selectGroup", id: g.id }); dispatch({ type: "groupPanel", id: g.id }); }}
          className="flex size-7 items-center justify-center rounded-full text-ink-secondary hover:bg-ink/10 hover:text-ink"><Pencil size={14} /></button>
        <GroupActionsButton group={g} />
      </span>
    </article>
  );
}

/** The projects (rooms and groups of bots) that moved most recently, newest first. */
function recentProjects(groups: Group[], bots: Bot[], sections: Section[], count: number) {
  const items = [
    ...groups.filter((g) => !g.hidden).map((g) => ({ at: g.lastAt ?? 0, node: <RoomCard key={`g-${g.id}`} group={g} /> })),
    ...sections.map((x) => {
      const members = bots.filter((b) => !b.hidden && b.section === x.id);
      return { at: Math.max(0, ...members.map((b) => b.lastAt ?? 0)), node: <SectionCard key={`s-${x.id}`} section={x} bots={members} /> };
    }),
  ];
  return items.sort((p, q) => q.at - p.at).slice(0, count).map((i) => i.node);
}

export function DashboardPage() {
  const { state, dispatch } = useStore();
  const t = useT();
  const bots = state.bots.filter((b) => !b.hidden);
  const tiles: [string, number][] = [
    ["Bots", bots.length],
    ["Working now", bots.filter((b) => b.busy).length],
    ["Waiting on you", state.inbox.length],
    ["Routines", state.routines.length],
  ];
  return (
    <PageFrame title="Dashboard" icon={LayoutDashboard} description="What your bots did and what they cost." testid="page-dashboard">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="dashboard-tiles">
        {tiles.map(([label, n]) => (
          <div key={label} className="rounded-xl bg-raised/60 px-3.5 py-3"><div className="text-[12px] text-ink-tertiary">{t(label)}</div><div className="text-[22px] font-semibold tabular-nums">{n}</div></div>
        ))}
      </div>
      <div className="mt-5" data-testid="dashboard-projects">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[12px] font-medium text-ink-tertiary">{t("Recent projects")}</h2>
          <button type="button" data-testid="all-projects" onClick={() => dispatch({ type: "view", view: "projects" })} className="flex h-8 items-center gap-1 rounded-full px-3 text-[13px] text-ink-secondary hover:bg-ink/10">{t("All projects")} <ArrowRight size={13} /></button>
        </div>
        <div className="grid gap-2 md:grid-cols-3">{recentProjects(state.groups, state.bots, state.sections, 3)}</div>
      </div>
      <div className="mt-5"><UsagePage /></div>
    </PageFrame>
  );
}

export function InboxPage() {
  return (
    <PageFrame title="Inbox" icon={InboxIcon} description="Everything waiting for your answer, from all bots and rooms." testid="page-inbox">
      <div className="flex min-h-[60vh] flex-col"><InboxPanel /></div>
    </PageFrame>
  );
}

export function ProjectsPage() {
  const { state, dispatch } = useStore();
  const t = useT();
  const groups = state.groups.filter((g) => !g.hidden);
  const sections = state.sections.map((x) => ({ ...x, bots: state.bots.filter((b) => !b.hidden && b.section === x.id) }));
  return (
    <PageFrame title="All projects" icon={Folders} description="Your groups of bots, and the rooms where several bots work together." testid="page-projects"
      actions={<button type="button" data-testid="projects-new" onClick={() => dispatch({ type: "newGroup", open: true })} className={PRIMARY}><Plus size={14} /> {t("New room")}</button>}>
      {sections.length === 0 && groups.length === 0 && <div className="py-16 text-center text-[13.5px] text-ink-tertiary">{t("No projects yet. Group your bots in the chat list, or make a room where several bots work together.")}</div>}
      {sections.length > 0 && (
        <>
          <h2 className="mb-2 text-[12px] font-medium text-ink-tertiary">{t("Groups of bots")}</h2>
          <div className="mb-5 grid gap-2 md:grid-cols-2" data-testid="sections-list">
            {sections.map((x) => <SectionCard key={x.id} section={x} bots={x.bots} />)}
          </div>
        </>
      )}
      {groups.length > 0 && (
        <>
          <h2 className="mb-2 text-[12px] font-medium text-ink-tertiary">{t("Rooms")}</h2>
          <div className="grid gap-2 md:grid-cols-2" data-testid="projects-list">
            {groups.map((g) => <RoomCard key={g.id} group={g} />)}
          </div>
        </>
      )}
    </PageFrame>
  );
}

export { SkillsPage } from "../SkillsPage";

export function AppsPage() {
  return (
    <PageFrame title="Apps" icon={Plug} description="Connect Gmail, Sheets, Slack and more, or add your own MCP servers." testid="page-apps">
      <div className="flex min-h-[70vh] flex-col"><ConnectedApps tabs={["apps", "mcp"]} /></div>
    </PageFrame>
  );
}

export function InputPage() {
  return (
    <PageFrame title="Channels" icon={RadioTower} description="Connect the Telegram and Zalo accounts where people write. Each agent decides there which accounts it answers on." testid="page-input">
      <div className="flex min-h-[70vh] flex-col"><InputChannels /></div>
    </PageFrame>
  );
}
