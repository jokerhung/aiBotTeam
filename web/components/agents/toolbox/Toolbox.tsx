"use client";
import { ChevronLeft, ChevronRight, Info, Search, Settings2, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useT } from "@/lib/i18n";
import { SKINS } from "@/lib/skins";
import type { Bot } from "@/lib/wire";
import { useStore } from "@/state/store";
import { AppsField, LibraryTab } from "../../BotPanel";
import { MemorySection } from "../../MemorySection";
import { SkillsSection } from "../../SkillsSection";
import { BUTTON, trapDialog } from "../shared";
import { CAPABILITY_ART, CAPABILITY_HUE } from "./art.generated";
import { DRAWN_ART, DRAWN_HUE } from "./art.drawn";
import { TOOLBOX_CATALOG, toolboxShelves, type ToolboxCapability } from "./catalog";
import "./capability-art.css";

type Resource = NonNullable<ToolboxCapability["resource"]>;
export function Toolbox({ bot, onChange }: { bot: Bot; onChange: (patch: Partial<Bot>) => void }) {
  const { state, dispatch } = useStore(); const t = useT();
  const [query, setQuery] = useState(""); const [opened, setOpened] = useState<string | null>(null);
  const [backup, setBackup] = useState<{ skills: string[]; apps: string[] }>({ skills: [], apps: [] });
  const shelves = toolboxShelves(query, t); const entry = TOOLBOX_CATALOG.find((item) => item.id === opened);
  const enabled = (item: ToolboxCapability) => item.resource === "memory" ? bot.memory !== false : item.resource === "skills" ? !!bot.skills?.length : item.resource === "apps" ? !!bot.mcpServers?.length : false;
  const toggle = (resource: Resource) => {
    if (resource === "memory") onChange({ memory: bot.memory === false });
    else {
      const values = resource === "skills" ? bot.skills ?? [] : bot.mcpServers ?? [];
      if (values.length) setBackup((saved) => ({ ...saved, [resource]: values }));
      const next = values.length ? [] : backup[resource];
      if (!values.length && !next.length) { setOpened(resource === "skills" ? "skills" : "connected_apps"); return; }
      onChange(resource === "skills" ? { skills: next } : { mcpServers: next });
    }
  };
  const count = (item: ToolboxCapability) => item.resource === "memory" ? t("Built in") : item.resource === "skills" ? `${bot.skills?.length ?? 0} ${t("assigned")}` : item.resource === "apps" ? `${bot.mcpServers?.length ?? 0} ${t("assigned")}` : t("Soon");
  const open = (id: string) => setOpened(id);
  return <section data-testid="toolbox-gallery" className="toolbox-gallery rounded-xl border border-edge bg-composer p-4 sm:p-5" data-dark={SKINS.find((skin) => skin.id === state.config.settings.skin)?.dark ?? false} data-reduced-motion={state.config.settings.reduceMotion}>
    <h2 className="text-base font-medium">{t("Capabilities")}</h2>
    <p className="mt-1 text-[13px] leading-5 text-ink-secondary">{t("What this agent can do, and where it keeps what it produces.")}</p>
    <div className="my-5 flex items-center gap-3"><label className="relative block w-full max-w-72"><Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-ink-tertiary" /><input aria-label={t("Search capabilities")} placeholder={t("Search capabilities…")} value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 w-full rounded-xl border border-edge bg-card pl-8 pr-3 text-[13px] outline-none focus:border-ink-tertiary" /></label><Info size={15} className="shrink-0 text-ink-tertiary" aria-label={t("Unavailable capabilities are marked Soon")} /></div>
    <div className="space-y-7">{shelves.map((shelf) => <Shelf key={shelf.category} category={shelf.category} entries={shelf.entries} enabled={enabled} count={count} opened={opened} onOpen={open} onToggle={toggle} />)}</div>
    {shelves.length === 0 && <p className="py-12 text-center text-sm text-ink-tertiary">{t("No capabilities match your search")}</p>}
    {entry && <CapabilityPanel key={entry.id} entry={entry} bot={bot} enabled={enabled(entry)} onToggle={() => entry.resource && toggle(entry.resource)} onChange={onChange} onClose={() => setOpened(null)} onConnect={() => { if (dispatch({ type: "view", view: "apps" })) setOpened(null); }} />}
  </section>;
}

