"use client";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import { api } from "@/state/api";
import { useStore } from "@/state/store";

/** What is being moved: an agent or a team, and the section it is in now. */
export type MoveTarget = { kind: "bot" | "group"; id: string; name: string; section: string | null };

let target: MoveTarget | null = null;
const listeners = new Set<() => void>();
const set = (next: MoveTarget | null) => { target = next; listeners.forEach((l) => l()); };

/** Opens the "Move to existing section" dialog (rendered once, in the Shell). */
export const askMoveToSection = (t: MoveTarget) => set(t);

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function MoveSectionDialog() {
  const current = useSyncExternalStore(subscribe, () => target, () => null);
  return (
    <Dialog open={!!current} onOpenChange={(o) => { if (!o) set(null); }}>
      {current && <Body key={`${current.kind}-${current.id}`} target={current} />}
    </Dialog>
  );
}

function Body({ target: item }: { target: MoveTarget }) {
  const { state } = useStore();
  const t = useT();
  const options = state.sections.filter((s) => s.id !== item.section);
  const [choice, setChoice] = useState(options[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const move = async () => {
    if (!choice) return;
    setBusy(true);
    try {
      if (item.kind === "bot") await api(`/api/bots/${item.id}/move`, { method: "POST", body: JSON.stringify({ section: choice }) });
      else await api(`/api/groups/${item.id}`, { method: "PATCH", body: JSON.stringify({ section: choice }) });
      set(null);
    } catch {
      setBusy(false);
    }
  };
  return (
    <DialogContent data-testid="move-section-dialog">
      <DialogHeader>
        <DialogTitle>{t("Move to existing section")}</DialogTitle>
        <span data-no-i18n="" className="truncate text-[13px] text-ink-secondary">{item.name}</span>
      </DialogHeader>
      {options.length === 0 ? (
        <p className="text-[13.5px] text-ink-secondary">{t("There is no other section yet.")}</p>
      ) : (
        <select aria-label={t("Section")} data-testid="move-section-select" value={choice} onChange={(e) => setChoice(e.target.value)}
          className="h-9 w-full rounded-lg border border-edge bg-card px-2 text-[14px] text-ink outline-none focus:ring-2 focus:ring-accent">
          {options.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={() => set(null)}>{t("Cancel")}</Button>
        <Button data-testid="move-section-confirm" disabled={!choice || busy} onClick={() => void move()}>{t("Move")}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
