"use client";
import { Check, CircleAlert, RefreshCw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { RELEASES } from "@/lib/whats-new";
import { cn } from "@/lib/utils";
import type { InstanceInfo, MausColor } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { Mascot } from "./Mascot";

export const WELCOMED_KEY = "botteam-welcomed";
export const TOUR_KEY = "botteam-tour-done";
export const SEEN_RELEASE_KEY = "botteam-seen-release";
const INPUT = "w-full rounded-lg bg-inset px-3 text-[14px] text-ink outline-none ring-1 ring-inset ring-ink/[0.07] placeholder:text-ink-tertiary focus:ring-ink/25";

const SETUP: Record<string, { install: string; signIn: string }> = {
  claude: { install: "npm install -g @anthropic-ai/claude-code", signIn: "claude  (then sign in when it asks)" },
  codex: { install: "npm install -g @openai/codex", signIn: "codex login" },
};

function EngineRow({ inst, onCheck }: { inst: InstanceInfo; onCheck: () => void }) {
  const t = useT();
  const ready = inst.snapshot.state === "available" && inst.snapshot.signedIn !== false;
  const help = SETUP[inst.id] ?? SETUP[inst.driver];
  return (
    <div data-testid="engine-row" className="rounded-xl bg-raised/60 px-3.5 py-3">
      <div className="flex items-center gap-2">
        {ready ? <Check size={16} className="text-success" /> : <CircleAlert size={16} className="text-warning" />}
        <span data-no-i18n="" className="text-[14.5px] font-medium">{inst.displayName}</span>
        <span className={cn("text-[12.5px]", ready ? "text-success" : "text-warning")}>{ready ? t("Ready") : inst.snapshot.state === "available" ? t("Needs sign-in") : t("Not installed")}</span>
        {inst.snapshot.version && <span data-no-i18n="" className="ml-auto text-[12px] text-ink-tertiary">{inst.snapshot.version}</span>}
      </div>
      {!ready && help && (
        <div className="mt-2 text-[12.5px] leading-5 text-ink-secondary">
          {inst.snapshot.state !== "available" && <div>{t("Install it:")} <code data-no-i18n="" className="rounded bg-inset px-1.5 py-0.5 font-mono">{help.install}</code></div>}
          <div>{t("Then sign in:")} <code data-no-i18n="" className="rounded bg-inset px-1.5 py-0.5 font-mono">{help.signIn}</code></div>
          <button type="button" onClick={onCheck} className="mt-1.5 flex items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] text-accent-text hover:bg-ink/10"><RefreshCw size={12} /> {t("Check again")}</button>
        </div>
      )}
    </div>
  );
}

/** The first screen of a new install: which engines are ready, how to get one, and the first bot. */
export function WelcomeGate() {
  const { state, dispatch } = useStore();
  const t = useT();
  const [skipped, setSkipped] = useState(() => { try { return localStorage.getItem(WELCOMED_KEY) === "1"; } catch { return false; } });
  const [name, setName] = useState("Maple");
  const [preset, setPreset] = useState("assistant");
  const [presets, setPresets] = useState<{ id: string; name: string; title: string; description: string; color: MausColor; instructions: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const real = state.instances.filter((i) => i.driver !== "echo" && !i.hidden);
  const anyReady = real.some((i) => i.snapshot.state === "available" && i.snapshot.signedIn !== false);
  useEffect(() => { api<{ presets: typeof presets }>("/api/presets").then((r) => setPresets(r.presets)).catch(() => {}); }, []);
  const check = useCallback(async (id: string) => { await api(`/api/instances/${id}/check`, { method: "POST" }).catch(() => {}); }, []);
  if (!state.hydrated || state.bots.length > 0 || state.groups.length > 0 || skipped) return null;
  const finish = () => { try { localStorage.setItem(WELCOMED_KEY, "1"); } catch { /* storage unavailable */ } setSkipped(true); };
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const p = presets.find((x) => x.id === preset);
      const bot = await api<{ id: string }>("/api/bots", { method: "POST", body: JSON.stringify({ name: name.trim(), title: p?.title ?? "", description: p?.description ?? "", color: p?.color, greet: true }) });
      if (p?.instructions) await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ soul: p.instructions }) });
      dispatch({ type: "select", id: bot.id });
      finish();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Welcome" data-testid="welcome" className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-app p-6 text-ink">
      <div className="w-full max-w-[520px] py-6">
        <div className="mb-4 flex items-center gap-3"><Mascot color="green" size={56} /><div><h1 className="text-[24px] font-semibold leading-tight">{t("Welcome to BotTeam")}</h1><p className="text-[14px] text-ink-secondary">{t("Your own team of AI bots, in a chat app.")}</p></div></div>
        <section aria-label={t("Engines")} className="mt-5">
          <h2 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{t("1. An AI engine")}</h2>
          <div className="flex flex-col gap-2">{real.map((i) => <EngineRow key={i.id} inst={i} onCheck={() => void check(i.id)} />)}</div>
          {real.length === 0 && <div className="text-[13px] text-ink-tertiary">{t("No engine was found yet.")}</div>}
          <button type="button" onClick={() => { dispatch({ type: "settings", open: true, page: "engines" }); }} className="mt-2 text-[13px] text-accent-text hover:underline">{t("Or add an OpenAI-compatible endpoint")}</button>
          {!anyReady && <p className="mt-2 text-[12.5px] text-warning" role="status">{t("You can make a bot now; it will answer once an engine is ready.")}</p>}
        </section>
        <section aria-label={t("First bot")} className="mt-6">
          <h2 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{t("2. Your first bot")}</h2>
          <select value={preset} onChange={(e) => { setPreset(e.target.value); const p = presets.find((x) => x.id === e.target.value); if (p) setName(p.name); }} aria-label={t("Starting role")} className={cn(INPUT, "mb-2 h-10")}>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <input data-no-i18n="" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && void create()} aria-label={t("Name")} className={cn(INPUT, "h-10")} />
          {error && <div role="alert" className="mt-2 text-[13px] text-danger">{error}</div>}
          <div className="mt-4 flex items-center justify-between">
            <button type="button" onClick={finish} className="text-[13px] text-ink-secondary hover:text-ink">{t("Skip for now")}</button>
            <button type="button" disabled={busy || !name.trim()} onClick={create} data-testid="welcome-create" className="flex h-10 items-center gap-1.5 rounded-full bg-accent px-5 text-[14px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40"><Sparkles size={15} /> {t("Meet your bot")}</button>
          </div>
        </section>
      </div>
    </div>
  );
}

