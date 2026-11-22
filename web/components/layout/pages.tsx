"use client";
import { Bot as BotIcon, FileUp, Folders, Hash, Inbox as InboxIcon, LayoutDashboard, Pencil, Plug, Plus, RadioTower, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Skill } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { ConnectedApps } from "../ConnectedApps";
import { InputChannels } from "../InputChannels";
import { Mascot } from "../Mascot";
import { InboxPanel } from "../NotificationsPanel";
import { UsagePage } from "../Observe";
import { SkillEditor } from "../SkillsSection";
import { PageFrame } from "./PageFrame";

const PRIMARY = "flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-[13.5px] font-medium text-[var(--color-accent-ink)]";
const SECOND = "flex h-9 items-center gap-1.5 rounded-full bg-raised px-3.5 text-[13.5px] font-medium text-ink hover:bg-raised-hover";

export function DashboardPage() {
  const { state } = useStore();
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

const MODES: Record<string, string> = { ask: "Ask", edits: "Edits", auto: "Auto", full: "Full" };

export function AgentsPage() {
  const { state, dispatch } = useStore();
  const t = useT();
  const bots = state.bots.filter((b) => !b.hidden);
  const open = (id: string, profile: boolean) => { dispatch({ type: "select", id }); if (profile) dispatch({ type: "panel", botId: id, profile: true }); };
  return (
    <PageFrame title="Agents" icon={BotIcon} description="Every bot: its model, approval level and working folder." wide testid="page-agents"
      actions={<>
        <button type="button" data-testid="agents-import" onClick={() => dispatch({ type: "importBot", open: true })} className={SECOND}><FileUp size={14} /> {t("Import bot")}</button>
        <button type="button" data-testid="agents-new" onClick={() => dispatch({ type: "newBot", open: true })} className={PRIMARY}><Plus size={14} /> {t("New bot")}</button>
      </>}>
      {bots.length === 0 && <div className="py-16 text-center text-[13.5px] text-ink-tertiary">{t("No bots yet.")}</div>}
      <div className="overflow-hidden rounded-xl ring-1 ring-ink/10" data-testid="agents-table">
        {bots.map((b) => (
          <div key={b.id} data-testid="agent-row" className="flex items-center gap-3 border-b-[0.5px] border-edge px-4 py-3 last:border-0 hover:bg-raised/40">
            <Mascot color={b.color} size={34} busy={b.busy} />
            <button type="button" onClick={() => open(b.id, false)} className="min-w-0 flex-1 text-left">
              <div data-no-i18n="" className="truncate text-[14.5px] font-medium text-ink">{b.name}</div>
              <div data-no-i18n="" className="truncate text-[12.5px] text-ink-tertiary">{b.title || b.description || "—"}</div>
            </button>
            <span data-no-i18n="" className="hidden w-[180px] truncate text-[12.5px] text-ink-secondary lg:block" title={b.modelSelection.model}>{b.modelSelection.instanceId} · {b.modelSelection.model}</span>
            <span className="w-[56px] text-[12.5px] text-ink-secondary">{t(MODES[b.approvalMode] ?? b.approvalMode)}</span>
            <span data-no-i18n="" className="hidden w-[200px] truncate text-[12px] text-ink-tertiary xl:block" title={b.cwd ?? ""}>{b.cwd ?? ""}</span>
            <button type="button" title={t("Edit Profile")} aria-label={`${t("Edit Profile")}: ${b.name}`} onClick={() => open(b.id, true)} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><Pencil size={14} /></button>
          </div>
        ))}
      </div>
    </PageFrame>
  );
}

export function ProjectsPage() {
  const { state, dispatch } = useStore();
  const t = useT();
  const groups = state.groups.filter((g) => !g.hidden);
  const sections = state.sections.map((x) => ({ ...x, bots: state.bots.filter((b) => !b.hidden && b.section === x.id) }));
  const card = "flex items-center gap-3 rounded-xl bg-raised/50 px-4 py-3 text-left ring-1 ring-ink/[0.06] hover:bg-raised";
  const badge = () => <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-panel text-ink-secondary"><Hash size={17} /></span>;
  return (
    <PageFrame title="All projects" icon={Folders} description="Your groups of bots, and the rooms where several bots work together." testid="page-projects"
      actions={<button type="button" data-testid="projects-new" onClick={() => dispatch({ type: "newGroup", open: true })} className={PRIMARY}><Plus size={14} /> {t("New room")}</button>}>
      {sections.length === 0 && groups.length === 0 && <div className="py-16 text-center text-[13.5px] text-ink-tertiary">{t("No projects yet. Group your bots in the chat list, or make a room where several bots work together.")}</div>}
      {sections.length > 0 && (
        <>
          <h2 className="mb-2 text-[12px] font-medium text-ink-tertiary">{t("Groups of bots")}</h2>
          <div className="mb-5 grid gap-2 md:grid-cols-2" data-testid="sections-list">
            {sections.map((x) => (
              <button key={x.id} type="button" data-testid="section-card" onClick={() => dispatch({ type: "openSection", id: x.id })} className={card}>
                {badge()}
                <span className="min-w-0 flex-1">
                  <span data-no-i18n="" className="block truncate text-[14.5px] font-medium text-ink">{x.name}</span>
                  <span data-no-i18n="" className="block truncate text-[12.5px] text-ink-tertiary">{x.bots.map((b) => b.name).join(", ") || "—"}</span>
                </span>
                <span className="text-[12px] tabular-nums text-ink-tertiary">{x.bots.length}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {groups.length > 0 && (
        <>
          <h2 className="mb-2 text-[12px] font-medium text-ink-tertiary">{t("Rooms")}</h2>
          <div className="grid gap-2 md:grid-cols-2" data-testid="projects-list">
            {groups.map((g) => (
              <button key={g.id} type="button" data-testid="project-card" onClick={() => dispatch({ type: "selectGroup", id: g.id })} className={card}>
                {badge()}
                <span className="min-w-0 flex-1">
                  <span data-no-i18n="" className="block truncate text-[14.5px] font-medium text-ink">{g.name}</span>
                  <span data-no-i18n="" className="block truncate text-[12.5px] text-ink-tertiary">{g.memberInfo.map((m) => m.name).join(", ") || "—"}</span>
                </span>
                {g.unread && <span aria-label={t("Unread")} className="size-2 shrink-0 rounded-full bg-accent" />}
              </button>
            ))}
          </div>
        </>
      )}
    </PageFrame>
  );
}

export function SkillsPage() {
  const t = useT();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editing, setEditing] = useState<Skill | "new" | null>(null);
  const load = useCallback(() => api<{ skills: Skill[] }>("/api/skills").then((r) => setSkills(r.skills)).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);
  return (
    <PageFrame title="Skills" icon={Sparkles} description="Instructions a bot follows when they fit the task. Give them to a bot in its settings." testid="page-skills"
      actions={<button type="button" data-testid="new-skill" onClick={() => setEditing("new")} className={PRIMARY}><Plus size={14} /> {t("New skill")}</button>}>
      {skills.length === 0 && <div className="py-16 text-center text-[13.5px] text-ink-tertiary">{t("No skills yet. A skill is a set of instructions the bot follows when it fits the task.")}</div>}
      <div className="flex flex-col gap-1.5" data-testid="skills-list">
        {skills.map((s) => (
          <div key={s.id} data-testid="skill-row" className="rounded-xl bg-raised/50 px-4 py-2.5 ring-1 ring-ink/[0.06]">
            <div className="flex items-center gap-2">
              <span data-no-i18n="" className={cn("min-w-0 flex-1 truncate text-[14.5px] font-medium", !s.enabled && "opacity-50")}>{s.name}</span>
              <button type="button" role="switch" aria-checked={s.enabled} aria-label={`${s.name} ${s.enabled ? "on" : "off"}`}
                onClick={async () => { await api(`/api/skills/${s.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !s.enabled }) }); void load(); }}
                className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", s.enabled ? "bg-accent" : "bg-ink/20")}><span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-all", s.enabled ? "left-[18px]" : "left-0.5")} /></button>
              <button type="button" title={t("Edit")} aria-label={t("Edit")} onClick={() => setEditing(s)} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><Pencil size={14} /></button>
              <button type="button" title={t("Delete")} aria-label={t("Delete")} onClick={async () => { if (confirm(t("Delete this skill?"))) { await api(`/api/skills/${s.id}`, { method: "DELETE" }); void load(); } }} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><Trash2 size={14} /></button>
            </div>
            {s.description && <div data-no-i18n="" className="mt-0.5 truncate text-[12.5px] text-ink-tertiary">{s.description}</div>}
          </div>
        ))}
      </div>
      {editing && <SkillEditor key={editing === "new" ? "new" : editing.id} skill={editing === "new" ? null : editing} onClose={() => { setEditing(null); void load(); }} />}
    </PageFrame>
  );
}

export function AppsPage() {
  return (
    <PageFrame title="Apps" icon={Plug} description="Connect Gmail, Sheets, Slack and more, or add your own MCP servers." testid="page-apps">
      <div className="flex min-h-[70vh] flex-col"><ConnectedApps tabs={["apps", "mcp"]} /></div>
    </PageFrame>
  );
}

export function InputPage() {
  return (
    <PageFrame title="Input" icon={RadioTower} description="Telegram and Zalo: where people write to your bots." testid="page-input">
      <div className="flex min-h-[70vh] flex-col"><InputChannels /></div>
    </PageFrame>
  );
}
