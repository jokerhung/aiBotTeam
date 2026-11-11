"use client";
/* eslint-disable react-hooks/set-state-in-effect -- these effects hydrate from localStorage or reset form state when a dialog opens or the target changes */
import { Library, Monitor, Share2, User, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { queuePatch } from "@/lib/patch-queue";
import { cn } from "@/lib/utils";
import type { Bot, MausColor, ModelSelection } from "@/lib/wire";
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
        {tab === "computer" && <Empty icon={Monitor} title="Computer" text="Screens and files this bot works with will appear here." />}
        {tab === "library" && <Empty icon={Library} title="Library" text="Notes and saved skills for this bot will appear here." />}
      </div>
    </aside>
  );
}

function Empty({ icon: Icon, title, text }: { icon: typeof User; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-8 py-16 text-center">
      <Icon size={22} className="text-ink-tertiary" />
      <div className="text-[15px] font-medium text-ink">{title}</div>
      <div className="text-[13px] text-ink-secondary">{text}</div>
    </div>
  );
}
