"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Globe, Hand, Maximize2, Minimize2, Monitor } from "lucide-react";
import type { Bot } from "@/lib/wire";
import { DEFAULT_TOOLBOX } from "@/lib/wire";
import { lastControl, lastScreen, subscribeComputer, type ComputerControl } from "@/lib/screens";
import { useT } from "@/lib/i18n";
import { api } from "@/state/api";
import { ComputerScreen } from "./ComputerScreen";
import { trapDialog } from "./agents/shared";

type Surface = "browser" | "computer";
const BUTTON = "inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs hover:bg-raised disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent";

export function InlineLiveViews({ bots }: { bots: Bot[] }) {
  return <div className="flex flex-wrap gap-3">{bots.map((bot) => <AgentViews key={bot.id} bot={bot} />)}</div>;
}

function AgentViews({ bot }: { bot: Bot }) {
  const config = bot.toolbox ?? DEFAULT_TOOLBOX;
  return <>{config.web.enabled && <LiveView bot={bot} surface="browser" />}{config.computer.enabled && <LiveView bot={bot} surface="computer" />}</>;
}

function LiveView({ bot, surface }: { bot: Bot; surface: Surface }) {
  const t = useT();
  const base = `/api/bots/${bot.id}/${surface}`;
  const control = useSyncExternalStore(subscribeComputer, () => lastControl(bot.id, surface), () => undefined);
  const screen = useSyncExternalStore(subscribeComputer, () => lastScreen(bot.id), () => undefined);
  const [initial, setInitial] = useState<ComputerControl | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [still, setStill] = useState("");
  const preview = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const state = control ?? initial;
  const running = !!state?.running;
  const held = !!state?.held;
  useEffect(() => {
    let active = true;
    void api<ComputerControl>(surface === "computer" ? `${base}/capability` : base).then((value) => { if (active) setInitial(value); }).catch(() => {});
    return () => { active = false; };
  }, [base, surface]);
  useEffect(() => {
    if (!running || surface !== "browser") return;
    const stream = new EventSource(`${base}/watch`);
    // The global event stream supplies images; this subscription owns the watcher lease.
    return () => stream.close();
  }, [base, running, surface]);
  useEffect(() => {
    if (!running || surface !== "browser") return;
    let active = true; let url = "";
    void fetch(`${base}/screen`).then((response) => response.ok ? response.blob() : null).then((blob) => {
      if (blob && active) { url = URL.createObjectURL(blob); setStill(url); }
    }).catch(() => {});
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [base, running, surface]);
  useEffect(() => {
    if (!expanded || !running) return;
    const previous = document.activeElement as HTMLElement | null;
    const returnButton = expandButton.current;
    closeButton.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; (returnButton?.isConnected ? returnButton : previous)?.focus(); };
  }, [expanded, running]);
  if (!running) return null;
  const resolution = surface === "browser" ? [screen?.width ?? 1280, screen?.height ?? 800] : (bot.toolbox ?? DEFAULT_TOOLBOX).computer.resolution;
  const input = async (event: Record<string, unknown>) => {
    setError("");
    try { await api(`${base}/input`, { method: "POST", body: JSON.stringify(event) }); }
    catch (exc) { setError(exc instanceof Error ? exc.message : t("Could not do that")); }
  };
  const takeover = async () => {
    setBusy(true); setError("");
    try {
      const next = await api<ComputerControl>(`${base}/control`, { method: "POST", body: JSON.stringify({ holder: held ? "bot" : "person" }) });
      setInitial(next);
      if (next.held) preview.current?.focus();
    } catch (exc) { setError(exc instanceof Error ? exc.message : t("Could not do that")); }
    finally { setBusy(false); }
  };
  const title = `${bot.name} · ${t(surface === "browser" ? "Browser" : "Computer")}`;
  const content = <section data-testid="inline-liveview" data-surface={surface} className={`overflow-hidden rounded-xl border border-edge bg-composer ${expanded ? "flex max-h-[94dvh] w-full max-w-6xl flex-col shadow-xl" : "w-full max-w-sm"}`}>
    <header className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
      {surface === "browser" ? <Globe size={15} /> : <Monitor size={15} />}
      <span className="min-w-0 flex-1 truncate text-xs font-medium" data-no-i18n>{title}</span>
      {expanded && <button type="button" disabled={busy} className={`${BUTTON} ${held ? "bg-warning/15" : "bg-accent/10"}`} onClick={() => void takeover()}><Hand size={14} />{t(held ? "Give it back" : "Take over")}</button>}
      <span className="size-1.5 shrink-0 rounded-full bg-success" aria-label={t("Live preview")} />
      <button ref={expanded ? closeButton : expandButton} type="button" aria-label={t(expanded ? "Close live preview" : "Expand live preview")} className={BUTTON} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
    </header>
    {state?.helpReason && <p className="bg-warning/15 px-3 py-2 text-xs" role="status">{state.helpReason}</p>}
    <div className="min-h-0 overflow-y-auto">
      <div ref={preview} role="group" aria-label={t("Live preview")} tabIndex={held && expanded ? 0 : -1} style={{ aspectRatio: `${resolution[0]} / ${resolution[1]}` }} className={`relative w-full overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${held && expanded ? "cursor-crosshair" : ""}`}
        onClick={(event) => {
          if (!held || !expanded) return;
          event.currentTarget.focus();
          const rect = event.currentTarget.getBoundingClientRect();
          void input({ type: "click", x: Math.min(resolution[0] - 1, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * resolution[0]))), y: Math.min(resolution[1] - 1, Math.max(0, Math.floor((event.clientY - rect.top) / rect.height * resolution[1]))) });
        }}
        onWheel={(event) => { if (held && expanded) void input({ type: "scroll", dy: event.deltaY }); }}
        onKeyDown={(event) => {
          if (!held || !expanded || ["Tab", "Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          void input({ type: "key", key: [event.ctrlKey ? "Control" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", event.metaKey ? "Meta" : "", event.key].filter(Boolean).join("+") });
        }}>
        {surface === "computer" ? <ComputerScreen botId={bot.id} /> : screen || still ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={t("Live preview")} src={screen ? `data:image/jpeg;base64,${screen.image}` : still} draggable={false} className="pointer-events-none size-full select-none object-fill" />
        ) : <span className="absolute inset-0 grid place-items-center text-xs text-white/70">{t("Waiting for live preview…")}</span>}
      </div>
    </div>
    {surface === "browser" && screen?.url && <p className="truncate px-3 pt-2 text-xs text-ink-tertiary" title={screen.url}>{screen.url}</p>}
    {expanded && (held || error) && <footer className="shrink-0 px-3 py-2">
      {held && <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (text) { void input({ type: "text", text }); setText(""); } }}><input aria-label={t("Type into the screen")} placeholder={t("Type into the screen")} className="min-w-0 flex-1 rounded-lg border border-edge bg-inset px-2 py-1 text-sm" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} /><button className={BUTTON} type="submit">{t("Send")}</button></form>}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </footer>}
  </section>;
  return expanded ? createPortal(<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-3" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) setExpanded(false); }} onKeyDown={(event) => trapDialog(event, () => setExpanded(false))}><button tabIndex={-1} aria-label={t("Close live preview")} className="absolute inset-0" onClick={() => setExpanded(false)} /><div className="relative flex w-full justify-center">{content}</div></div>, document.body) : content;
}
