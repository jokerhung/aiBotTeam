"use client";
import { Check, ClipboardPaste, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { McpServer, McpStatus } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";

const INPUT = "w-full rounded-lg bg-inset px-3 text-[14px] text-ink outline-none ring-1 ring-inset ring-ink/[0.07] placeholder:text-ink-tertiary focus:ring-ink/25";

const toPairs = (m: Record<string, string> | undefined) => Object.entries(m ?? {}).map(([k, v]) => `${k}=${v}`).join("\n");
const fromPairs = (s: string) => Object.fromEntries(s.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf("="); return i < 0 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + 1)]; }));

function StatusDot({ s }: { s: McpStatus }) {
  const t = useT();
  const tone = s.state === "ok" ? "bg-success" : s.state === "failed" ? "bg-danger" : "bg-ink/30";
  return <span className="flex items-center gap-1.5 text-[12px] text-ink-tertiary"><span className={cn("size-2 rounded-full", tone)} />{t(s.state === "ok" ? "Connected" : s.state === "failed" ? "Failed" : "Not tested")}</span>;
}

/** Add or edit one server: stdio (a command) or remote (a URL). Secret values show as a mask and are kept unless replaced. */
export function McpServerEditor({ server, onClose }: { server: McpServer | null; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(server?.name ?? "");
  const [transport, setTransport] = useState<McpServer["transport"]>(server?.transport ?? "stdio");
  const [command, setCommand] = useState(server?.command ?? "");
  const [args, setArgs] = useState((server?.args ?? []).join("\n"));
  const [env, setEnv] = useState(toPairs(server?.env));
  const [url, setUrl] = useState(server?.url ?? "");
  const [headers, setHeaders] = useState(toPairs(server?.headers));
  const [budget, setBudget] = useState(server?.outputBudget ?? 20000);
  const [result, setResult] = useState<McpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const body = () => ({ name: name.trim(), transport, outputBudget: budget, ...(transport === "stdio"
    ? { command: command.trim(), args: args.split("\n").map((a) => a.trim()).filter(Boolean), env: fromPairs(env) }
    : { url: url.trim(), headers: fromPairs(headers) }) });
  const test = async () => {
    setBusy(true); setError(""); setResult(null);
    try { setResult(await api<McpStatus>("/api/mcp/test", { method: "POST", body: JSON.stringify(body()) })); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setError("");
    try {
      await api(server ? `/api/mcp/servers/${server.id}` : "/api/mcp/servers", { method: server ? "PATCH" : "POST", body: JSON.stringify(body()) });
      onClose();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const label = "mb-1.5 mt-4 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary";
  return (
    <div role="dialog" aria-modal="true" aria-label="MCP server" data-testid="mcp-editor" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[92vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl bg-panel text-ink shadow-xl ring-1 ring-ink/10">
        <div className="flex h-14 shrink-0 items-center px-5">
          <h2 className="flex-1 text-[16px] font-semibold">{server ? t("Edit server") : t("Add a server")}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-1.5 hover:bg-ink/10"><X size={15} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <div className={label} style={{ marginTop: 0 }}>{t("Name")}</div>
          <input data-no-i18n="" value={name} onChange={(e) => setName(e.target.value)} aria-label={t("Name")} placeholder="files" className={cn(INPUT, "h-10")} />
          <div className={label}>{t("Kind")}</div>
          <div role="radiogroup" className="flex gap-1.5">
            {(["stdio", "http", "sse"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={transport === k} onClick={() => setTransport(k)}
                className={cn("flex-1 rounded-lg px-2 py-1.5 text-[13px] ring-1 ring-ink/10", transport === k ? "bg-accent/12 ring-accent/60" : "hover:bg-ink/[0.04]")}>{k === "stdio" ? t("Command (stdio)") : k === "http" ? "HTTP" : "SSE"}</button>
            ))}
          </div>
          {transport === "stdio" ? (
            <>
              <div className={label}>{t("Command")}</div>
              <input data-no-i18n="" value={command} onChange={(e) => setCommand(e.target.value)} aria-label={t("Command")} placeholder="npx" className={cn(INPUT, "h-10 font-mono text-[13px]")} />
              <div className={label}>{t("Arguments (one per line)")}</div>
              <textarea data-no-i18n="" value={args} onChange={(e) => setArgs(e.target.value)} rows={3} aria-label={t("Arguments")} placeholder={"-y\n@modelcontextprotocol/server-filesystem\n."} className={cn(INPUT, "py-2 font-mono text-[13px]")} />
              <div className={label}>{t("Environment (KEY=value per line)")}</div>
              <textarea data-no-i18n="" value={env} onChange={(e) => setEnv(e.target.value)} rows={3} aria-label={t("Environment")} placeholder="API_KEY=…" className={cn(INPUT, "py-2 font-mono text-[13px]")} />
            </>
          ) : (
            <>
              <div className={label}>URL</div>
              <input data-no-i18n="" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="URL" placeholder="https://example.com/mcp" className={cn(INPUT, "h-10 font-mono text-[13px]")} />
              <div className={label}>{t("Headers (Name=value per line)")}</div>
              <textarea data-no-i18n="" value={headers} onChange={(e) => setHeaders(e.target.value)} rows={3} aria-label={t("Headers")} placeholder="Authorization=Bearer …" className={cn(INPUT, "py-2 font-mono text-[13px]")} />
            </>
          )}
          <div className="mt-1.5 text-[12px] text-ink-tertiary">{t("Values are kept on this computer and shown as ******** afterwards; leave them to keep what is stored.")}</div>
          <div className={label}>{t("Longest result shown (characters)")}</div>
          <input type="number" min={1000} max={500000} value={budget} onChange={(e) => setBudget(Number(e.target.value))} aria-label={t("Longest result shown (characters)")} className={cn(INPUT, "h-10 w-36")} />
          {result && (
            <div role="status" data-testid="mcp-test-result" className={cn("mt-4 rounded-xl px-3 py-2.5 text-[13px]", result.state === "ok" ? "bg-success/10 text-ink" : "bg-danger/10 text-danger")}>
              {result.state === "ok" ? (
                <><div className="flex items-center gap-1.5 font-medium text-success"><Check size={14} /> {t("Connected")} · {result.tools.length} {t("tools")}</div>
                  <div data-no-i18n="" className="mt-1 text-ink-secondary">{result.tools.map((x) => x.name).join(", ")}</div></>
              ) : <span data-no-i18n="">{result.error}</span>}
            </div>
          )}
          {error && <div role="alert" className="mt-3 text-[13px] text-danger">{error}</div>}
        </div>
        <div className="flex h-[60px] shrink-0 items-center justify-between border-t border-edge px-5">
          <button type="button" disabled={busy} onClick={test} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13.5px] text-ink-secondary hover:bg-ink/10"><Play size={13} /> {t("Test")}</button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-full px-3.5 py-2 text-[14px] text-ink-secondary hover:bg-ink/10">{t("Cancel")}</button>
            <button type="button" disabled={busy || !name.trim()} onClick={save} className="h-9 rounded-full bg-accent px-4 text-[14px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Save")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Custom MCP servers (the second tab of Connected apps): the list, its status, and a quick import from the JSON Claude Desktop uses. */
export function McpServersView() {
  const { state } = useStore();
  const t = useT();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [editing, setEditing] = useState<McpServer | "new" | null>(null);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => api<{ servers: McpServer[] }>("/api/mcp/servers").then((r) => setServers(r.servers)).catch(() => {}), []);
  useEffect(() => { void load(); }, [state.mcpTick, load]);
  const importJson = async () => {
    setError("");
    try { await api("/api/mcp/import", { method: "POST", body: JSON.stringify({ json: text }) }); setPasting(false); setText(""); await load(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <div role="tabpanel" aria-label={t("Custom MCP servers")} data-testid="mcp-panel" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-end gap-2 px-5 pb-3">
        <button type="button" onClick={() => setPasting((v) => !v)} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-ink/10"><ClipboardPaste size={14} /> {t("Paste JSON")}</button>
        <button type="button" onClick={() => setEditing("new")} data-testid="add-mcp" className="flex h-9 items-center gap-1.5 rounded-full bg-accent px-3.5 text-[13.5px] font-medium text-[var(--color-accent-ink)]"><Plus size={14} /> {t("Add a server")}</button>
      </div>
      {pasting && (
        <div className="px-5 pb-3" data-testid="mcp-paste">
          <textarea data-no-i18n="" value={text} onChange={(e) => setText(e.target.value)} rows={6} aria-label={t("Configuration JSON")} placeholder={'{ "mcpServers": { "files": { "command": "npx", "args": ["-y", "…"] } } }'} className={cn(INPUT, "py-2 font-mono text-[12.5px]")} />
          {error && <div role="alert" className="mt-1.5 text-[13px] text-danger">{error}</div>}
          <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setPasting(false)} className="rounded-full px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-ink/10">{t("Cancel")}</button>
            <button type="button" disabled={!text.trim()} onClick={importJson} className="rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Import")}</button></div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {servers.length === 0 && !pasting && <div className="px-6 py-12 text-center text-[13.5px] text-ink-tertiary">{t("No servers yet. Add one, or paste the JSON you use in Claude Desktop.")}</div>}
        {servers.filter((s) => s.appId !== "composio").map((s) => (
          <div key={s.id} data-testid="mcp-row" className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-raised/50">
            <div className="min-w-0 flex-1 leading-tight">
              <div data-no-i18n="" className={cn("truncate text-[14.5px] font-medium", !s.enabled && "opacity-50")}>{s.name}</div>
              <div data-no-i18n="" className="truncate font-mono text-[12px] text-ink-tertiary">{s.transport === "stdio" ? `${s.command} ${(s.args ?? []).join(" ")}` : s.url}</div>
            </div>
            <StatusDot s={s.status} />
            {s.status.state === "ok" && <span className="text-[12px] tabular-nums text-ink-tertiary">{s.status.tools.length} {t("tools")}</span>}
            <button type="button" title={t("Test")} aria-label={t("Test")} onClick={async () => { await api(`/api/mcp/servers/${s.id}/test`, { method: "POST" }).catch(() => {}); await load(); }} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><Play size={14} /></button>
            <button type="button" title={t("Edit")} aria-label={t("Edit")} onClick={() => setEditing(s)} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><Pencil size={14} /></button>
            <button type="button" title={t("Delete")} aria-label={t("Delete")} onClick={async () => { if (confirm(t("Delete this server?"))) { await api(`/api/mcp/servers/${s.id}`, { method: "DELETE" }).catch(() => {}); await load(); } }} className="rounded-full p-1.5 text-ink-tertiary hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-edge px-5 py-3 text-[12px] text-ink-tertiary">{t("A bot uses a server once you tick it in the bot's settings. Every tool it calls goes through that bot's approval level.")}</div>
      {editing && <McpServerEditor key={editing === "new" ? "new" : editing.id} server={editing === "new" ? null : editing} onClose={() => { setEditing(null); void load(); }} />}
    </div>
  );
}
