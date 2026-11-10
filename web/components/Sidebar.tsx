"use client";
import { CalendarDays, Plus, Puzzle, Search, Settings } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Bot } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { Mascot } from "./Mascot";
import { BotContextMenu } from "./BotContextMenu";

function clock(at: number | null): string {
  if (!at) return "";
  const d = new Date(at);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: false }).replace(/^0/, "");
}

function BotRow({ bot, selected, onSelect, icons }: { bot: Bot; selected: boolean; onSelect: () => void; icons: boolean }) {
  return (
    <BotContextMenu bot={bot}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
          icons && "justify-center px-0",
          selected ? "bg-raised" : "hover:bg-raised/60",
        )}
      >
        <Mascot color={bot.color} size={48} busy={bot.busy} />
        <span className={cn("min-w-0 flex-1", icons && "sr-only")}>
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn("truncate text-[17px] leading-6 text-ink", bot.unread ? "font-semibold" : "font-medium")}>
              {bot.name}
            </span>
            <span className="shrink-0 text-[14px] text-ink-secondary">{clock(bot.lastAt)}</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="block truncate text-[15px] leading-5 text-ink-secondary">
              {bot.busy ? "Working…" : bot.lastText || bot.description || "New bot"}
            </span>
            {bot.unread && <span aria-label="Unread" className="ml-auto size-2 shrink-0 rounded-full bg-accent" />}
          </span>
        </span>
      </button>
    </BotContextMenu>
  );
}

const MIN_W = 240;
const MAX_W = 480;
const ICON_W = 80;
const DEFAULT_W = 320;

/** Sidebar width, persisted. Dragging below the minimum snaps to the 80px icon rail. */
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

export function Sidebar() {
  const { state, dispatch } = useStore();
  const [q, setQ] = useState("");
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
        <div
          aria-hidden
          onMouseDown={() => dispatch({ type: "drawer", open: false })}
          className="absolute inset-0 z-30 bg-black/50 md:hidden"
        />
      )}
      <aside
        data-sidebar-root
        data-icons={icons ? "" : undefined}
        style={{ "--sidebar-width": `${width}px` } as React.CSSProperties}
        className={cn(
          "group/side relative z-40 flex h-full w-[320px] shrink-0 flex-col md:w-[var(--sidebar-width)] border-r-[0.5px] border-edge bg-side max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:transition-transform",
          !state.drawerOpen && "max-md:-translate-x-full",
        )}
      >
        <div className="flex h-[68px] shrink-0 items-center justify-end px-4">
          <button
            type="button"
            aria-label="New bot"
            onClick={() => dispatch({ type: "newBot", open: true })}
            className="flex size-9 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-raised hover:text-ink"
          >
            <Plus size={22} />
          </button>
        </div>
        <div className={cn("px-3 pb-3", icons && "hidden")}>
          <label className="flex h-[52px] items-center gap-3 rounded-lg bg-raised px-4 text-ink-secondary focus-within:ring-1 focus-within:ring-focus">
            <Search size={18} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search"
              aria-label="Search bots"
              className="w-full bg-transparent text-[17px] text-ink outline-none placeholder:text-ink-secondary"
            />
          </label>
        </div>
        <nav aria-label="Bots" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2">
          {bots.map((b) => (
            <BotRow key={b.id} bot={b} icons={icons} selected={b.id === state.selectedId} onSelect={() => select(b)} />
          ))}
        </nav>
        <div className="space-y-1 px-3 pb-3 pt-2">
          <FooterRow icons={icons} icon={<CalendarDays size={22} />} label="Automations" />
          <FooterRow icons={icons} icon={<Puzzle size={22} />} label="Plugins" />
          <div className="flex items-center gap-3 rounded-lg px-3 py-2">
            <span className="flex size-9 items-center justify-center rounded-full bg-raised-hover text-[13px] text-ink-secondary">
              Y
            </span>
            <span className={cn("flex-1 text-[17px] text-ink", icons && "hidden")}>You</span>
            <button
              type="button"
              aria-label="Settings"
              onClick={() => dispatch({ type: "settings", open: true })}
              className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={startDrag}
          className="absolute inset-y-0 -right-1 z-10 hidden w-2 cursor-col-resize hover:bg-accent/30 md:block"
        />
      </aside>
    </>
  );
}

function FooterRow({ icon, label, icons }: { icon: React.ReactNode; label: string; icons: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[17px] text-ink transition-colors hover:bg-raised", icons && "justify-center px-0")}
    >
      <span className="text-ink-secondary">{icon}</span>
      {!icons && label}
    </button>
  );
}
