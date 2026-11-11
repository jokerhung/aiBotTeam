"use client";
import { X } from "lucide-react";
import { useStore } from "@/state/store";

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Navigate",
    rows: [
      ["Ctrl / ⌘ K", "Command palette"],
      ["Ctrl / ⌘ 1…9", "Switch to bot 1…9"],
      ["Ctrl / ⌘ F", "Find in this conversation"],
      ["?", "Show this list"],
    ],
  },
  {
    title: "Create",
    rows: [
      ["Ctrl / ⌘ N", "New bot"],
      ["Ctrl / ⌘ Shift N", "New task"],
    ],
  },
  {
    title: "Questions from a bot",
    rows: [
      ["A  B  C  D", "Pick that option"],
      ["Enter", "Send a typed answer"],
      ["Esc", "Close a dialog"],
    ],
  },
];

export function KeyboardShortcutsModal() {
  const { state, dispatch } = useStore();
  if (!state.shortcutsOpen) return null;
  const close = () => dispatch({ type: "shortcuts", open: false });
  return (
    <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === "Escape" && close()}>
      <div className="relative w-[min(94vw,460px)] animate-pop-in rounded-2xl border border-hairline bg-card p-6 shadow-2xl">
        <button type="button" autoFocus aria-label="Close" onClick={close} className="absolute right-3 top-3 rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><X size={16} /></button>
        <h2 className="mb-3 text-[18px] font-semibold text-ink">Keyboard shortcuts</h2>
        {GROUPS.map((g) => (
          <div key={g.title} className="mb-3 last:mb-0">
            <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">{g.title}</div>
            {g.rows.map(([k, d]) => (
              <div key={k} className="flex items-center justify-between py-1 text-[14px]">
                <span className="text-ink-secondary">{d}</span>
                <kbd className="rounded-md bg-raised px-2 py-0.5 font-mono text-[12px] text-ink">{k}</kbd>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
