"use client";
/* eslint-disable react-hooks/set-state-in-effect -- these effects hydrate from localStorage or reset form state when a dialog opens or the target changes */
import { Keyboard, MessageSquarePlus, Palette, Search, Settings, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { Mascot } from "./Mascot";

interface Item {
  id: string;
  label: string;
  hint?: string;
  icon?: typeof Search;
  face?: React.ReactNode;
  run: () => void;
}

/** Ctrl/Cmd+K: jump to a bot or run a quick command. */
export function CommandPalette() {
  const { state, dispatch } = useStore();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const open = state.paletteOpen;
  const close = () => dispatch({ type: "palette", open: false });

  const items = useMemo<Item[]>(() => {
    const bot = state.bots.find((b) => b.id === state.selectedId);
    const go = (fn: () => void) => () => { close(); fn(); };
    const commands: Item[] = [
      { id: "new-bot", label: "New bot", hint: "Ctrl N", icon: UserPlus, run: go(() => dispatch({ type: "newBot", open: true })) },
      ...(bot ? [{
        id: "new-task", label: `New task with ${bot.name}`, hint: "Ctrl Shift N", icon: MessageSquarePlus,
        run: go(() => void api(`/api/bots/${bot.id}/tasks`, { method: "POST", body: JSON.stringify({ title: "New task" }) })),
      }] : []),
      { id: "search", label: "Search bots and messages", icon: Search, run: go(() => window.dispatchEvent(new Event("botteam:search"))) },
      { id: "settings", label: "Open settings", icon: Settings, run: go(() => dispatch({ type: "settings", open: true, page: "general" })) },
      { id: "appearance", label: "Change skin", icon: Palette, run: go(() => dispatch({ type: "settings", open: true, page: "appearance" })) },
      { id: "keys", label: "Keyboard shortcuts", hint: "?", icon: Keyboard, run: go(() => dispatch({ type: "shortcuts", open: true })) },
    ];
    const bots: Item[] = state.bots.filter((b) => !b.hidden).map((b) => ({
      id: `bot-${b.id}`, label: b.name, hint: b.title || undefined, face: <Mascot color={b.color} size={24} />,
      run: go(() => dispatch({ type: "select", id: b.id })),
    }));
    const needle = q.trim().toLowerCase();
    return [...bots, ...commands].filter((i) => !needle || i.label.toLowerCase().includes(needle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.bots, state.selectedId, q]);

  useEffect(() => { setCursor(0); }, [q, open]);
  useEffect(() => { if (open) setQ(""); }, [open]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" }); }, [cursor]);
  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Command palette" className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 pt-[14vh]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="w-[min(94vw,560px)] animate-pop-in overflow-hidden rounded-2xl border border-hairline bg-card shadow-2xl">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            else if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(items.length - 1, c + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
            else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); items[cursor]?.run(); }
          }}
          placeholder="Jump to a bot or run a command…"
          aria-label="Command"
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
          className="h-12 w-full border-b border-hairline bg-transparent px-4 text-[15px] text-ink outline-none placeholder:text-ink-tertiary"
        />
        <div id="palette-list" ref={list} role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
          {items.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-ink-tertiary">Nothing matches “{q}”.</div>}
          {items.map((it, i) => (
            <button key={it.id} type="button" role="option" aria-selected={i === cursor} data-index={i} onMouseMove={() => setCursor(i)} onClick={it.run}
              className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[14px] text-ink", i === cursor && "bg-menu-hover")}>
              {it.face ?? (it.icon && <it.icon size={16} className="text-ink-secondary" />)}
              <span data-no-i18n={it.id.startsWith("bot-") ? "" : undefined} className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.hint && <span className="shrink-0 text-[12px] text-ink-tertiary">{it.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