function CapabilityArt({ entry, off }: { entry: ToolboxCapability; off: boolean }) {
  const id = entry.artId ?? entry.id; const markup = CAPABILITY_ART[id] ?? DRAWN_ART[id];
  return <div className={`cap-art ${off ? "is-off" : ""}`} style={{ "--h": CAPABILITY_HUE[id] ?? DRAWN_HUE[id] ?? 210 } as CSSProperties} aria-hidden="true">
    {/* Trusted, repository-owned SVG constants adapted from the reference app; never user input. */}
    {markup ? <div className="stage v-B h-20 sm:h-24" dangerouslySetInnerHTML={{ __html: markup }} /> : <div className="stage v-B grid h-20 sm:h-24 place-items-center text-3xl text-ink-tertiary">{entry.name[0]}</div>}
  </div>;
}

function CapabilitySwitch({ checked, disabled, label, onToggle }: { checked: boolean; disabled: boolean; label: string; onToggle: () => void }) {
  return <button type="button" role="switch" aria-checked={checked} disabled={disabled} aria-label={label} onClick={onToggle} className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "border-success bg-success" : "border-ink-tertiary bg-ink/15"}`}><span className={`absolute top-px size-4 rounded-full shadow-sm transition-transform ${checked ? "translate-x-[17px] bg-white" : "translate-x-px bg-ink-secondary"}`} style={{ left: 0 }} /></button>;
}

function Shelf({ category, entries, enabled, count, opened, onOpen, onToggle }: {
  category: string; entries: ToolboxCapability[]; enabled: (entry: ToolboxCapability) => boolean; count: (entry: ToolboxCapability) => string; opened: string | null; onOpen: (id: string) => void; onToggle: (resource: Resource) => void;
}) {
  const t = useT(); const strip = useRef<HTMLDivElement>(null); const { state } = useStore();
  const [edges, setEdges] = useState({ left: false, right: false });
  const contentKey = entries.map((item) => item.id).join(",");
  useEffect(() => {
    const element = strip.current; if (!element) return;
    const measure = () => {
      const left = element.scrollLeft > 1, right = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setEdges((previous) => previous.left === left && previous.right === right ? previous : { left, right });
    };
    const observer = new ResizeObserver(measure); observer.observe(element); element.addEventListener("scroll", measure); measure();
    return () => { observer.disconnect(); element.removeEventListener("scroll", measure); };
  }, [contentKey]);
  const scroll = (direction: number) => strip.current?.scrollBy({ left: direction * strip.current.clientWidth * .85, behavior: state.config.settings.reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  return <section aria-label={t(category)} data-testid="capability-shelf">
    <header className="mb-2 flex items-center gap-2"><h3 className="text-sm font-medium">{t(category)}</h3><span className="text-xs text-ink-secondary">{entries.filter(enabled).length} {t("of")} {entries.length} {t("on")}</span><div className="ml-auto flex gap-1"><button aria-label={`${t("Previous")}: ${t(category)}`} className="rounded-md p-1 text-ink-secondary hover:bg-raised" onClick={() => scroll(-1)}><ChevronLeft size={16} /></button><button aria-label={`${t("Next")}: ${t(category)}`} className="rounded-md p-1 text-ink-secondary hover:bg-raised" onClick={() => scroll(1)}><ChevronRight size={16} /></button></div></header>
    <div ref={strip} style={{ maskImage: `linear-gradient(to right, ${edges.left ? "transparent, black 16px" : "black"}, ${edges.right ? "black calc(100% - 20px), transparent" : "black"})` }} className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" data-testid="capability-strip">
      {entries.map((item) => <article key={item.id} data-testid="capability-card" data-capability={item.id} className={`group relative flex w-[64%] shrink-0 snap-start flex-col overflow-hidden rounded-xl border bg-composer sm:w-[216px] ${opened === item.id ? "border-ink-secondary" : "border-edge hover:border-ink-tertiary"}`}>
        <button className="flex flex-1 flex-col text-left" aria-current={opened === item.id ? "true" : undefined} aria-label={t(`${item.name} settings`)} onClick={() => onOpen(item.id)}>
          <div className="capability-art-viewport relative w-full overflow-hidden border-b border-edge"><CapabilityArt entry={item} off={!enabled(item)} />{item.recommended && <span className="absolute left-2 top-2 rounded-md border border-edge bg-composer/95 px-1.5 text-[11px] leading-4 text-success shadow-sm">{t("Recommended")}</span>}</div>
          <div className="w-full px-3 pb-1 pt-2.5"><span className="flex items-center gap-2"><span className={`min-w-0 flex-1 text-sm font-medium ${enabled(item) ? "text-ink" : "text-ink-secondary"}`}>{t(item.name)}</span><Settings2 size={13} className="shrink-0 text-ink-tertiary" /></span><span className="mt-1 line-clamp-2 text-xs leading-5 text-ink-secondary">{t(item.description)}</span></div>
        </button>
        <footer className="mt-auto flex items-center justify-between gap-2 px-3 pb-2.5 pt-1 text-[11px] text-ink-tertiary"><span className="flex items-center gap-1.5"><span className={`size-1.5 rounded-full ${enabled(item) ? "bg-success" : "bg-ink/25"}`} />{count(item)}</span><CapabilitySwitch checked={enabled(item)} disabled={!item.resource} label={item.resource ? `${item.resource} enabled` : `${t(item.name)} ${t("unavailable")}`} onToggle={() => item.resource && onToggle(item.resource)} /></footer>
      </article>)}
    </div>
  </section>;
}

function CapabilityPanel({ entry, bot, enabled, onToggle, onChange, onClose, onConnect }: {
  entry: ToolboxCapability; bot: Bot; enabled: boolean; onToggle: () => void; onChange: (patch: Partial<Bot>) => void; onClose: () => void; onConnect: () => void;
}) {
  const t = useT(); const [tab, setTab] = useState("settings"); const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; close.current?.focus(); return () => previous?.focus(); }, []);
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/35" role="dialog" aria-modal="true" aria-label={t(`${entry.name} settings`)} onKeyDown={(event) => trapDialog(event, onClose)}>
    <button tabIndex={-1} className="absolute inset-0 cursor-default" aria-label={t("Dismiss capability settings")} onClick={onClose} />
    <aside className="relative flex h-full w-full max-w-2xl flex-col border-l border-edge bg-app shadow-xl">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-edge px-4"><h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{t(`${entry.name} settings`)}</h2><button ref={close} aria-label={t("Close capability settings")} className="rounded-md p-2 text-ink-secondary hover:bg-raised" onClick={onClose}><X size={18} /></button></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"><div className="rounded-xl border border-edge bg-composer p-4 sm:p-5"><div className="flex items-center gap-2"><h3 className="text-sm font-medium">{t(entry.name)}</h3><code className="min-w-0 flex-1 truncate text-xs text-ink-tertiary">{entry.id}</code><CapabilitySwitch checked={enabled} disabled={!entry.resource} label={`${t(entry.name)} ${t("enabled")}`} onToggle={onToggle} /></div><p className="my-4 text-sm leading-5 text-ink-secondary">{t(entry.description)}</p>
        {!entry.resource ? <div className="rounded-lg bg-card p-4 text-sm text-ink-secondary"><span className="mb-2 block font-medium">{t("Soon")}</span><span>{t("This capability is not available in BotTeam yet.")}</span></div> : <><div role="tablist" aria-label={t("Capability settings")} className="mb-4 flex gap-2 border-b border-edge">{["settings", ...(entry.resource === "memory" ? ["notes"] : [])].map((id) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`border-b-2 px-3 py-2 text-sm ${tab === id ? "border-ink" : "border-transparent text-ink-secondary"}`}>{t(id === "notes" ? "Notes" : "Settings")}</button>)}</div>
          {entry.resource === "memory" ? tab === "notes" ? <LibraryTab bot={bot} /> : <MemorySection bot={bot} embedded onChange={(memory) => onChange({ memory })} /> : entry.resource === "skills" ? <SkillsSection bot={bot} onChange={(skills) => onChange({ skills })} /> : <><AppsField bot={bot} onChange={onChange} /><button className={`${BUTTON} mt-4`} onClick={onConnect}>{t("Connect apps")}</button></>}
        </>}
      </div></div>
      {entry.resource && <footer className="flex shrink-0 items-center gap-4 border-t border-edge px-5 py-3"><p className="flex-1 text-xs text-ink-secondary">{t("Agent changes are saved with Save in the page header.")}</p><button className={BUTTON} onClick={onClose}>{t("Done")}</button></footer>}
    </aside>
  </div>;
}
