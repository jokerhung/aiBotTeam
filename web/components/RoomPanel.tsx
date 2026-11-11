"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the fields reset when another room is shown */
import { Crown, Folder, Trash2, UserMinus, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { tr, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Group, Responder } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { Mascot } from "./Mascot";

const INPUT = "w-full rounded-lg bg-inset px-3 text-[14px] text-ink outline-none ring-1 ring-inset ring-ink/[0.07] placeholder:text-ink-tertiary focus:ring-ink/25";
const RESPONDERS: { id: Responder; label: string; hint: string }[] = [
  { id: "leader", label: "Leader", hint: "The leader answers anything not aimed at someone" },
  { id: "mention", label: "Mentions only", hint: "Only members you @mention answer" },
  { id: "auto", label: "Automatic", hint: "A member is chosen for each message" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-2.5">
      <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{label}</div>
      {children}
    </div>
  );
}

/** Which model chooses the answering member when a room is set to Automatic. Off means the leader answers. */
function DeciderField() {
  const { state } = useStore();
  const t = useT();
  const [value, setValue] = useState("");
  useEffect(() => {
    api<{ decider: { instanceId: string; model: string } | null }>("/api/decider").then((r) => setValue(r.decider ? `${r.decider.instanceId}::${r.decider.model}` : "")).catch(() => {});
  }, []);
  const choose = (v: string) => {
    setValue(v);
    const [instanceId, ...m] = v.split("::");
    void api("/api/decider", { method: "PUT", body: JSON.stringify(v ? { instanceId, model: m.join("::") } : {}) }).catch(() => {});
  };
  const engines = state.instances.filter((i) => !i.hidden && i.enabled && i.snapshot.state === "available");
  return (
    <Field label={t("Chooser model")}>
      <select value={value} onChange={(e) => choose(e.target.value)} aria-label={t("Chooser model")} className={cn(INPUT, "h-10")} data-testid="decider-select">
        <option value="">{t("Off: the leader answers")}</option>
        {engines.map((i) => <optgroup key={i.id} label={i.displayName}>{i.models.map((m) => <option key={m.id} value={`${i.id}::${m.id}`}>{m.label}</option>)}</optgroup>)}
      </select>
      <div className="mt-1 text-[12px] text-ink-tertiary">{t("A quick model picks who answers each message. If it is off or unsure, the leader answers.")}</div>
    </Field>
  );
}

/** The side panel of a room: members, leader, instructions, folder and who answers. */
export function RoomPanel({ group }: { group: Group }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const [name, setName] = useState(group.name);
  const [instructions, setInstructions] = useState(group.instructions);
  const [cwd, setCwd] = useState(group.cwd ?? "");
  const [adding, setAdding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { setName(group.name); setInstructions(group.instructions); setCwd(group.cwd ?? ""); }, [group.id, group.name, group.instructions, group.cwd]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const patch = (body: object) => api(`/api/groups/${group.id}`, { method: "PATCH", body: JSON.stringify(body) }).catch(() => {});
  const later = (body: object) => { clearTimeout(timer.current); timer.current = setTimeout(() => void patch(body), 400); };
  const outsiders = state.bots.filter((b) => !group.members.includes(b.id) && !b.hidden);
  const remove = () => {
    if (!confirm(tr(`Delete the room “${group.name}”? The bots stay.`))) return;
    void api(`/api/groups/${group.id}`, { method: "DELETE" });
  };
  return (
    <aside aria-label="Room details" data-testid="room-panel"
      className="flex h-full w-[340px] shrink-0 flex-col overflow-y-auto border-l-[0.5px] border-edge bg-panel max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:shadow-xl">
      <div className="flex items-center justify-between px-5 pb-1 pt-4">
        <div className="text-[15px] font-medium text-ink">{t("Room")}</div>
        <button type="button" aria-label="Close" onClick={() => dispatch({ type: "groupPanel", id: null })} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><X size={15} /></button>
      </div>
      <Field label={t("Name")}>
        <input data-no-i18n="" value={name} onChange={(e) => { setName(e.target.value); if (e.target.value.trim()) later({ name: e.target.value.trim() }); }} aria-label={t("Name")} className={cn(INPUT, "h-9")} />
      </Field>
      <Field label={t("Members")}>
        <div className="flex flex-col gap-0.5">
          {group.memberInfo.map((m) => (
            <div key={m.id} className="group/m flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-raised/60">
              <Mascot color={m.color as never} size={28} />
              <div className="min-w-0 flex-1 leading-tight">
                <div data-no-i18n="" className="truncate text-[14px] text-ink">{m.name}</div>
                {m.title && <div data-no-i18n="" className="truncate text-[12px] text-ink-tertiary">{m.title}</div>}
              </div>
              <button type="button" title={group.leader === m.id ? t("Leader") : t("Make leader")} aria-label={group.leader === m.id ? t("Leader") : t("Make leader")}
                aria-pressed={group.leader === m.id} onClick={() => patch({ leader: group.leader === m.id ? null : m.id })}
                className={cn("rounded-full p-1.5", group.leader === m.id ? "text-warning" : "text-ink-tertiary opacity-0 hover:bg-ink/10 group-hover/m:opacity-100 focus-visible:opacity-100 touch:opacity-100")}><Crown size={14} /></button>
              <button type="button" title={t("Remove from room")} aria-label={`${t("Remove from room")} ${m.name}`} onClick={() => patch({ members: group.members.filter((x) => x !== m.id) })}
                className="rounded-full p-1.5 text-ink-tertiary opacity-0 hover:bg-danger/10 hover:text-danger group-hover/m:opacity-100 focus-visible:opacity-100 touch:opacity-100"><UserMinus size={14} /></button>
            </div>
          ))}
        </div>
        {adding ? (
          <div className="mt-2 rounded-lg bg-inset p-1 ring-1 ring-ink/10">
            {outsiders.length === 0 && <div className="px-2 py-1.5 text-[13px] text-ink-tertiary">{t("Everyone is already here.")}</div>}
            {outsiders.map((b) => (
              <button key={b.id} type="button" onClick={() => { void patch({ members: [...group.members, b.id] }); setAdding(false); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[14px] hover:bg-raised">
                <Mascot color={b.color} size={22} /> <span data-no-i18n="" className="truncate">{b.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="mt-2 flex items-center gap-1.5 rounded-full bg-raised px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-raised-hover"><UserPlus size={13} /> {t("Add a member")}</button>
        )}
      </Field>
      <Field label={t("Who answers")}>
        <div role="radiogroup" className="flex flex-col gap-1">
          {RESPONDERS.map((r) => (
            <button key={r.id} type="button" role="radio" aria-checked={group.responder === r.id} onClick={() => patch({ responder: r.id })}
              className={cn("rounded-lg px-3 py-1.5 text-left ring-1 ring-ink/10 hover:bg-ink/[0.04]", group.responder === r.id && "bg-accent/12 ring-accent/60")}>
              <div className="text-[14px] text-ink">{t(r.label)}</div>
              <div className="text-[12px] text-ink-tertiary">{t(r.hint)}</div>
            </button>
          ))}
        </div>
      </Field>
      {group.responder === "auto" && <DeciderField />}
      <Field label={t("Instructions")}>
        <textarea data-no-i18n="" value={instructions} rows={4} onChange={(e) => { setInstructions(e.target.value); later({ instructions: e.target.value }); }}
          aria-label={t("Instructions")} placeholder={t("What is this room for? Every member is told.")} className={cn(INPUT, "py-2 leading-5")} />
      </Field>
      <Field label={t("Working folder")}>
        <div className="flex items-center gap-2">
          <Folder size={15} className="shrink-0 text-ink-tertiary" />
          <input data-no-i18n="" value={cwd} onChange={(e) => { setCwd(e.target.value); later({ cwd: e.target.value.trim() || null }); }} aria-label={t("Working folder")}
            placeholder={t("Absolute path (optional)")} className={cn(INPUT, "h-9")} />
        </div>
      </Field>
      <div className="mt-auto px-5 py-4">
        <button type="button" onClick={remove} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] text-danger hover:bg-danger/10"><Trash2 size={13} /> {t("Delete room")}</button>
      </div>
    </aside>
  );
}
