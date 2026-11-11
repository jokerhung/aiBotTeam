"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the preview is fetched when the dialog opens or its options change */
import { Check, Download, FileUp, Link2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { api } from "@/state/api";
import { useStore } from "@/state/store";

const INPUT = "w-full rounded-lg bg-inset px-3 text-[14px] text-ink outline-none ring-1 ring-inset ring-ink/[0.07] placeholder:text-ink-tertiary focus:ring-ink/25";

interface Report { bots: number; skills: number; rooms: number; routines: number; connections: number; notes: number; changed: string[]; leftOut: string[]; bytes: number }
interface Exported { file: string; filename: string; report: Report }

const Row = ({ n, label }: { n: number; label: string }) => <div className="flex justify-between text-[14px]"><span>{label}</span><span className="tabular-nums text-ink-secondary">{n}</span></div>;

/** "Share section…": exactly what the file holds, before it is saved. There is no confirmation step: Save file is the decision. */
export function ShareTeamDialog() {
  const { state, dispatch } = useStore();
  const t = useT();
  const section = state.sections.find((s) => s.id === state.shareSection);
  const [notes, setNotes] = useState(true);
  const [skills, setSkills] = useState(true);
  const [out, setOut] = useState<Exported | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!state.shareSection) return;
    setError("");
    api<Exported>("/api/teams/export", { method: "POST", body: JSON.stringify({ sectionId: state.shareSection, options: { notes, skills } }) }).then(setOut).catch((e: Error) => setError(e.message));
  }, [state.shareSection, notes, skills]);
  if (!state.shareSection || !section) return null;
  const close = () => dispatch({ type: "shareTeam", id: null });
  const save = () => {
    if (!out) return;
    const url = URL.createObjectURL(new Blob([out.file], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url; a.download = out.filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    close();
  };
  const r = out?.report;
  return (
    <div role="dialog" aria-modal="true" aria-label="Share section" data-testid="share-team" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="flex max-h-[90vh] w-full max-w-[520px] flex-col overflow-hidden rounded-[20px] bg-panel text-ink shadow-xl ring-1 ring-ink/10">
        <div className="flex h-14 shrink-0 items-center px-5"><h2 className="flex-1 text-[17px] font-semibold">{t("Share")} <span data-no-i18n="">{section.name}</span></h2>
          <button type="button" aria-label="Close" onClick={close} className="rounded-full p-1.5 hover:bg-ink/10"><X size={16} /></button></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <p className="text-[13px] leading-5 text-ink-secondary">{t("One file with the bots of this section. It never holds chat history, keys, model choices, folders or who may see a bot.")}</p>
          {r && (
            <div className="mt-3 flex flex-col gap-1.5 rounded-xl bg-raised/60 p-3" data-testid="share-counts">
              <Row n={r.bots} label={t("Bots")} /><Row n={r.skills} label={t("Skills")} /><Row n={r.rooms} label={t("Rooms")} />
              <Row n={r.routines} label={t("Routines (arrive paused)")} /><Row n={r.connections} label={t("Connections (names only, no values)")} /><Row n={r.notes} label={t("Bots with starter notes")} />
            </div>
          )}
          <label className="mt-3 flex items-center gap-2 text-[14px]"><input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} /> {t("Include starter notes")}</label>
          <div className="ml-6 text-[12px] text-ink-tertiary">{t("Untick it if the notes hold private details.")}</div>
          <label className="mt-2 flex items-center gap-2 text-[14px]"><input type="checkbox" checked={skills} onChange={(e) => setSkills(e.target.checked)} /> {t("Include skills (their text only)")}</label>
          {r && r.changed.length > 0 && <div className="mt-3 rounded-xl bg-warning/10 p-3 text-[12.5px] leading-5" data-testid="share-changed"><div className="font-medium text-warning">{t("Changed before saving")}</div>{r.changed.map((c, i) => <div key={i} data-no-i18n="">{c}</div>)}</div>}
          {r && r.leftOut.length > 0 && <div className="mt-3 rounded-xl bg-ink/[0.05] p-3 text-[12.5px] leading-5" data-testid="share-left-out"><div className="font-medium text-ink-secondary">{t("Left out")}</div>{r.leftOut.map((c, i) => <div key={i} data-no-i18n="">{c}</div>)}</div>}
          {error && <div role="alert" className="mt-3 text-[13px] text-danger">{error}</div>}
        </div>
        <div className="flex h-[64px] shrink-0 items-center justify-end gap-2 border-t border-edge px-5">
          <button type="button" onClick={close} className="rounded-full px-3.5 py-2 text-[14px] text-ink-secondary hover:bg-ink/10">{t("Cancel")}</button>
          <button type="button" disabled={!out} onClick={save} data-testid="save-team-file" className="flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-[14px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40"><Download size={14} /> {t("Save file")}</button>
        </div>
      </div>
    </div>
  );
}

interface Review { name: string; counts: Report; bots: { name: string; title: string; skills: string[]; chief: boolean; notes: boolean }[]; rooms: string[]; routines: string[]; connections: { name: string; url: string; needs: string[] }[]; changed: string[]; willDo: string[] }

