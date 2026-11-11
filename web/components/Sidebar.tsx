"use client";
/* eslint-disable react-hooks/set-state-in-effect -- these effects hydrate from localStorage or reset form state when a dialog opens or the target changes */
import { Archive, Check, ChevronDown, ChevronRight, Inbox, Keyboard, ListChecks, Pencil, Plus, Search, Settings, Hash, Trash2, User } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { tr, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Bot, SearchHit, Section } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { BotActionsButton, BotContextMenu, deleteBotWithUndo } from "./BotContextMenu";
import { Mascot } from "./Mascot";

const MIN_W = 240;
const MAX_W = 480;
const ICON_W = 80;
const DEFAULT_W = 280;

const PILL =
  "flex size-9 shrink-0 items-center justify-center rounded-full text-ink/90 bg-composer ring-1 ring-inset ring-ink/[0.07] transition-colors duration-[120ms] hover:bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_7%)] aria-expanded:bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_7%)]";

/** Sidebar width, persisted. Dragging below the minimum snaps to the icon rail. */
function useSidebarWidth() {
  const [width, setWidth] = useState(DEFAULT_W);
  useEffect(() => {
    const saved = Number(localStorage.getItem("botteam-sidebar-width"));
    if (saved) setWidth(saved);
  }, []);
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width;
    let last = w0;
    document.body.style.userSelect = "none";
    const move = (ev: PointerEvent) => {
      const w = w0 + ev.clientX - x0;
      last = w < MIN_W - 40 ? ICON_W : Math.min(MAX_W, Math.max(MIN_W, w));
      setWidth(last);
    };
    const up = () => {
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      localStorage.setItem("botteam-sidebar-width", String(last));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return { width, setWidth, icons: width <= ICON_W, startDrag };
}

function clock(at: number | null): string {
  return at ? new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
}

interface DragApi {
  dragging: string | null;
  setDragging: (id: string | null) => void;
  drop: (botId: string, section: string | null, beforeId: string | null) => void;
}

function BotRow({ bot, selected, icons, onSelect, drag }: { bot: Bot; selected: boolean; icons: boolean; onSelect: () => void; drag: DragApi }) {
  const { state, dispatch } = useStore();
  const [over, setOver] = useState(false);
  const picked = state.picked.includes(bot.id);
  const waiting = bot.activity === "waiting-on-you";
  return (
    <BotContextMenu bot={bot}>
      <div
        className={cn("group relative", over && drag.dragging !== bot.id && "before:absolute before:inset-x-2 before:top-0 before:h-0.5 before:rounded before:bg-accent")}
        draggable={!state.selecting}
        onDragStart={(e) => { e.dataTransfer.setData("text/plain", bot.id); e.dataTransfer.effectAllowed = "move"; drag.setDragging(bot.id); }}
        onDragEnd={() => { drag.setDragging(null); setOver(false); }}
        onDragOver={(e) => { if (drag.dragging) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); if (drag.dragging && drag.dragging !== bot.id) drag.drop(drag.dragging, bot.section, bot.id); }}
      >
        <div
          role="button"
          tabIndex={0}
          data-no-i18n=""
          title={bot.name}
          onClick={() => (state.selecting ? dispatch({ type: "pick", id: bot.id }) : onSelect())}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), state.selecting ? dispatch({ type: "pick", id: bot.id }) : onSelect())}
          className={cn(
            "flex w-full cursor-pointer items-center gap-2 rounded-[8px] py-2 pl-2 pr-2 text-left transition-colors duration-150 md:h-[54px] md:py-0",
            selected && !state.selecting ? "bg-raised" : "hover:bg-raised/50",
            picked && "bg-accent/15",
            icons && "justify-center px-0",
          )}
        >
          {state.selecting && !icons && (
            <span aria-hidden className={cn("flex size-4 shrink-0 items-center justify-center rounded border border-ink/30", picked && "border-accent bg-accent text-[var(--color-accent-ink)]")}>
              {picked && <Check size={11} />}
            </span>
          )}
          <span className="relative -m-[3px] flex shrink-0">
            <Mascot color={bot.color} size={44} busy={bot.busy && !waiting} />
            {waiting && icons && <span aria-label="Needs your attention" className="absolute right-0 top-0 size-3 rounded-full bg-warning ring-2 ring-panel" />}
          </span>
          <div className={cn("min-w-0 flex-1", icons && "sr-only")}>
            <div className="flex items-baseline justify-between gap-2">
              <span data-no-i18n="" className="min-w-0 grow truncate text-[14px] font-medium leading-5 text-ink">
                {bot.name}
                {bot.chief && <span className="ml-1.5 rounded bg-ink/[0.08] px-1 text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">Chief</span>}
              </span>
              <span className="hidden shrink-0 text-[12px] tabular-nums text-ink-secondary max-md:inline">{clock(bot.lastAt)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span data-no-i18n={waiting || bot.busy ? undefined : ""} className={cn("min-w-0 truncate text-[13px] leading-[18px] text-ink-secondary", waiting && "font-medium text-warning")}>
                {waiting ? "Needs your answer" : bot.busy ? "Working…" : bot.lastText || bot.description || "New bot"}
              </span>
              {waiting ? (
                <span aria-label="Needs your attention" className="ms-auto size-2 shrink-0 rounded-full bg-warning" />
              ) : (
                bot.unread && <span aria-label="Unread" className="ms-auto size-2 shrink-0 rounded-full bg-accent" />
              )}
            </div>
          </div>
        </div>
        {!icons && !state.selecting && (
          <BotActionsButton bot={bot} className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-panel/80 opacity-0 backdrop-blur group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 max-md:opacity-100" />
        )}
      </div>
    </BotContextMenu>
  );
}

