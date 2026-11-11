"use client";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { queuePatch } from "@/lib/patch-queue";
import { cn } from "@/lib/utils";
import type { Bot, Skill } from "@/lib/wire";
import { api } from "@/state/api";

const INPUT = "w-full rounded-lg bg-inset px-3 text-[14px] text-ink outline-none ring-1 ring-inset ring-ink/[0.07] placeholder:text-ink-tertiary focus:ring-ink/25";

function SkillEditor({ skill, onClose }: { skill: Skill | null; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [body, setBody] = useState(skill?.body ?? "");
  const [error, setError] = useState("");
  const save = async () => {
    try {
      await api(skill ? `/api/skills/${skill.id}` : "/api/skills", { method: skill ? "PATCH" : "POST", body: JSON.stringify({ name, description, body }) });
      onClose();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Skill" data-testid="skill-editor" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl bg-panel text-ink shadow-xl ring-1 ring-ink/10">
        <div className="flex h-14 items-center px-5"><h2 className="flex-1 text-[16px] font-semibold">{skill ? t("Edit skill") : t("New skill")}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-1.5 hover:bg-ink/10"><X size={15} /></button></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <input data-no-i18n="" value={name} onChange={(e) => setName(e.target.value)} aria-label={t("Name")} placeholder={t("Name")} className={cn(INPUT, "h-10")} />
          <input data-no-i18n="" value={description} onChange={(e) => setDescription(e.target.value)} aria-label={t("When to use it")} placeholder={t("When to use it")} className={cn(INPUT, "mt-2 h-10")} />
          <textarea data-no-i18n="" value={body} onChange={(e) => setBody(e.target.value)} rows={10} aria-label={t("Instructions")} placeholder={t("What the bot should do, step by step")} className={cn(INPUT, "mt-2 py-2 leading-5")} />
          {error && <div role="alert" className="mt-2 text-[13px] text-danger">{error}</div>}
        </div>
        <div className="flex h-[60px] items-center justify-end gap-2 border-t border-edge px-5">
          <button type="button" onClick={onClose} className="rounded-full px-3.5 py-2 text-[14px] text-ink-secondary hover:bg-ink/10">{t("Cancel")}</button>
          <button type="button" disabled={!name.trim()} onClick={save} className="h-9 rounded-full bg-accent px-4 text-[14px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Save")}</button>
        </div>
      </div>
    </div>
  );
}

/** The skill library and which of its skills this bot has: a SKILL.md each, switched on or off. */
export function SkillsSection({ bot }: { bot: Bot }) {
  const t = useT();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editing, setEditing] = useState<Skill | "new" | null>(null);
  const load = useCallback(() => api<{ skills: Skill[] }>("/api/skills").then((r) => setSkills(r.skills)).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);
  const have = bot.skills ?? [];
  return (
    <div data-testid="skills-section" className="px-5 py-2.5">
      <div className="mb-1.5 flex items-center text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">
        <span className="flex-1">{t("Skills")}</span>
        <button type="button" onClick={() => setEditing("new")} data-testid="new-skill" className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] normal-case tracking-normal text-accent-text hover:bg-ink/10"><Plus size={12} /> {t("New skill")}</button>
      </div>
      {skills.length === 0 && <div className="text-[13px] text-ink-tertiary">{t("No skills yet. A skill is a set of instructions the bot follows when it fits the task.")}</div>}
      <div className="flex flex-col gap-1.5">
        {skills.map((s) => (
          <div key={s.id} data-testid="skill-row" className="rounded-lg bg-inset px-3 py-2 ring-1 ring-inset ring-ink/[0.07]">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={have.includes(s.id)} aria-label={`Give ${s.name}`} onChange={(e) => void queuePatch(bot.id, { skills: e.target.checked ? [...have, s.id] : have.filter((x) => x !== s.id) })} />
              <span data-no-i18n="" className={cn("min-w-0 flex-1 truncate text-[14px]", !s.enabled && "opacity-50")}>{s.name}</span>
              <button type="button" role="switch" aria-checked={s.enabled} aria-label={`${s.name} ${s.enabled ? "on" : "off"}`} onClick={async () => { await api(`/api/skills/${s.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !s.enabled }) }).catch(() => {}); await load(); }}
                className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", s.enabled ? "bg-accent" : "bg-ink/20")}><span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-all", s.enabled ? "left-[18px]" : "left-0.5")} /></button>
              <button type="button" title={t("Edit")} aria-label={t("Edit")} onClick={() => setEditing(s)} className="rounded-full p-1 text-ink-secondary hover:bg-ink/10"><Pencil size={13} /></button>
              <button type="button" title={t("Delete")} aria-label={t("Delete")} onClick={async () => { if (confirm(t("Delete this skill?"))) { await api(`/api/skills/${s.id}`, { method: "DELETE" }).catch(() => {}); await load(); } }} className="rounded-full p-1 text-ink-tertiary hover:bg-danger/10 hover:text-danger"><Trash2 size={13} /></button>
            </div>
            {s.description && <div data-no-i18n="" className="mt-0.5 truncate pl-6 text-[12px] text-ink-tertiary">{s.description}</div>}
          </div>
        ))}
      </div>
      {editing && <SkillEditor key={editing === "new" ? "new" : editing.id} skill={editing === "new" ? null : editing} onClose={() => { setEditing(null); void load(); }} />}
    </div>
  );
}
