"use client";
import { ArrowLeft, CalendarClock, ChevronLeft, ChevronRight, Copy, Menu, Pencil, Play, Plus, Send, Trash2, Webhook as WebhookIcon, X, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { locale, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { occurrences } from "@/lib/team";
import type { Routine, RoutineRun, Webhook, WebhookAttempt } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { Mascot } from "./Mascot";

const INPUT = "w-full rounded-lg bg-inset px-3 text-[14px] text-ink outline-none ring-1 ring-inset ring-ink/[0.07] placeholder:text-ink-tertiary focus:ring-ink/25";
const DAY = 86_400_000;
const HOUR_PX = 44;
const DAY_LETTERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATUS_TONE: Record<string, string> = {
  done: "bg-success/20 text-success", running: "bg-accent/20 text-accent-text", failed: "bg-danger/15 text-danger", timeout: "bg-danger/15 text-danger",
  skipped: "bg-warning/20 text-warning", cancelled: "bg-ink/10 text-ink-secondary", stopped: "bg-ink/10 text-ink-secondary",
};

type Range = 1 | 3 | 7;
const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const clock = (ms: number) => new Date(ms).toLocaleTimeString([locale()], { hour: "numeric", minute: "2-digit" });
const mondayOf = (ms: number) => { const s = startOfDay(ms); const wd = (new Date(s).getDay() + 6) % 7; return s - wd * DAY; };

function EmptyState({ onNew }: { onNew: () => void }) {
  const t = useT();
  return (
    <div data-testid="automations-empty" className="flex flex-1 flex-col items-center gap-3 px-6 pt-[12vh] text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-accent/12 text-accent-text"><Zap size={22} /></span>
      <h2 className="text-[16px] font-semibold text-ink">{t("Your bots can do things on their own.")}</h2>
      <button type="button" onClick={onNew} className="text-[13.5px] text-accent-text hover:underline">{t("Try: every morning, summarize my inbox")}</button>
      <button type="button" aria-label={t("Create your first routine")} onClick={onNew} className="mt-2 flex h-10 items-center gap-1.5 rounded-full bg-accent px-5 text-[14px] font-medium text-[var(--color-accent-ink)]"><Plus size={15} /> {t("New")}</button>
    </div>
  );
}

function useTargets() {
  const { state } = useStore();
  return useMemo(() => [
    ...state.bots.filter((b) => !b.hidden).map((b) => ({ kind: "bot" as const, id: b.id, name: b.name, color: b.color })),
    ...state.groups.map((g) => ({ kind: "group" as const, id: g.id, name: g.name, color: "blue" as const })),
  ], [state.bots, state.groups]);
}

// ---- editor ----------------------------------------------------------------------------------------------------------
/** Step one of a new routine, as in the reference: say what should happen and who does it; the bot sets it up with its own tools. */
function RoutineAsk({ onForm, onClose }: { onForm: () => void; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const bots = state.bots.filter((b) => !b.hidden);
  const [text, setText] = useState("");
  const [who, setWho] = useState(bots[0]?.id ?? "");
  const send = async () => {
    if (!text.trim() || !who) return;
    const bot = bots.find((b) => b.id === who);
    if (!bot) return;
    await api(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: `Set up a routine for this: ${text.trim()}`, threadId: bot.threadId }) }).catch(() => {});
    onClose();
    dispatch({ type: "select", id: bot.id });
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="What should happen?" data-testid="routine-ask"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[560px] rounded-[20px] bg-panel p-5 text-ink shadow-xl ring-1 ring-ink/10">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-semibold">{t("What should happen?")}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><X size={15} /></button>
        </div>
        <textarea autoFocus data-no-i18n="" value={text} onChange={(e) => setText(e.target.value)} rows={4} aria-label={t("What should happen?")}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
          placeholder={t("e.g. every morning at 9, send me a summary of my inbox")}
          className="mt-3.5 block w-full resize-none rounded-xl bg-inset px-3.5 py-3 text-[14px] leading-5 text-ink outline-none ring-1 ring-inset ring-accent placeholder:text-ink-tertiary" />
        <div className="mt-4 flex items-center gap-2 text-[13px] text-ink-secondary">
          {t("Who should do it?")}
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label={t("Who should do it?")} className="h-8 rounded-lg bg-raised px-2.5 text-[13.5px] text-ink">
            {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <button type="button" onClick={onForm} className="rounded-full px-2 py-1.5 text-[13.5px] text-ink-secondary hover:text-ink">{t("Set it up yourself")}</button>
          <button type="button" disabled={!text.trim() || !who} onClick={send} className="flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-[14px] font-medium text-[var(--color-accent-ink)] disabled:bg-ink/10 disabled:text-ink-tertiary">
            <Send size={14} /> {t("Set it up")}
          </button>
        </div>
      </div>
    </div>
  );
}

function RoutineEditor({ routine, onClose }: { routine: Routine | null; onClose: () => void }) {
  const { state } = useStore();
  const t = useT();
  const targets = useTargets();
  const localTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const [name, setName] = useState(routine?.name ?? "");
  const [prompt, setPrompt] = useState(routine?.prompt ?? "");
  const [target, setTarget] = useState(routine ? `${routine.targetKind}:${routine.targetId}` : targets[0] ? `${targets[0].kind}:${targets[0].id}` : "");
  const [kind, setKind] = useState<"interval" | "weekly" | "once">(routine ? (routine.kind === "daily" ? "weekly" : routine.kind) : "interval");
  const [every, setEvery] = useState(routine?.everyMin ?? 60);
  const [at, setAt] = useState(routine?.at ?? "09:00");
  const [days, setDays] = useState<number[]>(routine?.days?.length ? routine.days : [0, 1, 2, 3, 4, 5, 6]);
  const [runAt, setRunAt] = useState(() => {
    const d = new Date(routine?.runAt ?? Date.now() + 3_600_000);
    d.setSeconds(0, 0);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  });
  const [tz, setTz] = useState(routine?.tz ?? localTz);
  const [maxRun, setMaxRun] = useState(routine?.maxRunMin ?? 60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  void state;

  const save = async () => {
    const [targetKind, ...rest] = target.split(":");
    const body: Record<string, unknown> = { name: name.trim() || prompt.trim().slice(0, 40), prompt: prompt.trim(), kind, tz, maxRunMin: maxRun };
    if (!routine) { body.targetKind = targetKind; body.targetId = rest.join(":"); }
    if (kind === "interval") body.everyMin = every;
    if (kind === "weekly") { body.at = at; body.days = days; }
    if (kind === "once") body.runAt = new Date(runAt).getTime();
    setBusy(true);
    setError("");
    try {
      await api(routine ? `/api/routines/${routine.id}` : "/api/routines", { method: routine ? "PATCH" : "POST", body: JSON.stringify(body) });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const label = "mb-1.5 mt-4 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary";
  return (
    <div role="dialog" aria-modal="true" aria-label={routine ? "Edit routine" : "New routine"} data-testid="routine-editor"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[92vh] w-full max-w-[480px] flex-col overflow-y-auto rounded-2xl bg-panel p-5 text-ink shadow-xl ring-1 ring-ink/10">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-semibold">{routine ? t("Edit routine") : t("New routine")}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><X size={15} /></button>
        </div>
        <div className={label}>{t("Name")}</div>
        <input data-no-i18n="" value={name} onChange={(e) => setName(e.target.value)} aria-label={t("Name")} placeholder={t("Morning summary")} className={cn(INPUT, "h-10")} />
        <div className={label}>{t("Send to")}</div>
        <select value={target} disabled={!!routine} onChange={(e) => setTarget(e.target.value)} aria-label={t("Send to")} className={cn(INPUT, "h-10")}>
          {targets.map((x) => <option key={`${x.kind}:${x.id}`} value={`${x.kind}:${x.id}`}>{x.kind === "group" ? `${x.name} (${t("room")})` : x.name}</option>)}
        </select>
        <div className={label}>{t("Message")}</div>
        <textarea data-no-i18n="" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} aria-label={t("Routine message")} placeholder={t("What should it be asked?")} className={cn(INPUT, "py-2 leading-5")} />
        <div className={label}>{t("Repeat")}</div>
        <div role="radiogroup" className="flex gap-1.5">
          {([["interval", "Every N minutes"], ["weekly", "On days"], ["once", "Once"]] as const).map(([id, text]) => (
            <button key={id} type="button" role="radio" aria-checked={kind === id} onClick={() => setKind(id)}
              className={cn("flex-1 rounded-lg px-2 py-1.5 text-[13px] ring-1 ring-ink/10 hover:bg-ink/[0.04]", kind === id && "bg-accent/12 ring-accent/60")}>{t(text)}</button>
          ))}
        </div>
        {kind === "interval" && (
          <div className="mt-3 flex items-center gap-2 text-[14px]">
            {t("Every")}
            <input type="number" min={5} max={1440} value={every} onChange={(e) => setEvery(Number(e.target.value))} aria-label={t("Minutes")} className={cn(INPUT, "h-9 w-24")} />
            {t("minutes (5–1440)")}
          </div>
        )}
        {kind === "weekly" && (
          <>
            <div className="mt-3 flex gap-1" role="group" aria-label={t("Days")}>
              {DAY_LETTERS.map((d, i) => (
                <button key={d} type="button" aria-pressed={days.includes(i)} onClick={() => setDays((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i]))}
                  className={cn("flex-1 rounded-lg py-1.5 text-[12.5px] ring-1 ring-ink/10", days.includes(i) ? "bg-accent text-[var(--color-accent-ink)] ring-accent" : "hover:bg-ink/[0.04]")}>{d}</button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 text-[14px]">{t("At")} <input type="time" value={at} onChange={(e) => setAt(e.target.value)} aria-label={t("Time")} className={cn(INPUT, "h-9 w-32")} /></div>
          </>
        )}
        {kind === "once" && <input type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} aria-label={t("Date and time")} className={cn(INPUT, "mt-3 h-10")} />}
        <div className={label}>{t("Time zone")}</div>
        <input value={tz} onChange={(e) => setTz(e.target.value)} aria-label={t("Time zone")} placeholder="Europe/Paris" className={cn(INPUT, "h-10")} />
        <div className={label}>{t("Time limit per run (minutes)")}</div>
        <input type="number" min={1} max={1440} value={maxRun} onChange={(e) => setMaxRun(Number(e.target.value))} aria-label={t("Time limit per run (minutes)")} className={cn(INPUT, "h-10 w-28")} />
        {error && <div role="alert" className="mt-3 text-[13px] text-danger">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-[14px] text-ink-secondary hover:bg-ink/10">{t("Cancel")}</button>
          <button type="button" disabled={busy || !prompt.trim() || (kind === "weekly" && !days.length)} onClick={save}
            className="rounded-full bg-accent px-4 py-2 text-[14px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Save routine")}</button>
        </div>
      </div>
    </div>
  );
}

// ---- calendar --------------------------------------------------------------------------------------------------------
function CalendarGrid({ routines, runs, anchor, range, onEdit }: { routines: Routine[]; runs: RoutineRun[]; anchor: number; range: Range; onEdit: (r: Routine) => void }) {
  const start = range === 7 ? mondayOf(anchor) : startOfDay(anchor);
  const days = Array.from({ length: range }, (_, i) => start + i * DAY);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = Math.max(0, (new Date().getHours() - 1) * HOUR_PX); }, [range]);
  const byId = new Map(routines.map((r) => [r.id, r]));
  const blocks = (day: number) => {
    const end = day + DAY;
    const future = routines.flatMap((r) => occurrences(r, Math.max(day, now), end).map((at) => ({ key: `${r.id}-${at}`, r, at, run: null as RoutineRun | null })));
    const past = runs.filter((x) => x.startedAt >= day && x.startedAt < end).map((x) => ({ key: x.id, r: byId.get(x.routineId), at: x.startedAt, run: x }));
    return [...past, ...future].filter((b) => b.r);
  };
  return (
    <div ref={scroller} data-testid="calendar-grid" className="min-h-0 flex-1 overflow-auto">
      <div className="sticky top-0 z-10 grid border-b border-edge bg-app" style={{ gridTemplateColumns: `52px repeat(${range}, minmax(0, 1fr))` }}>
        <div />
        {days.map((d) => {
          const today = startOfDay(now) === d;
          return (
            <div key={d} className="px-2 py-2 text-center text-[12.5px] text-ink-secondary">
              <div>{new Date(d).toLocaleDateString([locale()], { weekday: "short" })}</div>
              <div className={cn("mx-auto mt-0.5 flex size-7 items-center justify-center rounded-full text-[14px] font-medium", today ? "bg-accent text-[var(--color-accent-ink)]" : "text-ink")}>{new Date(d).getDate()}</div>
            </div>
          );
        })}
      </div>
      <div className="relative grid" style={{ gridTemplateColumns: `52px repeat(${range}, minmax(0, 1fr))`, height: 24 * HOUR_PX }}>
        <div className="relative">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-ink-tertiary" style={{ top: h * HOUR_PX, display: h === 0 ? "none" : undefined }}>
              {new Date(2000, 0, 1, h).toLocaleTimeString([locale()], { hour: "numeric" })}
            </div>
          ))}
        </div>
        {days.map((d) => (
          <div key={d} className="relative border-l border-edge">
            {Array.from({ length: 24 }, (_, h) => <div key={h} className="absolute inset-x-0 border-t border-edge/60" style={{ top: h * HOUR_PX }} />)}
            {startOfDay(now) === d && <div className="absolute inset-x-0 z-[5] h-px bg-danger" style={{ top: ((now - d) / 3_600_000) * HOUR_PX }}><span className="absolute -left-1 -top-[3px] size-[7px] rounded-full bg-danger" /></div>}
            {blocks(d).map((b) => (
              <button key={b.key} type="button" data-testid="routine-block" onClick={() => b.r && onEdit(b.r)} title={`${b.r!.name} · ${clock(b.at)}${b.run ? ` · ${b.run.status}` : ""}`}
                className={cn("absolute inset-x-1 z-[3] overflow-hidden rounded-md px-1.5 text-left text-[11.5px] leading-[16px] ring-1 ring-ink/10", b.run ? (STATUS_TONE[b.run.status] ?? "bg-ink/10") : "bg-accent/15 text-accent-text")}
                style={{ top: ((b.at - d) / 3_600_000) * HOUR_PX, height: 18 }}>
                <span data-no-i18n="" className="truncate">{clock(b.at)} {b.r!.name}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- run log ---------------------------------------------------------------------------------------------------------
function RunLog({ routines, runs }: { routines: Routine[]; runs: RoutineRun[] }) {
  const t = useT();
  const { state, dispatch } = useStore();
  const [filter, setFilter] = useState<string>("all");
  const byId = new Map(routines.map((r) => [r.id, r]));
  const shown = runs.filter((r) => filter === "all" || r.status === filter).sort((a, b) => b.startedAt - a.startedAt).slice(0, 60);
  const open = (r: RoutineRun) => {
    const def = byId.get(r.routineId);
    if (!r.threadId || !def) return;
    if (def.targetKind === "bot") { void api(`/api/bots/${def.targetId}`, { method: "PATCH", body: JSON.stringify({ threadId: r.threadId }) }).catch(() => {}); dispatch({ type: "select", id: def.targetId }); }
    else dispatch({ type: "selectGroup", id: def.targetId });
  };
  void state;
  return (
    <section aria-label={t("Run log")} data-testid="run-log" className="border-t border-edge">
      <div className="flex items-center gap-2 px-5 py-2.5">
        <h3 className="text-[14px] font-medium text-ink">{t("Run log")}</h3>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("Status")} className="ml-auto rounded-lg bg-inset px-2 py-1 text-[13px] text-ink ring-1 ring-ink/10">
          {["all", "done", "running", "failed", "skipped", "timeout", "cancelled"].map((s) => <option key={s} value={s}>{t(s === "all" ? "All statuses" : s)}</option>)}
        </select>
      </div>
      <div className="max-h-[220px] overflow-y-auto px-5 pb-3">
        {shown.length === 0 && <div className="py-4 text-center text-[13px] text-ink-tertiary">{t("No runs yet.")}</div>}
        {shown.map((r) => (
          <button key={r.id} type="button" data-testid="run-row" onClick={() => open(r)} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-raised/60">
            <span className={cn("w-[72px] shrink-0 rounded-full px-2 py-0.5 text-center text-[11.5px] font-medium", STATUS_TONE[r.status] ?? "bg-ink/10")}>{r.status}</span>
            <span data-no-i18n="" className="min-w-0 flex-1 truncate text-ink">{byId.get(r.routineId)?.name ?? r.routineId}</span>
            <span data-no-i18n="" className="hidden min-w-0 max-w-[40%] truncate text-ink-tertiary sm:block">{r.detail}</span>
            <span className="shrink-0 tabular-nums text-ink-tertiary">{new Date(r.startedAt).toLocaleString([locale()], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---- routines list -----------------------------------------------------------------------------------------------------
function RoutineRows({ routines, onEdit }: { routines: Routine[]; onEdit: (r: Routine) => void }) {
  const { state } = useStore();
  const t = useT();
  const nameOf = (r: Routine) => (r.targetKind === "bot" ? state.bots.find((b) => b.id === r.targetId)?.name : state.groups.find((g) => g.id === r.targetId)?.name) ?? "?";
  const colorOf = (r: Routine) => (r.targetKind === "bot" ? state.bots.find((b) => b.id === r.targetId)?.color : undefined);
  const act = (p: Promise<unknown>) => void p.catch(() => {});
  return (
    <div className="px-5 py-3">
      {routines.map((r) => (
        <div key={r.id} data-testid="routine-row" className="mb-2 flex items-center gap-3 rounded-xl bg-card p-3 ring-[0.5px] ring-ink/10">
          <span className="shrink-0">{colorOf(r) ? <Mascot color={colorOf(r)!} size={32} /> : <span className="flex size-8 items-center justify-center rounded-full bg-raised"><CalendarClock size={15} /></span>}</span>
          <div className="min-w-0 flex-1">
            <div data-no-i18n="" className={cn("truncate text-[14px] font-medium text-ink", !r.enabled && "opacity-50")}>{r.name}</div>
            <div className="truncate text-[12.5px] text-ink-tertiary"><span data-no-i18n="">{nameOf(r)}</span> · {r.schedule}{r.enabled && r.nextRun ? ` · ${t("next")} ${new Date(r.nextRun).toLocaleString([locale()], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}{!r.enabled ? ` · ${t("Paused")}` : ""}</div>
          </div>
          <button type="button" role="switch" aria-checked={r.enabled} aria-label={r.enabled ? t("Pause") : t("Resume")} onClick={() => act(api(`/api/routines/${r.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !r.enabled }) }))}
            className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", r.enabled ? "bg-accent" : "bg-ink/20")}><span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-all", r.enabled ? "left-[18px]" : "left-0.5")} /></button>
          <button type="button" title={t("Run now")} aria-label={t("Run now")} onClick={() => act(api(`/api/routines/${r.id}/run`, { method: "POST" }))} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><Play size={14} /></button>
          <button type="button" title={t("Edit")} aria-label={t("Edit")} onClick={() => onEdit(r)} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><Pencil size={14} /></button>
          <button type="button" title={t("Delete routine")} aria-label={t("Delete routine")} onClick={() => confirm(t("Delete this routine?")) && act(api(`/api/routines/${r.id}`, { method: "DELETE" }))} className="rounded-full p-1.5 text-ink-tertiary hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
        </div>
      ))}
    </div>
  );
}

// ---- webhooks ----------------------------------------------------------------------------------------------------------
function WebhooksTab() {
  const { state, dispatch } = useStore();
  const t = useT();
  const targets = useTargets().filter((x) => x.kind === "bot");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  const [auth, setAuth] = useState<"bearer" | "url">("bearer");
  const [shown, setShown] = useState<{ id: string; secret: string; url: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const hookBase = (w: Webhook) => w.url;
  const reveal = (w: Webhook, secret: string) => setShown({ id: w.id, secret, url: auth === "url" || w.auth === "url" ? `${w.url}/${secret}` : w.url });

  const create = async () => {
    if (!name.trim() || !target) return;
    const r = await api<{ webhook: Webhook; secret: string }>("/api/webhooks", { method: "POST", body: JSON.stringify({ name: name.trim(), prompt, targetId: target, auth }) }).catch(() => null);
    if (!r) return;
    dispatch({ type: "frame", frame: { kind: "webhook", webhook: r.webhook } });
    reveal(r.webhook, r.secret);
    setAdding(false); setName(""); setPrompt("");
  };
  const attemptsOf = (id: string) => state.attempts[id] ?? [];
  const toggle = async (w: Webhook) => {
    const next = open === w.id ? null : w.id;
    setOpen(next);
    if (next) {
      const r = await api<{ attempts: WebhookAttempt[] }>(`/api/webhooks/${w.id}/attempts`).catch(() => null);
      if (r) dispatch({ type: "attempts", webhookId: w.id, attempts: r.attempts });
    }
  };
  return (
    <div className="px-5 py-3" data-testid="webhooks-tab">
      <p className="mb-3 text-[13px] leading-5 text-ink-secondary">{t("A webhook starts a task on a bot when something outside calls its address. What arrives is outside content and never carries your authority.")}</p>
      {shown && (
        <div role="status" data-testid="webhook-secret" className="mb-3 rounded-xl bg-warning/10 p-3 ring-1 ring-warning/40">
          <div className="text-[13px] font-medium text-ink">{t("Copy this now — the secret is shown only once.")}</div>
          <code data-no-i18n="" className="mt-1.5 block break-all rounded-lg bg-inset px-2 py-1.5 font-mono text-[12.5px] text-ink">{shown.url}</code>
          <div className="mt-1 flex items-center gap-2">
            <code data-no-i18n="" className="block min-w-0 flex-1 break-all font-mono text-[12.5px] text-ink-secondary">{shown.secret}</code>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(shown.secret)} className="flex items-center gap-1 rounded-full bg-raised px-2.5 py-1 text-[12.5px] hover:bg-raised-hover"><Copy size={12} /> {t("Copy")}</button>
            <button type="button" onClick={() => setShown(null)} className="rounded-full px-2.5 py-1 text-[12.5px] text-ink-secondary hover:bg-ink/10">{t("Done")}</button>
          </div>
        </div>
      )}
      {state.webhooks.map((w) => {
        const bot = state.bots.find((b) => b.id === w.targetId);
        return (
          <div key={w.id} data-testid="webhook-row" className="mb-2 rounded-xl bg-card p-3 ring-[0.5px] ring-ink/10">
            <div className="flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary"><WebhookIcon size={15} /></span>
              <div className="min-w-0 flex-1">
                <div data-no-i18n="" className={cn("truncate text-[14px] font-medium text-ink", !w.enabled && "opacity-50")}>{w.name}</div>
                <div data-no-i18n="" className="truncate font-mono text-[12px] text-ink-tertiary">{hookBase(w)}{w.auth === "url" ? "/…" : ""} · {bot?.name ?? "?"}</div>
              </div>
              {w.awaitingReveal && (
                <button type="button" onClick={async () => { const r = await api<{ secret: string }>(`/api/webhooks/${w.id}/reveal`, { method: "POST" }).catch(() => null); if (r) reveal(w, r.secret); }}
                  className="rounded-full bg-accent px-3 py-1 text-[12.5px] font-medium text-[var(--color-accent-ink)]">{t("Show secret")}</button>
              )}
              <button type="button" title={t("Copy link")} aria-label={t("Copy link")} onClick={() => void navigator.clipboard?.writeText(w.url)} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><Copy size={14} /></button>
              <button type="button" onClick={async () => { const r = await api<{ secret: string }>(`/api/webhooks/${w.id}/rotate`, { method: "POST" }).catch(() => null); if (r) reveal(w, r.secret); }}
                className="rounded-full px-2.5 py-1 text-[12.5px] text-ink-secondary hover:bg-ink/10">{t("New secret")}</button>
              <button type="button" role="switch" aria-checked={w.enabled} aria-label={w.enabled ? t("Pause") : t("Resume")} onClick={() => void api(`/api/webhooks/${w.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !w.enabled }) }).catch(() => {})}
                className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", w.enabled ? "bg-accent" : "bg-ink/20")}><span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-all", w.enabled ? "left-[18px]" : "left-0.5")} /></button>
              <button type="button" onClick={() => toggle(w)} aria-expanded={open === w.id} className="rounded-full px-2.5 py-1 text-[12.5px] text-ink-secondary hover:bg-ink/10">{t("Attempts")}</button>
              <button type="button" title={t("Delete")} aria-label={t("Delete")} onClick={() => confirm(t("Delete this webhook?")) && void api(`/api/webhooks/${w.id}`, { method: "DELETE" }).catch(() => {})} className="rounded-full p-1.5 text-ink-tertiary hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
            </div>
            {open === w.id && (
              <div data-testid="webhook-attempts" className="mt-2 max-h-48 overflow-y-auto border-t border-hairline pt-2">
                {attemptsOf(w.id).length === 0 && <div className="py-2 text-center text-[13px] text-ink-tertiary">{t("No calls yet.")}</div>}
                {attemptsOf(w.id).map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-1 py-0.5 text-[12.5px]">
                    <span className={cn("w-10 shrink-0 text-center font-mono", a.status < 300 ? "text-success" : "text-danger")}>{a.status}</span>
                    <span data-no-i18n="" className="min-w-0 flex-1 truncate text-ink-secondary">{a.result}</span>
                    <span className="shrink-0 tabular-nums text-ink-tertiary">{new Date(a.at).toLocaleTimeString([locale()])}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {state.webhooks.length === 0 && !adding && <div className="py-10 text-center text-[13.5px] text-ink-tertiary">{t("No webhooks yet.")}</div>}
      {adding ? (
        <div className="rounded-xl bg-card p-3 ring-[0.5px] ring-ink/10" data-testid="webhook-form">
          <input data-no-i18n="" value={name} onChange={(e) => setName(e.target.value)} aria-label={t("Name")} placeholder={t("Name, e.g. Deploys")} className={cn(INPUT, "h-9")} />
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label={t("Bot")} className={cn(INPUT, "mt-2 h-9")}>{targets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <textarea data-no-i18n="" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} aria-label={t("Instructions")} placeholder={t("What should the bot do with each event?")} className={cn(INPUT, "mt-2 py-2 leading-5")} />
          <div role="radiogroup" className="mt-2 flex gap-1.5">
            {([["bearer", "Bearer header"], ["url", "Secret in the URL"]] as const).map(([id, text]) => (
              <button key={id} type="button" role="radio" aria-checked={auth === id} onClick={() => setAuth(id)} className={cn("flex-1 rounded-lg px-2 py-1.5 text-[13px] ring-1 ring-ink/10", auth === id && "bg-accent/12 ring-accent/60")}>{t(text)}</button>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="rounded-full px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-ink/10">{t("Cancel")}</button>
            <button type="button" disabled={!name.trim() || !target} onClick={create} className="rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Create webhook")}</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { setAdding(true); setTarget((x) => x || targets[0]?.id || ""); }} className="flex items-center gap-1.5 rounded-full bg-raised px-3.5 py-1.5 text-[13px] font-medium text-ink hover:bg-raised-hover"><Plus size={13} /> {t("New webhook")}</button>
      )}
    </div>
  );
}

// ---- page --------------------------------------------------------------------------------------------------------------
export function AutomationsPage() {
  const { state, dispatch } = useStore();
  const t = useT();
  const [tab, setTab] = useState<"routines" | "webhooks">("routines");
  const [layout, setLayout] = useState<"list" | "calendar">("list");
  const [range, setRange] = useState<Range>(7);
  const [anchor, setAnchor] = useState(() => Date.now());
  const [botFilter, setBotFilter] = useState("all");
  const [editing, setEditing] = useState<Routine | "new" | null>(null);
  const [form, setForm] = useState(false); // a new routine starts with the plain-words step; true once "Set it up yourself" is chosen
  const routines = state.routines.filter((r) => botFilter === "all" || r.targetId === botFilter);
  const runs = state.runs.filter((r) => routines.some((x) => x.id === r.routineId));
  const step = range === 7 ? 7 * DAY : range * DAY;
  const first = range === 7 ? mondayOf(anchor) : startOfDay(anchor);
  const title = new Date(first).toLocaleDateString([locale()], { month: "long", year: "numeric" });
  const seg = (on: boolean) => cn("px-3 py-1 text-[13px]", on ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink");
  const none = state.routines.length === 0;

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col bg-app" data-testid="automations-page">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b-[0.5px] border-edge px-5 max-md:pl-14">
        <button type="button" aria-label="Open bot list" onClick={() => dispatch({ type: "drawer", open: true })} className="-ml-2 rounded-md p-1.5 text-ink-secondary hover:bg-raised md:hidden"><Menu size={20} /></button>
        <button type="button" aria-label={t("Back")} title={t("Back")} onClick={() => dispatch({ type: "automations", open: false })} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10 hover:text-ink"><ArrowLeft size={18} /></button>
        <h1 className="min-w-0 truncate text-[17px] font-semibold text-ink">{t("Automations")}</h1>
        <div className="ml-auto flex items-center gap-2">
          <select value={botFilter} onChange={(e) => setBotFilter(e.target.value)} aria-label={t("Filter by bot")} className="h-9 rounded-xl bg-raised px-3 text-[13.5px] text-ink">
            <option value="all">{t("All bots")}</option>
            {state.bots.filter((b) => !b.hidden).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            {state.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <div role="group" aria-label={t("Layout")} className="flex overflow-hidden rounded-full ring-1 ring-ink/10">
            <button type="button" aria-pressed={layout === "list"} onClick={() => setLayout("list")} className={seg(layout === "list")}>{t("List")}</button>
            <button type="button" aria-pressed={layout === "calendar"} onClick={() => setLayout("calendar")} className={seg(layout === "calendar")}>{t("Calendar")}</button>
          </div>
          <button type="button" aria-label={t("New routine")} onClick={() => setEditing("new")} className="flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-[14px] font-medium text-[var(--color-accent-ink)]"><Plus size={14} /> {t("New")}</button>
        </div>
      </header>
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-edge px-5">
        {(["routines", "webhooks"] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-[14px]", tab === id ? "border-accent text-ink" : "border-transparent text-ink-secondary hover:text-ink")}>{t(id === "routines" ? "Routines" : "Webhooks")}</button>
        ))}
      </div>
      {tab === "webhooks" ? <div className="min-h-0 flex-1 overflow-y-auto"><WebhooksTab /></div> : none ? <EmptyState onNew={() => setEditing("new")} /> : (
        <div className="flex min-h-0 flex-1 flex-col">
          {layout === "calendar" && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 py-2">
              <div className="flex items-center gap-1" role="group" aria-label={t("Navigate")}>
                <button type="button" aria-label={t("Previous")} onClick={() => setAnchor((a) => a - step)} className="rounded-full p-1.5 hover:bg-ink/10"><ChevronLeft size={16} /></button>
                <button type="button" onClick={() => setAnchor(Date.now())} className="rounded-full px-3 py-1 text-[13px] ring-1 ring-ink/10 hover:bg-ink/10">{t("Today")}</button>
                <button type="button" aria-label={t("Next")} onClick={() => setAnchor((a) => a + step)} className="rounded-full p-1.5 hover:bg-ink/10"><ChevronRight size={16} /></button>
              </div>
              <div data-no-i18n="" className="text-[15px] font-medium text-ink">{title}</div>
              <div role="group" aria-label={t("Range")} className="ml-auto flex overflow-hidden rounded-full ring-1 ring-ink/10">
                {([[1, "Day"], [3, "3 days"], [7, "Week"]] as const).map(([n, text]) => <button key={n} type="button" aria-pressed={range === n} onClick={() => setRange(n)} className={seg(range === n)}>{t(text)}</button>)}
              </div>
            </div>
          )}
          {layout === "calendar" ? <CalendarGrid routines={routines} runs={runs} anchor={anchor} range={range} onEdit={setEditing} /> : <div className="min-h-0 flex-1 overflow-y-auto"><RoutineRows routines={routines} onEdit={setEditing} /></div>}
          <RunLog routines={routines} runs={runs} />
        </div>
      )}
      {editing === "new" && !form && <RoutineAsk onForm={() => setForm(true)} onClose={() => setEditing(null)} />}
      {editing && (editing !== "new" || form) && <RoutineEditor key={editing === "new" ? "new" : editing.id} routine={editing === "new" ? null : editing} onClose={() => { setEditing(null); setForm(false); }} />}
    </main>
  );
}
