"use client";
import { Inbox, Plus, Search, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Bot } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { BotContextMenu } from "./BotContextMenu";
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
  return { width, icons: width <= ICON_W, startDrag };
}

function clock(at: number | null): string {
  return at ? new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
}

function BotRow({ bot, selected, icons, onSelect }: { bot: Bot; selected: boolean; icons: boolean; onSelect: () => void }) {
  return (
    <BotContextMenu bot={bot}>
      <div className="group relative">
        <div
          role="button"
          tabIndex={0}
          title={bot.name}
          onClick={onSelect}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}
          className={cn(
            "flex w-full cursor-pointer items-center gap-2 rounded-[8px] py-2 pl-2 pr-2 text-left transition-colors duration-150 md:h-[54px] md:py-0",
            selected ? "bg-raised" : "hover:bg-raised/50",
            icons && "justify-center px-0",
          )}
        >
          <span className="relative -m-[3px] flex shrink-0">
            <Mascot color={bot.color} size={44} busy={bot.busy} />
          </span>
          <div className={cn("min-w-0 flex-1", icons && "sr-only")}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 grow truncate text-[14px] font-medium leading-5 text-ink">{bot.name}</span>
              <span className="hidden shrink-0 text-[12px] tabular-nums text-ink-secondary max-md:inline">{clock(bot.lastAt)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[13px] leading-[18px] text-ink-secondary">
                {bot.busy ? "Working…" : bot.lastText || bot.description || "New bot"}
              </span>
              {bot.unread && <span aria-label="Unread" className="ms-auto size-2 shrink-0 rounded-full bg-accent" />}
            </div>
          </div>
        </div>
      </div>
    </BotContextMenu>
  );
}

export function Sidebar() {
  const { state, dispatch } = useStore();
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const { width, icons, startDrag } = useSidebarWidth();
  const bots = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shown = state.bots.filter((b) => !b.hidden && (!needle || b.name.toLowerCase().includes(needle)));
    return [...shown.filter((b) => b.pinned), ...shown.filter((b) => !b.pinned)];
  }, [state.bots, q]);

  const select = (b: Bot) => {
    dispatch({ type: "select", id: b.id });
    if (b.unread) api(`/api/bots/${b.id}/read`, { method: "POST" }).catch(() => {});
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
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && (setQ(""), setSearching(false))}
                placeholder="Search bots"
                aria-label="Search bots"
                className="h-9 w-full rounded-full bg-composer px-4 text-[14px] text-ink ring-1 ring-inset ring-ink/[0.07] outline-none placeholder:text-ink-tertiary focus:ring-ink/[0.22]"
              />
            </div>
          )}
          <div className={cn("px-3 pb-1", icons && "mt-10 px-0")}>
            <button
              type="button"
              title="Inbox"
              className={cn("flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-raised/60", icons && "justify-center")}
            >
              <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-raised text-ink-secondary">
                <Inbox size={16} />
              </span>
              {!icons && <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-ink">Inbox</span>}
            </button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          <nav aria-label="Bots" className={cn("h-full overflow-y-auto px-3 pt-2", icons && "px-1")}>
            <div className="flex flex-col gap-0.5 pb-2">
              {bots.map((b) => (
                <BotRow key={b.id} bot={b} icons={icons} selected={b.id === state.selectedId} onSelect={() => select(b)} />
              ))}
            </div>
          </nav>
        </div>
        <div className="relative z-10 shrink-0">
          <div className={cn("px-4 pb-4 pt-2", icons && "px-0")}>
            <div className={cn("flex items-center gap-2", icons && "flex-col")}>
              <button type="button" title="Settings" onClick={() => dispatch({ type: "settings", open: true })} className="shrink-0 rounded-full">
                <span className="relative flex size-9 items-center justify-center rounded-full ring-2 ring-transparent transition-shadow hover:ring-ink/10">
                  <span className="flex size-9 items-center justify-center rounded-full bg-raised text-ink-secondary ring-1 ring-inset ring-ink/[0.04]">
                    <User size={16} />
                  </span>
                </span>
              </button>
              {!icons && (
                <button
                  type="button"
                  className="group/apps flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-composer pl-4 pr-3 text-[14px] font-medium leading-5 text-ink ring-1 ring-inset ring-ink/[0.07] transition-colors duration-[120ms] hover:bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_7%)]"
                >
                  <span className="min-w-0 truncate">Connect apps</span>
                  <span className="flex shrink-0 items-center gap-1 opacity-60 grayscale transition-[filter,opacity] group-hover/apps:opacity-100 group-hover/apps:grayscale-0">
                    <AppDot bg="#ea4335" label="G" />
                    <AppDot bg="#611f69" label="#" />
                    <AppDot bg="#000" label="N" />
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

function AppDot({ bg, label }: { bg: string; label: string }) {
  return (
    <span aria-hidden style={{ background: bg }} className="flex size-[18px] shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white">
      {label}
    </span>
  );
}
