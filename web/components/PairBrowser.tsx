"use client";
import { Check, Copy, RefreshCw, Smartphone, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { api } from "@/state/api";
import { useStore } from "@/state/store";

interface Made { required: boolean; code?: string; expiresIn?: number }

/** The phone button next to Connect apps: makes a one-time code (valid 10 minutes) to pair another browser that reaches BotTeam through a domain.
 * The code is shown here, on a computer that can open BotTeam directly, and is no longer printed in the server's terminal. */
export function PairBrowser() {
  const { state, dispatch } = useStore();
  const t = useT();
  const [made, setMade] = useState<Made | null>(null);
  const [until, setUntil] = useState(0);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const make = useCallback(async () => {
    setError("");
    setCopied(false);
    try {
      const r = await api<Made>("/api/auth/pair-code", { method: "POST" });
      setMade(r);
      setUntil(Date.now() + (r.expiresIn ?? 600) * 1000);
    } catch (e) {
      setMade(null);
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { if (state.pairOpen) void make(); }, [state.pairOpen, make]);
  useEffect(() => {
    if (!state.pairOpen || !made?.code) return;
    const tick = () => setLeft(Math.max(0, Math.round((until - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state.pairOpen, made, until]);
  if (!state.pairOpen) return null;
  const close = () => { setMade(null); dispatch({ type: "pair", open: false }); };
  const expired = !!made?.code && left <= 0;
  return (
    <div role="dialog" aria-modal="true" aria-label={t("Pair a browser")} data-testid="pair-browser"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="flex w-full max-w-[420px] flex-col overflow-hidden rounded-[20px] bg-panel text-ink shadow-xl ring-1 ring-ink/10">
        <div className="flex h-[60px] shrink-0 items-center gap-2 px-5">
          <Smartphone size={18} className="text-accent-text" aria-hidden />
          <h2 className="flex-1 text-[17px] font-semibold">{t("Pair a browser")}</h2>
          <button type="button" aria-label="Close" onClick={close} className="rounded-full p-2 text-ink-secondary hover:bg-ink/10"><X size={16} /></button>
        </div>
        <div className="px-5 pb-5">
          {error && <div role="alert" className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger" data-no-i18n="">{error}</div>}
          {made && !made.required && <div role="status" className="rounded-xl bg-raised px-3.5 py-3 text-[13.5px] leading-5 text-ink-secondary">{t("Remote access is off. Start BotTeam so that it listens beyond this computer to pair other browsers.")}</div>}
          {made?.code && (
            <>
              <p className="text-[13.5px] leading-5 text-ink-secondary">{t("Open BotTeam in the other browser through your domain and enter this code. It works once, for 10 minutes. Addresses on this computer or your own network open without it.")}</p>
              <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-raised py-5">
                <span data-testid="pair-code" data-no-i18n="" className={`font-mono text-[34px] font-semibold tracking-[0.12em] ${expired ? "text-ink-tertiary line-through" : "text-ink"}`}>{made.code}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-[12.5px] text-ink-tertiary">
                <span aria-live="polite">{expired ? t("This code has expired.") : `${t("Valid for")} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}</span>
                <span className="flex gap-1.5">
                  <button type="button" disabled={expired} onClick={() => { void navigator.clipboard?.writeText(made.code ?? ""); setCopied(true); }}
                    className="flex items-center gap-1 rounded-full px-2.5 py-1 text-ink-secondary hover:bg-ink/10 disabled:opacity-40">{copied ? <Check size={13} /> : <Copy size={13} />} {t(copied ? "Copied" : "Copy")}</button>
                  <button type="button" onClick={() => void make()} data-testid="pair-new-code" className="flex items-center gap-1 rounded-full px-2.5 py-1 text-ink-secondary hover:bg-ink/10"><RefreshCw size={13} /> {t("New code")}</button>
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
