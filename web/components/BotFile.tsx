"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the dialog starts again each time it opens */
import { Check, FileUp, Link2, Plug, X } from "lucide-react";
import { useEffect, useState } from "react";
import { tr, useT } from "@/lib/i18n";
import type { Bot } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { toast } from "./Toaster";

const INPUT = "w-full rounded-lg bg-inset px-3 text-[14px] text-ink outline-none ring-1 ring-inset ring-ink/[0.07] placeholder:text-ink-tertiary focus:ring-ink/25";

/** "Export bot" in a bot's ... menu: the bot as one Markdown file, saved at once. It never holds memory, history, keys, the model or the folder. */
export async function exportBotFile(bot: Bot) {
  try {
    const out = await api<{ file: string; filename: string; report: { changed: string[]; leftOut: string[] } }>(`/api/bots/${bot.id}/export-file`, { method: "POST" });
    const url = URL.createObjectURL(new Blob([out.file], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = out.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const notes = out.report.leftOut.length + out.report.changed.length;
    toast(notes ? `${tr("Exported")} ${bot.name}. ${tr("Some things were left out or cleaned: read the file's report in the dialog when you import it.")}` : `${tr("Exported")} ${bot.name}`, { ms: 6000 });
  } catch (e) {
    toast((e as Error).message);
  }
}

interface Conn { name: string; action: "use" | "create" | "missing"; with?: string; url?: string; needs?: string[]; scope: string; tools: string[] }
interface Review { name: string; title: string; description: string; skills: string[]; connections: Conn[]; changed: string[]; willDo: string[] }

/** "Import bot" in the + menu: choose a bot file, see what it will make (and which connections are found again by themselves), then add it. */
export function ImportBotDialog() {
  const { state, dispatch } = useStore();
  const t = useT();
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [rev, setRev] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ name: string; notes: string[] } | null>(null);
  useEffect(() => { if (state.importBotOpen) { setText(""); setUrl(""); setRev(null); setError(""); setDone(null); } }, [state.importBotOpen]);
  if (!state.importBotOpen) return null;
  const close = () => dispatch({ type: "importBot", open: false });
  const source = () => (text.trim() ? { text } : { url: url.trim() });
  const preview = async (body: object) => {
    setBusy(true); setError(""); setRev(null);
    try { setRev(await api<Review>("/api/bot-files/preview", { method: "POST", body: JSON.stringify(body) })); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const add = async () => {
    setBusy(true); setError("");
    try {
      const r = await api<{ botId: string; name: string; notes: string[] }>("/api/bot-files/import", { method: "POST", body: JSON.stringify(source()) });
      setDone({ name: r.name, notes: r.notes });
      dispatch({ type: "select", id: r.botId });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const how = (c: Conn) => c.action === "use" ? `${t("will use")} ${c.with}` : c.action === "missing" ? t("not connected here: connect it, then tick it in the bot's settings") : t("made empty and switched off; add its values in Custom MCP servers");
  return (
    <div role="dialog" aria-modal="true" aria-label={t("Import bot")} data-testid="import-bot" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[20px] bg-panel text-ink shadow-xl ring-1 ring-ink/10">
        <div className="flex h-14 shrink-0 items-center px-5"><h2 className="flex-1 text-[17px] font-semibold">{t("Import bot")}</h2>
          <button type="button" aria-label="Close" onClick={close} className="rounded-full p-1.5 hover:bg-ink/10"><X size={16} /></button></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {done ? (
            <div role="status" data-testid="import-bot-done" className="py-6">
              <div className="flex items-center gap-2 text-[15px] text-success"><Check size={18} /> <span data-no-i18n="">{done.name}</span> {t("was added")}</div>
              {done.notes.map((n) => <div key={n} data-no-i18n="" className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-[12.5px] leading-5">{n}</div>)}
            </div>
          ) : !rev ? (
            <>
              <p className="mb-3 text-[13px] leading-5 text-ink-secondary">{t("Choose a bot file made with Export bot. It brings the bot's name, instructions and skills, never its memory, chat history, keys or model.")}</p>
              <div className="flex gap-2">
                <label className="flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-raised px-3 text-[13.5px] hover:bg-raised-hover"><FileUp size={14} /> {t("Choose a file")}
                  <input type="file" accept=".md,.yaml,.yml,.txt" hidden aria-label={t("Choose a file")} data-testid="import-bot-file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const body = await f.text(); setText(body); void preview({ text: body }); } }} /></label>
                <div className="relative min-w-0 flex-1"><Link2 size={14} className="absolute left-3 top-3 text-ink-tertiary" />
                  <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && url.trim() && void preview({ url: url.trim() })} aria-label={t("Public GitHub address")} placeholder="https://github.com/…/bot.bot.md" className={`${INPUT} h-10 pl-9`} /></div>
              </div>
              <textarea data-no-i18n="" value={text} onChange={(e) => setText(e.target.value)} rows={7} aria-label={t("Bot file text")} placeholder={t("…or paste the file here")} className={`${INPUT} mt-3 py-2 font-mono text-[12.5px]`} />
              {error && <div role="alert" className="mt-2 text-[13px] text-danger" data-testid="import-bot-error">{error}</div>}
            </>
          ) : (
            <div data-testid="import-bot-review">
              <div className="text-[15px] font-medium" data-no-i18n="">{rev.name}</div>
              {rev.title && <div className="text-[13px] text-ink-tertiary" data-no-i18n="">{rev.title}</div>}
              {rev.description && <div className="mt-1 text-[13px] text-ink-secondary" data-no-i18n="">{rev.description}</div>}
              {rev.skills.length > 0 && <div className="mt-2 text-[12.5px] text-ink-tertiary" data-no-i18n="">{t("Skills")}: {rev.skills.join(", ")}</div>}
              {rev.connections.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5">
                  {rev.connections.map((c) => (
                    <div key={c.name} data-testid="import-bot-connection" className="rounded-lg bg-raised/60 px-3 py-2 text-[13px]">
                      <div className="flex items-center gap-1.5"><Plug size={13} className="text-ink-tertiary" /><span data-no-i18n="" className="font-medium">{c.name}</span><span className="text-ink-tertiary">· {t(c.scope === "write" ? "Write" : "Read")}</span></div>
                      <div className="mt-0.5 text-[12px] text-ink-secondary">{how(c)}</div>
                      {c.tools.length > 0 && <div data-no-i18n="" className="mt-0.5 truncate font-mono text-[11.5px] text-ink-tertiary" title={c.tools.join(", ")}>{c.tools.join(", ")}</div>}
                    </div>
                  ))}
                </div>
              )}
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
              {rev
                ? <button type="button" disabled={busy} onClick={add} data-testid="add-bot" className="h-9 rounded-full bg-accent px-4 text-[14px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Add this bot")}</button>
                : <button type="button" disabled={busy || (!text.trim() && !url.trim())} onClick={() => void preview(source())} data-testid="review-bot" className="h-9 rounded-full bg-accent px-4 text-[14px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Review")}</button>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