function SectionHeader({ section, count, drag }: { section: Section; count: number; drag: DragApi }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(section.name);
  const [over, setOver] = useState(false);
  const save = () => {
    setRenaming(false);
    if (name.trim() && name.trim() !== section.name) void api(`/api/sidebar-sections/${section.id}`, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) });
  };
  return (
    <div
      className={cn("group/sec flex items-center gap-1 rounded-md px-1 pt-3", over && "bg-accent/15")}
      onDragOver={(e) => { if (drag.dragging) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (drag.dragging) drag.drop(drag.dragging, section.id, null); }}
    >
      <button type="button" aria-label={section.collapsed ? `Expand ${section.name}` : `Collapse ${section.name}`} aria-expanded={!section.collapsed}
        onClick={() => api(`/api/sidebar-sections/${section.id}`, { method: "PATCH", body: JSON.stringify({ collapsed: !section.collapsed }) })}
        className="flex min-w-0 flex-1 items-center gap-1 text-left text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary hover:text-ink">
        {section.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        {renaming ? (
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={save} onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") save(); if (e.key === "Escape") { setName(section.name); setRenaming(false); } }}
            aria-label="Section name" className="min-w-0 flex-1 rounded bg-inset px-1 text-[12px] normal-case text-ink outline-none" />
        ) : (
          <span data-no-i18n="" className="truncate">{section.name}</span>
        )}
        <span className="text-[11px] font-normal">{count}</span>
      </button>
      <button type="button" title="Rename section" aria-label={`Rename ${section.name}`} onClick={() => { setName(section.name); setRenaming(true); }}
        className="rounded p-1 text-ink-tertiary opacity-0 hover:bg-ink/10 hover:text-ink group-hover/sec:opacity-100 focus-visible:opacity-100"><Pencil size={12} /></button>
      <button type="button" title="Delete section" aria-label={`Delete ${section.name}`}
        onClick={() => { if (confirm(tr(`Delete the section “${section.name}”? Its bots stay in the list.`))) void api(`/api/sidebar-sections/${section.id}`, { method: "DELETE" }); }}
        className="rounded p-1 text-ink-tertiary opacity-0 hover:bg-ink/10 hover:text-danger group-hover/sec:opacity-100 focus-visible:opacity-100"><Trash2 size={12} /></button>
    </div>
  );
}