interface Step { target: string; title: string; text: string }
const STEPS: Step[] = [
  { target: "model", title: "Choose the model", text: "Each bot has its own model. Change it here whenever a task needs more, or less." },
  { target: "computer", title: "Watch it work", text: "The computer panel shows the browser your bot uses, and lets you take over when it needs you." },
  { target: "automations", title: "Let it work alone", text: "Open your profile menu, then Automations, to run a bot on a schedule or when another app calls." },
];

/** A short spotlight tour after the first bot exists: the model picker, the computer panel and automations. Shown once. */
export function GuidedTour() {
  const { state } = useStore();
  const t = useT();
  const [i, setI] = useState(0);
  const [done, setDone] = useState(() => { try { return localStorage.getItem(TOUR_KEY) === "1"; } catch { return true; } });
  const [rect, setRect] = useState<DOMRect | null>(null);
  const welcomed = (() => { try { return localStorage.getItem(WELCOMED_KEY) === "1"; } catch { return false; } })();
  const active = !done && state.hydrated && state.bots.length > 0 && welcomed && !state.settingsOpen && !state.newBotOpen;
  const step = STEPS[i];
  useEffect(() => {
    if (!active) return;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      const r = el?.getBoundingClientRect();
      setRect(r && r.width > 0 ? r : null);
    };
    measure();
    const id = setInterval(measure, 500);
    window.addEventListener("resize", measure);
    return () => { clearInterval(id); window.removeEventListener("resize", measure); };
  }, [active, step?.target]);
  if (!active) return null;
  const finish = () => { try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* storage unavailable */ } setDone(true); };
  const next = () => (i + 1 < STEPS.length ? setI(i + 1) : finish());
  const pad = 6;
  const style = rect
    ? { top: Math.min(rect.bottom + 14, window.innerHeight - 190), left: Math.max(12, Math.min(rect.left, window.innerWidth - 332)) }
    : { top: "40%", left: "calc(50% - 160px)" };
  return (
    <div data-testid="tour" className="pointer-events-none fixed inset-0 z-[75]">
      {rect && <div className="pointer-events-none absolute rounded-xl ring-2 ring-accent" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.45)" }} />}
      <div role="group" aria-label={t(step.title)} className="pointer-events-auto absolute w-[320px] rounded-2xl bg-panel p-4 text-ink shadow-xl ring-1 ring-ink/10" style={style}>
        <div className="flex items-start gap-2"><h2 className="flex-1 text-[15px] font-semibold">{t(step.title)}</h2><button type="button" aria-label={t("Skip tour")} onClick={finish} className="rounded-full p-1 hover:bg-ink/10"><X size={14} /></button></div>
        <p className="mt-1 text-[13.5px] leading-5 text-ink-secondary">{t(step.text)}</p>
        <div className="mt-3 flex items-center justify-between"><span className="text-[12px] tabular-nums text-ink-tertiary">{i + 1} / {STEPS.length}</span>
          <button type="button" onClick={next} data-testid="tour-next" className="h-8 rounded-full bg-accent px-4 text-[13px] font-medium text-[var(--color-accent-ink)]">{i + 1 < STEPS.length ? t("Next") : t("Done")}</button></div>
      </div>
    </div>
  );
}

/** "What's new": the releases, newest first. */
export function WhatsNew() {
  const { state, dispatch } = useStore();
  const t = useT();
  if (!state.whatsNewOpen) return null;
  const close = () => { try { localStorage.setItem(SEEN_RELEASE_KEY, RELEASES[0].id); } catch { /* storage unavailable */ } dispatch({ type: "whatsNew", open: false }); };
  return (
    <div role="dialog" aria-modal="true" aria-label="What's new" data-testid="whats-new" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="flex max-h-[88vh] w-full max-w-[480px] flex-col overflow-hidden rounded-[20px] bg-panel text-ink shadow-xl ring-1 ring-ink/10">
        <div className="flex h-14 shrink-0 items-center px-5"><h2 className="flex-1 text-[17px] font-semibold">{t("What's new")}</h2><button type="button" aria-label="Close" onClick={close} className="rounded-full p-1.5 hover:bg-ink/10"><X size={16} /></button></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {RELEASES.map((r) => (
            <section key={r.id} className="mb-4"><div className="text-[12px] tabular-nums text-ink-tertiary">{r.date}</div><h3 className="text-[15px] font-medium">{t(r.title)}</h3>
              <ul className="mt-1 list-disc pl-5 text-[13.5px] leading-5 text-ink-secondary">{r.items.map((x) => <li key={x}>{t(x)}</li>)}</ul></section>
          ))}
        </div>
      </div>
    </div>
  );
}
