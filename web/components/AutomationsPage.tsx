"use client";
import { RoutineResourceBadge } from "./RoutineResourceFields";
import { ArrowLeft, CalendarClock, CirclePlay, Copy, History, Menu, Pause, Pencil, Play, Plus, Send, Trash2, X, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { locale, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Routine, RoutineRun, Webhook, WebhookAttempt } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { type Range, type RoutineStatus, CalendarView, routineStatus } from "./AutomationsCalendar";
import { AutomationForm, WebhookDialog, WhenStep } from "./RoutineWizard";

const INPUT = "w-full rounded-lg bg-inset px-3 text-[14px] text-ink outline-none ring-1 ring-inset ring-ink/[0.07] placeholder:text-ink-tertiary focus:ring-ink/25";
const STATUS_TONE: Record<string, string> = {
  done: "bg-success/20 text-success", completed: "bg-success/20 text-success", running: "bg-accent/20 text-accent-text", failed: "bg-danger/15 text-danger", timeout: "bg-danger/15 text-danger",
  skipped: "bg-warning/20 text-warning", cancelled: "bg-ink/10 text-ink-secondary", stopped: "bg-ink/10 text-ink-secondary",
};

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
            {bots.map((b) => <option key={b.id} value={b.id} data-no-i18n="">{b.name}</option>)}
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

// ---- run log ---------------------------------------------------------------------------------------------------------
function RunLog({ routines, runs, compact, onClear, only }: { routines: Routine[]; runs: RoutineRun[]; compact?: boolean; onClear?: () => void; only?: string }) {
  const t = useT();
  const [shownLog, setShownLog] = useState(!compact);
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
    <section aria-label={t("Run log")} data-testid="run-log" className={cn(!compact && "mx-auto w-full max-w-[960px]", compact && "shrink-0 border-t border-edge")}>
      <div className="flex items-center gap-2 px-5 py-2.5">
        <h3 className="text-[14px] font-medium text-ink">
          {compact ? <button type="button" aria-expanded={shownLog} onClick={() => setShownLog((v) => !v)} className="hover:underline">{t("Run log")} {shownLog ? "▾" : "▸"}</button> : t("Run log")}
        </h3>
        {only && onClear && <button type="button" data-testid="run-log-only" onClick={onClear} className="flex items-center gap-1 rounded-full bg-raised px-2.5 py-1 text-[12.5px] text-ink hover:bg-raised-hover"><span data-no-i18n="" className="max-w-[220px] truncate">{only}</span> <X size={12} /></button>}
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("Status")} className="ml-auto rounded-lg bg-inset px-2 py-1 text-[13px] text-ink ring-1 ring-ink/10">
          {["all", "done", "running", "failed", "skipped", "timeout", "cancelled"].map((s) => <option key={s} value={s}>{t(s === "all" ? "All statuses" : s)}</option>)}
        </select>
      </div>
      {shownLog && <div className={cn("overflow-y-auto px-5 pb-3", compact && "max-h-[220px]")}>
        {shown.length === 0 && <div className="py-4 text-center text-[13px] text-ink-tertiary">{t("No runs yet.")}</div>}
        {shown.map((r) => (
          <button key={r.id} type="button" data-testid="run-row" onClick={() => open(r)} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-raised/60">
            <span className={cn("w-[72px] shrink-0 rounded-full px-2 py-0.5 text-center text-[11.5px] font-medium", STATUS_TONE[r.status] ?? "bg-ink/10")}>{t(r.status)}</span>
            <span data-no-i18n="" className="min-w-0 flex-1 truncate text-ink">{byId.get(r.routineId)?.name ?? r.routineId}</span>
            <span data-no-i18n="" className="hidden min-w-0 max-w-[40%] truncate text-ink-tertiary sm:block">{r.detail}</span>
            <span className="shrink-0 tabular-nums text-ink-tertiary">{new Date(r.startedAt).toLocaleString([locale()], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
          </button>
        ))}
      </div>}
    </section>
  );
}

// ---- routines list -----------------------------------------------------------------------------------------------------
/** The reference's switch: 44 x 24, blue when on. */
function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onChange}
      className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-ink/20")}>
      <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

