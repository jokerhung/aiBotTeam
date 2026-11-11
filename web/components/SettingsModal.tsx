"use client";
/* eslint-disable react-hooks/set-state-in-effect -- these effects hydrate from localStorage or reset form state when a dialog opens or the target changes */
import { Check, CircleHelp, Cpu, KeyRound, Palette, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LANGUAGES, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SKINS } from "@/lib/skins";
import type { AppConfig, AppSettings, InstanceInfo } from "@/lib/wire";
import { api } from "@/state/api";
import { DEFAULT_SETTINGS, useStore, type SettingsPage } from "@/state/store";

const PAGES: { id: SettingsPage; label: string; icon: typeof Cpu }[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "connections", label: "Connections", icon: KeyRound },
  { id: "engines", label: "Engines", icon: Cpu },
  { id: "appearance", label: "Appearance", icon: Palette },
];

/** A labelled group: small heading, then one rounded card holding its rows (as in the reference's settings pages). */
function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="mb-6">
      <div className="mb-2 text-[13px] font-semibold text-ink-secondary">{title}</div>
      <div data-testid={testId} className="rounded-xl bg-card px-4 ring-[0.5px] ring-ink/10">{children}</div>
    </section>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-hairline/60 py-3 last:border-0 max-sm:flex-col max-sm:items-stretch max-sm:gap-2">
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-ink">{title}</div>
        {hint && <div className="text-[12.5px] leading-4 text-ink-tertiary">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const SELECT = "h-9 rounded-lg border-0 bg-inset px-3 text-[14px] text-ink outline-none";

function useSettingsSave() {
  const { dispatch } = useStore();
  const { state } = useStore();
  return async (patch: Partial<AppSettings>) => {
    // The page changes at once (no waiting for the server); the server's answer then confirms it.
    dispatch({ type: "config", config: { ...state.config, settings: { ...state.config.settings, ...patch } } });
    const out = await api<AppConfig>("/api/config", { method: "PUT", body: JSON.stringify(patch) });
    dispatch({ type: "config", config: { settings: { ...DEFAULT_SETTINGS, ...out.settings }, keys: out.keys, keyCatalog: out.keyCatalog } });
  };
}

function General() {
  const { state } = useStore();
  const t = useT();
  const s = state.config.settings;
  const save = useSettingsSave();
  const [name, setName] = useState(s.displayName);
  useEffect(() => setName(s.displayName), [s.displayName]);
  return (
    <>
      <Section title={t("Account")}>
      <Row title={t("Display name")} hint="Shown in your profile menu.">
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={() => name !== s.displayName && void save({ displayName: name })}
          aria-label="Display name" className={cn(SELECT, "w-56")} />
      </Row>
      </Section>
      <Section title={t("Appearance")}>
      <Row title={t("Interface")} hint="Simple hides advanced controls.">
        <select aria-label="Interface mode" value={s.uiMode} onChange={(e) => void save({ uiMode: e.target.value as AppSettings["uiMode"] })} className={SELECT}>
          <option value="simple">Simple</option>
          <option value="advanced">Advanced</option>
        </select>
      </Row>
      </Section>
      <Section title={t("Language and typing")}>
      <Row title={t("Language")} hint="More languages arrive in a later release.">
        <select aria-label="Language" value={s.language} onChange={(e) => void save({ language: e.target.value })} className={SELECT}>
          {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </Row>
      </Section>
    </>
  );
}

function KeyRow({ id, label, purpose, configured }: { id: string; label: string; purpose: string; configured: boolean }) {
  const { dispatch } = useStore();
  const t = useT();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const put = async (v: string | null) => {
    setBusy(true);
    setError("");
    try {
      const out = await api<AppConfig>("/api/config", { method: "PUT", body: JSON.stringify({ keys: { [id]: v } }) });
      dispatch({ type: "config", config: { settings: { ...DEFAULT_SETTINGS, ...out.settings }, keys: out.keys, keyCatalog: out.keyCatalog } });
      setValue("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border-b border-hairline/60 py-3.5 last:border-0" data-testid={`key-${id}`}>
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn("size-2 rounded-full", configured ? "bg-success" : "bg-ink-tertiary/50")} />
        <span className="text-[14px] font-medium text-ink">{label}</span>
        <span className="rounded bg-ink/[0.07] px-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">{t("Optional")}</span>
        {configured && <span className="text-[12.5px] text-success">{t("Connected")}</span>}
        <span title={purpose} className="ml-auto text-ink-tertiary"><CircleHelp size={14} /></span>
      </div>
      <div className="mt-0.5 pl-4 text-[12.5px] text-ink-tertiary">{purpose}</div>
      <div className="mt-2 flex gap-2 pl-4">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && value.trim() && void put(value.trim())}
          placeholder={configured ? "••••••••  (paste to replace)" : "Paste key"}
          aria-label={`${label} key`}
          className={cn(SELECT, "min-w-0 flex-1 font-mono text-[13px]")}
        />
        {configured && !value.trim() ? (
          <button type="button" disabled={busy} onClick={() => put(null)} className="h-9 w-[72px] shrink-0 rounded-lg bg-control text-[14px] font-medium text-danger hover:bg-raised-hover">{t("Clear")}</button>
        ) : (
          <button type="button" disabled={busy || !value.trim()} onClick={() => put(value.trim())} className="flex h-9 w-[72px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-control text-[14px] font-medium text-ink-secondary hover:bg-raised-hover disabled:opacity-60"><Check size={14} /> {t("Save")}</button>
        )}
      </div>
      {error && <div role="alert" className="mt-1 pl-4 text-[12.5px] text-danger">{error}</div>}
    </div>
  );
}

function Connections() {
  const { state } = useStore();
  const t = useT();
  const { keyCatalog, keys } = state.config;
  return (
    <Section title={t("Keys")} testId="keys-card">
      <p className="pt-3 text-[13px] leading-[18px] text-ink-secondary">{t("Shared by all bots. Saving a key reloads providers instantly; keys are stored locally and never shown again.")}</p>
      {keyCatalog.map((k) => <KeyRow key={k.id} id={k.id} label={k.label} purpose={k.purpose} configured={!!keys[k.id]?.configured} />)}
    </Section>
  );
}

function EngineRow({ inst }: { inst: InstanceInfo }) {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const patch = (body: object) => api(`/api/instances/${inst.id}`, { method: "PATCH", body: JSON.stringify(body) }).catch(() => {});
  const ok = inst.snapshot.state === "available";
  const cli = inst.driver === "claude" || inst.driver === "codex";
  return (
    <div className="border-b border-hairline/60 py-3.5 last:border-0" data-testid={`engine-${inst.id}`}>
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn("size-2 rounded-full", ok && inst.snapshot.signedIn !== false ? "bg-success" : "bg-warning")} />
        <span className="text-[14px] font-medium text-ink">{inst.displayName}</span>
        {inst.snapshot.version && <span className="text-[12px] text-ink-tertiary">{inst.snapshot.version}</span>}
        <span className="ml-auto flex items-center gap-3 text-[13px] text-ink-secondary">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={inst.enabled} onChange={(e) => patch({ enabled: e.target.checked })} /> On</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={inst.hidden} onChange={(e) => patch({ hidden: e.target.checked })} /> Hide</label>
        </span>
      </div>
      <div className="mt-0.5 pl-4 text-[12.5px] text-ink-tertiary">
        {!ok ? inst.snapshot.reason ?? "Unavailable" : inst.snapshot.signedIn === false ? "Not signed in — run the CLI’s login command" : inst.snapshot.signedIn ? "Signed in" : "Ready"}
      </div>
      {cli && (
        <div className="mt-2 flex gap-2 pl-4">
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="Custom path to the CLI (optional)" aria-label={`${inst.displayName} binary path`} className={cn(SELECT, "min-w-0 flex-1 font-mono text-[13px]")} />
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); await (path.trim() ? patch({ path: path.trim() }) : api(`/api/instances/${inst.id}/check`, { method: "POST" }).catch(() => {})); setBusy(false); }}
            className="rounded-lg bg-raised px-3.5 text-[13px] font-medium text-ink hover:bg-raised-hover disabled:opacity-40">{path.trim() ? "Use path" : "Re-check"}</button>
        </div>
      )}
    </div>
  );
}

