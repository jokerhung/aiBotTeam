"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the files are read when the dialog opens and the verdict is asked for after typing stops */
import { FileText, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Bot } from "@/lib/wire";
import { ApiError, api } from "@/state/api";
import { useStore } from "@/state/store";

type Name = "intake.md" | "machines.md";
interface FileState { content: string; original: string; hash: string; exists: boolean; loaded: boolean }
interface Verdict { valid: boolean; error: string | null; line: number | null; warnings: string[]; summary: string }
interface IntakeInfo { hasFolder: boolean; hasInput: boolean; exists: boolean; valid: boolean; error: string | null; line: number | null; warnings: string[]; usingLastGood: boolean; summary: string }

const NONE: FileState = { content: "", original: "", hash: "", exists: false, loaded: false };
const LINE = 20; // px: the gutter and the text share one line height
const BTN = "h-9 rounded-full px-4 text-[14px]";

/** The dialog that edits a bot's intake.md (and machines.md) in place, checking the text before it can be saved (specs/intake-md.md §7a). */
export function IntakeEditor({ botId, botName, onClose, onSaved }: { botId: string; botName: string; onClose: () => void; onSaved?: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<Name>("intake.md");
  const [files, setFiles] = useState<Record<Name, FileState>>({ "intake.md": NONE, "machines.md": NONE });
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [discard, setDiscard] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const base = `/api/bots/${botId}/intake`;
  const cur = files[tab];
  const dirty = (n: Name) => files[n].loaded && files[n].content !== files[n].original;

  const load = useCallback(async (name: Name) => {
    try {
      const f = await api<{ exists: boolean; content: string; hash: string }>(`${base}/file?name=${name}`);
      setFiles((p) => ({ ...p, [name]: { content: f.content, original: f.content, hash: f.hash, exists: f.exists, loaded: true } }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [base]);
  useEffect(() => { void load("intake.md"); void load("machines.md"); }, [load]);

  // the verdict on what is typed, asked for when typing stops
  useEffect(() => {
    if (!cur.loaded) return;
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      api<Verdict>(`${base}/check`, { method: "POST", body: JSON.stringify({ name: tab, content: cur.content }) })
        .then((v) => { if (mine === seq.current) setVerdict(v); })
        .catch((e) => { if (mine === seq.current) setVerdict({ valid: false, error: (e as Error).message, line: null, warnings: [], summary: "" }); });
    }, 600);
    return () => clearTimeout(timer);
  }, [base, tab, cur.content, cur.loaded]);

  const edit = (content: string) => { setFiles((p) => ({ ...p, [tab]: { ...p[tab], content } })); setVerdict(null); setConflict(false); setError(""); };
  const close = () => { if (dirty("intake.md") || dirty("machines.md")) setDiscard(true); else onClose(); };
  const canSave = !busy && cur.loaded && dirty(tab) && verdict?.valid === true;

  const save = async (force = false) => {
    if (!canSave && !force) return;
    setBusy(true);
    setError("");
    try {
      const out = await api<{ hash: string }>(`${base}/file`, { method: "PUT", body: JSON.stringify({ name: tab, content: cur.content, hash: cur.hash, force }) });
      setFiles((p) => ({ ...p, [tab]: { content: p[tab].content, original: p[tab].content, hash: out.hash, exists: true, loaded: true } }));
      setConflict(false);
      onSaved?.();
      const other: Name = tab === "intake.md" ? "machines.md" : "intake.md";
      if (!dirty(other)) onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    try {
      const r = await api<{ content: string }>(`${base}/template?name=${tab}`);
      edit(r.content);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const jump = (line: number) => {
    const el = area.current;
    if (!el) return;
    const start = cur.content.split("\n").slice(0, Math.max(0, line - 1)).join("\n").length + (line > 1 ? 1 : 0);
    el.focus();
    el.setSelectionRange(start, start);
    el.scrollTop = Math.max(0, (line - 3) * LINE);
  };

  const lines = Math.max(1, cur.content.split("\n").length);
  return (
    <div role="dialog" aria-modal="true" aria-label={t("Intake workflow")} data-testid="intake-editor" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 max-md:p-0"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); close(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
      }}>
      <div className="flex h-[90vh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl bg-panel text-ink shadow-xl ring-1 ring-ink/10 max-md:h-full max-md:max-w-none max-md:rounded-none">
        <div className="flex h-14 shrink-0 items-center gap-2 px-5">
          <FileText size={16} className="text-ink-secondary" />
          <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold">{t("Intake workflow")} · <span data-no-i18n="">{botName}</span></h2>
          <button type="button" aria-label={t("Close")} onClick={close} className="rounded-full p-1.5 hover:bg-ink/10"><X size={15} /></button>
        </div>
        <div role="tablist" className="flex shrink-0 gap-1 px-5 pb-2">
          {(["intake.md", "machines.md"] as const).map((n) => (
            <button key={n} type="button" role="tab" aria-selected={tab === n} onClick={() => { setTab(n); setVerdict(null); }} data-no-i18n="" data-testid={`intake-tab-${n}`}
              className={cn("rounded-lg px-3 py-1.5 font-mono text-[13px]", tab === n ? "bg-accent/12 ring-1 ring-accent/60" : "text-ink-secondary hover:bg-ink/[0.05]")}>
              {n}{dirty(n) ? " •" : ""}
            </button>
          ))}
        </div>
        <div className="relative mx-5 min-h-0 flex-1 overflow-hidden rounded-xl bg-inset ring-1 ring-inset ring-ink/[0.07]">
          <div ref={gutter} aria-hidden className="absolute inset-y-0 left-0 w-11 overflow-hidden border-r border-ink/[0.07] py-2 pr-2 text-right font-mono text-[12.5px] text-ink-tertiary" style={{ lineHeight: `${LINE}px` }}>
            {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
          </div>
          <textarea ref={area} data-no-i18n="" value={cur.content} spellCheck={false} disabled={!cur.loaded} aria-label={tab} data-testid="intake-text"
            onChange={(e) => edit(e.target.value)}
            onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
            onKeyDown={(e) => {
              if (e.key === "Tab" && !e.shiftKey) {
                e.preventDefault();
                const el = e.currentTarget;
                const { selectionStart: a, selectionEnd: b } = el;
                edit(`${cur.content.slice(0, a)}  ${cur.content.slice(b)}`);
                requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
              }
            }}
            wrap="off" className="absolute inset-y-0 left-11 right-0 resize-none overflow-auto bg-transparent px-3 py-2 font-mono text-[12.5px] text-ink outline-none" style={{ lineHeight: `${LINE}px` }} />
          {cur.loaded && !cur.exists && !cur.content && (
            <div className="pointer-events-none absolute inset-x-0 top-16 px-8 text-center text-[13px] text-ink-tertiary">
              {tab === "intake.md" ? t("There is no intake.md yet. Use “Restore the template”, then Save.") : t("There is no machines.md yet. Use “Restore the template”, then Save.")}
            </div>
          )}
        </div>
        <div className="shrink-0 px-5 pt-2 text-[13px] leading-5" aria-live="polite" data-testid="intake-verdict">
          {conflict ? (
            <div role="alert" className="rounded-lg bg-warning/12 px-3 py-2 text-warning">
              {t("The file was changed somewhere else since you opened it.")}{" "}
              <button type="button" onClick={() => { setConflict(false); void load(tab); }} className="underline">{t("Reload")}</button>{" · "}
              <button type="button" onClick={() => void save(true)} className="underline" data-testid="intake-overwrite">{t("Overwrite")}</button>
            </div>
          ) : error ? <div role="alert" data-no-i18n="" className="text-danger">{error}</div>
            : verdict === null ? <span className="text-ink-tertiary">{t("Checking…")}</span>
              : verdict.valid ? <span className="text-success">✓ {t("Valid")}{verdict.summary ? <>: <span data-no-i18n="">{t(verdict.summary)}</span></> : null}</span>
                : <button type="button" onClick={() => verdict.line && jump(verdict.line)} className="text-left text-danger" data-no-i18n="">✗ {verdict.line ? `${t("Line")} ${verdict.line}: ` : ""}{verdict.error}</button>}
          {verdict?.warnings.map((w) => <div key={w} data-no-i18n="" className="text-warning">⚠ {w}</div>)}
        </div>
        {discard && (
          <div role="alertdialog" className="mx-5 mt-2 flex items-center gap-2 rounded-lg bg-warning/12 px-3 py-2 text-[13px]">
            <span className="flex-1">{t("Discard your changes?")}</span>
            <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-danger hover:bg-ink/10" data-testid="intake-discard">{t("Discard")}</button>
            <button type="button" onClick={() => setDiscard(false)} className="rounded-full px-3 py-1 hover:bg-ink/10">{t("Keep editing")}</button>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-2 px-5 py-3">
          <button type="button" onClick={() => void reset()} disabled={!cur.loaded} className={cn(BTN, "text-ink-secondary hover:bg-ink/10")} data-testid="intake-reset">{t("Restore the template")}</button>
          <span className="flex-1" />
          <button type="button" onClick={close} className={cn(BTN, "text-ink-secondary hover:bg-ink/10")}>{t("Cancel")}</button>
          <button type="button" disabled={!canSave} onClick={() => void save()} data-testid="intake-save"
            className={cn(BTN, "bg-accent font-medium text-[var(--color-accent-ink)] disabled:opacity-40")}>{t("Save")}</button>
        </div>
      </div>
    </div>
  );
}

/** In Bot settings, under Inputs: what the bot's intake.md says in one line, what is wrong with it, and the way to edit it. */
export function IntakeSection({ bot }: { bot: Bot }) {
  const t = useT();
  const { state } = useStore();
  const [info, setInfo] = useState<IntakeInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<IntakeInfo>(`/api/bots/${bot.id}/intake`).then(setInfo).catch(() => {}), [bot.id]);
  useEffect(() => { void load(); }, [load, state.channelTick, bot.cwd]);
  const make = async () => {
    setBusy(true);
    try { setInfo(await api<IntakeInfo>(`/api/bots/${bot.id}/intake/default`, { method: "POST" })); } catch { /* another file is already there */ } finally { setBusy(false); void load(); }
  };
  const hint = "How this bot receives what people send it: when it runs, where the photos are saved, what it is asked to do. The file is in its working folder.";
  return (
    <div className="px-5 py-2.5" data-testid="bot-intake">
      <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{t("Intake workflow")} <span className="normal-case tracking-normal" data-no-i18n="">(intake.md)</span></div>
      {!info ? null : !info.hasFolder ? (
        <div className="text-[13px] text-ink-tertiary">{t("This bot has no working folder.")}</div>
      ) : !info.exists ? (
        <div className="text-[13px] text-ink-secondary">
          {t(info.hasInput ? "intake.md is missing: nothing runs until it is made." : "There is no intake.md yet. It is made when the bot is given an input.")}
          <button type="button" disabled={busy} onClick={() => void make()} data-testid="intake-make" className="ml-2 text-accent-text hover:underline disabled:opacity-40">{t("Make it from the template")}</button>
        </div>
      ) : (
        <div className="rounded-lg bg-inset px-3 py-2 text-[13px] ring-1 ring-inset ring-ink/[0.07]">
          {info.error ? (
            <div role="alert" data-no-i18n="" className="text-danger">✗ {info.line ? `${t("Line")} ${info.line}: ` : ""}{info.error}{info.usingLastGood ? ` — ${t("running on the last good version")}` : ""}</div>
          ) : (
            <div data-no-i18n="" className="text-ink-secondary">{t(info.summary.split(" · ")[0])}{info.summary.includes(" · ") ? ` · ${t("saves to")} ${info.summary.split("saves to ")[1] ?? ""}` : ""}</div>
          )}
          {info.warnings.map((w) => <div key={w} data-no-i18n="" className="text-warning">⚠ {w}</div>)}
        </div>
      )}
      {info?.hasFolder && info.exists && (
        <button type="button" onClick={() => setOpen(true)} data-testid="intake-edit" className="mt-1.5 text-[12.5px] text-accent-text hover:underline">{t("Edit")}</button>
      )}
      <div className="mt-1 text-[12px] leading-[1.4] text-ink-tertiary">{t(hint)}</div>
      {open && <IntakeEditor botId={bot.id} botName={bot.name} onClose={() => { setOpen(false); void load(); }} onSaved={() => void load()} />}
    </div>
  );
}
