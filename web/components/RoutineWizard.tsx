"use client";
import { CalendarClock, Check, ChevronRight, FileText, Share2, UserPlus, X, Clock, AppWindow } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Routine, Webhook } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { Mascot } from "./Mascot";

const INPUT = "rounded-xl bg-inset px-3 text-[14px] text-ink outline-none ring-1 ring-inset ring-ink/[0.07] placeholder:text-ink-tertiary focus:ring-ink/25";
const pad = (n: number) => String(n).padStart(2, "0");
const dateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeStr = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const nextHour = () => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; };

/** Step one of a routine made by hand: what starts it. */
export function WhenStep({ onSchedule, onWebhook, onBack, onClose }: { onSchedule: () => void; onWebhook: () => void; onBack: () => void; onClose: () => void }) {
  const t = useT();
  const [pick, setPick] = useState<"schedule" | "webhook">("schedule");
  const opt = (id: "schedule" | "app" | "webhook", Icon: typeof Clock, text: string, off?: string) => (
    <button key={id} type="button" role="radio" aria-checked={pick === id} disabled={!!off} title={off ? t(off) : undefined} onClick={() => id !== "app" && setPick(id)}
      className={cn("flex h-[47px] w-full items-center gap-3 rounded-xl px-3 text-left text-[14px] ring-1 ring-ink/15", pick === id ? "bg-accent/12 text-ink ring-accent/60" : "text-ink-secondary hover:bg-ink/[0.04]", off && "opacity-50")}>
      <Icon size={15} className="text-accent-text" /> {t(text)}
    </button>
  );
  return (
    <div role="dialog" aria-modal="true" aria-label="When" data-testid="routine-when" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[560px] rounded-[20px] bg-panel p-5 text-ink shadow-xl ring-1 ring-ink/10">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-semibold">{t("When")}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><X size={15} /></button>
        </div>
        <div role="radiogroup" className="mt-4 flex flex-col gap-2">
          {opt("schedule", CalendarClock, "On a schedule")}
          {opt("app", AppWindow, "When something happens in an app", "Needs a connected app")}
          {opt("webhook", Share2, "When another app sends something")}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={onBack} className="rounded-full px-2 py-1.5 text-[13.5px] text-ink-secondary hover:text-ink">{t("Back")}</button>
          <button type="button" onClick={pick === "schedule" ? onSchedule : onWebhook} className="h-9 rounded-full bg-accent px-4 text-[14px] font-medium text-[var(--color-accent-ink)]">{t("Continue")}</button>
        </div>
      </div>
    </div>
  );
}

type Chip = "once" | "day" | "weekdays" | "week" | "custom";

function chipOf(r: Routine | null): Chip {
  if (!r || r.kind === "once") return "once";
  const days = r.days && r.days.length ? [...r.days].sort() : [0, 1, 2, 3, 4, 5, 6];
  if (r.kind === "weekly" || r.kind === "daily") {
    if (days.length === 7) return "day";
    if (days.join() === "0,1,2,3,4") return "weekdays";
    if (days.length === 1) return "week";
    return "custom";
  }
  return "day";
}

