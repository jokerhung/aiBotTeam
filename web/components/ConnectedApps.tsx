"use client";
import { Check, ExternalLink, KeyRound, Plug, Plus, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { InputChannels } from "./InputChannels";
import { McpServersView } from "./McpServers";

const INPUT = "w-full rounded-lg bg-inset px-3 text-[14px] text-ink outline-none ring-1 ring-inset ring-ink/[0.07] placeholder:text-ink-tertiary focus:ring-ink/25";
const TILE = ["bg-[#2d333b] text-white", "bg-[#5e6ad2] text-white", "bg-[#1a1a1a] text-white", "bg-[#362d59] text-white", "bg-[#1d6f42] text-white", "bg-[#0052cc] text-white"];
const KEYS_URL = "https://dashboard.composio.dev/~/project/settings/api-keys";

interface Account { id: string; alias: string | null; status: string }
interface Conn { connected: boolean; pending: boolean; status: string; accounts: Account[] }
interface Card { slug: string; label: string; blurb: string; logo: string | null }
interface AppsState { configured: boolean; source: string | null; keyHint: string | null; apps: Card[]; connections: Record<string, Conn>; error: string | null }

/** "Connected apps" (the Connect apps pill): every app goes through Composio. One project key is pasted once; each app signs in in the person's own
 * browser, several accounts per app are told apart by a label, and no provider token is ever kept here. */
type Tab = "apps" | "mcp" | "input";

export function ConnectedApps() {
  const { state, dispatch } = useStore();
  const t = useT();
  const tab: Tab = state.appsTab;  // kept in the store, so another screen can open the dialog on a given tab
  const setTab = (next: Tab) => dispatch({ type: "apps", open: true, tab: next });
  const [data, setData] = useState<AppsState | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [alias, setAlias] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ id: string; ok: boolean; text: string; url?: string } | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const load = useCallback(() => api<AppsState>("/api/apps").then(setData).catch(() => {}), []);
  useEffect(() => { if (state.appsOpen) void load(); }, [state.appsOpen, state.mcpTick, load]);
  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);
  if (!state.appsOpen) return null;
  const apps = data?.apps ?? [];
  const conns = data?.connections ?? {};
  const shown = apps.filter((a) => `${a.label} ${a.blurb}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 80);
  const noneYet = !Object.values(conns).some((c) => c.connected);
  const saveKey = async () => {
    setBusy(true);
    setNote(null);
    try {
      await api("/api/composio/key", { method: "PUT", body: JSON.stringify({ key: key.trim() }) });
      setKey("");
      await load();
    } catch (e) {
      setNote({ id: "key", ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  /** The sign-in tab is reserved during the click, before the link is asked for, so a pop-up blocker does not stop it. */
  const connect = async (c: Card) => {
    setBusy(true);
    setNote(null);
    const tab = window.open("", "_blank");
    try {
      const r = await api<{ url: string }>(`/api/apps/${c.slug}/connect`, { method: "POST", body: JSON.stringify({ alias: alias.trim() || null }) });
      if (tab) tab.location.href = r.url; else setNote({ id: c.slug, ok: true, text: t("Your browser blocked the sign-in page."), url: r.url });
      setOpen(null);
      setAlias("");
      if (poll.current) clearInterval(poll.current);
      let n = 0;
      poll.current = setInterval(() => { void load(); if (++n > 40 && poll.current) clearInterval(poll.current); }, 3000); // until the person has finished
      await load();
    } catch (e) {
      tab?.close();
      setNote({ id: c.slug, ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const remove = async (slug: string, id: string) => {
    await api(`/api/apps/${slug}/accounts/${id}`, { method: "DELETE" }).catch((e: Error) => setNote({ id: slug, ok: false, text: e.message }));
    await load();
  };
  const close = () => dispatch({ type: "apps", open: false });
  return (
    <div role="dialog" aria-modal="true" aria-label="Connected apps" data-testid="connected-apps"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="flex h-[min(640px,88vh)] w-full max-w-[560px] flex-col overflow-hidden rounded-[20px] bg-panel text-ink shadow-xl ring-1 ring-ink/10">
        <div className="flex h-[60px] shrink-0 items-center gap-2 px-5">
          <h2 className="flex-1 text-[17px] font-semibold">{t("Connected apps")}</h2>
          <button type="button" title={t("Refresh")} aria-label={t("Refresh")} onClick={() => void load()} className="rounded-full p-2 text-ink-secondary hover:bg-ink/10"><RefreshCw size={15} /></button>
          <button type="button" aria-label="Close" onClick={close} className="rounded-full p-2 text-ink-secondary hover:bg-ink/10"><X size={16} /></button>
        </div>
        <div role="tablist" aria-label={t("Connected apps")} className="mx-5 mb-3 flex h-9 shrink-0 items-center rounded-full bg-raised p-[3px]" data-testid="apps-tabs">
          {([["apps", "Connected apps", "tab-apps"], ["mcp", "Custom MCP servers", "open-mcp"], ["input", "Input", "tab-input"]] as const).map(([id, label, testid]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} data-testid={testid} onClick={() => setTab(id)}
              className={cn("h-[30px] min-w-0 flex-1 truncate rounded-full px-2.5 text-[13px] font-medium", tab === id ? "bg-composer text-ink shadow-sm ring-[0.5px] ring-ink/10" : "text-ink-secondary hover:text-ink")}>{t(label)}</button>
          ))}
        </div>
        {tab === "mcp" && <McpServersView />}
        {tab === "input" && <InputChannels />}
        {tab === "apps" && <>
        {data && !data.configured && (
          <div role="status" data-testid="apps-warning" className="mx-5 mb-3 rounded-xl bg-warning/12 px-3.5 py-3 text-[13px] leading-5 text-warning">
            <div className="flex items-center gap-1.5 font-medium"><KeyRound size={14} /> {t("Add your Composio project key to connect apps")}</div>
            <div className="mt-1 text-ink-secondary">{t("Apps connect through Composio. Create a project key (it starts with ak_), paste it here, and it stays on this computer.")}</div>
            <div className="mt-2 flex gap-2">
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && key.trim() && void saveKey()}
                aria-label={t("Composio project key")} placeholder="ak_…" autoComplete="off" data-no-i18n="" className={cn(INPUT, "h-9 text-ink")} />
              <button type="button" disabled={busy || !key.trim()} onClick={() => void saveKey()} data-testid="save-composio-key"
                className="h-9 shrink-0 rounded-full bg-accent px-4 text-[13px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Save")}</button>
            </div>
            <a href={KEYS_URL} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-accent-text hover:underline">{t("Get a project key")} <ExternalLink size={11} /></a>
            {note?.id === "key" && <div role="alert" className="mt-1.5 text-[12.5px] text-danger">{note.text}</div>}
          </div>
        )}
        {data?.configured && noneYet && !data.error && (
          <div role="status" className="mx-5 mb-3 rounded-xl bg-raised px-3.5 py-2.5 text-[13px] leading-5 text-ink-secondary">{t("No app is connected yet. Choose one; it signs in in your browser.")}</div>
        )}
        {data?.error && <div role="alert" className="mx-5 mb-3 rounded-xl bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger" data-no-i18n="">{data.error}</div>}
        <div className="px-5 pb-3">
          <label className="flex h-10 items-center gap-2 rounded-xl bg-raised px-3 text-ink-tertiary">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search apps")} aria-label={t("Search apps")} className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-tertiary" />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {shown.length === 0 && <div className="py-10 text-center text-[13.5px] text-ink-tertiary">{t("No app matches.")}</div>}
          {shown.map((a, i) => {
            const c = conns[a.slug];
            const accounts = c?.accounts ?? [];
            const needLabel = accounts.length > 0;
            return (
              <div key={a.slug} data-testid="app-row" className="rounded-xl px-2 py-2 hover:bg-raised/50">
                <div className="flex items-center gap-3">
                  {a.logo
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={a.logo} alt="" className="size-11 shrink-0 rounded-xl bg-white object-contain p-1.5" />
                    : <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl text-[18px] font-semibold", TILE[i % TILE.length])} aria-hidden>{a.label[0]}</span>}
                  <div className="min-w-0 flex-1 leading-tight">
                    <div data-no-i18n="" className="truncate text-[14.5px] font-medium">{a.label}</div>
                    <div data-no-i18n="" className="truncate text-[12.5px] text-ink-tertiary">{a.blurb}</div>
                  </div>
                  {c?.connected && <span className="flex items-center gap-1 text-[12.5px] text-success"><Check size={13} /> {t("Connected")}</span>}
                  {!c?.connected && c?.pending && <span className="text-[12.5px] text-ink-tertiary">{t("Waiting for sign-in")}</span>}
                  <button type="button" disabled={!data?.configured} onClick={() => (needLabel ? (setOpen(open === a.slug ? null : a.slug), setAlias("")) : void connect(a))}
                    aria-label={needLabel ? `${t("Add account")}: ${a.label}` : undefined}
                    className={cn("flex h-9 items-center gap-1 rounded-full px-4 text-[13.5px] font-medium disabled:opacity-40", needLabel ? "bg-raised text-ink hover:bg-raised-hover" : "bg-accent text-[var(--color-accent-ink)]")}>
                    {needLabel ? <><Plus size={13} /> {t("Add account")}</> : t("Connect")}
                  </button>
                </div>
                {accounts.map((x) => (
                  <div key={x.id} data-testid="app-account" className="mt-1 flex items-center gap-2 pl-14 pr-1 text-[12.5px]">
                    <span data-no-i18n="" className="min-w-0 flex-1 truncate text-ink-secondary">{x.alias || x.id}</span>
                    <span className={cn(x.status === "ACTIVE" ? "text-success" : "text-ink-tertiary")}>{x.status === "ACTIVE" ? t("Connected") : t("Needs sign-in")}</span>
                    <button type="button" onClick={() => void remove(a.slug, x.id)} className="rounded-full px-2.5 py-1 text-ink-secondary hover:bg-ink/10">{t("Disconnect")}</button>
                  </div>
                ))}
                {open === a.slug && (
                  <div className="mt-2 pl-14 pr-1">
                    <input autoFocus value={alias} onChange={(e) => setAlias(e.target.value)} onKeyDown={(e) => e.key === "Enter" && alias.trim() && void connect(a)}
                      aria-label={t("Account label")} placeholder={t("A label for this account, such as work")} maxLength={40} className={cn(INPUT, "h-10")} />
                    <div className="mt-1.5 flex justify-end">
                      <button type="button" disabled={busy || !alias.trim()} onClick={() => void connect(a)} className="h-8 rounded-full bg-accent px-3.5 text-[13px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Connect")}</button>
                    </div>
                  </div>
                )}
                {note?.id === a.slug && (
                  <div role="status" className={cn("mt-1.5 pl-14 text-[12.5px]", note.ok ? "text-ink-secondary" : "text-danger")}>
                    <span data-no-i18n="">{note.text}</span>
                    {note.url && <> <a href={note.url} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">{t("Open authorization page")}</a></>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex h-[56px] shrink-0 items-center justify-end border-t border-edge px-5">
          <span className="flex items-center gap-1 text-[12px] text-ink-tertiary"><Plug size={12} /> {t("Tools ask before they act, as set for each bot.")}</span>
        </div>
        </>}
      </div>
    </div>
  );
}
