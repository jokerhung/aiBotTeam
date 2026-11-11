"use client";
/* eslint-disable react-hooks/set-state-in-effect -- these effects hydrate from localStorage or reset form state when a dialog opens or the target changes */
import { ChevronRight, FileText, Folder, Monitor, Plus, Share2, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { queuePatch } from "@/lib/patch-queue";
import { cn } from "@/lib/utils";
import type { Bot, MausColor, ModelSelection } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { ApprovalModeSelector } from "./ApprovalModeSelector";
import { Mascot } from "./Mascot";
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

function Details({ bot }: { bot: Bot }) {
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
    </div>
  );
}

export function BotPanel({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const [tab, setTab] = useState<Tab>("details");
  const tabs: { id: Tab; label: string }[] = [
    { id: "details", label: "Details" },
    { id: "computer", label: "Computer" },
    { id: "library", label: "Library" },
  ];
  return (
    <aside aria-label={`${bot.name} settings`} className="relative z-20 flex h-full w-[360px] shrink-0 animate-panel-in flex-col border-l-[0.5px] border-edge bg-panel max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:w-full">
      <div className="flex items-center gap-1 px-3 pb-1 pt-3">
        <div role="tablist" className="flex min-w-0 flex-1 gap-0.5 overflow-hidden">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={cn("min-w-0 truncate rounded-full px-2.5 py-1.5 text-[13px] font-medium", tab === t.id ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink")}>
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" title="Copy a link to this bot" aria-label="Share" onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/?bot=${bot.id}`); toast("Link copied"); }}
          className="flex size-8 items-center justify-center rounded-full bg-raised text-ink-secondary hover:text-ink"><Share2 size={14} /></button>
        <button type="button" title="Close" aria-label="Close panel" onClick={() => dispatch({ type: "panel", botId: null })}
          className="flex size-8 items-center justify-center rounded-full text-ink-secondary hover:bg-ink/10 hover:text-ink"><X size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel">
        {tab === "details" && <Details bot={bot} />}
        {tab === "computer" && <Computer bot={bot} />}
        {tab === "library" && <LibraryTab bot={bot} />}
      </div>
    </aside>
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
        <span className="text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">Notes {bot.name} keeps</span>
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