/** "Import team": a file, pasted text or a public GitHub address; a review comes first, and nothing is made until Add. */
export function ImportTeamDialog() {
  const { state, dispatch } = useStore();
  const t = useT();
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [rev, setRev] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  useEffect(() => { if (state.importOpen) { setText(""); setUrl(""); setRev(null); setError(""); setDone(""); } }, [state.importOpen]);
  if (!state.importOpen) return null;
  const close = () => dispatch({ type: "importTeam", open: false });
  const source = () => (text.trim() ? { text } : { url: url.trim() });
  const preview = async (body: object) => {
    setBusy(true); setError(""); setRev(null);
    try { setRev(await api<Review>("/api/teams/import/preview", { method: "POST", body: JSON.stringify(body) })); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const add = async () => {
    setBusy(true); setError("");
    try {
      const r = await api<{ section: string; bots: number }>("/api/teams/import", { method: "POST", body: JSON.stringify(source()) });
      setDone(`${r.bots} ${t("bots added in")} ${r.section}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Import team" data-testid="import-team" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[20px] bg-panel text-ink shadow-xl ring-1 ring-ink/10">
        <div className="flex h-14 shrink-0 items-center px-5"><h2 className="flex-1 text-[17px] font-semibold">{t("Import team")}</h2>
          <button type="button" aria-label="Close" onClick={close} className="rounded-full p-1.5 hover:bg-ink/10"><X size={16} /></button></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {done ? <div role="status" className="flex items-center gap-2 py-8 text-[15px] text-success" data-testid="import-done"><Check size={18} /> <span data-no-i18n="">{done}</span></div> : !rev ? (
            <>
              <div className="flex gap-2">
                <label className="flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-raised px-3 text-[13.5px] hover:bg-raised-hover"><FileUp size={14} /> {t("Choose a file")}
                  <input type="file" accept=".md,.yaml,.yml,.txt" hidden aria-label={t("Choose a file")} onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const body = await f.text(); setText(body); void preview({ text: body }); } }} /></label>
                <div className="relative min-w-0 flex-1"><Link2 size={14} className="absolute left-3 top-3 text-ink-tertiary" />
                  <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && url.trim() && void preview({ url: url.trim() })} aria-label={t("Public GitHub address")} placeholder="https://github.com/…/team.botteam.md" className={cn(INPUT, "h-10 pl-8")} /></div>
              </div>
              <textarea data-no-i18n="" value={text} onChange={(e) => setText(e.target.value)} rows={8} aria-label={t("Team file text")} placeholder={t("…or paste the file here")} className={cn(INPUT, "mt-3 py-2 font-mono text-[12.5px]")} />
              {error && <div role="alert" className="mt-2 text-[13px] text-danger" data-testid="import-error">{error}</div>}
            </>
          ) : (
            <div data-testid="import-review">
              <div className="text-[15px] font-medium" data-no-i18n="">{rev.name}</div>
              <div className="mt-2 flex flex-col gap-1">{rev.bots.map((b) => (
                <div key={b.name} className="rounded-lg bg-raised/60 px-3 py-2 text-[13.5px]"><span data-no-i18n="" className="font-medium">{b.name}</span>{b.title && <span data-no-i18n="" className="text-ink-tertiary"> · {b.title}</span>}
                  {b.skills.length > 0 && <div data-no-i18n="" className="text-[12px] text-ink-tertiary">{t("Skills")}: {b.skills.join(", ")}</div>}</div>))}</div>
              {rev.counts.rooms + rev.counts.routines + rev.counts.connections > 0 && <div className="mt-2 text-[13px] text-ink-secondary">{rev.counts.rooms} {t("rooms")} · {rev.counts.routines} {t("routines")} · {rev.counts.connections} {t("connections")}</div>}
              {rev.connections.map((c) => <div key={c.name} data-no-i18n="" className="mt-1 truncate font-mono text-[12px] text-ink-tertiary">{c.name}: {c.url}</div>)}
              <ul className="mt-3 list-disc pl-5 text-[13px] text-ink-secondary">{rev.willDo.map((w) => <li key={w}>{t(w)}</li>)}</ul>
              {rev.changed.length > 0 && <div className="mt-3 rounded-xl bg-warning/10 p-3 text-[12.5px]"><div className="font-medium text-warning">{t("Changed before reading")}</div>{rev.changed.map((c, i) => <div key={i} data-no-i18n="">{c}</div>)}</div>}
              {error && <div role="alert" className="mt-2 text-[13px] text-danger">{error}</div>}
            </div>
          )}
        </div>
        <div className="flex h-[64px] shrink-0 items-center justify-end gap-2 border-t border-edge px-5">
          {done ? <button type="button" onClick={close} className="h-9 rounded-full bg-accent px-4 text-[14px] font-medium text-[var(--color-accent-ink)]">{t("Done")}</button> : (
            <>
              <button type="button" onClick={rev ? () => setRev(null) : close} className="rounded-full px-3.5 py-2 text-[14px] text-ink-secondary hover:bg-ink/10">{rev ? t("Back") : t("Cancel")}</button>
              {rev ? <button type="button" disabled={busy} onClick={add} data-testid="add-team" className="h-9 rounded-full bg-accent px-4 text-[14px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Add this team")}</button>
                : <button type="button" disabled={busy || (!text.trim() && !url.trim())} onClick={() => void preview(source())} data-testid="review-team" className="h-9 rounded-full bg-accent px-4 text-[14px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Review")}</button>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
