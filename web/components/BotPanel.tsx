"use client";
/* eslint-disable react-hooks/set-state-in-effect -- these effects hydrate from localStorage or reset form state when a dialog opens or the target changes */
import { Bug, CalendarClock, CalendarPlus, ChevronRight, ListChecks, Play, Plus, RotateCcw, Search, Settings, Share2, Sparkles, SquarePen, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { queuePatch } from "@/lib/patch-queue";
import { locale, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Bot, McpServer, ModelSelection } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { Mascot } from "./Mascot";
import { ActivityPanel, ExportButtons, InspectorPanel } from "./Observe";
import { toast } from "./Toaster";


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

export function ModelPicker({ value, onChange, allowNone }: { value: ModelSelection | null; onChange: (s: ModelSelection | null) => void; allowNone?: boolean }) {
  const { state } = useStore();
  const engines = state.instances.filter((i) => !i.hidden && i.enabled && i.snapshot.state === "available");
  const v = value ? `${value.instanceId}::${value.model}` : "";
  const engine = engines.find((e) => e.id === value?.instanceId);
  return <div className="grid gap-3 sm:grid-cols-2">
    <select aria-label={allowNone ? "Backup engine" : "Engine"} className={cn(INPUT, "h-10")} value={value?.instanceId ?? ""} onChange={(event) => {
      const selected = engines.find((e) => e.id === event.target.value);
      onChange(selected ? { instanceId: selected.id, model: selected.models[0]?.id ?? "" } : null);
    }}>
      <option value="">{allowNone ? "None" : "Choose an engine"}</option>
      {value && !engine && <option value={value.instanceId}>{value.instanceId}</option>}
      {engines.map((e) => <option key={e.id} value={e.id}>{e.displayName}</option>)}
    </select>
    <select value={v} disabled={!value} onChange={(event) => {
      if (!event.target.value) return onChange(null);
      const [instanceId, ...model] = event.target.value.split("::");
      onChange({ instanceId, model: model.join("::") });
    }} className={cn(INPUT, "h-10")} aria-label={allowNone ? "Backup model" : "Model"}>
      {allowNone && <option value="">None</option>}
      {value && !engine?.models.some((m) => m.id === value.model) && <option value={v}>{value.model}</option>}
      {engine?.models.map((m) => <option key={m.id} value={`${engine.id}::${m.id}`}>{m.label}</option>)}
    </select>
  </div>;

}

/** Which custom MCP servers and connected apps this bot may use, read or write, and whether sending out asks first. */
/** How long a bot that only reads reuses what it read (a sheet, a file) before it reads again; 0 reads every time. */
function ToolAllowlist({ name, value, onChange }: { name: string; value: string[]; onChange: (tools: string[]) => void }) {
  const [text, setText] = useState(value.join(", ")); const editing = useRef(false);
  useEffect(() => { if (!editing.current) setText(value.join(", ")); }, [value]);
  return <label className="mt-2 block text-xs text-ink-secondary">Allowed tools (comma separated; empty allows all)<input aria-label={`${name} allowed tools`} className={`${INPUT} mt-1 h-9`} value={text} onFocus={() => { editing.current = true; }} onBlur={() => { editing.current = false; setText(value.join(", ")); }} onChange={(event) => { setText(event.target.value); onChange(event.target.value.split(",").map((tool) => tool.trim()).filter(Boolean)); }} /></label>;
}

function CacheMinutes({ name, value, onChange }: { name: string; value: number; onChange: (n: number) => void }) {
  const t = useT();
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6 text-[12.5px] text-ink-secondary" data-testid="cache-minutes">
      <label htmlFor={`cache-${name}`}>{t("Cache (minutes)")}</label>
      <input id={`cache-${name}`} type="number" inputMode="numeric" min={0} max={1440} value={text} aria-label={`${name} ${t("Cache (minutes)")}`}
        onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value !== "" && Number.isInteger(n) && n >= 0 && n <= 1440) onChange(n); }}
        onBlur={() => setText(String(value))} className="h-7 w-20 rounded-md bg-raised px-2 text-ink" />
      <span className="text-ink-tertiary">{t("0 = no cache: every question reads the file again.")}</span>
    </div>
  );
}

type Access = { scope: "read" | "write"; outbound: "ask" | "allow"; cacheMinutes?: number; allowTools?: string[] };

/** What one enabled server or app may do for a bot: read or write, ask before sending, which tools, how long to cache. */
export function ServerAccessControls({ name, acc, setAccess }: { name: string; acc: Access; setAccess: (patch: Partial<Access>) => void }) {
  return (
    <>
      <div className="mt-1.5 flex gap-2 pl-6 text-[12.5px]">
        <select value={acc.scope} onChange={(e) => setAccess({ scope: e.target.value as "read" | "write" })} aria-label={`${name} access`} className="rounded-md bg-raised px-2 py-1 text-ink">
          <option value="read">Read</option><option value="write">Write</option>
        </select>
        {acc.scope === "write" && (
          <select value={acc.outbound} onChange={(e) => setAccess({ outbound: e.target.value as "ask" | "allow" })} aria-label={`${name} sending out`} className="rounded-md bg-raised px-2 py-1 text-ink">
            <option value="ask">Ask before sending</option><option value="allow">Send without asking</option>
          </select>
        )}
      </div>
      <ToolAllowlist name={name} value={acc.allowTools ?? []} onChange={(allowTools) => setAccess({ allowTools })} />
      <CacheMinutes name={name} value={acc.cacheMinutes ?? 0} onChange={(n) => setAccess({ cacheMinutes: n })} />
    </>
  );
}

