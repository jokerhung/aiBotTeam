"use client";
import { useEffect, useState } from "react";
import { DEFAULT_TOOLBOX, type Bot, type HandBack, type SharedCapability, type ToolboxSettings } from "@/lib/wire";
import { useT } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { api } from "@/state/api";
import { randomUuid } from "@/lib/random-uuid";
import { BUTTON } from "../shared";

const INPUT = "mt-1 w-full rounded-lg border border-edge bg-card px-3 py-2 text-sm";
export function NativeSettings({ resource, bot, onChange }: { resource: "subagents" | "web" | "computer" | "resources"; bot: Bot; onChange: (p: Partial<Bot>) => void }) {
  const t = useT(); const { state } = useStore();
  const config = bot.toolbox ?? DEFAULT_TOOLBOX;
  const change = <K extends keyof ToolboxSettings>(key: K, patch: Partial<ToolboxSettings[K]>) => onChange({ toolbox: { ...config, [key]: { ...config[key], ...patch } } });
  const [host, setHost] = useState<{ available: boolean; reason?: string; reasonCode?: string } | null>(null);
  useEffect(() => { if (resource === "computer") void api<typeof host>(`/api/bots/${bot.id}/computer/capability`).then(setHost).catch(() => setHost({ available: false, reason: t("Could not check Computer host") })); }, [resource, bot.id, t]);
  const check = (label: string, value: boolean, set: (v: boolean) => void, hint?: string) => <label className="flex items-start gap-3 py-2 text-sm"><input type="checkbox" className="mt-1" checked={value} onChange={(e) => set(e.target.checked)} /><span>{t(label)}{hint && <span className="mt-1 block text-xs leading-5 text-ink-secondary">{t(hint)}</span>}</span></label>;
  const number = (label: string, value: number, min: number, max: number, set: (v: number) => void) => <label className="block text-sm">{t(label)}<input type="number" className={INPUT} value={value} min={min} max={max} onChange={(e) => { const n = Number(e.target.value); if (n >= min && n <= max) set(n); }} /></label>;
  const mode = (value: HandBack | null | undefined, set: (v: HandBack | null) => void, inherit = false) => <select aria-label={t("Hand-back mode")} className={INPUT} value={value ?? ""} onChange={(e) => set((e.target.value || null) as HandBack | null)}>{inherit && <option value="">{t("Use agent policy")}</option>}<option value="sync">{t("Synchronous")}</option><option value="async">{t("Background")}</option><option value="auto">{t("Automatic")}</option></select>;
  if (resource === "resources") return <div className="space-y-4">
    <p className="text-sm text-ink-secondary">{t("Resources keep immutable versions. Only people approve a version; routines use its exact reference.")}</p>
    {check("Allow HTML resources", config.resources.allowHtml, (allowHtml) => change("resources", { allowHtml }))}
    {check("Show resource cards in chat", config.resources.chatCards, (chatCards) => change("resources", { chatCards }))}
    {number("Maximum HTML size (KB)", config.resources.maxHtmlBytes / 1024, 1, 2048, (value) => change("resources", { maxHtmlBytes: value * 1024 }))}
    {number("Maximum Markdown size (KB)", config.resources.maxMarkdownBytes / 1024, 1, 500, (value) => change("resources", { maxMarkdownBytes: value * 1024 }))}
    {number("Maximum image size (KB)", config.resources.maxImageBytes / 1024, 1, 10240, (value) => change("resources", { maxImageBytes: value * 1024 }))}
  </div>;
  if (resource === "web") return <div className="space-y-4">
    <p className="text-sm text-ink-secondary">{t("A private browser profile for this agent, powered by Playwright MCP.")}</p>
    {check("Show browser window", config.web.headed, (headed) => change("web", { headed }))}
    {check("Allow local network pages", config.web.allowLocal, (allowLocal) => change("web", { allowLocal }), "Private network access is blocked by default. BotTeam control ports remain protected.")}
    {number("Idle timeout (seconds, 0 to keep open)", config.web.idleSeconds, 0, 86400, (idleSeconds) => change("web", { idleSeconds }))}
    <button className={BUTTON} onClick={async () => { if (confirm(t("Reset this agent's browser profile and saved logins?"))) await api(`/api/bots/${bot.id}/browser/profile`, { method: "DELETE" }); }}>{t("Reset browser profile")}</button>
  </div>;
  if (resource === "computer") return <div className="space-y-4">
    <div role="status" className="rounded-lg bg-card p-3 text-sm">{host?.available ? t("Computer host is ready") : host?.reason ?? t("Checking Computer host…")}</div>
    <p className="text-xs text-ink-secondary">{t("Configure and test the connection in Settings → Computer host before enabling this capability. The selected engine must support image tool results.")}</p>
    <div className="grid grid-cols-2 gap-3">{number("Width", config.computer.resolution[0], 640, 3840, (width) => change("computer", { resolution: [width, config.computer.resolution[1]] }))}{number("Height", config.computer.resolution[1], 640, 3840, (height) => change("computer", { resolution: [config.computer.resolution[0], height] }))}</div>
    {number("Idle timeout (seconds)", config.computer.idleSeconds, 30, 86400, (idleSeconds) => change("computer", { idleSeconds }))}
    {check("Allow commands", config.computer.allowCommands, (allowCommands) => change("computer", { allowCommands }), "Run commands inside the sandbox. Full approval mode also permits commands.")}
  </div>;
  const policy = config.subagents;
  const candidates = state.bots.filter((b) => b.id !== bot.id && !b.admin && !b.inline && !b.ephemeral);
  return <div className="space-y-5">
    <section><h4 className="text-sm font-medium">{t("Delegates")}</h4>{check("All accessible agents", policy.allowAnyAgent, (allowAnyAgent) => change("subagents", { allowAnyAgent }), "Only interactive chats can discover agents. Routines, webhooks and channels use the delegates selected below.")}
      <p className="mb-2 text-xs text-ink-secondary">{t("Delegates use their current setup. Select an agent to allow unattended delegation.")}</p>
      {candidates.map((candidate) => { const selected = policy.delegates.find((d) => d.bot === candidate.id); return <div key={candidate.id} className="mb-2 rounded-lg border border-edge p-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!selected} onChange={(e) => change("subagents", { delegates: e.target.checked ? [...policy.delegates, { bot: candidate.id }] : policy.delegates.filter((d) => d.bot !== candidate.id) })} />{candidate.name}</label>{selected && mode(selected.handBack, (handBack) => change("subagents", { delegates: policy.delegates.map((d) => d.bot === candidate.id ? { ...d, handBack } : d) }), true)}</div>; })}
    </section>
    <section className="space-y-3"><h4 className="text-sm font-medium">{t("Inline specialists")}</h4>
      {policy.inline.map((specialist, index) => { const update = (patch: Partial<typeof specialist>) => change("subagents", { inline: policy.inline.map((s, i) => i === index ? { ...s, ...patch } : s) }); return <details key={specialist.id} className="rounded-lg border border-edge p-3" open><summary className="cursor-pointer text-sm font-medium">{specialist.name || t("New specialist")}</summary><div className="mt-3 space-y-3">
        <label className="block text-sm">{t("Name")}<input className={INPUT} value={specialist.name} maxLength={60} onChange={(e) => update({ name: e.target.value })} /></label>
        <label className="block text-sm">{t("Description")}<textarea className={INPUT} value={specialist.description} onChange={(e) => update({ description: e.target.value })} /></label>
        <label className="block text-sm">{t("Instructions")}<textarea className={`${INPUT} min-h-36`} value={specialist.instructions} onChange={(e) => update({ instructions: e.target.value })} /></label>
        {number("Maximum steps", specialist.maxSteps, 1, 200, (maxSteps) => update({ maxSteps }))}
        <label className="block text-sm">{t("Model")}<input className={INPUT} placeholder={t("Inherit parent model")} value={specialist.modelSelection?.model ?? ""} onChange={(e) => update({ modelSelection: e.target.value ? { ...bot.modelSelection, model: e.target.value } : null })} /></label>
        {mode(specialist.handBack, (handBack) => update({ handBack }), true)}
        <div className="flex flex-wrap gap-3">{(["web", "computer", "memory", "skills", "apps"] as SharedCapability[]).map((cap) => <label key={cap} className="text-xs"><input type="checkbox" checked={specialist.capabilities.includes(cap)} onChange={(e) => update({ capabilities: e.target.checked ? [...specialist.capabilities, cap] : specialist.capabilities.filter((v) => v !== cap) })} /> {t(cap)}</label>)}</div>
        <label className="block text-sm">{t("Knowledge (one reference per line)")}<textarea className={INPUT} value={specialist.knowledge.join("\n")} onChange={(e) => update({ knowledge: e.target.value.split("\n").filter(Boolean) })} /></label>
        <label className="block text-sm">{t("Skills (one assigned skill ID per line)")}<textarea className={INPUT} value={specialist.skills.join("\n")} onChange={(e) => update({ skills: e.target.value.split("\n").filter(Boolean) })} /></label>
        <div className="flex gap-2"><button className={BUTTON} onClick={() => change("subagents", { inline: policy.inline.filter((s) => s.id !== specialist.id) })}>{t("Remove")}</button>{specialist.botId && <button className={BUTTON} onClick={async () => { await api(`/api/bots/${specialist.botId}/promote`, { method: "POST" }); }}>{t("Promote to agent")}</button>}</div>
      </div></details>; })}
      <button className={BUTTON} onClick={() => change("subagents", { inline: [...policy.inline, { id: randomUuid(), name: "Specialist", description: "", instructions: "", maxSteps: 20, capabilities: [], knowledge: [], skills: [] }] })}>{t("Add specialist")}</button>
    </section>
    <section className="space-y-3"><h4 className="text-sm font-medium">{t("Delegation policy")}</h4>{mode(policy.mode, (value) => change("subagents", { mode: value! }))}
      {check("Allow questions", policy.allowQuestions, (allowQuestions) => change("subagents", { allowQuestions }), "Explicit synchronous delegates can ask questions in the parent conversation. Temporary specialists cannot ask questions.")}
      {check("Allow dynamic specialists", policy.allowDynamic, (allowDynamic) => change("subagents", { allowDynamic }), "Approve each specialist's full instructions before delegation, unless approval mode is Full.")}
      {number("Maximum depth", policy.maxDepth, 1, 3, (maxDepth) => change("subagents", { maxDepth }))}
      <details><summary className="cursor-pointer text-sm">{t("Advanced")}</summary><div className="mt-3 space-y-3">{number("Maximum concurrent delegates", policy.maxFanout, 1, 10, (maxFanout) => change("subagents", { maxFanout }))}{number("Maximum result characters", policy.maxResultChars, 500, 20000, (maxResultChars) => change("subagents", { maxResultChars }))}{number("Maximum synchronous wait (seconds)", policy.maxWaitSeconds, 1, 1800, (maxWaitSeconds) => change("subagents", { maxWaitSeconds }))}<h5 className="text-sm">{t("Shared capabilities")}</h5>{(["web", "computer", "memory", "skills", "apps"] as SharedCapability[]).map((cap) => check(cap, policy.shareWithDelegates.includes(cap), (value) => change("subagents", { shareWithDelegates: value ? [...policy.shareWithDelegates, cap] : policy.shareWithDelegates.filter((v) => v !== cap) })))}</div></details>
    </section>
  </div>;
}