/** The reference lists every automation in one rounded card, a hairline between rows. */
function AutoGroup({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[720px] overflow-hidden rounded-2xl bg-card ring-1 ring-ink/10" data-testid="auto-group">{children}</div>;
}

/** One automation as the reference lists it: a status dot and title, what it does, when it last ran and runs next, the switch on the right. */
function AutoCard({ testid, enabled, title, desc, meta, actions, onToggle, toggleLabel, children }: {
  testid: string; enabled: boolean; title: string; desc: string; meta: string; actions: React.ReactNode; onToggle: () => void; toggleLabel: string; children?: React.ReactNode;
}) {
  return (
    <div data-testid={testid} className="w-full border-t border-edge px-4 py-3.5 first:border-t-0">
      <div className="flex items-start gap-3">
        <span className={cn("mt-[7px] size-2.5 shrink-0 rounded-full", enabled ? "bg-success" : "bg-ink/30")} />
        <div className="min-w-0 flex-1">
          <div data-no-i18n="" className={cn("truncate text-[15px] font-medium leading-6 text-ink", !enabled && "opacity-60")}>{title}</div>
          <div data-no-i18n="" className="truncate text-[13px] leading-[18px] text-ink">{desc}</div>
          <div className="mt-0.5 truncate text-[12.5px] leading-[18px] text-ink-tertiary">{meta}</div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 pt-0.5">{actions}<span className="ml-1.5"><Toggle on={enabled} label={toggleLabel} onChange={onToggle} /></span></div>
      </div>
      {children}
    </div>
  );
}

type Status = RoutineStatus;
const statusOf = routineStatus;
const STATUS_LABEL: Record<Status, string> = { active: "Active", draft: "Draft", paused: "Pause" };
const STATUS_INK: Record<Status, string> = { active: "text-success", draft: "text-warning", paused: "text-ink-tertiary" };

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  const t = useT();
  return <div className={cn("min-w-0", className)}><div className="text-[10.5px] font-medium uppercase tracking-wide text-ink-tertiary">{t(label)}</div><div data-no-i18n="" className="text-[12.5px] leading-[17px] text-ink">{children}</div></div>;
}

