"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the servers and apps are fetched when the tab opens and when connections change */
import { ExternalLink, KeyRound, Pencil, Play, Plug, Plus, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { queuePatch } from "@/lib/patch-queue";
import { cn } from "@/lib/utils";
import type { Bot, McpServer } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { ServerAccessControls } from "../BotPanel";
import { McpServerEditor } from "../McpServers";

interface Account { id: string; alias: string | null; status: string }
interface Conn { connected: boolean; pending: boolean; status: string; accounts: Account[] }
interface AppCard { slug: string; label: string; blurb: string; logo: string | null }
interface AppsState { configured: boolean; apps: AppCard[]; connections: Record<string, Conn>; error: string | null }

const TILE = ["bg-[#2d333b]", "bg-[#5e6ad2]", "bg-[#1a1a1a]", "bg-[#362d59]", "bg-[#1d6f42]", "bg-[#0052cc]"];
const CARD = "flex min-h-[170px] flex-col rounded-2xl border border-edge bg-composer p-4";

function Switch({ checked, label, onToggle, disabled }: { checked: boolean; label: string; onToggle: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onToggle}
      className={cn("relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50", checked ? "border-success bg-success" : "border-ink-tertiary bg-ink/15")}>
      <span className={cn("absolute top-px size-4 rounded-full shadow-sm transition-transform", checked ? "translate-x-[17px] bg-white" : "translate-x-px bg-ink-secondary")} style={{ left: 0 }} />
    </button>
  );
}

function Dot({ tone, children }: { tone: "ok" | "bad" | "off"; children: React.ReactNode }) {
  return <span className="flex items-center gap-1.5 text-[12px] text-ink-tertiary"><span className={cn("size-1.5 rounded-full", tone === "ok" ? "bg-success" : tone === "bad" ? "bg-danger" : "bg-ink/25")} />{children}</span>;
}

/** The MCP servers tab of an agent: the Composio apps (one switch for the Composio server, every app with its sign-in state) and the custom servers,
 * as cards. An agent uses a server once its switch is on; each server then shows what it may do (read or write, ask first, which tools). */
