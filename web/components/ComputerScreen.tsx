"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useT } from "@/lib/i18n";


export function ComputerScreen({ botId }: { botId: string }) {
  const t = useT();
  const screen = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [connected, setConnected] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stopped = false;
    let connection: InstanceType<typeof import("@novnc/novnc").default> | undefined;
    let ended = false; // noVNC reports an error when a connection that has already ended is disconnected again

    async function connect() {
      try {
        const { default: RFB } = await import("@novnc/novnc");
        if (!screen.current || stopped) return;
        const url = new URL(`/api/bots/${encodeURIComponent(botId)}/computer/stream`, location.href);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        // noVNC logs "requires a secure context" as an error on plain-HTTP addresses (the LAN or Tailscale). It matters only for its
        // encrypted VNC logins; this stream is view-only and BotTeam authorizes it. Its logger was bound when the module loaded, so the
        // message cannot be filtered: the check it makes is answered "secure" while the connection is being made, and put back after.
        const own = Object.getOwnPropertyDescriptor(window, "isSecureContext");
        Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
        try {
          connection = new RFB(screen.current, url.href);
        } finally {
          if (own) Object.defineProperty(window, "isSecureContext", own);
          else delete (window as { isSecureContext?: boolean }).isSecureContext;
        }
        connection.viewOnly = true;
        connection.scaleViewport = true;
        connection.addEventListener("connect", () => !stopped && setConnected(true));
        connection.addEventListener("disconnect", (event: Event) => {
          ended = true;
          if (!stopped && !(event as CustomEvent<{ clean: boolean }>).detail?.clean) setFailed(true);
        });
      } catch {
        if (!stopped) setFailed(true);
      }
    }
    void connect();
    return () => { stopped = true; if (!ended) connection?.disconnect(); };
  }, [botId, attempt]);

  // The stream can drop while the tab is out of sight: connect again when the screen comes back into view.
  useEffect(() => {
    const element = screen.current;
    if (!element || !failed || typeof IntersectionObserver === "undefined") return;
    // Only a change from hidden to shown starts a new try, so a stream that keeps failing does not reconnect in a loop.
    let hidden = false;
    const watcher = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      if (visible && hidden) setAttempt((previous) => previous + 1);
      hidden = !visible;
    });
    watcher.observe(element);
    return () => watcher.disconnect();
  }, [failed]);

  return (
    <div className="relative size-full overflow-hidden bg-muted">
      {/* The stream is view-only. noVNC's canvas swallows mouse events, which kept clicks and the wheel from reaching the panel's
          handlers (they send the person's input through the server); without pointer events here they go to the panel. */}
      <div ref={screen} className="pointer-events-none size-full" role="img" aria-label={t("Computer preview")} />
      {!connected && !failed && (
        <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 bg-black text-xs text-white/80">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          {t("Connecting to the computer…")}
        </div>
      )}
      {failed && (
        <div role="alert" className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-2 bg-background/90 p-2 text-xs text-destructive">
          {t("Could not connect to the live computer preview.")}
          <button type="button" className="rounded border border-edge px-3 py-1" onClick={() => { setFailed(false); setConnected(false); setAttempt((previous) => previous + 1); }}>{t("Retry")}</button>
        </div>
      )}
    </div>
  );
}
