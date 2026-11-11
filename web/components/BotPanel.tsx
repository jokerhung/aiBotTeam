"use client";
/* eslint-disable react-hooks/set-state-in-effect -- these effects hydrate from localStorage or reset form state when a dialog opens or the target changes */
import { Bug, CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, FileText, Folder, ListChecks, Monitor, Play, Plus, RotateCcw, Search, Settings, Share2, Sparkles, SquarePen, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { queuePatch } from "@/lib/patch-queue";
import { locale, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Bot, MausColor, McpServer, ModelSelection } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { ApprovalModeSelector } from "./ApprovalModeSelector";
import { Mascot } from "./Mascot";
import { ActivityPanel, ExportButtons, InspectorPanel } from "./Observe";
import { MemorySection } from "./MemorySection";
import { SkillsSection } from "./SkillsSection";
import { toast } from "./Toaster";

const COLORS: MausColor[] = ["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral", "silver", "chrome"];
type Tab = "details" | "computer" | "library";

/** A text field that saves what you typed shortly after you stop, through the per-bot patch queue. */
function useSaved(bot: Bot, field: "name" | "title" | "description" | "soul" | "cwd", initial: string) {
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(initial);
  useEffect(() => { setValue(initial); latest.current = initial; }, [bot.id, initial]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (v: string) => {
    setValue(v);
    latest.current = v;
    clearTimeout(timer.current);
    if (field === "name" && !v.trim()) return; // a bot always has a name
    timer.current = setTimeout(() => void queuePatch(bot.id, { [field]: field === "cwd" ? (v.trim() || null) : v }), 400);
  };
  const flush = () => {
    clearTimeout(timer.current);
    if (field === "name" && !latest.current.trim()) { setValue(initial); return; }
    if (latest.current !== initial) void queuePatch(bot.id, { [field]: field === "cwd" ? (latest.current.trim() || null) : latest.current });
  };
  return { value, change, flush };
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="px-5 py-2.5">
      <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[12px] text-ink-tertiary">{hint}</div>}
    </div>
  );
}

const INPUT = "w-full rounded-lg bg-inset px-3 text-[14px] text-ink outline-none ring-1 ring-inset ring-ink/[0.07] placeholder:text-ink-tertiary focus:ring-ink/25";

function ModelPicker({ value, onChange, allowNone }: { value: ModelSelection | null; onChange: (s: ModelSelection | null) => void; allowNone?: boolean }) {
  const { state } = useStore();
  const engines = state.instances.filter((i) => !i.hidden && i.enabled && i.snapshot.state === "available");
  const v = value ? `${value.instanceId}::${value.model}` : "";
  return (
    <select value={v} onChange={(e) => {
      if (!e.target.value) return onChange(null);
      const [instanceId, ...m] = e.target.value.split("::");
      onChange({ instanceId, model: m.join("::") });
    }} className={cn(INPUT, "h-10")} aria-label={allowNone ? "Backup model" : "Model"}>
      {allowNone && <option value="">None</option>}
      {engines.map((e) => (
        <optgroup key={e.id} label={e.displayName}>
          {e.models.map((m) => <option key={m.id} value={`${e.id}::${m.id}`}>{m.label}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** Which custom MCP servers and connected apps this bot may use, read or write, and whether sending out asks first. */
function AppsField({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const [servers, setServers] = useState<McpServer[]>([]);
  useEffect(() => { api<{ servers: McpServer[] }>("/api/mcp/servers").then((r) => setServers(r.servers)).catch(() => {}); }, [state.mcpTick]);
  const used = bot.mcpServers ?? [];
  const access = bot.mcpAccess ?? {};
  const setUsed = (id: string, on: boolean) => void queuePatch(bot.id, { mcpServers: on ? [...used, id] : used.filter((x) => x !== id) });
  const setAccess = (id: string, patch: Partial<{ scope: "read" | "write"; outbound: "ask" | "allow" }>) =>
    void queuePatch(bot.id, { mcpAccess: { ...access, [id]: { ...(access[id] ?? { scope: "read" as const, outbound: "ask" as const }), ...patch } } });
  return (
    <Field label="Apps and servers" hint="What this bot may use. Read lets it look; Write lets it change things, and Ask makes it check with you before it sends anything out.">
      {servers.length === 0 && <div className="text-[13px] text-ink-tertiary">No apps are connected yet. Use “Connect apps” at the bottom of the sidebar.</div>}
      <div className="flex flex-col gap-1.5" data-testid="bot-apps">
        {servers.map((s) => {
          const on = used.includes(s.id);
          const acc = access[s.id] ?? { scope: "read", outbound: "ask" };
          return (
            <div key={s.id} className="rounded-lg bg-inset px-3 py-2 ring-1 ring-inset ring-ink/[0.07]">
              <label className="flex items-center gap-2 text-[14px] text-ink">
                <input type="checkbox" checked={on} onChange={(e) => setUsed(s.id, e.target.checked)} aria-label={`Use ${s.name}`} />
                <span data-no-i18n="" className="min-w-0 flex-1 truncate">{s.name}</span>
              </label>
              {on && (
                <div className="mt-1.5 flex gap-2 pl-6 text-[12.5px]">
                  <select value={acc.scope} onChange={(e) => setAccess(s.id, { scope: e.target.value as "read" | "write" })} aria-label={`${s.name} access`} className="rounded-md bg-raised px-2 py-1 text-ink">
                    <option value="read">Read</option><option value="write">Write</option>
                  </select>
                  {acc.scope === "write" && (
                    <select value={acc.outbound} onChange={(e) => setAccess(s.id, { outbound: e.target.value as "ask" | "allow" })} aria-label={`${s.name} sending out`} className="rounded-md bg-raised px-2 py-1 text-ink">
                      <option value="ask">Ask before sending</option><option value="allow">Send without asking</option>
                    </select>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Field>
  );
}

function SettingsForm({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const name = useSaved(bot, "name", bot.name);
  const title = useSaved(bot, "title", bot.title);
  const desc = useSaved(bot, "description", bot.description);
  const soul = useSaved(bot, "soul", bot.soul);
  const cwd = useSaved(bot, "cwd", bot.cwd ?? "");
  const [notifBlocked, setNotifBlocked] = useState(false);
  useEffect(() => { setNotifBlocked(typeof Notification !== "undefined" && Notification.permission === "denied"); }, []);
  return (
    <div className="pb-8">
      <div className="flex flex-col items-center gap-3 px-5 pb-3 pt-4">
        <Mascot color={bot.color} size={88} busy={bot.busy} />
        <div role="radiogroup" aria-label="Mascot color" className="flex flex-wrap justify-center gap-1.5">
          {COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={c === bot.color} aria-label={c} title={c} onClick={() => void queuePatch(bot.id, { color: c })}
              className={cn("size-6 rounded-full ring-offset-2 ring-offset-panel", c === bot.color && "ring-2 ring-ink")} style={{ background: `var(--identity-${c})` }} />
          ))}
        </div>
      </div>
      <Field label="Name"><input value={name.value} onChange={(e) => name.change(e.target.value)} onBlur={name.flush} maxLength={60} aria-label="Name" className={cn(INPUT, "h-10")} /></Field>
      <Field label="Title"><input value={title.value} onChange={(e) => title.change(e.target.value)} onBlur={title.flush} placeholder="e.g. Researcher" aria-label="Title" className={cn(INPUT, "h-10")} /></Field>
      <Field label="Description"><textarea value={desc.value} onChange={(e) => desc.change(e.target.value)} onBlur={desc.flush} rows={2} aria-label="Description" className={cn(INPUT, "resize-none py-2")} /></Field>
      <Field label="Instructions" hint="Always part of what the bot knows about its role. Sent with every turn.">
        <textarea value={soul.value} onChange={(e) => soul.change(e.target.value)} onBlur={soul.flush} rows={5} placeholder="How should this bot behave?" aria-label="Instructions" className={cn(INPUT, "resize-y py-2")} />
      </Field>
      <Field label="Model"><ModelPicker value={bot.modelSelection} onChange={(s) => s && void queuePatch(bot.id, { modelSelection: s })} /></Field>
      <Field label="Backup model" hint="Used when the main model is unavailable."><ModelPicker allowNone value={bot.fallbackSelection} onChange={(s) => void queuePatch(bot.id, { fallbackSelection: s })} /></Field>
      <Field label="Access" hint="What the bot may do without asking you first."><ApprovalModeSelector compact value={bot.approvalMode} onChange={(m) => void queuePatch(bot.id, { approvalMode: m })} /></Field>
      <Field label="Working folder" hint="Where the bot runs commands. Empty uses the server folder.">
        <input value={cwd.value} onChange={(e) => cwd.change(e.target.value)} onBlur={cwd.flush} placeholder="Absolute path" aria-label="Working folder" className={cn(INPUT, "h-10 font-mono text-[13px]")} />
      </Field>
      <Field label="Notifications" hint={notifBlocked ? "Notifications are blocked in this browser." : "Get a browser notification when this bot needs you while the tab is hidden."}>
        <label className="flex items-center gap-2 text-[14px] text-ink">
          <input type="checkbox" checked={bot.notifications} onChange={(e) => {
            void queuePatch(bot.id, { notifications: e.target.checked });
            if (e.target.checked && typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
          }} /> Notify me
        </label>
      </Field>
      <Field label="Reports to" hint="Who this bot answers to. A Chief of Staff can hand work to the bots that report to it.">
        <select value={bot.reportsTo ?? ""} onChange={(e) => void queuePatch(bot.id, { reportsTo: e.target.value || null })} aria-label="Reports to" className={cn(INPUT, "h-10")}>
          <option value="">None</option>
          {state.bots.filter((b) => b.id !== bot.id && !b.hidden).map((b) => <option key={b.id} value={b.id} data-no-i18n="">{b.name}</option>)}
        </select>
      </Field>
      <AppsField bot={bot} />
      <SkillsSection bot={bot} />
      <MemorySection bot={bot} />
      <Field label="Chief of Staff" hint="The Chief answers for you where it may and hands work to the team. Only one bot is Chief; with sections ticked it works only inside them.">
        <label className="flex items-center gap-2 text-[14px] text-ink">
          <input type="checkbox" checked={bot.chief} onChange={(e) => void queuePatch(bot.id, { chief: e.target.checked })} /> Chief of Staff
        </label>
        {bot.chief && state.sections.length > 0 && (
          <div className="mt-2 flex flex-col gap-1" role="group" aria-label="Sections it manages">
            {state.sections.map((sec) => (
              <label key={sec.id} className="flex items-center gap-2 text-[13.5px] text-ink-secondary">
                <input type="checkbox" checked={bot.managedSections?.includes(sec.id) ?? false}
                  onChange={(e) => void queuePatch(bot.id, { managedSections: e.target.checked ? [...(bot.managedSections ?? []), sec.id] : (bot.managedSections ?? []).filter((x) => x !== sec.id) })} />
                <span data-no-i18n="">{sec.name}</span>
              </label>
            ))}
          </div>
        )}
      </Field>
    </div>
  );
}

type View = "overview" | "settings" | "activity" | "inspector" | "routines";

function Row({ icon: Icon, label, right, onClick, chevron }: { icon: typeof Search; label: string; right?: React.ReactNode; onClick?: () => void; chevron?: boolean }) {
  return (
    <button type="button" disabled={!onClick} onClick={onClick}
      className="flex h-[46px] w-full items-center gap-3 rounded-lg px-1 text-left text-[15px] text-ink enabled:hover:bg-ink/[0.05] disabled:text-ink-tertiary">
      <Icon size={16} className="shrink-0 text-ink-secondary" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {right}
      {chevron && <ChevronRight size={15} className="shrink-0 text-ink-tertiary" />}
    </button>
  );
}

function Overview({ bot, go }: { bot: Bot; go: (v: View) => void }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const inst = state.instances.find((i) => i.id === bot.modelSelection.instanceId);
  const modelLabel = inst?.models.find((m) => m.id === bot.modelSelection.model)?.label ?? bot.modelSelection.model;
  const newTask = () => void api(`/api/bots/${bot.id}/tasks`, { method: "POST", body: JSON.stringify({ title: "New task" }) });
  const fresh = async () => {
    try {
      await api(`/api/bots/${bot.id}/fresh?thread=${bot.threadId}`, { method: "POST" });
      toast("Next message starts a fresh session");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not start fresh");
    }
  };
  return (
    <div className="px-[30px] pb-6" data-testid="panel-overview">
      <Row icon={Sparkles} label="Model" right={<span className="max-w-[140px] truncate text-[14px] text-ink-secondary">{modelLabel}</span>} chevron onClick={() => go("settings")} />
      <div className="mt-4 text-[14px] font-medium text-ink-secondary">{t("Conversations")}</div>
      <Row icon={SquarePen} label={t("New conversation")} onClick={newTask} />
      <div className="mt-4 text-[14px] font-medium text-ink-secondary">{t("This conversation")}</div>
      <Row icon={Search} label={t("Find in conversation")} right={<kbd className="rounded border border-hairline px-1.5 text-[11px] text-ink-tertiary">Ctrl F</kbd>} onClick={() => dispatch({ type: "find", open: true })} />
      <Row icon={RotateCcw} label={t("Start fresh")} onClick={fresh} />
      <Row icon={ListChecks} label={t("Activity")} chevron onClick={() => go("activity")} />
      <Row icon={Bug} label={t("Inspector")} chevron onClick={() => go("inspector")} />
      <div className="mt-2 px-1"><div className="mb-1.5 text-[12.5px] text-ink-tertiary">{t("Export transcript")}</div><ExportButtons bot={bot} /></div>
      <div className="mt-4 flex items-center justify-between text-[14px] font-medium text-ink-secondary">
        <span>{t("Routines")}</span>
        <button type="button" onClick={() => go("routines")} className="text-[13px] font-normal text-ink-tertiary hover:text-ink">{t("Manage")}</button>
      </div>
      <Row icon={CalendarPlus} label={t("Add a routine")} onClick={() => go("routines")} />
      <Row icon={CalendarClock} label={t("Automations")} chevron onClick={() => dispatch({ type: "automations", open: true })} />
    </div>
  );
}



export function BotPanel({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const t = useT();
  const [tab, setTab] = useState<Tab>("details");
  const [view, setView] = useState<View>("overview");
  const tabs: { id: Tab; label: string }[] = [
    { id: "details", label: "Details" },
    { id: "library", label: "Library" },
    { id: "computer", label: "Computer" },
  ];
  const sub = tab === "details" && view !== "overview";
  const circle = "flex size-9 items-center justify-center rounded-full bg-card text-ink-secondary shadow-(--shadow-float) ring-[0.5px] ring-ink/10 hover:text-ink";
  return (
    <aside aria-label={`${bot.name} details`} data-testid="bot-panel" className="relative z-20 flex h-full w-[320px] shrink-0 animate-panel-in flex-col border-l-[0.5px] border-edge bg-app max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:w-full">
      <div className="flex h-[58px] shrink-0 items-center justify-end gap-2.5 px-3.5">
        <button type="button" title="Copy a link to this bot" aria-label="Share" onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/?bot=${bot.id}`); toast("Link copied"); }} className={circle}><Share2 size={15} /></button>
        <button type="button" title="Close" aria-label="Close panel" onClick={() => dispatch({ type: "panel", botId: null })} className={circle}><X size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel">
        <div className="flex flex-col items-center px-6 pb-3 pt-[10px] text-center">
          <Mascot color={bot.color} size={52} busy={bot.busy} />
          <div className="mt-[15px] flex max-w-full items-center justify-center gap-1.5">
            <div data-no-i18n="" className="min-w-0 truncate text-[18px] font-semibold leading-6 text-ink">{bot.name}</div>
            <button type="button" title="Bot settings" aria-label="Bot settings" aria-pressed={view === "settings"} onClick={() => { setTab("details"); setView(view === "settings" ? "overview" : "settings"); }}
              className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink", view === "settings" && "bg-ink/10 text-ink")}><Settings size={15} /></button>
          </div>
          {(bot.title || bot.description) && <div data-no-i18n="" className="max-w-full truncate text-[14px] text-ink-secondary">{bot.title || bot.description}</div>}
          <div role="tablist" className="mt-[22px] flex h-8 items-center rounded-full bg-raised p-[3px]" data-testid="panel-tabs">
            {tabs.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => { setTab(x.id); setView("overview"); }}
                className={cn("h-[26px] rounded-full px-[10.5px] text-[13.5px] font-medium", tab === x.id ? "bg-composer text-ink shadow-sm ring-[0.5px] ring-ink/10" : "text-ink-secondary hover:text-ink")}>
                {t(x.label)}
              </button>
            ))}
          </div>
        </div>
        {sub && (
          <div className="px-6 pb-2">
            <button type="button" onClick={() => setView("overview")} className="flex items-center gap-1 rounded-full px-2 py-1 text-[13px] text-ink-secondary hover:bg-ink/10 hover:text-ink"><ChevronLeft size={14} /> Back</button>
          </div>
        )}
        {tab === "details" && view === "overview" && <Overview bot={bot} go={setView} />}
        {tab === "details" && view === "settings" && <SettingsForm bot={bot} />}
        {tab === "details" && view === "activity" && <ActivityPanel bot={bot} />}
        {tab === "details" && view === "inspector" && <InspectorPanel bot={bot} />}
        {tab === "details" && view === "routines" && <Routines bot={bot} />}
        {tab === "computer" && <Computer bot={bot} />}
        {tab === "library" && <LibraryTab bot={bot} />}
      </div>
    </aside>
  );
}

interface Routine { id: string; title: string; text: string; kind: "interval" | "daily"; everyMin: number | null; at: string | null; enabled: boolean; lastRun: number | null; nextRun: number }

const schedule = (r: Pick<Routine, "kind" | "everyMin" | "at">) => (r.kind === "daily" ? `Daily at ${r.at}` : `Every ${r.everyMin} min`);

/** Messages the bot is sent on a schedule: an interval, or a time every day. */
function Routines({ bot }: { bot: Bot }) {
  const t = useT();
  const [items, setItems] = useState<Routine[]>([]);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"interval" | "daily">("daily");
  const [every, setEvery] = useState("60");
  const [at, setAt] = useState("09:00");
  const [error, setError] = useState("");
  const load = () => api<{ routines: Routine[] }>(`/api/bots/${bot.id}/routines`).then((r) => setItems(r.routines)).catch(() => {});
  useEffect(() => { void load(); }, [bot.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = `/api/bots/${bot.id}/routines`;
  const save = async () => {
    setError("");
    try {
      await api(base, { method: "POST", body: JSON.stringify({ text: text.trim(), kind, everyMin: kind === "interval" ? Number(every) : null, at: kind === "daily" ? at : null }) });
      setText("");
      setAdding(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    }
  };
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { toast(e instanceof Error ? e.message : "Could not do that"); } await load(); };
  return (
    <div className="px-6 pb-6" data-testid="routines-view">
      {items.length === 0 && !adding && <div className="py-8 text-center text-[13px] text-ink-tertiary">{t("No routines yet. A routine sends this bot a message on a schedule.")}</div>}
      {items.map((r) => (
        <div key={r.id} className="mb-2 rounded-xl bg-card p-3 ring-[0.5px] ring-ink/10" data-testid="routine-row">
          <div className="flex items-center gap-2">
            <input type="checkbox" aria-label={t("Enabled")} checked={r.enabled} onChange={(e) => { const enabled = e.target.checked; setItems((xs) => xs.map((x) => (x.id === r.id ? { ...x, enabled } : x))); void act(() => api(`${base}/${r.id}`, { method: "PATCH", body: JSON.stringify({ enabled }) })); }} />
            <span data-no-i18n="" className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{r.title}</span>
            <button type="button" title={t("Run now")} aria-label={t("Run now")} onClick={() => void act(() => api(`${base}/${r.id}/run`, { method: "POST" }))} className="rounded-full p-1 text-ink-secondary hover:bg-ink/10 hover:text-ink"><Play size={13} /></button>
            <button type="button" title={t("Delete routine")} aria-label={t("Delete routine")} onClick={() => void act(() => api(`${base}/${r.id}`, { method: "DELETE" }))} className="rounded-full p-1 text-ink-tertiary hover:bg-danger/10 hover:text-danger"><Trash2 size={13} /></button>
          </div>
          <div className="mt-0.5 pl-6 text-[12.5px] text-ink-tertiary">{`${t(schedule(r))} · ${t("Next run")} ${new Date(r.nextRun).toLocaleString([locale()], { weekday: "short", hour: "numeric", minute: "2-digit" })}`}</div>
        </div>
      ))}
      {adding ? (
        <div className="rounded-xl bg-card p-3 ring-[0.5px] ring-ink/10" data-testid="routine-form">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label={t("Routine message")} placeholder={t("What should the bot be asked?")}
            className="w-full resize-none rounded-lg bg-inset px-2.5 py-2 text-[13.5px] text-ink outline-none placeholder:text-ink-tertiary" />
          <div className="mt-2 flex items-center gap-2 text-[13px] text-ink-secondary">
            <select aria-label={t("Repeat")} value={kind} onChange={(e) => setKind(e.target.value as "interval" | "daily")} className="h-8 rounded-lg bg-inset px-2 text-ink">
              <option value="daily">{t("Every day at")}</option>
              <option value="interval">{t("Every")}</option>
            </select>
            {kind === "daily" ? (
              <input type="time" aria-label={t("Time of day")} value={at} onChange={(e) => setAt(e.target.value)} className="h-8 rounded-lg bg-inset px-2 text-ink" />
            ) : (
              <>
                <input type="number" min={1} aria-label={t("Minutes")} value={every} onChange={(e) => setEvery(e.target.value)} className="h-8 w-20 rounded-lg bg-inset px-2 text-ink" />
                <span>{t("minutes")}</span>
              </>
            )}
          </div>
          {error && <div role="alert" className="mt-2 text-[12.5px] text-danger">{error}</div>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => { setAdding(false); setError(""); }} className="rounded-full px-3 py-1 text-[13px] text-ink-secondary hover:bg-ink/10">{t("Cancel")}</button>
            <button type="button" disabled={!text.trim()} onClick={save} className="rounded-full bg-accent px-3.5 py-1 text-[13px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Save routine")}</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-full bg-raised px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-raised-hover"><Plus size={13} /> {t("Add a routine")}</button>
      )}
    </div>
  );
}

interface Entry { name: string; dir: boolean; size: number; at: number }
const bytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** The bot's working folder, read-only: where it runs commands and what it left there. */
function Computer({ bot }: { bot: Bot }) {
  const [path, setPath] = useState("");
  const [data, setData] = useState<{ root: string; entries: Entry[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    api<{ root: string; entries: Entry[] }>(`/api/bots/${bot.id}/files?path=${encodeURIComponent(path)}`)
      .then((r) => { if (!cancelled) { setData(r); setError(""); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [bot.id, bot.cwd, path]);
  const parts = path ? path.split("/") : [];
  return (
    <div className="px-5 py-4" data-testid="computer-tab">
      <div className="mb-2 flex items-center gap-1 text-[12.5px] text-ink-secondary">
        <Monitor size={13} />
        <button type="button" onClick={() => setPath("")} className="truncate font-mono hover:text-ink" title={data?.root}>{data?.root ?? "Working folder"}</button>
        {parts.map((seg, i) => (
          <span key={i} className="flex items-center gap-1"><ChevronRight size={12} />
            <button type="button" onClick={() => setPath(parts.slice(0, i + 1).join("/"))} className="font-mono hover:text-ink">{seg}</button></span>
        ))}
      </div>
      {error && <div role="alert" className="text-[13px] text-danger">{error}</div>}
      {data && data.entries.length === 0 && <div className="py-8 text-center text-[13px] text-ink-tertiary">This folder is empty.</div>}
      {path && <button type="button" onClick={() => setPath(parts.slice(0, -1).join("/"))} className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] text-ink-secondary hover:bg-ink/[0.06]"><Folder size={14} /> ..</button>}
      {data?.entries.map((e) => (
        <button key={e.name} type="button" disabled={!e.dir} onClick={() => setPath(path ? `${path}/${e.name}` : e.name)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] text-ink enabled:hover:bg-ink/[0.06]">
          {e.dir ? <Folder size={14} className="shrink-0 text-accent" /> : <FileText size={14} className="shrink-0 text-ink-tertiary" />}
          <span className="min-w-0 flex-1 truncate">{e.name}</span>
          {!e.dir && <span className="shrink-0 text-[11.5px] text-ink-tertiary">{bytes(e.size)}</span>}
        </button>
      ))}
    </div>
  );
}

interface Note { id: string; title: string; text: string }

/** Notes the bot keeps: they are part of what it is told on every turn. */
function LibraryTab({ bot }: { bot: Bot }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const load = () => api<{ notes: Note[] }>(`/api/bots/${bot.id}/library`).then((r) => setNotes(r.notes)).catch(() => {});
  useEffect(() => { void load(); }, [bot.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async () => { await api(`/api/bots/${bot.id}/library`, { method: "POST", body: JSON.stringify({ title: "New note", text: "" }) }); await load(); };
  const save = (n: Note, patch: Partial<Note>) => api(`/api/bots/${bot.id}/library/${n.id}`, { method: "PATCH", body: JSON.stringify(patch) }).catch(() => {});
  const del = async (n: Note) => { await api(`/api/bots/${bot.id}/library/${n.id}`, { method: "DELETE" }); await load(); };
  return (
    <div className="px-5 py-4" data-testid="library-tab">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{`Notes ${bot.name} keeps`}</span>
        <button type="button" onClick={add} className="flex items-center gap-1 rounded-full bg-raised px-2.5 py-1 text-[12.5px] font-medium text-ink hover:bg-raised-hover"><Plus size={13} /> Add</button>
      </div>
      {notes.length === 0 && <div className="py-8 text-center text-[13px] text-ink-tertiary">No notes yet. Anything you save here is part of what the bot knows.</div>}
      {notes.map((n) => <NoteCard key={n.id} note={n} onSave={(patch) => save(n, patch)} onDelete={() => del(n)} />)}
    </div>
  );
}

/** One note; edits save by themselves a moment after you stop typing, so closing the panel loses nothing. */
function NoteCard({ note, onSave, onDelete }: { note: Note; onSave: (p: Partial<Note>) => unknown; onDelete: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<Partial<Note>>({});
  useEffect(() => () => { clearTimeout(timer.current); if (Object.keys(pending.current).length) void onSave(pending.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = (patch: Partial<Note>) => {
    pending.current = { ...pending.current, ...patch };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { const p = pending.current; pending.current = {}; void onSave(p); }, 400);
  };
  return (
    <div className="mb-3 rounded-xl bg-card p-3 ring-[0.5px] ring-ink/10">
      <div className="flex items-center gap-2">
        <input defaultValue={note.title} aria-label="Note title" onChange={(e) => edit({ title: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-[14px] font-medium text-ink outline-none" />
        <button type="button" aria-label="Delete note" onClick={onDelete} className="rounded-full p-1 text-ink-tertiary hover:bg-danger/10 hover:text-danger"><Trash2 size={13} /></button>
      </div>
      <textarea defaultValue={note.text} rows={4} aria-label="Note text" placeholder="Write something the bot should remember" onChange={(e) => edit({ text: e.target.value })}
        className="mt-1.5 w-full resize-y rounded-lg bg-inset px-2.5 py-2 text-[13.5px] text-ink outline-none placeholder:text-ink-tertiary" />
    </div>
  );
}