/** "New automation": the form of the reference: a title, when it starts and repeats, who does it, what to do; the rest under More options. */
export function AutomationForm({ routine, prefill, onClose }: { routine: Routine | null; prefill?: { botId?: string; at?: number }; onClose: () => void }) {
  const { state } = useStore();
  const t = useT();
  const targets = useMemo(() => [
    ...state.bots.filter((b) => !b.hidden).map((b) => ({ kind: "bot" as const, id: b.id, name: b.name, color: b.color })),
    ...state.groups.map((g) => ({ kind: "group" as const, id: g.id, name: g.name, color: "blue" as const })),
  ], [state.bots, state.groups]);
  const localTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const start = useMemo(() => new Date(routine?.runAt ?? prefill?.at ?? nextHour().getTime()), [routine, prefill]);
  const [title, setTitle] = useState(routine?.name ?? "");
  const [prompt, setPrompt] = useState(routine?.prompt ?? "");
  const [target, setTarget] = useState(routine ? `${routine.targetKind}:${routine.targetId}` : prefill?.botId ? `bot:${prefill.botId}` : targets[0] ? `${targets[0].kind}:${targets[0].id}` : "");
  const [date, setDate] = useState(dateStr(start));
  const [time, setTime] = useState(routine?.at ?? timeStr(start));
  const [chip, setChip] = useState<Chip>(chipOf(routine));
  const [more, setMore] = useState(routine?.kind === "interval");
  const [every, setEvery] = useState(routine?.kind === "interval" ? String(routine.everyMin ?? "") : "");
  const [days, setDays] = useState<number[]>(routine?.days?.length ? routine.days : [0, 1, 2, 3, 4, 5, 6]);
  const [tz, setTz] = useState(routine?.tz ?? localTz);
  const [maxRun, setMaxRun] = useState(routine?.maxRunMin ?? 60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const weekday = (new Date(`${date}T12:00`).getDay() + 6) % 7;
  const chosenDays = chip === "day" ? [0, 1, 2, 3, 4, 5, 6] : chip === "weekdays" ? [0, 1, 2, 3, 4] : chip === "week" ? [weekday] : days;
  const interval = every.trim() !== "";
  const save = async () => {
    const [targetKind, ...rest] = target.split(":");
    const body: Record<string, unknown> = { name: title.trim() || prompt.trim().slice(0, 40), prompt: prompt.trim(), tz, maxRunMin: maxRun };
    if (!routine) { body.targetKind = targetKind; body.targetId = rest.join(":"); }
    if (interval) { body.kind = "interval"; body.everyMin = Number(every); }
    else if (chip === "once") { body.kind = "once"; body.runAt = new Date(`${date}T${time}`).getTime(); }
    else { body.kind = "weekly"; body.at = time; body.days = chosenDays; }
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
  const chips: [Chip, string][] = [["once", "Once"], ["day", "Every day"], ["weekdays", "Weekdays"], ["week", "Every week"]];
  const row = "flex gap-4 px-8 py-3";
  return (
    <div role="dialog" aria-modal="true" aria-label={routine ? "Edit routine" : "New routine"} data-testid="routine-editor"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[94vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[20px] bg-panel text-ink shadow-xl ring-1 ring-ink/10">
        <div className="flex h-[64px] shrink-0 items-center justify-between border-b border-edge px-5">
          <h2 className="text-[15px] font-semibold">{routine ? t("Edit routine") : t("New automation")}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><X size={15} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          <div className="flex items-center gap-3 px-8 pb-2 pt-4">
            <span className="size-4 shrink-0 rounded-[4px] bg-accent" />
            <input data-no-i18n="" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t("Title")} placeholder={t("What should happen?")}
              className="h-11 min-w-0 flex-1 border-b border-ink/70 bg-transparent text-[22px] text-ink outline-none placeholder:text-ink-tertiary" />
          </div>
          <div className={row}>
            <Clock size={17} className="mt-0.5 shrink-0 text-ink-secondary" />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium">{t("When")}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] text-ink-tertiary">{t("Starts")}</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t("Date")} className={cn(INPUT, "h-10 w-[150px]")} />
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label={t("Time")} className={cn(INPUT, "h-10 w-[125px]")} />
              </div>
              <div role="radiogroup" aria-label={t("Repeat")} className="mt-3 flex flex-wrap gap-2">
                {chips.map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={chip === id && !interval} onClick={() => { setChip(id); setEvery(""); }}
                    className={cn("rounded-full px-3.5 py-1 text-[12.5px] ring-1", chip === id && !interval ? "bg-accent/12 text-ink ring-accent/60" : "bg-raised text-ink-secondary ring-transparent hover:bg-raised-hover")}>{t(label)}</button>
                ))}
              </div>
            </div>
          </div>
          <div className={row}>
            <UserPlus size={17} className="mt-0.5 shrink-0 text-ink-secondary" />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium">{t("Who does it")}</div>
              <div role="radiogroup" aria-label={t("Who does it")} className="mt-2 grid grid-cols-2 gap-1.5 rounded-2xl bg-raised p-1.5 ring-1 ring-ink/10">
                {targets.map((x) => {
                  const on = target === `${x.kind}:${x.id}`;
                  return (
                    <button key={`${x.kind}:${x.id}`} type="button" role="radio" aria-checked={on} disabled={!!routine} onClick={() => setTarget(`${x.kind}:${x.id}`)}
                      className={cn("flex h-[48px] items-center gap-2.5 rounded-xl px-3 text-left text-[14px] disabled:opacity-60", on ? "bg-accent/12 ring-1 ring-accent/60" : "hover:bg-ink/[0.05]")}>
                      {x.kind === "bot" ? <Mascot color={x.color} size={26} /> : <span className="flex size-[26px] items-center justify-center rounded-full bg-ink/10 text-[11px]">{t("room")}</span>}
                      <span data-no-i18n="" className="min-w-0 flex-1 truncate">{x.name}</span>
                      {on && <Check size={15} className="shrink-0 text-accent-text" />}
                    </button>
                  );
                })}
              </div>
              <div className="mt-1.5 text-[12px] text-ink-tertiary">{t("This bot owns each scheduled run.")}</div>
            </div>
          </div>
          <div className={row}>
            <FileText size={17} className="mt-3 shrink-0 text-ink-secondary" />
            <textarea data-no-i18n="" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} aria-label={t("Routine message")} placeholder={t("Tell the bot what to do each time")}
              className={cn(INPUT, "min-h-[132px] min-w-0 flex-1 resize-y py-3 leading-5")} />
          </div>
          <div className="px-8 pb-2">
            <button type="button" aria-expanded={more} onClick={() => setMore((v) => !v)} className="flex items-center gap-1 text-[13.5px] text-accent-text hover:underline">
              <ChevronRight size={14} className={cn("transition-transform", more && "rotate-90")} /> {t("More options")}
            </button>
            {more && (
              <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 pl-5 text-[13.5px]" data-testid="more-options">
                <span className="text-ink-secondary">{t("Every N minutes")}</span>
                <span className="flex items-center gap-2"><input type="number" min={5} max={1440} value={every} onChange={(e) => setEvery(e.target.value)} aria-label={t("Minutes")} placeholder="—" className={cn(INPUT, "h-9 w-24")} /><span className="text-ink-tertiary">{t("minutes (5–1440)")}</span></span>
                {!interval && chip !== "once" && (
                  <>
                    <span className="text-ink-secondary">{t("Days")}</span>
                    <span className="flex gap-1" role="group" aria-label={t("Days")}>
                      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
                        <button key={d} type="button" aria-pressed={chosenDays.includes(i)} onClick={() => { setDays(chosenDays.includes(i) ? chosenDays.filter((y) => y !== i) : [...chosenDays, i]); setChip("custom"); }}
                          className={cn("rounded-lg px-2 py-1 text-[12px] ring-1 ring-ink/10", chosenDays.includes(i) ? "bg-accent text-[var(--color-accent-ink)] ring-accent" : "hover:bg-ink/[0.04]")}>{d}</button>
                      ))}
                    </span>
                  </>
                )}
                <span className="text-ink-secondary">{t("Time zone")}</span>
                <input value={tz} onChange={(e) => setTz(e.target.value)} aria-label={t("Time zone")} placeholder="Europe/Paris" className={cn(INPUT, "h-9 w-56")} />
                <span className="text-ink-secondary">{t("Time limit per run (minutes)")}</span>
                <input type="number" min={1} max={1440} value={maxRun} onChange={(e) => setMaxRun(Number(e.target.value))} aria-label={t("Time limit per run (minutes)")} className={cn(INPUT, "h-9 w-24")} />
              </div>
            )}
          </div>
          {error && <div role="alert" className="px-8 pt-2 text-[13px] text-danger">{error}</div>}
        </div>
        <div className="flex h-[66px] shrink-0 items-center justify-end gap-3 border-t border-edge px-6">
          <button type="button" onClick={onClose} className="rounded-full px-3 py-2 text-[14px] text-ink-secondary hover:text-ink">{t("Cancel")}</button>
          <button type="button" disabled={busy || !prompt.trim() || (!interval && chip !== "once" && !chosenDays.length)} onClick={save}
            className="h-10 rounded-full bg-accent px-5 text-[14px] font-medium text-[var(--color-accent-ink)] disabled:bg-ink/10 disabled:text-ink-tertiary">{t("Save")}</button>
        </div>
      </div>
    </div>
  );
}