/** One routine as a card: its state, name, what it asks, when it runs, who does it, and the few things a person does with it. */
function RoutineCard({ r, onEdit, onHistory, historyOn }: { r: Routine; onEdit: (r: Routine) => void; onHistory: (r: Routine) => void; historyOn: boolean }) {
  const { state } = useStore();
  const t = useT();
  const status = statusOf(r);
  const who = (r.targetKind === "bot" ? state.bots.find((b) => b.id === r.targetId)?.name : state.groups.find((g) => g.id === r.targetId)?.name) ?? "?";
  const act = (p: Promise<unknown>) => void p.catch(() => {});
  const when = (ms: number) => new Date(ms).toLocaleString([locale()], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const ic = "flex size-8 items-center justify-center rounded-lg border border-edge bg-composer text-ink hover:bg-raised";
  return (
    <article data-testid="routine-row" data-status={status} className="relative flex min-w-0 flex-col rounded-2xl border border-edge bg-card p-3.5 shadow-sm">
      <button type="button" title={t("Edit")} aria-label={`${t("Edit")} ${r.name}`} onClick={() => onEdit(r)} className={cn(ic, "absolute right-3 top-3")}><Pencil size={13} /></button>
      <div className={cn("text-[11px] font-semibold uppercase tracking-wide", STATUS_INK[status])}>{t(STATUS_LABEL[status])}</div>
      <h3 data-no-i18n="" className="mt-0.5 truncate pr-10 text-[13px] font-medium text-ink">{r.name}</h3>
      <div data-no-i18n="" tabIndex={0} aria-label={t("Instructions")} className="mt-1.5 max-h-[88px] overflow-y-auto whitespace-pre-wrap break-words pr-1 text-[12px] leading-[17px] text-ink-secondary">{r.prompt}</div>
      {r.resource_id && r.resource_version && <RoutineResourceBadge routine={r} />}
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Fact label="Schedule">{r.schedule}</Fact>
        <Fact label="Timezone">{r.tz || "UTC"}</Fact>
        <Fact label={r.targetKind === "bot" ? "Agent" : "Room"}>{who}</Fact>
        <Fact label="Next run">{r.enabled && r.nextRun ? when(r.nextRun) : "—"}</Fact>
        {r.lastRun ? <Fact label="Last run" className="col-span-2">{when(r.lastRun)}</Fact> : null}
      </div>
      <div className="mt-auto flex items-center gap-1.5 pt-3.5">
        <button type="button" title={t(r.enabled ? "Pause" : "Resume")} aria-label={`${t(r.enabled ? "Pause" : "Resume")} ${r.name}`}
          onClick={() => act(api(`/api/routines/${r.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !r.enabled }) }))} className={ic}>{r.enabled ? <Pause size={13} /> : <Play size={13} />}</button>
        <button type="button" title={t("Run now")} aria-label={`${t("Run now")} ${r.name}`} onClick={() => act(api(`/api/routines/${r.id}/run`, { method: "POST" }))} className={ic}><CirclePlay size={14} /></button>
        <button type="button" title={t("Run log")} aria-label={`${t("Run log")} ${r.name}`} aria-pressed={historyOn} onClick={() => onHistory(r)} className={cn(ic, historyOn && "bg-accent/15")}><History size={14} /></button>
        <button type="button" title={t("Delete routine")} aria-label={`${t("Delete routine")} ${r.name}`} onClick={() => confirm(t("Delete this routine?")) && act(api(`/api/routines/${r.id}`, { method: "DELETE" }))}
          className={cn(ic, "ml-auto text-danger hover:bg-danger/10")}><Trash2 size={14} /></button>
      </div>
    </article>
  );
}

/** The routines as a board of cards under Active / Draft / Pause tabs, each with its count. */
function RoutineRows({ routines, onEdit, historyId, onHistory }: { routines: Routine[]; onEdit: (r: Routine) => void; historyId: string | null; onHistory: (r: Routine) => void }) {
  const t = useT();
  const [tab, setTab] = useState<Status>("active");
  const counts = { active: 0, draft: 0, paused: 0 } as Record<Status, number>;
  routines.forEach((r) => { counts[statusOf(r)] += 1; });
  const shown = routines.filter((r) => statusOf(r) === tab).sort((a, b) => (a.nextRun ?? Infinity) - (b.nextRun ?? Infinity));
  return (
    <div className="px-5 py-4" data-testid="routine-board">
      <div role="tablist" aria-label={t("Routines")} className="mb-3 flex items-center gap-4">
        {(["active", "draft", "paused"] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} data-testid={`routine-tab-${id}`} onClick={() => setTab(id)}
            className={cn("flex items-center gap-1.5 border-b-2 pb-1 text-[14px]", tab === id ? "border-ink font-medium text-ink" : "border-transparent text-ink-secondary hover:text-ink")}>
            {t(STATUS_LABEL[id])} <span className="rounded-full bg-ink/[0.07] px-1.5 text-[11.5px] tabular-nums">{counts[id]}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 && <div className="py-12 text-center text-[13.5px] text-ink-tertiary">{t("No routines here.")}</div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {shown.map((r) => <RoutineCard key={r.id} r={r} onEdit={onEdit} onHistory={onHistory} historyOn={historyId === r.id} />)}
      </div>
    </div>
  );
}

// ---- webhooks ----------------------------------------------------------------------------------------------------------
function WebhooksTab({ fresh }: { fresh?: { id: string; secret: string; url: string } | null }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const targets = useTargets().filter((x) => x.kind === "bot");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  const [auth, setAuth] = useState<"bearer" | "url">("bearer");
  const [shown, setShown] = useState<{ id: string; secret: string; url: string } | null>(fresh ?? null);
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
      <AutoGroup>
      {state.webhooks.map((w) => {
        const bot = state.bots.find((b) => b.id === w.targetId);
        return (
          <AutoCard key={w.id} testid="webhook-row" enabled={w.enabled} title={w.name} desc={`${t("Webhook")} · ${bot?.name ?? "?"}: ${w.prompt || ""}`}
            meta={[w.enabled ? t("On") : t("Paused"), w.lastAt ? `${t("last call")} ${new Date(w.lastAt).toLocaleString([locale()], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : t("no calls yet"), `${hookBase(w)}${w.auth === "url" ? "/…" : ""}`].join(" · ")}
            toggleLabel={w.enabled ? t("Pause") : t("Resume")} onToggle={() => void api(`/api/webhooks/${w.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !w.enabled }) }).catch(() => {})}
            actions={<>
              {w.awaitingReveal && (
                <button type="button" onClick={async () => { const r = await api<{ secret: string }>(`/api/webhooks/${w.id}/reveal`, { method: "POST" }).catch(() => null); if (r) reveal(w, r.secret); }}
                  className="mr-1 rounded-full bg-accent px-3 py-1 text-[12.5px] font-medium text-[var(--color-accent-ink)]">{t("Show secret")}</button>
              )}
              <button type="button" title={t("Copy link")} aria-label={t("Copy link")} onClick={() => void navigator.clipboard?.writeText(w.url)} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><Copy size={14} /></button>
              <button type="button" onClick={async () => { const r = await api<{ secret: string }>(`/api/webhooks/${w.id}/rotate`, { method: "POST" }).catch(() => null); if (r) reveal(w, r.secret); }}
                className="rounded-full px-2.5 py-1 text-[12.5px] text-ink-secondary hover:bg-ink/10">{t("New secret")}</button>
              <button type="button" onClick={() => toggle(w)} aria-expanded={open === w.id} className="rounded-full px-2.5 py-1 text-[12.5px] text-ink-secondary hover:bg-ink/10">{t("Attempts")}</button>
              <button type="button" title={t("Delete")} aria-label={t("Delete")} onClick={() => confirm(t("Delete this webhook?")) && void api(`/api/webhooks/${w.id}`, { method: "DELETE" }).catch(() => {})} className="rounded-full p-1.5 text-ink-tertiary hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
            </>}>
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
          </AutoCard>
        );
      })}
      </AutoGroup>
      {state.webhooks.length === 0 && !adding && <div className="py-10 text-center text-[13.5px] text-ink-tertiary">{t("No webhooks yet.")}</div>}
      {adding ? (
        <div className="rounded-xl bg-card p-3 ring-[0.5px] ring-ink/10" data-testid="webhook-form">
          <input data-no-i18n="" value={name} onChange={(e) => setName(e.target.value)} aria-label={t("Name")} placeholder={t("Name, e.g. Deploys")} className={cn(INPUT, "h-9")} />
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label={t("Bot")} className={cn(INPUT, "mt-2 h-9")}>{targets.map((x) => <option key={x.id} value={x.id} data-no-i18n="">{x.name}</option>)}</select>
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
  const [tab, setTab] = useState<"routines" | "webhooks" | "runs">("routines");
  const [layout, setLayout] = useState<"list" | "calendar">("list");
  const [range, setRange] = useState<Range>(7);
  const [anchor, setAnchorRaw] = useState(() => Date.now());
  const setAnchor = (f: ((a: number) => number) | number) => setAnchorRaw((a) => (typeof f === "function" ? f(a) : f));
  const [botFilter, setBotFilter] = useState("all");
  const [historyId, setHistoryId] = useState<string | null>(null);
  // a new routine goes: plain words -> when -> the form (or a webhook); a bot dropped on the calendar goes straight to the form
  const [editing, setEditing] = useState<Routine | "new" | null>(null);
  const [step, setStep] = useState<"ask" | "when" | "form" | "webhook">("ask");
  const [fresh, setFresh] = useState<{ id: string; secret: string; url: string } | null>(null);
  const [prefill, setPrefill] = useState<{ botId?: string; at?: number } | undefined>();
  const routines = state.routines.filter((r) => botFilter === "all" || r.targetId === botFilter);
  const runs = state.runs.filter((r) => routines.some((x) => x.id === r.routineId));
  const seg = (on: boolean) => cn("px-3 py-1 text-[13px]", on ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink");
  const none = state.routines.length === 0 && state.webhooks.length === 0;
  const close = () => { setEditing(null); setStep("ask"); setPrefill(undefined); };
  const create = () => { setPrefill(undefined); setStep("ask"); setEditing("new"); };

  return (
    <main className={cn("flex min-w-0 flex-1 flex-col bg-app", layout === "calendar" && tab === "routines" ? "fixed inset-0 z-40" : "relative h-full")} data-testid="automations-page">
      <header className="flex min-h-[60px] shrink-0 items-center gap-3 border-b-[0.5px] border-edge px-5 max-[1150px]:flex-wrap max-[1150px]:gap-y-2 max-[1150px]:py-2 max-md:pl-14">
        <button type="button" aria-label="Open bot list" onClick={() => dispatch({ type: "drawer", open: true })} className="-ml-2 rounded-md p-1.5 text-ink-secondary hover:bg-raised md:hidden"><Menu size={20} /></button>
        <button type="button" aria-label={t("Back")} title={t("Back")} onClick={() => dispatch({ type: "automations", open: false })} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10 hover:text-ink"><ArrowLeft size={18} /></button>
        <CalendarClock size={17} className="shrink-0 text-accent-text" aria-hidden />
        <div className="min-w-0 shrink-0 leading-tight">
          <h1 className="truncate text-[17px] font-semibold text-ink">{t("Automations")}</h1>
          <p className="hidden truncate text-[12px] text-ink-tertiary 2xl:block">{t("Routines run on a schedule; webhooks run when something calls them.")}</p>
        </div>
        <div role="tablist" className="ml-3 flex shrink-0 gap-0.5 rounded-lg bg-raised/70 p-0.5">
          {(["routines", "webhooks", "runs"] as const).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={cn("whitespace-nowrap rounded-md px-2.5 py-1 text-[13px]", tab === id ? "bg-app text-ink shadow-sm" : "text-ink-secondary hover:text-ink")}>{t(id === "routines" ? "Routines" : id === "webhooks" ? "Webhooks" : "Run log")}</button>
          ))}
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2 max-[1150px]:w-full max-[1150px]:flex-wrap max-[1150px]:justify-end">
          <select value={botFilter} onChange={(e) => setBotFilter(e.target.value)} aria-label={t("Filter by bot")} className="h-9 w-[150px] min-w-0 rounded-xl bg-raised px-3 text-[13.5px] text-ink max-md:w-auto">
            <option value="all">{t("All bots")}</option>
            {state.bots.filter((b) => !b.hidden).map((b) => <option key={b.id} value={b.id} data-no-i18n="">{b.name}</option>)}
            {state.groups.map((g) => <option key={g.id} value={g.id} data-no-i18n="">{g.name}</option>)}
          </select>
          <div role="group" aria-label={t("Layout")} className="flex shrink-0 overflow-hidden rounded-xl ring-1 ring-ink/10">
            <button type="button" aria-pressed={layout === "list"} onClick={() => setLayout("list")} className={seg(layout === "list")}>{t("List")}</button>
            <button type="button" aria-pressed={layout === "calendar"} onClick={() => setLayout("calendar")} className={seg(layout === "calendar")}>{t("Calendar")}</button>
          </div>
          <button type="button" aria-label={t("New routine")} onClick={create} className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-accent px-4 text-[14px] font-medium text-[var(--color-accent-ink)]"><Plus size={14} /> {t("New routine")}</button>
        </div>
      </header>
      {tab === "webhooks" ? <div className="min-h-0 flex-1 overflow-y-auto"><WebhooksTab key={fresh?.id ?? "tab"} fresh={fresh} /></div>
        : tab === "runs" ? <div className="min-h-0 flex-1 overflow-y-auto" data-testid="run-log-tab"><RunLog routines={historyId ? routines.filter((r) => r.id === historyId) : routines} runs={historyId ? runs.filter((r) => r.routineId === historyId) : runs}
            only={historyId ? routines.find((r) => r.id === historyId)?.name : undefined} onClear={() => setHistoryId(null)} /></div>
        : layout === "calendar" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <CalendarView routines={routines} runs={runs} anchor={anchor} setAnchor={setAnchor} range={range} setRange={setRange} onEdit={(r) => { setEditing(r); setStep("form"); }}
              onDropBot={(botId, at) => { setPrefill({ botId, at }); setEditing("new"); setStep("form"); }} />
          </div>
        ) : none ? <EmptyState onNew={create} /> : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto"><RoutineRows routines={routines} onEdit={(r) => { setEditing(r); setStep("form"); }} historyId={historyId} onHistory={(r) => { setHistoryId(r.id); setTab("runs"); }} /></div>
          </div>
        )}
      {editing === "new" && step === "ask" && <RoutineAsk onForm={() => setStep("when")} onClose={close} />}
      {editing === "new" && step === "when" && <WhenStep onBack={() => setStep("ask")} onClose={close} onSchedule={() => setStep("form")} onWebhook={() => setStep("webhook")} />}
      {editing === "new" && step === "webhook" && <WebhookDialog onClose={close} onCreated={(w, secret) => { setFresh({ id: w.id, secret, url: w.auth === "url" ? `${w.url}/${secret}` : w.url }); close(); setTab("webhooks"); }} />}
      {editing && step === "form" && <AutomationForm key={editing === "new" ? "new" : editing.id} routine={editing === "new" ? null : editing} prefill={prefill} onClose={close} />}
    </main>
  );
}
