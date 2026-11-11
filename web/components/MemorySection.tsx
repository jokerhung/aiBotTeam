"use client";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { queuePatch } from "@/lib/patch-queue";
import { cn } from "@/lib/utils";
import type { Bot, MemoryView } from "@/lib/wire";
import { api } from "@/state/api";

const INPUT = "w-full rounded-lg bg-inset px-3 text-[14px] text-ink outline-none ring-1 ring-inset ring-ink/[0.07] placeholder:text-ink-tertiary focus:ring-ink/25";

/** The bot's notes: a switch, a gauge of how much loads each turn, every note with a delete, and the files to read and edit. */
export function MemorySection({ bot }: { bot: Bot }) {
  const t = useT();
  const [view, setView] = useState<MemoryView | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [team, setTeam] = useState("");
  const [saved, setSaved] = useState("");
  const load = useCallback(() => api<MemoryView>(`/api/bots/${bot.id}/memory`).then((v) => { setView(v); setTeam(v.teamMemory ?? ""); }).catch(() => {}), [bot.id]);
  useEffect(() => { void load(); }, [load, bot.memory]);
  const open = async (name: string) => {
    const r = await api<{ text: string }>(`/api/bots/${bot.id}/memory/file?name=${encodeURIComponent(name)}`).catch(() => null);
    if (r) { setFile(name); setText(r.text); setSaved(""); }
  };
  const g = view?.gauge;
  const tone = g?.state === "red" ? "bg-danger" : g?.state === "amber" ? "bg-warning" : "bg-success";
  const pct = g ? Math.min(100, Math.round(Math.max(g.lines / g.lineBudget, g.bytes / g.byteBudget) * 100)) : 0;
  return (
    <div data-testid="memory-section" className="px-5 py-2.5">
      <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{t("Memory")}</div>
      <label className="flex items-center gap-2 text-[14px] text-ink">
        <input type="checkbox" checked={bot.memory !== false} onChange={(e) => void queuePatch(bot.id, { memory: e.target.checked })} aria-label={t("Let this bot use memory")} /> {t("Let this bot use memory")}
      </label>
      <div className="mt-1 text-[12px] text-ink-tertiary">{t("Notes stay between tasks, as plain files on this computer. Only the first 200 lines load each turn.")}</div>
      {g && (
        <div className="mt-2.5" data-testid="memory-gauge" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("Memory used")}>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink/10"><div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} /></div>
          <div className="mt-1 flex justify-between text-[12px] text-ink-tertiary tabular-nums"><span>{g.lines} / {g.lineBudget} {t("lines")}</span><span>{(g.bytes / 1024).toFixed(1)} / {g.byteBudget / 1024} KB</span></div>
          {g.notLoaded > 0 && <div role="alert" className="mt-1 text-[12px] text-danger">{g.notLoaded} {t("lines are not loading. Trim MEMORY.md.")}</div>}
        </div>
      )}
      <div className="mt-2.5 flex flex-col gap-1" data-testid="memory-entries">
        {view?.entries.length === 0 && <div className="text-[13px] text-ink-tertiary">{t("No notes yet. The bot adds them as it learns.")}</div>}
        {view?.entries.map((e) => (
          <div key={e.id} className="group flex items-start gap-2 rounded-lg bg-inset px-2.5 py-1.5 ring-1 ring-inset ring-ink/[0.07]">
            <div className="min-w-0 flex-1 text-[13px] leading-5 text-ink">{e.date && <span className="mr-1.5 tabular-nums text-ink-tertiary">{e.date}</span>}<span data-no-i18n="">{e.text}</span></div>
            <button type="button" title={t("Delete note")} aria-label={t("Delete note")} onClick={async () => { await api(`/api/bots/${bot.id}/memory/entries/${e.id}`, { method: "DELETE" }).catch(() => {}); await load(); }}
              className="rounded-full p-1 text-ink-tertiary opacity-0 hover:bg-danger/10 hover:text-danger group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      {view && view.files.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {view.files.map((f) => (
            <button key={f.name} type="button" onClick={() => void open(f.name)} className={cn("rounded-full px-2.5 py-1 text-[12px] ring-1 ring-ink/10 hover:bg-ink/[0.05]", file === f.name && "bg-accent/12 ring-accent/60")}><span data-no-i18n="">{f.name}</span></button>
          ))}
        </div>
      )}
      {file && (
        <div className="mt-2" data-testid="memory-editor">
          <textarea data-no-i18n="" value={text} onChange={(e) => { setText(e.target.value); setSaved(""); }} rows={8} aria-label={file} className={cn(INPUT, "py-2 font-mono text-[12.5px]")} />
          <div className="mt-1.5 flex items-center justify-end gap-2">
            {saved && <span className="text-[12px] text-success">{saved}</span>}
            <button type="button" onClick={() => setFile(null)} className="rounded-full px-3 py-1 text-[13px] text-ink-secondary hover:bg-ink/10">{t("Close")}</button>
            <button type="button" onClick={async () => { await api(`/api/bots/${bot.id}/memory/file`, { method: "PUT", body: JSON.stringify({ name: file, text }) }).catch(() => {}); setSaved(t("Saved")); await load(); }}
              className="rounded-full bg-accent px-3.5 py-1 text-[13px] font-medium text-[var(--color-accent-ink)]">{t("Save")}</button>
          </div>
        </div>
      )}
      {view?.teamMemory !== null && view?.teamMemory !== undefined && (
        <div className="mt-3" data-testid="team-memory">
          <div className="mb-1 text-[12px] font-medium text-ink-secondary">{t("Team memory (shared by this section)")}</div>
          <textarea data-no-i18n="" value={team} onChange={(e) => setTeam(e.target.value)} rows={4} aria-label={t("Team memory")} className={cn(INPUT, "py-2 font-mono text-[12.5px]")} />
          <div className="mt-1 flex justify-end"><button type="button" onClick={async () => { await api(`/api/bots/${bot.id}/memory/team`, { method: "PUT", body: JSON.stringify({ text: team }) }).catch(() => {}); await load(); }} className="rounded-full px-3 py-1 text-[13px] text-ink-secondary hover:bg-ink/10">{t("Save")}</button></div>
          <div className="text-[12px] text-ink-tertiary">{t("Bots can only add to it when you approve a card.")}</div>
        </div>
      )}
    </div>
  );
}
