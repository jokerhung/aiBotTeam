"use client";
import { Globe, Hand, Moon, Monitor, Send, Settings, X } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { lastControl, lastScreen, subscribeComputer, type ComputerControl, type Screen } from "@/lib/screens";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Bot } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { Routines } from "./BotPanel";
import { toast } from "./Toaster";

interface ComputerState extends ComputerControl { available: boolean; reason?: string | null; browser?: string; url?: string | null; allowLocal?: boolean }

const IDLE: ComputerControl = { running: false, held: false, helpReason: null };

/** The bot's own browser, live: what it is looking at, a way to take it over (a sign-in, a CAPTCHA) and to hand it back. */
export function ComputerPanel({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const t = useT();
  const [info, setInfo] = useState<ComputerState | null>(null);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const [address, setAddress] = useState("");
  const base = `/api/bots/${bot.id}/computer`;
  const screen = useSyncExternalStore(subscribeComputer, () => lastScreen(bot.id), () => undefined);
  const live = useSyncExternalStore(subscribeComputer, () => lastControl(bot.id), () => undefined);
  const state: ComputerControl = live ?? (info ? { running: info.running, held: info.held, helpReason: info.helpReason } : IDLE);
  const [still, setStill] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    api<ComputerState>(base).then((r) => { if (!dead) setInfo(r); }).catch(() => {});
    return () => { dead = true; };
  }, [base]);

  // pictures are sent only while someone watches
  useEffect(() => {
    if (!state.running) return;
    void api(`${base}/watch`, { method: "POST", body: JSON.stringify({ on: true }) }).catch(() => {});
    return () => { void fetch(`${base}/watch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: false }), keepalive: true }).catch(() => {}); };
  }, [base, state.running]);

  // the first picture, before the next frame arrives
  useEffect(() => {
    if (!state.running || screen) return;
    let url = "";
    let dead = false;
    fetch(`${base}/screen`).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b && !dead) { url = URL.createObjectURL(b); setStill(url); } }).catch(() => {});
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [base, state.running, screen]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); setInfo(await api<ComputerState>(base)); } catch (e) { toast(e instanceof Error ? e.message : t("Could not do that")); } finally { setBusy(false); }
  };
  const send = (ev: Record<string, unknown>) => api(`${base}/input`, { method: "POST", body: JSON.stringify(ev) }).catch((e: Error) => toast(e.message));
  const src: string | null = screen ? `data:image/jpeg;base64,${screen.image}` : still;
  const shot: Screen | undefined = screen;
  const unavailable = info && !info.available;
  const title = useMemo(() => shot?.title || shot?.url || "", [shot]);

  const click = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!state.held) return;
    const r = e.currentTarget.getBoundingClientRect();
    void send({ type: "click", x: ((e.clientX - r.left) / r.width) * (shot?.width ?? 1280), y: ((e.clientY - r.top) / r.height) * (shot?.height ?? 800) });
  };

  return (
    <aside aria-label={t("Computer")} data-testid="computer-panel" className="relative z-20 flex h-full w-[360px] shrink-0 animate-panel-in flex-col border-l-[0.5px] border-edge bg-app max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:w-full">
      <div className="flex h-[58px] shrink-0 items-center gap-2.5 px-3.5">
        <button type="button" title={t("Settings")} aria-label={t("Settings")} aria-pressed={settings} onClick={() => setSettings(!settings)}
          className={cn("flex size-9 items-center justify-center rounded-full text-ink-secondary hover:bg-ink/10 hover:text-ink", settings && "bg-ink/10 text-ink")}><Settings size={16} /></button>
        <div className="flex-1 text-center text-[15px] font-semibold text-ink">{t("Computer")}</div>
        <button type="button" title={t("Close")} aria-label={t("Close panel")} onClick={() => dispatch({ type: "computer", botId: null })}
          className="flex size-9 items-center justify-center rounded-full text-ink-secondary hover:bg-ink/10 hover:text-ink"><X size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {settings && (
          <label className="mb-3 flex items-start gap-2.5 rounded-xl bg-card p-3 text-[13px] text-ink ring-[0.5px] ring-ink/10">
            <input type="checkbox" className="mt-0.5" checked={!!info?.allowLocal} onChange={(e) => void act(() => api("/api/computer/settings", { method: "PUT", body: JSON.stringify({ allowLocal: e.target.checked }) }))} />
            <span>{t("Let bots open pages on this computer")}<span className="mt-0.5 block text-[12px] text-ink-tertiary">{t("Needed to test a site you run here. Off by default, so a web page cannot reach this app through a bot.")}</span></span>
          </label>
        )}
        <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-ink-secondary" data-no-i18n=""><Monitor size={14} />{t(`${bot.name}'s screen`)}</div>
        {state.helpReason && (
          <div role="alert" data-testid="computer-help" className="mb-2 rounded-xl bg-warning/15 p-3 text-[13px] text-ink">
            <div className="font-medium">{t("Your help is needed")}</div>
            <div className="mt-0.5" data-no-i18n="">{state.helpReason}</div>
          </div>
        )}
        <div className="relative aspect-[1280/800] w-full overflow-hidden rounded-xl bg-inset ring-[0.5px] ring-ink/10" data-testid="computer-screen">
          {src && state.running ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={title ? `${t("Screen")}: ${title}` : t("Screen")} onClick={click} draggable={false}
              className={cn("size-full select-none object-contain", state.held ? "cursor-pointer" : "cursor-default")} />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-1.5 px-6 text-center text-[13px] text-ink-tertiary">
              <Moon size={22} />
              {unavailable ? <span data-no-i18n="">{info?.reason}</span> : <span>{state.running ? t("Waiting for the first picture…") : t("The screen is asleep. It wakes when the bot opens a page.")}</span>}
            </div>
          )}
          {state.held && <span className="absolute bottom-2 left-2 rounded-full bg-accent px-2 py-0.5 text-[11.5px] font-medium text-[var(--color-accent-ink)]">{t("You are in control")}</span>}
        </div>
        {state.running && shot?.url && <div className="mt-1.5 truncate text-[12px] text-ink-tertiary" data-no-i18n="" title={shot.url}>{shot.url}</div>}
        {state.running && state.held && (
          <div className="mt-2 flex flex-col gap-2">
            <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (address.trim()) { void send({ type: "goto", url: address.trim() }); setAddress(""); } }}>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("Address")} aria-label={t("Address")} className="h-8 min-w-0 flex-1 rounded-lg bg-inset px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-tertiary" />
              <button type="submit" className="h-8 rounded-lg bg-raised px-2.5 text-[13px] text-ink hover:bg-raised-hover"><Globe size={14} /></button>
            </form>
            <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (typed) { void send({ type: "text", text: typed }); setTyped(""); } }}>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("Type into the page")} aria-label={t("Type into the page")} className="h-8 min-w-0 flex-1 rounded-lg bg-inset px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-tertiary" />
              <button type="submit" title={t("Send")} aria-label={t("Send")} className="h-8 rounded-lg bg-raised px-2.5 text-[13px] text-ink hover:bg-raised-hover"><Send size={14} /></button>
              <button type="button" onClick={() => void send({ type: "key", key: "Enter" })} className="h-8 rounded-lg bg-raised px-2.5 text-[12.5px] text-ink hover:bg-raised-hover">Enter</button>
            </form>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {state.running ? (
            <>
              <button type="button" disabled={busy} data-testid="computer-control"
                onClick={() => void act(() => api(`${base}/control`, { method: "POST", body: JSON.stringify({ holder: state.held ? "bot" : "person" }) }))}
                className="flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-medium text-[var(--color-accent-ink)] disabled:opacity-50"><Hand size={14} />{state.held ? t("Give it back") : t("Take control")}</button>
              <button type="button" disabled={busy} data-testid="computer-sleep" onClick={() => void act(() => api(`${base}/sleep`, { method: "POST" }))}
                className="flex items-center gap-1.5 rounded-full bg-raised px-3.5 py-1.5 text-[13px] font-medium text-ink hover:bg-raised-hover disabled:opacity-50"><Moon size={14} />{t("Sleep")}</button>
            </>
          ) : (
            <button type="button" disabled={busy || !!unavailable} data-testid="computer-wake" onClick={() => void act(() => api(`${base}/wake`, { method: "POST" }))}
              className="flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-medium text-[var(--color-accent-ink)] disabled:opacity-50"><Monitor size={14} />{t("Open desktop")}</button>
          )}
        </div>
        <div className="mt-5 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{t("Runs on")}</div>
        <div role="radiogroup" aria-label={t("Runs on")} className="mt-1.5 rounded-xl bg-card p-1 ring-[0.5px] ring-ink/10">
          <div role="radio" aria-checked="true" className="flex items-center gap-2 rounded-lg bg-raised px-3 py-2 text-[13.5px] text-ink">
            <Globe size={15} className="text-accent" /><span className="flex-1">{t("Built-in browser")}</span>
            <span className="text-[12px] text-ink-tertiary" data-no-i18n="">{info?.browser ?? ""}</span>
          </div>
        </div>
        <div className="mt-5 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{t("Routines")}</div>
        <div className="-mx-6 mt-1.5"><Routines bot={bot} /></div>
      </div>
    </aside>
  );
}
