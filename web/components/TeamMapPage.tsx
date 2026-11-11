"use client";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { Mascot } from "./Mascot";

interface Link { id: string; from: string; to: string; status: string }

/** The team as a map: the Chief on top, the bots below, a line between a bot and the bots it handed work to; a line
 * carries moving dashes while the work behind it runs. */
export function TeamMapPage() {
  const { state, dispatch } = useStore();
  const t = useT();
  const [links, setLinks] = useState<Link[]>([]);
  useEffect(() => {
    let dead = false;
    const load = () => api<{ assignments: { id: string; botId: string; status: string; parentId: string | null }[] }>("/api/assignments")
      .then((r) => {
        if (dead) return;
        const owner = new Map(r.assignments.map((x) => [x.id, x.botId]));
        setLinks(r.assignments.filter((x) => x.parentId && owner.get(x.parentId)).map((x) => ({ id: x.id, from: owner.get(x.parentId!)!, to: x.botId, status: x.status })));
      })
      .catch(() => {});
    void load();
    const id = setInterval(load, 3000);
    return () => { dead = true; clearInterval(id); };
  }, []);

  const bots = state.bots.filter((b) => !b.hidden);
  const chief = bots.find((b) => b.chief);
  const rest = bots.filter((b) => b !== chief);
  const boss = (b: (typeof bots)[number]) => bots.find((x) => x.id === b.reportsTo) ?? chief;
  const W = 920, H = 520;
  const pos = new Map<string, { x: number; y: number }>();
  if (chief) pos.set(chief.id, { x: W / 2, y: 90 });
  rest.forEach((b, i) => pos.set(b.id, { x: ((i + 1) * W) / (rest.length + 1), y: chief ? 340 : 220 }));
  const active = (s: string) => s === "running" || s === "queued" || s === "waiting" || s === "resume";
  return (
    <main data-testid="team-map" className="relative flex h-full min-w-0 flex-1 flex-col bg-app">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b-[0.5px] border-edge px-5 max-md:pl-14">
        <button type="button" aria-label={t("Back")} title={t("Back")} onClick={() => dispatch({ type: "teamMap", open: false })} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10 hover:text-ink"><ArrowLeft size={18} /></button>
        <h1 className="text-[17px] font-semibold text-ink">{t("Team map")}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-full max-h-[620px] w-full max-w-[1000px]" role="img" aria-label={t("Team map")}>
          {rest.map((b) => boss(b) && pos.get(b.id) && (
            <line key={`org-${b.id}`} x1={pos.get(boss(b)!.id)!.x} y1={pos.get(boss(b)!.id)!.y + 34} x2={pos.get(b.id)!.x} y2={pos.get(b.id)!.y - 34} stroke="currentColor" className="text-ink/15" strokeWidth={1.5} />
          ))}
          {links.map((l) => {
            const a = pos.get(l.from), b = pos.get(l.to);
            if (!a || !b) return null;
            const on = active(l.status);
            return (
              <path key={l.id} data-testid="team-link" data-active={on ? "" : undefined} d={`M ${a.x} ${a.y} C ${a.x} ${(a.y + b.y) / 2 + 60}, ${b.x} ${(a.y + b.y) / 2 + 60}, ${b.x} ${b.y}`}
                fill="none" stroke="var(--color-accent)" strokeWidth={on ? 2.5 : 1.5} strokeDasharray={on ? "6 6" : undefined} opacity={on ? 1 : 0.35} className={cn(on && "animate-link-flow")} />
            );
          })}
          {bots.map((b) => {
            const p = pos.get(b.id)!;
            return (
              <g key={b.id} transform={`translate(${p.x - 30}, ${p.y - 40})`} className="cursor-pointer" onClick={() => dispatch({ type: "select", id: b.id })}>
                <foreignObject width={60} height={60}><Mascot color={b.color} size={60} busy={b.busy} /></foreignObject>
                <text x={30} y={78} textAnchor="middle" fontSize={13} fill="currentColor" className="fill-ink" data-no-i18n="">{b.name}{b.chief ? " ★" : ""}</text>
                <text x={30} y={95} textAnchor="middle" fontSize={11} fill="currentColor" className="fill-ink-tertiary" data-no-i18n="">{b.waitingFor?.length ? `${t("Waiting for teammates")}` : b.busy ? t("Working…") : b.title}</text>
              </g>
            );
          })}
        </svg>
        {bots.length === 0 && <div className="py-20 text-center text-[14px] text-ink-secondary">{t("No bots yet.")}</div>}
      </div>
    </main>
  );
}