function AddEndpoint() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ displayName: "", baseUrl: "", apiKey: "", models: "" });
  const [error, setError] = useState("");
  const add = async () => {
    setError("");
    try {
      await api("/api/instances", { method: "POST", body: JSON.stringify({
        displayName: f.displayName.trim(), baseUrl: f.baseUrl.trim(), apiKey: f.apiKey.trim() || undefined,
        models: f.models.split(",").map((m) => m.trim()).filter(Boolean),
      }) });
      setF({ displayName: "", baseUrl: "", apiKey: "", models: "" });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the endpoint");
    }
  };
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="mt-3 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-medium text-accent-text hover:bg-ink/10"><Plus size={14} /> Add OpenAI-compatible endpoint</button>;
  const input = cn(SELECT, "w-full");
  return (
    <div className="mt-3 grid gap-2 rounded-xl bg-inset p-3">
      <input aria-label="Endpoint name" placeholder="Name" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} className={input} />
      <input aria-label="Base URL" placeholder="Base URL, e.g. http://localhost:1234/v1" value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} className={input} />
      <input aria-label="API key" type="password" autoComplete="off" placeholder="API key (optional)" value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} className={input} />
      <input aria-label="Models" placeholder="Models, comma separated (optional)" value={f.models} onChange={(e) => setF({ ...f, models: e.target.value })} className={input} />
      {error && <div role="alert" className="text-[12.5px] text-danger">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-ink/10">Cancel</button>
        <button type="button" disabled={!f.displayName.trim() || !f.baseUrl.trim()} onClick={add} className="rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">Add</button>
      </div>
    </div>
  );
}

