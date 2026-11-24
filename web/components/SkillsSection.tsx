"use client";
import { FileText, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { queuePatch } from "@/lib/patch-queue";
import { cn } from "@/lib/utils";
import type { Bot, Skill } from "@/lib/wire";
import { api } from "@/state/api";
import { trapDialog } from "./agents/shared";
import { CATEGORIES } from "@/lib/skills";
import { ChatMarkdown } from "./ChatMarkdown";

const INPUT = "w-full rounded-lg bg-inset px-3 text-[14px] text-ink outline-none ring-1 ring-inset ring-ink/[0.07] placeholder:text-ink-tertiary focus:ring-ink/25";

export function SkillEditor({ skill, onClose }: { skill: Skill | null; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [body, setBody] = useState(skill?.body ?? "");
  const [category, setCategory] = useState(skill?.category ?? "");
  const [preview, setPreview] = useState(false);
  const [selectedFile, setSelectedFile] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try {
      await api(skill ? `/api/skills/${skill.id}` : "/api/skills", { method: skill ? "PATCH" : "POST", body: JSON.stringify({ name, description, body, category }) });
      onClose();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const openFile = async (name: string) => {
    setSelectedFile(name); setFileContent("");
    try { const file = await api<{ content: string }>(`/api/skills/${skill!.id}/file?name=${encodeURIComponent(name)}`); setFileContent(file.content); }
    catch (exc) { setError(String(exc)); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Skill" data-testid="skill-editor" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onKeyDown={(event) => { if (event.key === "Escape" || event.key === "Tab") { event.stopPropagation(); trapDialog(event, onClose); } }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-panel text-ink shadow-xl ring-1 ring-ink/10">
        <div className="flex h-14 items-center px-5"><h2 className="flex-1 text-[16px] font-semibold">{skill ? t("Edit skill") : t("New skill")}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-1.5 hover:bg-ink/10"><X size={15} /></button></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <p className="mb-5 text-sm text-ink-secondary">{t("An agent reads this skill once it is added to that agent.")}</p>
          <label className="mb-4 block text-sm">{t("Name")}<input data-no-i18n="" value={name} onChange={(e) => setName(e.target.value)} aria-label={t("Name")} placeholder={t("Name")} className={cn(INPUT, "mt-2 h-10")} /></label>
          <label className="mb-4 block text-sm">{t("Description")}<textarea data-no-i18n="" value={description} onChange={(e) => setDescription(e.target.value)} aria-label={t("When to use it")} placeholder={t("When to use it")} className={cn(INPUT, "mt-2 py-2")} rows={2} /><span className="mt-1 block text-xs text-ink-tertiary">{t("Describe when this skill applies so the agent can decide whether to use it.")}</span></label>
          <label className="mb-4 block text-sm">{t("Category")}<select aria-label={t("Category")} value={category} onChange={(e) => setCategory(e.target.value)} className={cn(INPUT, "mt-2 h-10")}><option value="">{t("No category")}</option>{category && !CATEGORIES[category] && <option value={category}>{category}</option>}{Object.entries(CATEGORIES).map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}</select></label>
          <div className="mb-5 text-sm"><span>{t("Who can use it")}</span><div className="mt-2 flex items-center gap-2 rounded-lg border border-edge p-3"><Users size={16} />{t("Everyone")}<span className="ml-auto text-xs text-ink-tertiary">{t("Add it to an agent to use it.")}</span></div></div>
          <div className="flex min-h-72 overflow-hidden rounded-xl border border-edge"><aside className="w-40 shrink-0 border-r border-edge bg-inset p-2 max-sm:w-28"><div className="mb-2 px-2 text-xs font-medium text-ink-tertiary">{t("Files")}</div><button className={cn("flex w-full items-center gap-2 rounded-lg p-2 text-left text-xs", !selectedFile && "bg-panel")} onClick={() => setSelectedFile("")}><FileText size={14} />{t("Instructions")}</button>{skill?.files?.map((name) => <button data-no-i18n="" key={name} className={cn("mt-1 block w-full break-words rounded-lg p-2 text-left text-xs", selectedFile === name && "bg-panel")} onClick={() => void openFile(name)}>{name}</button>)}</aside><section className="min-w-0 flex-1 p-3"><div className="mb-3 flex items-center justify-between gap-2"><h3 data-no-i18n={selectedFile ? "" : undefined} className="truncate text-sm font-medium">{selectedFile || t("Instructions")}</h3><button className="rounded-lg border border-edge px-3 py-1 text-xs" onClick={() => setPreview(!preview)}>{t(preview ? "Edit" : "Preview")}</button></div>{selectedFile ? <div data-no-i18n="" className="max-h-80 overflow-auto text-sm"><ChatMarkdown text={fileContent} /></div> : preview ? <div data-no-i18n="" className="min-h-64 text-sm"><ChatMarkdown text={body} /></div> : <textarea data-no-i18n="" value={body} onChange={(e) => setBody(e.target.value)} rows={12} aria-label={t("Instructions")} placeholder={t("What the bot should do, step by step")} className={cn(INPUT, "min-h-64 py-2 font-mono text-xs leading-5")} />}</section></div>
          {error && <div role="alert" className="mt-2 text-[13px] text-danger">{error}</div>}
        </div>
        <div className="flex h-[60px] items-center justify-end gap-2 border-t border-edge px-5">
          <button type="button" onClick={onClose} className="rounded-full px-3.5 py-2 text-[14px] text-ink-secondary hover:bg-ink/10">{t("Cancel")}</button>
          <button type="button" disabled={busy || !name.trim()} onClick={save} className="h-9 rounded-full bg-accent px-4 text-[14px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t(busy ? "Saving…" : skill ? "Save" : "Create")}</button>
        </div>
      </div>
    </div>
  );
}

/** The skill library and which of its skills this bot has: a SKILL.md each, switched on or off. */
export function SkillsSection({ bot, onChange }: { bot: Bot; onChange?: (value: string[]) => void }) {
  const t = useT();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editing, setEditing] = useState<Skill | "new" | null>(null);
  const [query, setQuery] = useState("");
  const load = useCallback(() => api<{ skills: Skill[] }>("/api/skills").then((r) => setSkills(r.skills)).catch(() => {}), []);
  useEffect(() => { void load(); window.addEventListener("skills-changed", load); return () => window.removeEventListener("skills-changed", load); }, [load]);
  const have = bot.skills ?? [];
  return (
    <div data-testid="skills-section" className="px-5 py-2.5">
      <div className="mb-1.5 flex items-center text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">
        <span className="flex-1">{t("Skills")}</span>
        <button type="button" onClick={() => setEditing("new")} data-testid="new-skill" className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] normal-case tracking-normal text-accent-text hover:bg-ink/10"><Plus size={12} /> {t("New skill")}</button>
      </div>
      {skills.length === 0 && <div className="text-[13px] text-ink-tertiary">{t("No skills yet. A skill is a set of instructions the bot follows when it fits the task.")}</div>}
      {!!skills.length && <input className={cn(INPUT, "mb-3 h-9")} aria-label={t("Search skills")} placeholder={t("Search skills")} value={query} onChange={(e) => setQuery(e.target.value)} />}
      <div className="flex flex-col gap-1.5">
        {skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase())).map((s) => (
          <div key={s.id} data-testid="skill-row" className="rounded-lg bg-inset px-3 py-2 ring-1 ring-inset ring-ink/[0.07]">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={have.includes(s.id)} aria-label={`Give ${s.name}`} onChange={(e) => onChange ? onChange(e.target.checked ? [...have, s.id] : have.filter((x) => x !== s.id)) : void queuePatch(bot.id, { skills: e.target.checked ? [...have, s.id] : have.filter((x) => x !== s.id) })} />
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