function ProfileMenu({ icons }: { icons: boolean }) {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const name = state.config.settings.displayName || "You";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger title="Profile and settings" aria-label="Profile and settings" className="shrink-0 rounded-full">
        <span className="relative flex size-9 items-center justify-center rounded-full ring-2 ring-transparent transition-shadow hover:ring-ink/10">
          <span className="flex size-9 items-center justify-center rounded-full bg-raised text-ink-secondary ring-1 ring-inset ring-ink/[0.04]">
            <User size={16} />
          </span>
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[230px] gap-0 rounded-xl bg-menu p-1.5 text-ink ring-1 ring-ink/10">
        <div className="px-2.5 pb-1.5 pt-1 text-[13px] font-medium text-ink-secondary">{name}</div>
        <button type="button" onClick={() => { setOpen(false); dispatch({ type: "settings", open: true, page: "general" }); }} className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[14px] hover:bg-menu-hover"><Settings size={15} /> Settings</button>
        <button type="button" onClick={() => { setOpen(false); dispatch({ type: "shortcuts", open: true }); }} className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[14px] hover:bg-menu-hover"><Keyboard size={15} /> Keyboard shortcuts</button>
      </PopoverContent>
      {icons && null}
    </Popover>
  );
}

function BulkSelectBar() {
  const { state, dispatch } = useStore();
  if (!state.selecting) return null;
  const picked = state.bots.filter((b) => state.picked.includes(b.id));
  const hide = async () => {
    await Promise.all(picked.map((b) => api(`/api/bots/${b.id}`, { method: "PATCH", body: JSON.stringify({ hidden: true }) })));
    dispatch({ type: "selecting", on: false });
  };
  const remove = () => {
    if (!picked.length || !confirm(tr(`Delete ${picked.length} bot${picked.length > 1 ? "s" : ""}? You can undo for a few seconds.`))) return;
    const hideLocal = (id: string, hidden: boolean) => {
      const b = state.bots.find((x) => x.id === id);
      if (b) dispatch({ type: "frame", frame: { kind: "bot", bot: { ...b, hidden } } });
    };
    picked.forEach((b) => deleteBotWithUndo(b, hideLocal));
    dispatch({ type: "selecting", on: false });
  };
  const btn = "rounded-full px-3 py-1.5 text-[13px] font-medium disabled:opacity-40";
  return (
    <div role="toolbar" aria-label="Bulk actions" className="flex items-center gap-2 border-t border-edge bg-panel px-3 py-2">
      <span className="min-w-0 flex-1 text-[13px] text-ink-secondary">{picked.length} selected</span>
      <button type="button" disabled={!picked.length} onClick={hide} className={cn(btn, "bg-raised text-ink")}>Hide</button>
      <button type="button" disabled={!picked.length} onClick={remove} className={cn(btn, "bg-danger text-[var(--color-danger-ink)]")}>Delete</button>
      <button type="button" onClick={() => dispatch({ type: "selecting", on: false })} className={cn(btn, "text-ink-secondary")}>Done</button>
    </div>
  );
}