interface Rule { id: string; command: string; cwd: string }

function Allowlist() {
  const [rules, setRules] = useState<Rule[]>([]);
  const load = () => api<{ rules: Rule[] }>("/api/command-allowlist").then((r) => setRules(r.rules)).catch(() => {});
  useEffect(() => { void load(); }, []);
  if (!rules.length) return null;
  return (
    <div className="mt-5">
      <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Always-allowed commands</div>
      {rules.map((r) => (
        <div key={r.id} className="flex items-center gap-2 border-b border-hairline/60 py-2 last:border-0">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[12.5px] text-ink">{r.command}</div>
            <div className="truncate font-mono text-[11.5px] text-ink-tertiary">in {r.cwd}</div>
          </div>
          <button type="button" aria-label="Remove rule" onClick={() => api(`/api/command-allowlist/${r.id}`, { method: "DELETE" }).then(load)} className="rounded-full p-1.5 text-ink-tertiary hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
        </div>
      ))}
    </div>
  );
}

function Engines() {
  const { state } = useStore();
  return (
    <>
      {state.instances.map((i) => <EngineRow key={i.id} inst={i} />)}
      <AddEndpoint />
      <Allowlist />
    </>
  );
}

/** One live thumbnail per skin: a tiny subtree under [data-skin] so it paints with that skin's own tokens. */
function SkinTile({ id, name, tagline, selected, onPick }: { id: string; name: string; tagline: string; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={name} onClick={onPick} data-testid="skin-tile"
      className={cn("flex w-[140px] flex-col rounded-xl p-[9px] text-left ring-1 ring-inset ring-hairline transition-colors hover:bg-ink/[0.04]", selected && "bg-raised ring-accent")}>
      <div data-skin={id} data-skin-preview="" className="flex h-[78px] w-[122px] overflow-hidden rounded-md bg-app text-ink ring-1 ring-ink/10">
        <div className="w-[34%] bg-panel p-1.5"><div className="mb-1 size-2 rounded-full bg-raised" /><div className="mb-0.5 h-[3px] w-[70%] rounded bg-raised" /><div className="h-[3px] w-[50%] rounded bg-raised" /></div>
        <div className="flex flex-1 flex-col justify-end gap-1 p-1.5">
          <div className="ml-auto h-3 w-[55%] rounded-full bg-bubble-user" />
          <div className="h-3 w-[70%] rounded-md bg-card" />
          <div className="mt-0.5 flex h-4 items-center justify-end rounded-full bg-composer px-1 ring-1 ring-ink/10"><span className="size-2.5 rounded-full bg-accent" /></div>
        </div>
      </div>
      <div className="mx-0.5 mt-[9px] flex items-center text-[13px] font-medium leading-[19.5px] text-ink">
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {selected && <Check size={14} className="shrink-0 text-accent" />}
      </div>
      <div className="mx-0.5 mb-[3px] mt-0 text-[11px] leading-[15.125px] text-ink-secondary">{tagline}</div>
    </button>
  );
}