/** "When another app sends something": who does it and what to do with each event; the secret is shown once afterwards. */
export function WebhookDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (w: Webhook, secret: string) => void }) {
  const { state } = useStore();
  const t = useT();
  const bots = state.bots.filter((b) => !b.hidden);
  const [who, setWho] = useState(bots[0]?.id ?? "");
  const [text, setText] = useState("");
  const [more, setMore] = useState(false);
  const [name, setName] = useState("");
  const [auth, setAuth] = useState<"bearer" | "url">("bearer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = async () => {
    if (!who || !text.trim() || busy) return;
    setBusy(true);
    try {
      const r = await api<{ webhook: Webhook; secret: string }>("/api/webhooks", { method: "POST", body: JSON.stringify({ name: name.trim() || text.trim().slice(0, 40), prompt: text.trim(), targetId: who, auth }) });
      onCreated(r.webhook, r.secret);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="When another app sends something" data-testid="webhook-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[560px] overflow-hidden rounded-[20px] bg-panel text-ink shadow-xl ring-1 ring-ink/10">
        <div className="flex items-start justify-between px-5 pb-4 pt-5">
          <div>
            <h2 className="text-[17px] font-semibold">{t("When another app sends something")}</h2>
            <p className="mt-1 text-[12.5px] text-ink-tertiary">{t("Each time it sends something, your bot does this.")}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><X size={15} /></button>
        </div>
        <div className="border-t border-edge px-5 pb-4 pt-4">
          <div className="text-[13.5px] font-medium">{t("Who should do it?")}</div>
          <div role="radiogroup" aria-label={t("Who should do it?")} className="mt-2.5 grid grid-cols-3 gap-2">
            {bots.map((b) => (
              <button key={b.id} type="button" role="radio" aria-checked={who === b.id} onClick={() => setWho(b.id)}
                className={cn("flex h-[50px] items-center gap-2.5 rounded-xl px-3 text-left text-[14px] ring-1", who === b.id ? "bg-accent/12 ring-accent/60" : "bg-raised ring-ink/10 hover:bg-raised-hover")}>
                <Mascot color={b.color} size={24} /><span data-no-i18n="" className="min-w-0 flex-1 truncate">{b.name}</span>
              </button>
            ))}
          </div>
          <div className="mt-5 text-[13.5px] font-medium">{t("What should it do?")}</div>
          <textarea autoFocus data-no-i18n="" value={text} onChange={(e) => setText(e.target.value)} rows={4} aria-label={t("What should it do?")}
            placeholder={t("e.g. draft a short follow-up email for the person in it")}
            className="mt-2.5 block w-full resize-none rounded-xl bg-inset px-3.5 py-3 text-[14px] leading-5 text-ink outline-none ring-1 ring-inset ring-accent placeholder:text-ink-tertiary" />
          <button type="button" aria-expanded={more} onClick={() => setMore((v) => !v)}
            className="mt-4 flex h-11 w-full items-center gap-2 rounded-xl bg-raised px-3.5 text-left text-[13.5px] ring-1 ring-ink/10">
            <span className={cn("text-[10px] transition-transform", more && "rotate-90")}>▶</span> {t("More")}
          </button>
          {more && (
            <div className="mt-3 flex flex-col gap-2.5" data-testid="webhook-more">
              <input data-no-i18n="" value={name} onChange={(e) => setName(e.target.value)} aria-label={t("Name")} placeholder={t("Name, e.g. Deploys")} className={cn(INPUT, "h-10")} />
              <div role="radiogroup" className="flex gap-1.5">
                {([["bearer", "Bearer header"], ["url", "Secret in the URL"]] as const).map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={auth === id} onClick={() => setAuth(id)}
                    className={cn("flex-1 rounded-lg px-2 py-1.5 text-[13px] ring-1 ring-ink/10", auth === id && "bg-accent/12 ring-accent/60")}>{t(label)}</button>
                ))}
              </div>
            </div>
          )}
          {error && <div role="alert" className="mt-3 text-[13px] text-danger">{error}</div>}
        </div>
        <div className="flex h-[66px] items-center justify-end gap-3 border-t border-edge px-5">
          <button type="button" onClick={onClose} className="rounded-full px-3 py-2 text-[14px] text-ink-secondary hover:text-ink">{t("Cancel")}</button>
          <button type="button" disabled={!who || !text.trim() || busy} onClick={create}
            className="h-10 rounded-full bg-accent px-5 text-[14px] font-medium text-[var(--color-accent-ink)] disabled:bg-ink/10 disabled:text-ink-tertiary">{t("Set it up")}</button>
        </div>
      </div>
    </div>
  );
}
