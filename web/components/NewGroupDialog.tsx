"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the form resets when the dialog opens */
import { Check, Crown } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Group, Responder } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { Mascot } from "./Mascot";

const INPUT = "w-full rounded-lg bg-inset px-3 text-[14px] text-ink outline-none ring-1 ring-inset ring-ink/[0.07] placeholder:text-ink-tertiary focus:ring-ink/25";

/** "New group chat" from the sidebar's + menu: a name, the members, a leader and who answers. */
export function NewGroupDialog() {
  const { state, dispatch } = useStore();
  const t = useT();
  const open = state.newGroupOpen;
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [leader, setLeader] = useState<string | null>(null);
  const [responder, setResponder] = useState<Responder>("leader");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setName(""); setMembers([]); setLeader(null); setResponder("leader"); setInstructions(""); setError("");
  }, [open]);
  if (!open) return null;
  const close = () => dispatch({ type: "newGroup", open: false });
  const toggle = (id: string) => {
    setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
    setLeader((l) => (l === id ? null : l));
  };
  const lead = leader && members.includes(leader) ? leader : members[0] ?? null;
  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const g = await api<Group>("/api/groups", { method: "POST", body: JSON.stringify({ name: name.trim(), members, leader: lead, responder, instructions }) });
      dispatch({ type: "frame", frame: { kind: "group", group: g } });
      dispatch({ type: "selectGroup", id: g.id });
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="New group chat" data-testid="new-group"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="flex max-h-[90vh] w-full max-w-[460px] flex-col rounded-2xl bg-panel p-5 text-ink shadow-xl ring-1 ring-ink/10">
        <h2 className="text-[17px] font-semibold">{t("New group chat")}</h2>
        <p className="mt-1 text-[13px] text-ink-secondary">{t("Bots talk together here. Use @ to ask a member; the leader answers the rest.")}</p>
        <label className="mt-4 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary" htmlFor="group-name">{t("Name")}</label>
        <input id="group-name" autoFocus data-no-i18n="" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder={t("Room name")} className={cn(INPUT, "mt-1.5 h-10")} />
        <div className="mt-4 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{t("Members")}</div>
        <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto rounded-xl ring-1 ring-ink/10">
          {state.bots.filter((b) => !b.hidden).map((b) => {
            const on = members.includes(b.id);
            return (
              <div key={b.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-raised/60">
                <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(b.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border border-ink/30", on && "border-accent bg-accent text-[var(--color-accent-ink)]")}>{on && <Check size={11} />}</span>
                  <Mascot color={b.color} size={26} />
                  <span data-no-i18n="" className="min-w-0 truncate text-[14px]">{b.name}</span>
                </button>
                {on && (
                  <button type="button" title={t("Make leader")} aria-label={`${t("Make leader")} ${b.name}`} aria-pressed={lead === b.id} onClick={() => setLeader(b.id)}
                    className={cn("rounded-full p-1.5", lead === b.id ? "text-warning" : "text-ink-tertiary hover:bg-ink/10")}><Crown size={14} /></button>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex gap-1.5" role="radiogroup" aria-label={t("Who answers")}>
          {([["leader", "Leader"], ["mention", "Mentions only"], ["auto", "Automatic"]] as const).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={responder === id} onClick={() => setResponder(id)}
              className={cn("flex-1 rounded-lg px-2 py-1.5 text-[13px] ring-1 ring-ink/10 hover:bg-ink/[0.04]", responder === id && "bg-accent/12 ring-accent/60")}>{t(label)}</button>
          ))}
        </div>
        <textarea data-no-i18n="" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} aria-label={t("Instructions")}
          placeholder={t("Instructions for the room (optional)")} className={cn(INPUT, "mt-3 py-2 leading-5")} />
        {error && <div role="alert" className="mt-2 text-[13px] text-danger">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={close} className="rounded-full px-4 py-2 text-[14px] text-ink-secondary hover:bg-ink/10">{t("Cancel")}</button>
          <button type="button" disabled={!name.trim() || busy} onClick={create} className="rounded-full bg-accent px-4 py-2 text-[14px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Create")}</button>
        </div>
      </div>
    </div>
  );
}