export function Sidebar() {
  const { state, dispatch } = useStore();
  const t = useT();
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const { width: savedWidth, icons: savedIcons, startDrag } = useSidebarWidth();
  // With a bot panel open and not much room, the sidebar shrinks to its icon rail.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1180px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const squeeze = narrow && !!state.panelBotId;
  const icons = savedIcons || squeeze;
  const width = squeeze ? ICON_W : savedWidth;
  const searchRef = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd+K and the search button both land here.
  useEffect(() => {
    const open = () => { setSearching(true); setTimeout(() => searchRef.current?.focus(), 0); };
    window.addEventListener("botteam:search", open);
    return () => window.removeEventListener("botteam:search", open);
  }, []);

  // Full-text search of messages, debounced.
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) { setHits([]); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      api<{ results: SearchHit[] }>(`/api/search?q=${encodeURIComponent(needle)}`).then((r) => !cancelled && setHits(r.results)).catch(() => {});
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const needle = q.trim().toLowerCase();
  const visible = useMemo(() => state.bots.filter((b) => !b.hidden && (!needle || b.name.toLowerCase().includes(needle))), [state.bots, needle]);
  const archived = state.bots.filter((b) => b.hidden);
  const pinned = visible.filter((b) => b.pinned);
  const unpinned = visible.filter((b) => !b.pinned);
  const sectionIds = new Set(state.sections.map((s) => s.id));
  const loose = unpinned.filter((b) => !b.section || !sectionIds.has(b.section));

  const select = (b: Bot) => {
    dispatch({ type: "select", id: b.id });
    if (b.unread) api(`/api/bots/${b.id}/read`, { method: "POST" }).catch(() => {});
  };
  const openHit = async (h: SearchHit) => {
    await api(`/api/bots/${h.botId}`, { method: "PATCH", body: JSON.stringify({ threadId: h.threadId }) }).catch(() => {});
    dispatch({ type: "select", id: h.botId });
    dispatch({ type: "focusMessage", target: { threadId: h.threadId, messageId: h.messageId } });
  };

  const drag: DragApi = {
    dragging,
    setDragging,
    drop: (botId, section, beforeId) => {
      const ids = state.bots.map((b) => b.id).filter((id) => id !== botId);
      const at = beforeId ? ids.indexOf(beforeId) : -1;
      if (at >= 0) ids.splice(at, 0, botId);
      else ids.push(botId);
      setDragging(null);
      void api(`/api/bots/${botId}/move`, { method: "POST", body: JSON.stringify({ section, botIds: ids }) });
    },
  };

  const row = (b: Bot) => <BotRow key={b.id} bot={b} icons={icons} selected={b.id === state.selectedId} onSelect={() => select(b)} drag={drag} />;
  const addSection = async () => {
    const name = window.prompt(tr("Name of the new section"));
    if (name?.trim()) await api("/api/sidebar-sections", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
  };

  return (
    <>
      {state.drawerOpen && (
        <div aria-hidden onMouseDown={() => dispatch({ type: "drawer", open: false })} className="absolute inset-0 z-30 bg-black/50 md:hidden" />
      )}
      <aside
        data-sidebar-root
        data-icons={icons ? "" : undefined}
        style={{ "--sidebar-width": `${width}px` } as React.CSSProperties}
        className={cn(
          "relative flex h-full shrink-0 flex-col border-r-[0.5px] border-edge bg-panel transition-[width] duration-200 motion-reduce:transition-none",
          "w-[280px] md:w-[var(--sidebar-width)] md:max-w-[calc(100vw-320px)]",
          "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-full max-md:bg-app max-md:transition-transform max-md:duration-200",
          !state.drawerOpen && "max-md:-translate-x-full",
        )}
      >
        <div className="relative z-10 shrink-0">
          <div className={cn("relative flex h-[60px] items-start px-4 pt-3", icons && "justify-center px-0")}>
            <div className="min-w-0 flex-1" />
            <div className={cn("relative flex shrink-0 items-center gap-2", icons && "flex-col")}>
              <button type="button" title="Search bots and messages" aria-expanded={searching} onClick={() => setSearching((v) => !v)} className={PILL}>
                <Search size={16} />
              </button>
              <button type="button" title="New bot" onClick={() => dispatch({ type: "newBot", open: true })} className={PILL}>
                <Plus size={18} />
              </button>
            </div>
          </div>
          {searching && !icons && (
            <div className="px-3 pb-2">
              <input
                ref={searchRef}
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && (setQ(""), setSearching(false))}
                placeholder="Search bots and messages"
                aria-label="Search bots and messages"
                className="h-9 w-full rounded-full bg-composer px-4 text-[14px] text-ink ring-1 ring-inset ring-ink/[0.07] outline-none placeholder:text-ink-tertiary focus:ring-ink/[0.22]"
              />
            </div>
          )}
          <div className={cn("relative px-3 pb-1", icons && "mt-10 px-0")}>
            <button
              type="button"
              title="Inbox"
              className={cn("flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-raised/60", icons && "justify-center")}
            >
              <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-raised text-ink-secondary">
                <Inbox size={16} />
              </span>
              {!icons && <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-ink">{t("Inbox")}</span>}
            </button>
            {!icons && (
              <button type="button" title="Select bots" aria-label="Select bots" aria-pressed={state.selecting} onClick={() => dispatch({ type: "selecting", on: !state.selecting })}
                className={cn("absolute right-5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-secondary hover:bg-ink/10 hover:text-ink", state.selecting && "bg-accent text-[var(--color-accent-ink)] hover:bg-accent")}>
                <ListChecks size={15} />
              </button>
            )}
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          <nav aria-label="Bots" className={cn("h-full overflow-y-auto px-3 pt-2", icons && "px-1")}
            onDragOver={(e) => { if (dragging) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); if (dragging) drag.drop(dragging, null, null); }}>
            <div className="flex flex-col gap-0.5 pb-2">
              {pinned.map(row)}
              {loose.map(row)}
              {!icons && state.sections.map((s) => {
                const inSection = unpinned.filter((b) => b.section === s.id);
                if (needle && !inSection.length) return null;
                return (
                  <div key={s.id}>
                    <SectionHeader section={s} count={inSection.length} drag={drag} />
                    {!s.collapsed && <div className="flex flex-col gap-0.5">{inSection.map(row)}</div>}
                  </div>
                );
              })}
              {needle && !visible.length && hits.length === 0 && <div className="px-2 py-6 text-center text-[13px] text-ink-tertiary">{`No bots match “${q.trim()}”.`}</div>}
              {!icons && !needle && (
                <button type="button" onClick={addSection} className="mt-2 self-start rounded-md px-2 py-1 text-[12px] text-ink-tertiary hover:bg-raised/60 hover:text-ink">{t("+ New section")}</button>
              )}
              {!icons && hits.length > 0 && (
                <div className="mt-3" role="region" aria-label="Message results">
                  <div className="px-1 pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Messages</div>
                  {hits.map((h) => (
                    <button key={h.messageId} type="button" onClick={() => openHit(h)} className="flex w-full flex-col rounded-lg px-2 py-1.5 text-left hover:bg-raised/60">
                      <span className="flex items-baseline justify-between gap-2">
                        <span data-no-i18n="" className="truncate text-[13px] font-medium text-ink">{h.botName}</span>
                        <span className="shrink-0 text-[11px] text-ink-tertiary">{new Date(h.at).toLocaleDateString([], { day: "numeric", month: "short" })}</span>
                      </span>
                      <span data-no-i18n="" className="line-clamp-2 text-[12.5px] leading-4 text-ink-secondary"
                        dangerouslySetInnerHTML={{ __html: escapeSnippet(h.snippet) }} />
                    </button>
                  ))}
                </div>
              )}
              {!icons && archived.length > 0 && !needle && (
                <div className="mt-3">
                  <button type="button" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}
                    className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary hover:text-ink">
                    <Archive size={12} /> Hidden <span className="font-normal">{archived.length}</span>
                    {showArchived ? <ChevronDown size={13} className="ml-auto" /> : <ChevronRight size={13} className="ml-auto" />}
                  </button>
                  {showArchived && archived.map((b) => (
                    <div key={b.id} className="flex items-center gap-2 rounded-lg px-2 py-1">
                      <Mascot color={b.color} size={28} />
                      <span data-no-i18n="" className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">{b.name}</span>
                      <button type="button" onClick={() => api(`/api/bots/${b.id}`, { method: "PATCH", body: JSON.stringify({ hidden: false }) })} className="rounded-full px-2 py-0.5 text-[12px] text-accent-text hover:bg-ink/10">Unhide</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </nav>
        </div>
        <BulkSelectBar />
        <div className="relative z-10 shrink-0">
          <div className={cn("px-4 pb-4 pt-2", icons && "px-0")}>
            <div className={cn("flex items-center gap-2", icons && "flex-col")}>
              <ProfileMenu icons={icons} />
              {!icons && (
                <button
                  type="button"
                  onClick={() => dispatch({ type: "settings", open: true, page: "connections" })}
                  className="group/apps flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-composer pl-4 pr-3 text-[14px] font-medium leading-5 text-ink ring-1 ring-inset ring-ink/[0.07] transition-colors duration-[120ms] hover:bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_7%)]"
                >
                  <span className="min-w-0 truncate">{t("Connect apps")}</span>
                  <span aria-hidden className="flex shrink-0 items-center gap-[7px] text-ink-tertiary opacity-70 transition-opacity group-hover/apps:opacity-100">
                    <span className="w-[16px] text-center text-[16px] font-semibold leading-none">G</span>
                    <Hash size={16} strokeWidth={1.75} />
                    <span className="flex size-[17px] items-center justify-center rounded-[3px] border border-current text-[11px] font-bold leading-none">N</span>
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={startDrag}
          className="absolute inset-y-0 -right-1.5 z-20 hidden w-3 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-[5px] after:w-0.5 hover:after:bg-ink/10 md:block"
        />
      </aside>
    </>
  );
}

/** Snippets come back with [[match]] markers; everything else is escaped before it becomes markup. */
function escapeSnippet(s: string): string {
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/\[\[/g, "<mark class=\"rounded bg-warning/30 px-0.5 text-ink\">").replace(/\]\]/g, "</mark>");
}
