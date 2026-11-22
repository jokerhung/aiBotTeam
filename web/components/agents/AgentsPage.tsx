"use client";
import { Info, Menu, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useStore } from "@/state/store";
import { useT } from "@/lib/i18n";
import { filterAgents } from "@/lib/agent-form";
import { Mascot } from "../Mascot";
import { AgentActions, BUTTON, INPUT, PRIMARY } from "./shared";
import { TemplateLibrary } from "./TemplateLibrary";

export function AgentsPage() {
  const { state, dispatch } = useStore(); const t = useT();
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("all"); const [section, setSection] = useState(""); const [templates, setTemplates] = useState(false);
  const bots = filterAgents(state.bots, search, status, section); const total = state.bots.filter((b) => !b.admin).length;
  return <main data-testid="page-agents" className="h-full min-w-0 flex-1 overflow-y-auto bg-app p-5 md:p-8">
    <header className="mb-7 flex flex-wrap items-center gap-3"><button aria-label={t("Open menu")} className="rounded-lg p-2 md:hidden" onClick={() => dispatch({ type: "rail", open: true })}><Menu size={18} /></button><h1 className="mr-auto flex items-center gap-2 text-2xl font-medium">Agents <Info size={16} className="text-ink-tertiary" aria-label={t("Manage your agents")} /></h1><button className={BUTTON} onClick={() => setTemplates(true)}>{t("Agent templates")}</button><button data-testid="agents-new" className={PRIMARY} onClick={() => dispatch({ type: "newBot", open: true })}><Plus size={16} />{t("New agent")}</button></header>
    <div className="mb-6 flex flex-wrap items-center gap-3"><label className="relative min-w-40 flex-1 md:max-w-72"><Search size={16} className="absolute left-3 top-3 text-ink-tertiary" /><input aria-label={t("Search agents")} placeholder={t("Search agents")} className={`${INPUT.replace("px-3", "pl-9 pr-3")}`} value={search} onChange={(e) => setSearch(e.target.value)} /></label><select className={`${INPUT.replace("w-full", "w-auto")}`} aria-label={t("Status")} value={status} onChange={(e) => setStatus(e.target.value)}>{["all", "active", "archived"].map((s) => <option key={s} value={s}>{t(s[0].toUpperCase() + s.slice(1))}</option>)}</select>{state.sections.length > 0 && <select className={`${INPUT.replace("w-full", "w-auto")}`} aria-label={t("Section")} value={section} onChange={(e) => setSection(e.target.value)}><option value="">{t("All sections")}</option>{state.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}<span className="ml-auto text-sm text-ink-secondary">{bots.length === total ? `${total} ${t("agents")}` : `${bots.length} ${t("of")} ${total}`}</span><button data-testid="agents-import" className="text-sm text-ink-secondary underline" onClick={() => dispatch({ type: "importBot", open: true })}>{t("Import agent")}</button></div>
    {!state.connected && <p role="status" className="mb-4 text-sm text-ink-tertiary">{t("Connecting to server?")}</p>}
    {!state.hydrated && <div aria-label={t("Loading agents")} className="grid animate-pulse gap-5 md:grid-cols-3">{[0, 1, 2].map((n) => <div key={n} className="h-60 rounded-xl bg-raised" />)}</div>}
    <div data-testid="agents-grid" className="grid grid-cols-1 gap-5 min-[850px]:grid-cols-2 min-[1280px]:grid-cols-3">{bots.map((bot) => <article key={bot.id} data-testid="agent-card" className="group relative flex min-w-0 flex-col rounded-xl border border-edge bg-composer p-5 transition-shadow hover:shadow-md">
      <a href={`#/agents/${encodeURIComponent(bot.id)}/build`} aria-label={`${t("Edit agent")}: ${bot.name}`} className="absolute inset-0 rounded-xl focus-visible:ring-2 focus-visible:ring-accent" />
      <div className="flex items-center gap-3"><Mascot color={bot.color} size={58} /><div className="min-w-0 flex-1"><h2 data-no-i18n className="min-w-0 flex-1 truncate text-lg font-medium">{bot.name}</h2>{bot.section && <span className="rounded-md bg-raised px-2 py-1 text-xs">{state.sections.find((s) => s.id === bot.section)?.name}</span>}</div></div><p data-no-i18n className="mt-2 min-h-15 line-clamp-3 text-sm leading-5 text-ink-secondary">{bot.description || bot.title || t("No description")}</p>
      <footer className="mt-5 flex items-center gap-2 border-t border-edge pt-3 text-xs text-ink-tertiary"><span className={`size-1.5 rounded-full ${bot.hidden ? "bg-ink-tertiary" : "bg-green-500"}`} /><span>{t(bot.hidden ? "archived" : "active")}</span><span className="ml-auto">{bot.updatedAt ? `${t("Edited")} ${new Date(bot.updatedAt).toLocaleDateString()}` : "?"}</span><AgentActions bot={bot} edit /></footer>
    </article>)}</div>
    {bots.length === 0 && <p className="py-24 text-center text-sm text-ink-secondary">{t(total ? "No agents match your search" : "No agents yet")}</p>}
    {templates && <TemplateLibrary onClose={() => setTemplates(false)} />}
  </main>;
}