export function AppsField({ bot, onChange }: { bot: Bot; onChange?: (patch: Partial<Bot>) => void }) {
  const applyPatch = (body: Partial<Bot>) => onChange ? onChange(body) : void queuePatch(bot.id, body);
  const { state } = useStore();
  const [servers, setServers] = useState<McpServer[]>([]);
  useEffect(() => { api<{ servers: McpServer[] }>("/api/mcp/servers").then((r) => setServers(r.servers)).catch(() => {}); }, [state.mcpTick]);
  const used = bot.mcpServers ?? [];
  const access = bot.mcpAccess ?? {};
  const setUsed = (id: string, on: boolean) => applyPatch({ mcpServers: on ? [...used, id] : used.filter((x) => x !== id) });
  const setAccess = (id: string, patch: Partial<{ scope: "read" | "write"; outbound: "ask" | "allow"; cacheMinutes: number; allowTools: string[] }>) =>
    applyPatch({ mcpAccess: { ...access, [id]: { ...(access[id] ?? { scope: "read" as const, outbound: "ask" as const }), ...patch } } });
  return (
    <Field label="Apps and servers" hint="What this bot may use. Read lets it look; Write lets it change things, and Ask makes it check with you before it sends anything out.">
      {servers.length === 0 && <div className="text-[13px] text-ink-tertiary">No apps are connected yet. Use “Connect apps” at the bottom of the sidebar.</div>}
      <div className="grid gap-3 md:grid-cols-2" data-testid="bot-apps">
        {servers.map((s) => {
          const on = used.includes(s.id);
          const acc = access[s.id] ?? { scope: "read", outbound: "ask" };
          return (
            <div key={s.id} className="rounded-lg bg-inset px-3 py-2 ring-1 ring-inset ring-ink/[0.07]">
              <label className="flex items-center gap-2 text-[14px] text-ink">
                <input type="checkbox" checked={on} onChange={(e) => setUsed(s.id, e.target.checked)} role="switch" aria-checked={on} aria-label={`Use ${s.name}`} />
                <span data-no-i18n="" className="min-w-0 flex-1 truncate">{s.name}</span>
              </label>
              {on && <ServerAccessControls name={s.name} acc={acc} setAccess={(patch) => setAccess(s.id, patch)} />}
            </div>
          );
        })}
      </div>
    </Field>
  );
}

type View = "overview" | "activity" | "inspector";

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
      <Row icon={Sparkles} label="Model" right={<span className="max-w-[140px] truncate text-[14px] text-ink-secondary">{modelLabel}</span>} chevron onClick={() => dispatch({ type: "openAgent", id: bot.id })} />
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
        <button type="button" onClick={() => dispatch({ type: "openAgent", id: bot.id, tab: "availability" })} className="text-[13px] font-normal text-ink-tertiary hover:text-ink">{t("Manage")}</button>
      </div>
      <Row icon={CalendarPlus} label={t("Add a routine")} onClick={() => dispatch({ type: "openAgent", id: bot.id, tab: "availability" })} />
      <Row icon={CalendarClock} label={t("Automations")} chevron onClick={() => dispatch({ type: "automations", open: true })} />
    </div>
  );
}



export function BotPanel({ bot }: { bot: Bot; initialView?: "overview" | "settings" }) {
  const { dispatch } = useStore(); const t = useT();
  const [view, setView] = useState<View>("overview");
  return <aside aria-label={`${bot.name} details`} data-testid="bot-panel" className="relative z-20 flex h-full w-[320px] shrink-0 flex-col border-l border-edge bg-app max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:w-full">
    <header className="flex justify-end gap-2 p-3"><button aria-label="Share" className="rounded-full p-2 hover:bg-raised" onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/#/chat/${bot.id}`); toast("Link copied"); }}><Share2 size={16} /></button><button aria-label="Close panel" className="rounded-full p-2 hover:bg-raised" onClick={() => dispatch({ type: "panel", botId: null })}><X size={16} /></button></header>
    <div className="min-h-0 flex-1 overflow-y-auto"><div className="flex flex-col items-center px-5 py-3"><Mascot color={bot.color} size={52} /><div className="mt-3 flex items-center gap-2"><h2 data-no-i18n className="text-lg font-medium">{bot.name}</h2><button aria-label="Bot settings" title="Edit agent" className="rounded p-2 hover:bg-raised" onClick={() => dispatch({ type: "openAgent", id: bot.id })}><Settings size={15} /></button></div><p data-no-i18n className="text-sm text-ink-secondary">{bot.title || bot.description}</p></div>
      <div role="tablist" className="mb-4 flex justify-center gap-1 px-3" data-testid="panel-tabs">{(["overview", "activity", "inspector"] as const).map((id) => <button key={id} role="tab" aria-selected={view === id} className={`rounded-full px-3 py-2 text-sm ${view === id ? "bg-raised" : "text-ink-secondary"}`} onClick={() => setView(id)}>{t(id[0].toUpperCase() + id.slice(1))}</button>)}</div>
      {view === "overview" && <Overview bot={bot} go={setView} />}{view === "activity" && <ActivityPanel bot={bot} />}{view === "inspector" && <InspectorPanel bot={bot} />}
    </div>
  </aside>;
}

interface Routine { id: string; title: string; text: string; kind: "interval" | "daily"; everyMin: number | null; at: string | null; enabled: boolean; lastRun: number | null; nextRun: number }

const schedule = (r: Pick<Routine, "kind" | "everyMin" | "at">) => (r.kind === "daily" ? `Daily at ${r.at}` : `Every ${r.everyMin} min`);

/** Messages the bot is sent on a schedule: an interval, or a time every day. */
export function Routines({ bot }: { bot: Bot }) {
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

interface Note { id: string; title: string; text: string }

export function LibraryTab({ bot }: { bot: Bot }) {
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