export function McpTab({ bot, onChange }: { bot: Bot; onChange?: (patch: Partial<Bot>) => void }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [apps, setApps] = useState<AppsState | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [onlyConnected, setOnlyConnected] = useState(false);
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  const [editing, setEditing] = useState<McpServer | "new" | null>(null);
  const [note, setNote] = useState<{ slug: string; text: string; url?: string } | null>(null);
  const apply = (body: Partial<Bot>) => (onChange ? onChange(body) : void queuePatch(bot.id, body));
  const used = bot.mcpServers ?? [];
  const access = bot.mcpAccess ?? {};
  const setUsed = (id: string, on: boolean) => apply({ mcpServers: on ? [...used, id] : used.filter((x) => x !== id) });
  const setAccess = (id: string, patch: Partial<{ scope: "read" | "write"; outbound: "ask" | "allow"; cacheMinutes: number; allowTools: string[] }>) =>
    apply({ mcpAccess: { ...access, [id]: { ...(access[id] ?? { scope: "read" as const, outbound: "ask" as const }), ...patch } } });
  const loadServers = useCallback(() => api<{ servers: McpServer[] }>("/api/mcp/servers").then((r) => setServers(r.servers)).catch(() => {}), []);
  const loadApps = useCallback(async (refresh = false) => {
    setLoading(true);
    try { setApps(await api<AppsState>(refresh ? "/api/apps/refresh" : "/api/apps", refresh ? { method: "POST" } : undefined)); } catch { /* shown as empty */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadServers(); void loadApps(); }, [state.mcpTick, loadServers, loadApps]);

  const composio = servers.find((s) => s.appId === "composio");
  const custom = servers.filter((s) => s.appId !== "composio");
  const needle = q.trim().toLowerCase();
  const conns = useMemo(() => apps?.connections ?? {}, [apps]);
  const connectedCount = Object.values(conns).filter((c) => c.connected).length;
  const composioOn = !!composio && used.includes(composio.id);
  const shownApps = useMemo(() => (apps?.apps ?? [])
    .filter((a) => !needle || `${a.label} ${a.blurb}`.toLowerCase().includes(needle))
    .filter((a) => !onlyConnected || conns[a.slug]?.connected)
    .filter((a) => !onlyEnabled || (composioOn && conns[a.slug]?.connected))
    .sort((a, b) => Number(!!conns[b.slug]?.connected) - Number(!!conns[a.slug]?.connected))
    .slice(0, 80), [apps, needle, onlyConnected, onlyEnabled, conns, composioOn]);
  const shownCustom = custom.filter((s) => (!needle || `${s.name} ${s.url ?? s.command ?? ""}`.toLowerCase().includes(needle)) && (!onlyEnabled || used.includes(s.id)) && (!onlyConnected || s.status.state === "ok"));

  const connect = async (a: AppCard) => {
    setNote(null);
    const tab = window.open("", "_blank");
    try {
      const r = await api<{ url: string }>(`/api/apps/${a.slug}/connect`, { method: "POST", body: JSON.stringify({ alias: null }) });
      if (tab) { tab.location.href = r.url; setNote({ slug: a.slug, text: t("Connected accounts update automatically after sign-in succeeds.") }); }
      else setNote({ slug: a.slug, text: t("Your browser blocked the sign-in page."), url: r.url });
      void loadApps();
    } catch (e) { tab?.close(); setNote({ slug: a.slug, text: (e as Error).message }); }
  };
  const test = async (s: McpServer) => { await api(`/api/mcp/servers/${s.id}/test`, { method: "POST" }).catch(() => {}); await loadServers(); };

  return (
    <div data-testid="mcp-tab" className="mb-6 rounded-2xl border border-edge bg-composer p-5">
      <h2 className="text-lg font-medium">{t("MCP servers")}</h2>
      <p className="mt-1 max-w-[70ch] text-[13.5px] leading-5 text-ink-secondary">{t("External tools this agent may call: the apps connected through Composio and your own MCP servers. Turn a server on for this agent, then choose what it may do. Every tool it calls goes through the agent's approval level.")}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" data-testid="add-mcp-server" onClick={() => setEditing("new")} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-edge bg-raised px-3 text-[13.5px] text-ink hover:bg-raised-hover"><Plus size={14} /> {t("Connect a server")}</button>
        <button type="button" onClick={() => dispatch({ type: "view", view: "apps" })} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13.5px] text-ink-secondary hover:bg-ink/10"><Plug size={14} /> {t("Manage connected apps")}</button>
        <button type="button" title={t("Refresh from Composio")} aria-label={t("Refresh")} disabled={loading} onClick={() => void loadApps(true)} className="rounded-full p-2 text-ink-secondary hover:bg-ink/10 disabled:opacity-40"><RefreshCw size={15} className={loading ? "animate-spin" : undefined} /></button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex h-10 min-w-[220px] max-w-[320px] flex-1 items-center gap-2 rounded-xl border border-edge bg-raised px-3 text-ink-tertiary">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search servers…")} aria-label={t("Search servers…")} className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-tertiary" />
        </label>
        <label className="flex items-center gap-1.5 text-[13.5px] text-ink-secondary"><input type="checkbox" checked={onlyConnected} onChange={(e) => setOnlyConnected(e.target.checked)} /> {t("Connected")}</label>
        <label className="flex items-center gap-1.5 text-[13.5px] text-ink-secondary"><input type="checkbox" checked={onlyEnabled} onChange={(e) => setOnlyEnabled(e.target.checked)} /> {t("Enabled for this agent")}</label>
      </div>

      <section aria-label="Composio" className="mt-6" data-testid="mcp-composio">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-[15px] font-medium">Composio</h3>
          <span className="text-[12.5px] text-ink-tertiary">{apps?.configured ? `${connectedCount} ${t("connected apps")}` : t("No project key yet")}</span>
          {composio && (
            <span className="ml-auto flex items-center gap-2 text-[13px] text-ink-secondary">
              {t("Use Composio apps")}
              <Switch checked={composioOn} label={`Use ${composio.name}`} onToggle={() => setUsed(composio.id, !composioOn)} />
            </span>
          )}
        </div>
        {apps && !apps.configured && (
          <div role="status" data-testid="apps-warning" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-warning/12 px-3.5 py-2.5 text-[13px] text-warning">
            <KeyRound size={14} /> {t("Add your Composio project key to connect apps")}
            <button type="button" onClick={() => dispatch({ type: "view", view: "apps" })} className="ml-auto inline-flex items-center gap-1 text-accent-text hover:underline">{t("Open connected apps")} <ExternalLink size={11} /></button>
          </div>
        )}
        {apps?.configured && !composio && <div className="mt-3 text-[13px] text-ink-tertiary">{t("Connect an app first; Composio is added as a server once one is connected.")}</div>}
        {composioOn && composio && <div className="mt-2 max-w-[460px] rounded-xl bg-inset px-3 py-2 ring-1 ring-inset ring-ink/[0.07]"><ServerAccessControls name={composio.name} acc={access[composio.id] ?? { scope: "read", outbound: "ask" }} setAccess={(patch) => setAccess(composio.id, patch)} /></div>}
        {apps?.error && <div role="alert" className="mt-2 text-[13px] text-danger" data-no-i18n="">{apps.error}</div>}
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="mcp-app-grid">
          {shownApps.map((a, i) => {
            const c = conns[a.slug];
            return (
              <article key={a.slug} data-testid="mcp-app-card" className={CARD}>
                <div className="flex items-center gap-3">
                  {a.logo
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={a.logo} alt="" loading="lazy" decoding="async" className="size-10 shrink-0 rounded-xl bg-white object-contain p-1.5 ring-1 ring-ink/10" />
                    : <span aria-hidden className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl text-[17px] font-semibold text-white", TILE[i % TILE.length])}>{a.label[0]}</span>}
                  <span data-no-i18n="" className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{a.label}</span>
                  {composioOn && c?.connected && <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] text-success">{t("On")}</span>}
                </div>
                <p data-no-i18n="" className="mt-3 line-clamp-3 flex-1 text-[13px] leading-[19px] text-ink-secondary">{a.blurb}</p>
                <div className="mt-3 flex min-h-[45px] items-center justify-between gap-2 border-t border-edge pt-3">
                  <Dot tone={c?.connected ? "ok" : "off"}>{c?.connected ? `${t("Connected")}${c.accounts.length > 1 ? ` · ${c.accounts.length}` : ""}` : c?.pending ? t("Waiting for sign-in") : t("Not connected")}</Dot>
                  {!c?.connected && <button type="button" disabled={!apps?.configured} onClick={() => void connect(a)} className="h-8 rounded-lg bg-accent px-3 text-[12.5px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Connect")}</button>}
                </div>
                {note?.slug === a.slug && <div role="status" className="mt-2 text-[12px] text-ink-secondary"><span data-no-i18n="">{note.text}</span>{note.url && <> <a href={note.url} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">{t("Open authorization page")}</a></>}</div>}
              </article>
            );
          })}
          {apps && shownApps.length === 0 && <div className="col-span-full py-6 text-center text-[13.5px] text-ink-tertiary">{t("No app matches.")}</div>}
        </div>
      </section>

      <section aria-label={t("Custom MCP servers")} className="mt-8" data-testid="mcp-custom">
        <h3 className="text-[15px] font-medium">{t("Custom MCP servers")}</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {shownCustom.map((s) => {
            const on = used.includes(s.id);
            const tone = s.status.state === "ok" ? "ok" : s.status.state === "failed" ? "bad" : "off";
            return (
              <article key={s.id} data-testid="mcp-custom-card" className={cn(CARD, "min-h-[190px]")}>
                <div className="flex items-center gap-3">
                  <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary"><Plug size={18} /></span>
                  <span data-no-i18n="" className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{s.name}</span>
                  <Switch checked={on} label={`Use ${s.name}`} onToggle={() => setUsed(s.id, !on)} />
                </div>
                <p data-no-i18n="" className="mt-3 line-clamp-2 break-all font-mono text-[12px] leading-[18px] text-ink-tertiary">{s.transport === "stdio" ? `${s.command ?? ""} ${(s.args ?? []).join(" ")}` : s.url}</p>
                {on && <div className="mt-1"><ServerAccessControls name={s.name} acc={access[s.id] ?? { scope: "read", outbound: "ask" }} setAccess={(patch) => setAccess(s.id, patch)} /></div>}
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-edge pt-3">
                  <Dot tone={tone}>{s.status.state === "ok" ? `${t("Connected")} · ${s.status.tools.length} ${t("tools")}` : s.status.state === "failed" ? t("Failed") : t("Not tested")}</Dot>
                  <span className="flex gap-0.5">
                    <button type="button" title={t("Test")} aria-label={`${t("Test")} ${s.name}`} onClick={() => void test(s)} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><Play size={13} /></button>
                    <button type="button" title={t("Edit")} aria-label={`${t("Edit")} ${s.name}`} onClick={() => setEditing(s)} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><Pencil size={13} /></button>
                  </span>
                </div>
              </article>
            );
          })}
          {shownCustom.length === 0 && <div className="col-span-full py-6 text-center text-[13.5px] text-ink-tertiary">{custom.length === 0 ? t("No servers yet. Add one, or paste the JSON you use in Claude Desktop.") : t("No server matches.")}</div>}
        </div>
      </section>
      {editing && <McpServerEditor key={editing === "new" ? "new" : editing.id} server={editing === "new" ? null : editing} onClose={() => { setEditing(null); void loadServers(); }} />}
    </div>
  );
}
