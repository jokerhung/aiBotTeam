"use client";
import { ChevronLeft, ChevronRight, GripVertical, Search, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { occurrences } from "@/lib/team";
import { locale, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Routine, RoutineRun } from "@/lib/wire";
import { useStore } from "@/state/store";
import { Mascot } from "./Mascot";

export const DAY = 86_400_000;
export const HOUR_PX = 64;
export type Range = 1 | 3 | 7;
export const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const mondayOf = (ms: number) => { const s = startOfDay(ms); const wd = (new Date(s).getDay() + 6) % 7; return s - wd * DAY; };
const clock = (ms: number) => new Date(ms).toLocaleTimeString([locale()], { hour: "numeric", minute: "2-digit" });

const STATUS_TONE: Record<string, string> = {
  done: "bg-success/20 text-success", running: "bg-accent/20 text-accent-text", failed: "bg-danger/15 text-danger", timeout: "bg-danger/15 text-danger",
  skipped: "bg-warning/20 text-warning", cancelled: "bg-ink/10 text-ink-secondary", stopped: "bg-ink/10 text-ink-secondary",
};

/** The month at a glance: a day picks the week on show. */
function MiniMonth({ anchor, onPick }: { anchor: number; onPick: (ms: number) => void }) {
  const [month, setMonth] = useState(() => startOfDay(anchor));
  const first = new Date(month); first.setDate(1);
  const gridStart = mondayOf(first.getTime());
  const [today] = useState(() => startOfDay(Date.now()));
  const sel = startOfDay(anchor);
  const shift = (n: number) => { const d = new Date(first); d.setMonth(d.getMonth() + n); setMonth(d.getTime()); };
  const initials = Array.from({ length: 7 }, (_, i) => new Date(gridStart + i * DAY).toLocaleDateString([locale()], { weekday: "narrow" }));
  return (
    <div className="px-4 pb-3 pt-4" data-testid="mini-month">
      <div className="flex items-center justify-between">
        <div data-no-i18n="" className="text-[14px] font-medium text-ink">{first.toLocaleDateString([locale()], { month: "long", year: "numeric" })}</div>
        <div className="flex">
          <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="rounded-full p-1 text-ink-secondary hover:bg-ink/10"><ChevronLeft size={15} /></button>
          <button type="button" aria-label="Next month" onClick={() => shift(1)} className="rounded-full p-1 text-ink-secondary hover:bg-ink/10"><ChevronRight size={15} /></button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-7 text-center text-[10.5px] font-medium text-ink-tertiary" data-no-i18n="">
        {initials.map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-y-0.5 text-center text-[12.5px]" data-no-i18n="">
        {Array.from({ length: 42 }, (_, i) => {
          const d = gridStart + i * DAY;
          const inMonth = new Date(d).getMonth() === first.getMonth();
          return (
            <button key={d} type="button" onClick={() => onPick(d + 12 * 3_600_000)}
              className={cn("mx-auto flex size-7 items-center justify-center rounded-full tabular-nums", inMonth ? "text-ink" : "text-ink-tertiary/70",
                d === today ? "bg-accent text-[var(--color-accent-ink)]" : d === sel ? "bg-ink/10" : "hover:bg-ink/10")}>
              {new Date(d).getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "My bots": drag one onto the grid to start a routine for it at that time. */
function BotsPanel() {
  const { state } = useStore();
  const t = useT();
  const [q, setQ] = useState("");
  const bots = state.bots.filter((b) => !b.hidden && b.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-edge">
      <div className="flex items-center gap-2 px-4 pb-2 pt-3.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-secondary">
        <Users size={13} /> {t("My bots")}
        <span className="ml-auto rounded-full bg-ink/[0.07] px-1.5 text-[11px] font-medium tabular-nums">{state.bots.filter((b) => !b.hidden).length}</span>
      </div>
      <div className="px-3">
        <label className="flex h-9 items-center gap-2 rounded-xl bg-raised px-3 text-ink-tertiary">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search bots")} aria-label={t("Search bots")} className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-tertiary" />
        </label>
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2">
        {bots.map((b) => (
          <div key={b.id} draggable onDragStart={(e) => { e.dataTransfer.setData("application/x-botteam-bot", b.id); e.dataTransfer.effectAllowed = "copy"; }}
            data-testid="calendar-bot" className="flex cursor-grab items-center gap-2 rounded-lg px-1.5 py-2 hover:bg-raised/60 active:cursor-grabbing">
            <GripVertical size={12} className="shrink-0 text-ink-tertiary/60" />
            <Mascot color={b.color} size={30} />
            <span className="min-w-0 leading-tight">
              <span data-no-i18n="" className="block truncate text-[13.5px] font-medium text-ink">{b.name}</span>
              <span data-no-i18n="" className="block truncate text-[11.5px] text-ink-tertiary">{b.title || "BotAgent"}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="shrink-0 px-4 pb-3 pt-2 text-[11px] text-ink-tertiary">{t("Drag a bot onto any time to schedule it.")}</div>
    </div>
  );
}

function gmtLabel(): string {
  const off = -new Date().getTimezoneOffset() / 60;
  return `GMT${off >= 0 ? "+" : "-"}${Math.abs(off)}`;
}

function Grid({ routines, runs, anchor, range, onEdit, onDropBot }: { routines: Routine[]; runs: RoutineRun[]; anchor: number; range: Range; onEdit: (r: Routine) => void; onDropBot: (botId: string, at: number) => void }) {
  const start = range === 7 ? mondayOf(anchor) : startOfDay(anchor);
  const days = Array.from({ length: range }, (_, i) => start + i * DAY);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = Math.max(0, (new Date().getHours() - 2) * HOUR_PX); }, [range]);
  const byId = useMemo(() => new Map(routines.map((r) => [r.id, r])), [routines]);
  const blocks = (day: number) => {
    const end = day + DAY;
    const future = routines.flatMap((r) => occurrences(r, Math.max(day, now), end).map((at) => ({ key: `${r.id}-${at}`, r, at, run: null as RoutineRun | null })));
    const past = runs.filter((x) => x.startedAt >= day && x.startedAt < end).map((x) => ({ key: x.id, r: byId.get(x.routineId), at: x.startedAt, run: x }));
    return [...past, ...future].filter((b) => b.r);
  };
  const cols = `64px repeat(${range}, minmax(0, 1fr))`;
  return (
    <div ref={scroller} data-testid="calendar-grid" className="min-h-0 flex-1 overflow-auto">
      <div className="sticky top-0 z-10 grid border-b border-edge bg-app" style={{ gridTemplateColumns: cols, height: 68 }}>
        <div className="flex items-start justify-center pt-4 text-[10px] text-ink-tertiary" data-no-i18n="">{gmtLabel()}</div>
        {days.map((d) => {
          const today = startOfDay(now) === d;
          return (
            <div key={d} className={cn("border-l border-edge pt-2.5 text-center", today && "bg-accent/[0.07]")}>
              <div data-no-i18n="" className={cn("text-[10.5px] font-medium uppercase tracking-wide", today ? "text-accent-text" : "text-ink-tertiary")}>{new Date(d).toLocaleDateString([locale()], { weekday: "short" })}</div>
              <div data-no-i18n="" className={cn("mx-auto mt-0.5 flex size-8 items-center justify-center rounded-full text-[16px] font-medium", today ? "bg-accent text-[var(--color-accent-ink)]" : "text-ink")}>{new Date(d).getDate()}</div>
            </div>
          );
        })}
      </div>
      <div className="relative grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR_PX }}>
        <div className="relative">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="absolute right-2 -translate-y-1/2 text-[10.5px] tabular-nums text-ink-tertiary" style={{ top: h * HOUR_PX, display: h === 0 ? "none" : undefined }} data-no-i18n="">
              {new Date(2000, 0, 1, h).toLocaleTimeString([locale()], { hour: "numeric" })}
            </div>
          ))}
        </div>
        {days.map((d) => {
          const today = startOfDay(now) === d;
          return (
            <div key={d} className={cn("relative border-l border-edge", today && "bg-accent/[0.05]")}
              onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-botteam-bot")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
              onDrop={(e) => {
                const id = e.dataTransfer.getData("application/x-botteam-bot");
                if (!id) return;
                e.preventDefault();
                const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                const half = Math.floor((y / HOUR_PX) * 2) / 2; // snap to the half hour
                onDropBot(id, d + half * 3_600_000);
              }}>
              {Array.from({ length: 24 }, (_, h) => <div key={h} className="absolute inset-x-0 border-t border-edge/70" style={{ top: h * HOUR_PX }} />)}
              {today && <div className="absolute inset-x-0 z-[5] h-px bg-danger" style={{ top: ((now - d) / 3_600_000) * HOUR_PX }}><span className="absolute -left-1 -top-[3px] size-[7px] rounded-full bg-danger" /></div>}
              {blocks(d).map((b) => (
                <button key={b.key} type="button" data-testid="routine-block" onClick={() => b.r && onEdit(b.r)} title={`${b.r!.name} · ${clock(b.at)}${b.run ? ` · ${b.run.status}` : ""}`}
                  className={cn("absolute inset-x-1 z-[3] flex items-center gap-1 overflow-hidden rounded-md px-1.5 text-left text-[11.5px] leading-[16px] ring-1 ring-ink/10", b.run ? (STATUS_TONE[b.run.status] ?? "bg-ink/10") : "bg-accent/15 text-accent-text")}
                  style={{ top: ((b.at - d) / 3_600_000) * HOUR_PX, height: 22 }}>
                  <span data-no-i18n="" className="truncate font-medium">{b.r!.name}</span>
                  <span data-no-i18n="" className="ml-auto shrink-0 opacity-70">{clock(b.at)}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The calendar layout: month and bots on the left, the navigation row and the hour grid on the right. */
export function CalendarView({ routines, runs, anchor, setAnchor, range, setRange, onEdit, onDropBot }: {
  routines: Routine[]; runs: RoutineRun[]; anchor: number; setAnchor: (f: (a: number) => number | number) => void; range: Range; setRange: (r: Range) => void;
  onEdit: (r: Routine) => void; onDropBot: (botId: string, at: number) => void;
}) {
  const t = useT();
  const step = range === 7 ? 7 * DAY : range * DAY;
  const first = range === 7 ? mondayOf(anchor) : startOfDay(anchor);
  const last = first + (range - 1) * DAY;
  const fmt = (ms: number, o: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleDateString([locale()], o);
  const title = range === 1 ? fmt(first, { month: "long", day: "numeric", year: "numeric" })
    : new Date(first).getMonth() === new Date(last).getMonth() ? `${fmt(first, { month: "long", day: "numeric" })} – ${new Date(last).getDate()}, ${new Date(last).getFullYear()}`
    : `${fmt(first, { month: "short", day: "numeric" })} – ${fmt(last, { month: "short", day: "numeric", year: "numeric" })}`;
  const seg = (on: boolean) => cn("px-3 py-1 text-[13px]", on ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink");
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="calendar-view">
      <div className="flex h-[50px] shrink-0 items-center gap-2 border-b-[0.5px] border-edge px-5">
        <button type="button" aria-label={t("Previous")} onClick={() => setAnchor((a) => a - step)} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><ChevronLeft size={16} /></button>
        <button type="button" aria-label={t("Next")} onClick={() => setAnchor((a) => a + step)} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><ChevronRight size={16} /></button>
        <div data-no-i18n="" className="ml-1 text-[14.5px] font-medium text-ink">{title}</div>
        <button type="button" onClick={() => setAnchor(() => Date.now())} className="ml-1 rounded-lg bg-composer px-3 py-1 text-[13px] text-ink ring-1 ring-ink/15 hover:bg-ink/[0.05]">{t("Today")}</button>
        <div role="group" aria-label={t("Range")} className="ml-auto flex overflow-hidden rounded-lg ring-1 ring-ink/10">
          {([[1, "Day"], [3, "3 days"], [7, "Week"]] as const).map(([n, text]) => <button key={n} type="button" aria-pressed={range === n} onClick={() => setRange(n)} className={seg(range === n)}>{t(text)}</button>)}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[320px] shrink-0 flex-col border-r-[0.5px] border-edge bg-panel lg:flex" data-testid="calendar-side">
          <MiniMonth key={startOfDay(anchor)} anchor={anchor} onPick={(ms) => setAnchor(() => ms)} />
          <BotsPanel />
        </aside>
        <Grid routines={routines} runs={runs} anchor={anchor} range={range} onEdit={onEdit} onDropBot={onDropBot} />
      </div>
    </div>
  );
}
