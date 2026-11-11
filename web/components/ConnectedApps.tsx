"use client";
import { Check, ExternalLink, Plug, RefreshCw, Search, Server, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AppEntry } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";

const INPUT = "w-full rounded-lg bg-inset px-3 text-[14px] text-ink outline-none ring-1 ring-inset ring-ink/[0.07] placeholder:text-ink-tertiary focus:ring-ink/25";
const TILE = ["bg-[#2d333b] text-white", "bg-[#5e6ad2] text-white", "bg-[#1a1a1a] text-white", "bg-[#362d59] text-white", "bg-[#1d6f42] text-white", "bg-[#0052cc] text-white"];

/** "Connected apps" (the Connect apps pill): a catalog of apps an agent can use, each connected with a token that stays on this computer. */
export function ConnectedApps() {
  const { state, dispatch } = useStore();
  const t = useT();
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const load = useCallback(() => api<{ apps: AppEntry[] }>("/api/apps").then((r) => setApps(r.apps)).catch(() => {}), []);
  useEffect(() => { if (state.appsOpen) void load(); }, [state.appsOpen, load, state.mcpTick]);
  if (!state.appsOpen) return null;
  const shown = apps.filter((a) => `${a.name} ${a.description}`.toLowerCase().includes(q.trim().toLowerCase()));
  const noneYet = !apps.some((a) => a.connected);
  const connect = async (a: AppEntry) => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ status: { state: string; error?: string; tools?: unknown[] } }>(`/api/apps/${a.id}/connect`, { method: "POST", body: JSON.stringify({ token: token.trim() }) });
      setNote({ id: a.id, ok: r.status.state === "ok", text: r.status.state === "ok" ? `${r.status.tools?.length ?? 0} ${t("tools available")}` : (r.status.error ?? t("Could not connect")) });
      setOpen(null);
      setToken("");
      await load();
    } catch (e) {
      setNote({ id: a.id, ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const close = () => dispatch({ type: "apps", open: false });
  return (
    <div role="dialog" aria-modal="true" aria-label="Connected apps" data-testid="connected-apps"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="flex max-h-[88vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[20px] bg-panel text-ink shadow-xl ring-1 ring-ink/10">
        <div className="flex h-[60px] shrink-0 items-center gap-2 px-5">
          <h2 className="flex-1 text-[17px] font-semibold">{t("Connected apps")}</h2>
          <button type="button" title={t("Refresh")} aria-label={t("Refresh")} onClick={() => void load()} className="rounded-full p-2 text-ink-secondary hover:bg-ink/10"><RefreshCw size={15} /></button>
          <button type="button" aria-label="Close" onClick={close} className="rounded-full p-2 text-ink-secondary hover:bg-ink/10"><X size={16} /></button>
        </div>
        {noneYet && (
          <div role="status" data-testid="apps-warning" className="mx-5 mb-3 rounded-xl bg-warning/12 px-3.5 py-2.5 text-[13px] leading-5 text-warning">
            {t("No app is connected yet. Each app asks for a token; it is kept on this computer and never shown again.")}
          </div>
        )}
        <div className="px-5 pb-3">
          <label className="flex h-10 items-center gap-2 rounded-xl bg-raised px-3 text-ink-tertiary">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search apps")} aria-label={t("Search apps")} className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-tertiary" />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {shown.length === 0 && <div className="py-10 text-center text-[13.5px] text-ink-tertiary">{t("No app matches.")}</div>}
          {shown.map((a, i) => (
            <div key={a.id} data-testid="app-row" className="rounded-xl px-2 py-2 hover:bg-raised/50">
              <div className="flex items-center gap-3">
                <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl text-[18px] font-semibold", TILE[i % TILE.length])} aria-hidden>{a.name[0]}</span>
                <div className="min-w-0 flex-1 leading-tight">
                  <div data-no-i18n="" className="truncate text-[14.5px] font-medium">{a.name}</div>
                  <div data-no-i18n="" className="truncate text-[12.5px] text-ink-tertiary">{a.description}</div>
                </div>
                {a.connected ? (
                  <>
                    <span className={cn("flex items-center gap-1 text-[12.5px]", a.status?.state === "failed" ? "text-danger" : "text-success")}><Check size={13} /> {a.status?.state === "failed" ? t("Needs attention") : t("Connected")}</span>
                    <button type="button" onClick={async () => { await api(`/api/apps/${a.id}`, { method: "DELETE" }).catch(() => {}); await load(); }} className="rounded-full px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-ink/10">{t("Disconnect")}</button>
                  </>
                ) : (
                  <button type="button" onClick={() => (a.tokenLabel ? (setOpen(open === a.id ? null : a.id), setToken("")) : void connect(a))}
                    className="h-9 rounded-full bg-accent px-4 text-[13.5px] font-medium text-[var(--color-accent-ink)]">{t("Connect")}</button>
                )}
              </div>
              {open === a.id && (
                <div className="mt-2 pl-14 pr-1">
                  <input type="password" autoFocus value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === "Enter" && token.trim() && void connect(a)}
                    aria-label={t(a.tokenLabel)} placeholder={a.tokenLabel} autoComplete="off" className={cn(INPUT, "h-10")} />
                  <div className="mt-1.5 flex items-center gap-3 text-[12px] text-ink-tertiary">
                    {a.tokenUrl && <a href={a.tokenUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-text hover:underline">{t("Get a token")} <ExternalLink size={11} /></a>}
                    <button type="button" disabled={busy || !token.trim()} onClick={() => void connect(a)} className="ml-auto h-8 rounded-full bg-accent px-3.5 text-[13px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Connect")}</button>
                  </div>
                </div>
              )}
              {note?.id === a.id && <div role="status" className={cn("mt-1.5 pl-14 text-[12.5px]", note.ok ? "text-success" : "text-danger")}>{note.text}</div>}
            </div>
          ))}
        </div>
        <div className="flex h-[56px] shrink-0 items-center justify-between border-t border-edge px-5">
          <button type="button" onClick={() => { close(); dispatch({ type: "mcp", open: true }); }} data-testid="open-mcp"
            className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[13.5px] text-ink-secondary hover:bg-ink/10 hover:text-ink"><Server size={14} /> {t("Custom MCP servers")}</button>
          <span className="flex items-center gap-1 text-[12px] text-ink-tertiary"><Plug size={12} /> {t("Tools ask before they act, as set for each bot.")}</span>
        </div>
      </div>
    </div>
  );
}
