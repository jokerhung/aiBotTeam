"use client";
import { Download, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { locale, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Bot } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";

interface Logged { type: string; eventId: string; createdAt: string; turnId?: string | null; data: Record<string, unknown> }
interface Run { turnId: string; threadId: string; thread: string; startedAt: number | null; endedAt: number | null; durationMs: number | null; ok: boolean | null; error: string | null;
  tools: { name: string; summary: string; ms: number | null; ok: boolean | null }[]; usage: { input?: number; output?: number } }
interface Span { kind: string; name: string; detail: string; startMs: number; endMs: number; ok: boolean | null }
interface Trace { turnId: string; totalMs: number; firstTextMs: number | null; spans: Span[] }

const dur = (ms: number | null) => (ms === null ? "—" : ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`);
const clock = (at: number | string | null) => (at === null ? "" : new Date(at).toLocaleTimeString([locale()], { hour: "numeric", minute: "2-digit", second: "2-digit" }));

/** The bars of one turn on a time line: each tool call from its start to its end, and when the first words of the reply came. */
export function TraceWaterfall({ thread, turn }: { thread: string; turn: string }) {
  const t = useT();
  const [tr, setTr] = useState<Trace | null>(null);
  useEffect(() => { api<Trace>(`/api/threads/${thread}/trace?turn=${turn}`).then(setTr).catch(() => {}); }, [thread, turn]);
  if (!tr) return <div className="py-2 text-[12px] text-ink-tertiary">…</div>;
  const total = Math.max(tr.totalMs, 1);
  return (
    <div data-testid="waterfall" className="mt-1.5 rounded-lg bg-inset p-2.5" role="img" aria-label={`${t("Timeline")}: ${dur(tr.totalMs)}`}>
      <div className="mb-1.5 flex justify-between text-[11px] tabular-nums text-ink-tertiary"><span>0</span><span>{dur(tr.totalMs)}</span></div>
      <div className="flex flex-col gap-1">
        {tr.firstTextMs !== null && (
          <div className="relative h-4 rounded bg-ink/[0.04]"><div className="absolute inset-y-0 w-0.5 bg-accent" style={{ left: `${(tr.firstTextMs / total) * 100}%` }} /><span className="absolute left-1 top-0 text-[10.5px] text-ink-tertiary">{t("reply")} {dur(tr.firstTextMs)}</span></div>
        )}
        {tr.spans.length === 0 && <div className="text-[12px] text-ink-tertiary">{t("No tool calls in this turn.")}</div>}
        {tr.spans.map((s, i) => (
          <div key={i} className="relative h-5 rounded bg-ink/[0.04]" title={`${s.name} ${s.detail} · ${dur(s.endMs - s.startMs)}`}>
            <div className={cn("absolute inset-y-0 rounded", s.ok === false ? "bg-danger/60" : s.kind === "retry" ? "bg-warning/60" : "bg-accent/60")}
              style={{ left: `${(s.startMs / total) * 100}%`, width: `${Math.max(((s.endMs - s.startMs) / total) * 100, 1.5)}%` }} />
            <span data-no-i18n="" className="absolute left-1 top-0 max-w-full truncate font-mono text-[10.5px] leading-5 text-ink">{s.name} · {dur(s.endMs - s.startMs)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The recent runs of a bot: when, how long, which tools, what it used; open one for its timeline. */
export function ActivityPanel({ bot }: { bot: Bot }) {
  const t = useT();
  const [runs, setRuns] = useState<Run[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { api<{ runs: Run[] }>(`/api/bots/${bot.id}/runs?limit=30`).then((r) => setRuns(r.runs)).catch(() => {}); }, [bot.id, bot.busy]);
  return (
    <div className="px-6 pb-6" data-testid="activity-view">
      {runs.length === 0 && <div className="py-10 text-center text-[13px] text-ink-tertiary">{t("Nothing has run for this bot yet.")}</div>}
      {runs.map((r) => (
        <div key={r.turnId} data-testid="run-card" className="border-b border-hairline/60 py-2 text-[13px]">
          <button type="button" aria-expanded={open === r.turnId} onClick={() => setOpen(open === r.turnId ? null : r.turnId)} className="flex w-full items-center gap-2 text-left">
            <span className={cn("size-2 shrink-0 rounded-full", r.ok === false || r.error ? "bg-danger" : r.ok ? "bg-success" : "animate-pulse bg-accent")} />
            <span className="tabular-nums text-ink">{clock(r.startedAt)}</span>
            <span className="min-w-0 flex-1 truncate text-ink-tertiary" data-no-i18n="">{r.thread}</span>
            <span className="shrink-0 tabular-nums text-ink-secondary">{dur(r.durationMs)}</span>
          </button>
          <div className="mt-1 flex flex-wrap gap-1 pl-4">
            {r.tools.map((x, i) => <span key={i} data-no-i18n="" className={cn("rounded-full px-2 py-0.5 font-mono text-[11px] ring-1 ring-ink/10", x.ok === false && "text-danger")}>{x.name}{x.ms !== null && ` · ${dur(x.ms)}`}</span>)}
            {r.usage.output !== undefined && <span className="ml-auto text-[11.5px] tabular-nums text-ink-tertiary">{r.usage.input ?? 0} → {r.usage.output} {t("tokens")}</span>}
          </div>
          {r.error && <div className="mt-1 pl-4 text-[12px] text-danger" data-no-i18n="">{r.error}</div>}
          {open === r.turnId && <TraceWaterfall thread={r.threadId} turn={r.turnId} />}
        </div>
      ))}
    </div>
  );
}

/** The thread's event log: a time line, filtered by kind, with each event's raw JSON one click away. */
export function InspectorPanel({ bot }: { bot: Bot }) {
  const t = useT();
  const [events, setEvents] = useState<Logged[]>([]);
  const [kind, setKind] = useState("all");
  useEffect(() => { api<{ events: Logged[] }>(`/api/threads/${bot.threadId}/events?limit=400`).then((r) => setEvents(r.events)).catch(() => {}); }, [bot.threadId, bot.busy]);
  const kinds = useMemo(() => ["all", ...new Set(events.map((e) => e.type.split(".")[0]))], [events]);
  const shown = events.filter((e) => kind === "all" || e.type.startsWith(kind));
  return (
    <div className="px-6 pb-6" data-testid="inspector-view">
      <div className="flex flex-wrap gap-1.5 pb-2" role="group" aria-label={t("Filter by kind")}>
        {kinds.map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cn("rounded-full px-2.5 py-0.5 text-[12px] ring-1 ring-ink/10", kind === k ? "bg-accent/12 ring-accent/60" : "hover:bg-ink/[0.05]")}>{k === "all" ? t("All") : k}</button>)}
      </div>
      {shown.length === 0 && <div className="py-10 text-center text-[13px] text-ink-tertiary">{t("No events recorded for this conversation.")}</div>}
      {shown.slice().reverse().map((e, i) => (
        <details key={`${e.eventId}-${i}`} className="border-b border-hairline/60 py-1.5 text-[12.5px]" data-testid="event-row">
          <summary className="flex cursor-pointer items-center gap-2"><span className="tabular-nums text-ink-tertiary">{clock(e.createdAt || null)}</span><span className="font-mono text-ink">{e.type}</span>
            {e.turnId && <span className="ml-auto font-mono text-[11px] text-ink-tertiary">{e.turnId.slice(-6)}</span>}</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-inset p-2 font-mono text-[11.5px] text-ink-secondary" data-no-i18n="">{JSON.stringify(e, null, 1)}</pre>
        </details>
      ))}
    </div>
  );
}

/** How full the conversation is, in the composer: the tokens held against what the model can hold. */
export function ContextMeter({ bot }: { bot: Bot }) {
  const t = useT();
  const used = bot.usage.contextTokens ?? 0;
  const win = bot.usage.contextWindow ?? 0;
  if (!used || !win) return null;
  const pct = Math.min(100, Math.round((used / win) * 100));
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  return (
    <span data-testid="context-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${t("Context used")}: ${pct}%`} title={`${t("Context used")}: ${k(used)} / ${k(win)}`}
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-ink/[0.05] px-2 text-[11.5px] tabular-nums text-ink-secondary">
      <span className="h-1.5 w-8 overflow-hidden rounded-full bg-ink/15"><span className={cn("block h-full rounded-full", pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-success")} style={{ width: `${pct}%` }} /></span>{pct}%
    </span>
  );
}

interface UsageRow { key: string; input: number; output: number; cost: number; turns: number }
interface UsageData { rows: UsageRow[]; total: { input: number; output: number; cost: number; turns: number }; limits: Record<string, { resetsAt: number; limit?: string }> }

/** Tokens and cost by day, bot or model, with the total, and when a usage limit resets. */
export function UsagePage() {
  const { state, dispatch } = useStore();
  const t = useT();
  const [by, setBy] = useState<"day" | "bot" | "model">("day");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<UsageData | null>(null);
  useEffect(() => {
    if (!state.usageOpen) return;
    const since = days ? Date.now() - days * 86_400_000 : 0;
    api<UsageData>(`/api/usage?by=${by}&since=${since}`).then(setData).catch(() => {});
  }, [state.usageOpen, by, days]);
  if (!state.usageOpen) return null;
  const max = Math.max(1, ...(data?.rows.map((r) => r.input + r.output) ?? [1]));
  const close = () => dispatch({ type: "usage", open: false });
  const seg = (on: boolean) => cn("px-3 py-1 text-[13px]", on ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink");
  const fmt = (n: number) => n.toLocaleString([locale()]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Usage" data-testid="usage-page" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="flex max-h-[88vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[20px] bg-panel text-ink shadow-xl ring-1 ring-ink/10">
        <div className="flex h-[60px] shrink-0 items-center gap-3 px-5">
          <h2 className="flex-1 text-[17px] font-semibold">{t("Usage")}</h2>
          <div role="group" aria-label={t("Group by")} className="flex overflow-hidden rounded-lg ring-1 ring-ink/10">
            {(["day", "bot", "model"] as const).map((k) => <button key={k} type="button" aria-pressed={by === k} onClick={() => setBy(k)} className={seg(by === k)}>{t(k === "day" ? "By day" : k === "bot" ? "By bot" : "By model")}</button>)}
          </div>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t("Period")} className="h-8 rounded-lg bg-raised px-2 text-[13px]"><option value={7}>{t("7 days")}</option><option value={30}>{t("30 days")}</option><option value={0}>{t("All time")}</option></select>
          <button type="button" aria-label="Close" onClick={close} className="rounded-full p-1.5 hover:bg-ink/10"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {data && (
            <>
              <div className="grid grid-cols-4 gap-2" data-testid="usage-total">
                {[[t("Turns"), data.total.turns], [t("Input tokens"), data.total.input], [t("Output tokens"), data.total.output], [t("Cost"), data.total.cost ? `$${data.total.cost.toFixed(2)}` : "—"]].map(([label, v]) => (
                  <div key={String(label)} className="rounded-xl bg-raised/60 px-3 py-2"><div className="text-[11.5px] text-ink-tertiary">{label}</div><div className="text-[17px] font-semibold tabular-nums" data-testid={`total-${String(label).toLowerCase().replace(/\s/g, "-")}`}>{typeof v === "number" ? fmt(v) : v}</div></div>
                ))}
              </div>
              {Object.entries(data.limits).map(([inst, l]) => (
                <div key={inst} role="status" className="mt-3 rounded-xl bg-warning/10 px-3 py-2 text-[13px]" data-testid="limit-reset"><span data-no-i18n="">{inst}</span> {t("hit its usage limit; it resets at")} {new Date(l.resetsAt).toLocaleString([locale()], { weekday: "short", hour: "numeric", minute: "2-digit" })}</div>
              ))}
              <div className="mt-4 flex flex-col gap-1.5" data-testid="usage-rows">
                {data.rows.length === 0 && <div className="py-8 text-center text-[13.5px] text-ink-tertiary">{t("Nothing used in this period.")}</div>}
                {data.rows.map((r) => (
                  <div key={r.key} className="grid grid-cols-[120px_1fr_auto] items-center gap-3 text-[13px]" data-testid="usage-row">
                    <span data-no-i18n="" className="truncate text-ink-secondary">{r.key}</span>
                    <span className="h-3 overflow-hidden rounded bg-ink/[0.06]"><span className="block h-full rounded bg-accent/70" style={{ width: `${((r.input + r.output) / max) * 100}%` }} /></span>
                    <span className="tabular-nums text-ink-tertiary">{fmt(r.input + r.output)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Save the transcript of this conversation as Markdown or JSON. */
export function ExportButtons({ bot }: { bot: Bot }) {
  const t = useT();
  const link = (format: "md" | "json") => `/api/bots/${bot.id}/export?thread=${bot.threadId}&format=${format}`;
  const cls = "flex items-center gap-1.5 rounded-full bg-raised px-3 py-1.5 text-[13px] hover:bg-raised-hover";
  return (
    <div className="flex gap-2" data-testid="export-buttons">
      <a href={link("md")} download className={cls}><Download size={13} /> {t("Markdown")}</a>
      <a href={link("json")} download className={cls}><Download size={13} /> JSON</a>
    </div>
  );
}
