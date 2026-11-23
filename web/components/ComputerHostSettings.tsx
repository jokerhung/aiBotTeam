"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/state/api";
import { useT } from "@/lib/i18n";

interface Host { source: "cloud" | "embed" | "opensandbox"; apiUrl: string; sandboxUrl: string; domain: string; template: string; image: string; maxMachines: number; idleSeconds: number; keySet: boolean; status: string; detail?: string; installCommand?: string }
const INPUT = "mt-1 w-full rounded-lg border border-edge bg-inset px-3 py-2 text-sm";
export function ComputerHostSettings() {
  const t = useT(); const [host, setHost] = useState<Host | null>(null); const [key, setKey] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [result, setResult] = useState<{ ok: boolean; detail?: string } | null>(null);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resultTimer.current) clearTimeout(resultTimer.current); }, []);
  const notify = (ok: boolean, detail?: string) => {
    setResult({ ok, detail });
    resultTimer.current = setTimeout(() => setResult(null), 10000);
  };
  useEffect(() => { void api<Host>("/api/computer/host").then(setHost).catch((e: Error) => setError(e.message)); }, []);
  const save = async (test: boolean) => {
    if (!host) return;
    if (resultTimer.current) clearTimeout(resultTimer.current);
    setResult(null); setBusy(true); setError("");
    try {
      const { source, apiUrl, sandboxUrl, domain, template, image, maxMachines, idleSeconds } = host;
      const next = await api<Host>("/api/computer/host", { method: "PATCH", body: JSON.stringify({ source, apiUrl, sandboxUrl, domain, template, image, maxMachines, idleSeconds, ...(key ? { apiKey: key } : {}) }) });
      setKey(""); setHost(next);
      if (test) {
        const checked = await api<Host>("/api/computer/host/test", { method: "POST" });
        setHost(checked);
        notify(checked.status === "ready", checked.status === "ready" ? undefined : checked.status);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : t("Could not save");
      if (test) notify(false, message); else setError(message);
    } finally { setBusy(false); }
  };
  return <section className="space-y-4" data-testid="computer-host-settings"><p className="text-sm text-ink-secondary">{t("Connect a sandbox host to give each agent an isolated desktop. Provision the host using the setup guide, then test the connection here.")}</p>
    {host && <div className="space-y-4 rounded-xl border border-edge bg-card p-4">
      <label className="block text-sm">{t("Provider")}<select className={INPUT} value={host.source} onChange={(e) => setHost({ ...host, source: e.target.value as Host["source"], apiUrl: "", sandboxUrl: "", domain: "", status: "unchecked" })}><option value="cloud">E2B Cloud</option><option value="embed">E2B Embed</option><option value="opensandbox">OpenSandbox</option></select></label>
      {([...(host.source !== "cloud" ? ["apiUrl"] : []), ...(host.source === "embed" ? ["sandboxUrl", "domain"] : []), host.source === "opensandbox" ? "image" : "template"] as const).map((field) => <label key={field} className="block text-sm">{t(({ apiUrl: "API URL", sandboxUrl: "Sandbox URL", domain: "Domain", image: "Desktop image", template: "Desktop template" } as Record<string, string>)[field])}<input className={INPUT} value={String(host[field as keyof Host])} onChange={(e) => setHost({ ...host, [field]: e.target.value, status: "unchecked" })} /></label>)}
      <label className="block text-sm">{t("API key")}<input type="password" autoComplete="new-password" className={INPUT} value={key} onChange={(e) => setKey(e.target.value)} placeholder={host.keySet ? t("Key saved — enter to replace") : t("Enter API key")} /></label>
      <div className="grid grid-cols-2 gap-3">{(["maxMachines", "idleSeconds"] as const).map((field) => <label key={field} className="text-sm">{t(field === "maxMachines" ? "Maximum machines" : "Idle timeout (seconds)")}<input type="number" min={1} max={field === "maxMachines" ? 32 : 86400} className={INPUT} value={host[field]} onChange={(e) => setHost({ ...host, [field]: Number(e.target.value) })} /></label>)}</div>
      <div role="status" className="rounded-lg bg-inset p-3 text-sm">{t(host.status)}{host.detail && <p className="mt-1 text-ink-secondary">{host.detail}</p>}{host.installCommand && <code className="mt-2 block break-all">{host.installCommand}</code>}</div>
      <div className="flex flex-wrap items-center gap-2"><button disabled={busy} className="rounded-full bg-raised px-4 py-2 text-sm disabled:opacity-50" onClick={() => void save(false)}>{t("Save")}</button><button disabled={busy} className="rounded-full bg-accent px-4 py-2 text-sm text-[var(--color-accent-ink)] disabled:opacity-50" onClick={() => void save(true)}>{busy ? t("Testing…") : t("Save and test connection")}</button><a href={`/api/computer/guides/${host.source === "opensandbox" ? "opensandbox" : "e2b"}/${document.documentElement.lang === "vi" ? "vi" : "en"}`} target="_blank" rel="noreferrer" className="px-3 py-2 text-sm underline">{t("Setup guide")}</a>{result && <span role="status" title={result.detail ? t(result.detail) : undefined} className={`min-w-0 text-xs ${result.ok ? "text-success" : "text-danger"}`}>{t(result.ok ? "Connection test succeeded" : "Connection test failed")}{result.detail && `: ${t(result.detail)}`}</span>}</div>
    </div>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </section>;
}