function Appearance() {
  const { state } = useStore();
  const t = useT();
  const s = state.config.settings;
  const save = useSettingsSave();
  return (
    <>
      <div role="radiogroup" aria-label="Skin" className="grid grid-cols-[repeat(4,140px)] justify-start gap-3 pb-4 max-sm:grid-cols-[repeat(2,140px)]">
        {SKINS.map((k) => <SkinTile key={k.id} id={k.id} name={k.name} tagline={k.tagline} selected={s.skin === k.id} onPick={() => void save({ skin: k.id })} />)}
      </div>
      <Row title={t("Font")}>
        <select aria-label="Font" value={s.font} onChange={(e) => void save({ font: e.target.value })} className={SELECT}>
          <option value="skin">Skin default</option>
          <option value="inter">Inter</option>
          <option value="geist">Geist</option>
          <option value="system">System</option>
        </select>
      </Row>
      <Row title={t("Chat width")}>
        <select aria-label="Chat width" value={s.chatWidth} onChange={(e) => void save({ chatWidth: e.target.value as AppSettings["chatWidth"] })} className={SELECT}>
          <option value="default">Default</option>
          <option value="wide">Wide</option>
        </select>
      </Row>
      <Row title={t("Reduce motion")} hint="Turns off animations and transitions.">
        <input type="checkbox" aria-label="Reduce motion" checked={s.reduceMotion} onChange={(e) => void save({ reduceMotion: e.target.checked })} />
      </Row>
    </>
  );
}

export function SettingsModal() {
  const { state, dispatch } = useStore();
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (state.settingsOpen) ref.current?.focus(); }, [state.settingsOpen]);
  if (!state.settingsOpen) return null;
  const close = () => dispatch({ type: "settings", open: false });
  const page = state.settingsPage;
  return (
    <div role="dialog" aria-modal="true" aria-label="Settings" className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === "Escape" && close()}>
      <div ref={ref} tabIndex={-1} data-testid="settings-modal" className="flex h-[min(700px,calc(100vh-100px))] max-h-[92vh] w-[860px] max-w-[96vw] animate-pop-in overflow-hidden rounded-2xl border border-hairline/70 bg-app shadow-2xl outline-none max-sm:flex-col">
        <nav aria-label="Settings sections" className="flex w-[198px] shrink-0 flex-col gap-0.5 border-r border-hairline/60 bg-app px-3 py-4 max-sm:w-full max-sm:flex-row max-sm:overflow-x-auto max-sm:border-b max-sm:border-r-0">
          {PAGES.map((p) => (
            <button key={p.id} type="button" aria-current={page === p.id ? "page" : undefined} onClick={() => dispatch({ type: "settings", open: true, page: p.id })}
              className={cn("flex h-8 shrink-0 items-center gap-[9px] rounded-lg px-[9px] text-left text-[13px]", page === p.id ? "bg-ink/[0.07] text-ink" : "text-ink hover:bg-ink/[0.06]")}>
              <p.icon size={15} /> {t(p.label)}
            </button>
          ))}
        </nav>
        <div className="relative min-w-0 flex-1 overflow-y-auto px-8 pb-6 pt-[22px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button type="button" aria-label="Close settings" onClick={close} className="absolute right-[22px] top-[21px] rounded-full p-1.5 text-ink-secondary hover:bg-ink/10 hover:text-ink"><X size={16} /></button>
          <h2 className="mb-[18px] text-[17px] font-medium leading-6 tracking-[-0.008em] text-ink">{t(PAGES.find((p) => p.id === page)?.label ?? "")}</h2>
          {page === "general" && <General />}
          {page === "connections" && <Connections />}
          {page === "engines" && <Engines />}
          {page === "appearance" && <Appearance />}
        </div>
      </div>
    </div>
  );
}
