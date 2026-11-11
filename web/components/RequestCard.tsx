"use client";
import { ArrowUp, Check, ChevronDown, ShieldCheck, ShieldX, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Bot, Message, RequestInfo, RequestQuestion } from "@/lib/wire";
import { Mascot } from "./Mascot";
import { api } from "@/state/api";

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

const optionLabel = (o: NonNullable<RequestQuestion["options"]>[number]) => (typeof o === "string" ? o : o.label);
const optionHint = (o: NonNullable<RequestQuestion["options"]>[number]) => (typeof o === "string" ? "" : (o.description ?? ""));

/** The questions a request asks: AskUserQuestion's list, or the single `ask_user` question with its choices. */
function questionsOf(r: RequestInfo): RequestQuestion[] {
  if (r.questions.length) return r.questions;
  return [{ question: r.summary, options: r.choices }];
}

function answer(thread: string, id: string, body: object) {
  return api(`/api/threads/${thread}/requests/${id}`, { method: "POST", body: JSON.stringify(body) }).catch(() => {});
}

const WHO: Record<string, string> = {
  user: "by you",
  auto: "automatically",
  rule: "by a saved rule",
  expired: "— no answer in time",
  unavailable: "— nobody could be asked",
  system: "by the system",
};

/** After a decision the card shrinks to one line saying who decided. */
function Decided({ r }: { r: RequestInfo }) {
  const t = useT();
  const allowed = r.behavior === "allow";
  // a question the person answered reads like the reference: a green tick and "You chose: ..."
  if (r.type === "question" && allowed && r.answer && r.source === "user") {
    return (
      <div data-testid="request-decided" className="flex min-w-0 items-center gap-2 text-[13px] leading-5 text-ink-tertiary">
        <Check size={14} className="shrink-0 text-success" />
        <span className="truncate">{`You chose: ${r.answer.slice(0, 120)}`}</span>
      </div>
    );
  }
  const Icon = r.type === "question" ? Check : allowed ? ShieldCheck : ShieldX;
  const what = t(r.type === "question" ? (allowed ? "Answered" : "Skipped") : allowed ? "Allowed" : "Denied");
  const detail = r.type === "question" ? (r.answer && allowed ? ` “${r.answer.slice(0, 80)}”` : "") : ` ${r.command ?? r.summary}`.slice(0, 90);
  return (
    <div
      data-testid="request-decided"
      className={cn("flex items-center gap-2 text-[13px] text-ink-tertiary", "min-w-0")}
    >
      <Icon size={14} className={cn("shrink-0", !allowed && r.type === "permission" && "text-danger")} />
      <span className="truncate">
        {what}
        <span className="font-mono text-[12px]">{detail}</span> {t(WHO[r.source ?? "user"] ?? "")}
      </span>
    </div>
  );
}

/** The open permission request, docked above the composer like the reference: who wants what, the exact command,
 * then Deny / Allow once (and Always allow when the command can be remembered). */
export function ApprovalDock({ m, thread, bot }: { m: Message; thread: string; bot: Bot }) {
  const r = m.request;
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  if (!r || r.status !== "open" || r.type !== "permission") return null;
  const decide = async (behavior: "allow" | "deny", always = false) => {
    setBusy(true);
    await answer(thread, r.id, { behavior, always, message: behavior === "deny" ? "Denied from the chat" : undefined });
    setBusy(false);
  };
  const what = r.command ? "wants to run a command" : r.tool === "Edit" || r.tool === "Write" ? "wants to edit files" : `wants to use ${r.tool}`;
  return (
    <div role="group" aria-label={`Permission needed: ${r.tool}`} data-testid="approval-card"
      className="mb-2 w-full rounded-[18px] border border-hairline bg-card px-4 pb-3.5 pt-3 shadow-(--shadow-float)">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex h-5 w-full items-center gap-2 text-left text-[13.5px] text-ink-secondary">
        <Mascot color={bot.color} size={16} />
        <span className="min-w-0 flex-1 truncate">{bot.name} {t(what)}</span>
        <ChevronDown size={15} className={cn("shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      <pre className={cn("mt-2 overflow-auto rounded-lg bg-inset px-3 py-2 font-mono text-[12.5px] leading-[17px] text-ink-secondary", open ? "max-h-48 whitespace-pre-wrap break-all" : "max-h-[33px] truncate whitespace-nowrap")}>{r.command ?? r.summary}</pre>
      {open && (r.cwd || r.tool) && (
        <div className="mt-1.5 space-y-0.5 font-mono text-[12px] text-ink-tertiary">
          <div>tool: {r.tool}</div>
          {r.cwd && <div className="truncate" title={r.cwd}>in {r.cwd}</div>}
        </div>
      )}
      <div className="mt-3 flex items-center justify-end gap-2">
        {r.canAlways && (
          <button type="button" disabled={busy} onClick={() => decide("allow", true)} title="Skip this prompt next time for this exact command in this folder"
            className="mr-auto rounded-full px-2 py-1.5 text-[13px] text-ink-secondary hover:bg-ink/10 disabled:opacity-50">{t("Always allow")}</button>
        )}
        <button type="button" disabled={busy} onClick={() => decide("deny")}
          className="h-9 rounded-full bg-raised px-4 text-[14px] font-medium text-ink hover:bg-raised-hover disabled:opacity-50">{t("Deny")}</button>
        <button type="button" disabled={busy} onClick={() => decide("allow")}
          className="h-9 rounded-full bg-accent px-4 text-[14px] font-medium text-[var(--color-accent-ink)] disabled:opacity-50">{t("Allow once")}</button>
      </div>
    </div>
  );
}

function QuestionCard({ r, thread, active, bot }: { r: RequestInfo; thread: string; active: boolean; bot: Bot }) {
  const t = useT();
  const qs = useMemo(() => questionsOf(r), [r]);
  const single = qs.length === 1 && !qs[0].multiSelect;
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const valueOf = (i: number) => (typed[i]?.trim() ? [typed[i].trim()] : (picked[i] ?? [])).join(", ");
  const submit = async (override?: Record<number, string>) => {
    setBusy(true);
    const val = (i: number) => override?.[i] ?? valueOf(i);
    const answers: Record<string, string> = {};
    qs.forEach((q, i) => { if (val(i)) answers[q.question] = val(i); });
    await answer(thread, r.id, { behavior: "allow", message: val(0), answers });
    setBusy(false);
  };
  const choose = (qi: number, label: string) => {
    if (single) { void submit({ 0: label }); return; }
    setTyped((t) => ({ ...t, [qi]: "" }));
    setPicked((p) => {
      const cur = p[qi] ?? [];
      if (qs[qi].multiSelect) return { ...p, [qi]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] };
      return { ...p, [qi]: [label] };
    });
  };
  const dismiss = () => answer(thread, r.id, { behavior: "deny", message: "The person dismissed the question without answering." });

  // A–D picks the matching option of the first question while no field has focus.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // The composer has focus by default: while it is empty a letter is an answer, not text.
      const emptyComposer = t?.tagName === "TEXTAREA" && !(t as HTMLTextAreaElement).value;
      if (t && !emptyComposer && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = LETTERS.indexOf(e.key.toUpperCase());
      const opts = qs[0].options ?? [];
      if (idx >= 0 && idx < Math.min(opts.length, 4)) { e.preventDefault(); choose(0, optionLabel(opts[idx])); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, qs]);

  const ready = qs.every((_, i) => valueOf(i));
  const asks = `${bot.name} asks`;
  return (
    <div role="group" aria-label="Question" data-testid="ask-card"
      className="relative w-full max-w-[560px] rounded-[18px] bg-composer px-4 pb-3.5 pt-3 text-start ring-[0.5px] ring-ink/10">
      <button type="button" aria-label="Dismiss question" title="Dismiss" onClick={dismiss}
        className="absolute right-2.5 top-2.5 flex size-7 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink">
        <X size={15} />
      </button>
      {qs.map((q, qi) => (
        <div key={qi} className={cn(qi > 0 && "mt-4 border-t border-hairline pt-3")}>
          {qi === 0 && (
            <div className="flex h-5 items-center gap-1.5 text-[13px] text-ink-secondary">
              <Mascot color={bot.color} size={16} />
              <span className="truncate">{asks}</span>
            </div>
          )}
          <div className={cn("text-[15px] font-medium leading-[22px] text-ink", qi === 0 && "mt-1 pr-6")}>{q.header ? `${q.header}: ` : ""}{q.question}</div>
          {q.multiSelect && <div className="text-[12.5px] leading-4 text-ink-tertiary">{t("Select all that apply")}</div>}
          <div className="mt-3 flex flex-col gap-1.5" role="listbox" aria-label="Options">
            {(q.options ?? []).map((o, oi) => {
              const label = optionLabel(o);
              const on = (picked[qi] ?? []).includes(label) && !typed[qi]?.trim();
              return (
                <button key={oi} type="button" role="option" aria-selected={on} disabled={busy} onClick={() => choose(qi, label)}
                  className={cn("flex min-h-10 w-full items-center gap-2.5 rounded-[12px] px-3.5 py-2 text-start text-[14px] leading-[18px] text-ink ring-[0.5px] ring-ink/15 transition-colors hover:bg-ink/[0.04] disabled:opacity-60", on && "bg-accent/12 ring-1 ring-accent/60")}>
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {optionHint(o) && <span className="hidden min-w-0 truncate text-[12.5px] text-ink-tertiary sm:block">{optionHint(o)}</span>}
                  <kbd aria-hidden className="shrink-0 rounded-[5px] bg-ink/[0.06] px-1.5 text-[11px] font-medium leading-[18px] text-ink-tertiary">{LETTERS[oi] ?? oi + 1}</kbd>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex h-10 items-center gap-2 rounded-2xl bg-ink/[0.045] pl-3 pr-1">
            <input
              value={typed[qi] ?? ""}
              disabled={busy}
              onChange={(e) => setTyped((t) => ({ ...t, [qi]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing && typed[qi]?.trim() && (single || ready)) { e.preventDefault(); void submit(); }
              }}
              placeholder={t("Type your own answer")}
              aria-label="Type your own answer"
              className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-tertiary"
            />
            {single && (
              <button type="button" aria-label="Send answer" disabled={busy || !typed[qi]?.trim()} onClick={() => submit()}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink/10 text-ink-secondary enabled:bg-accent enabled:text-[var(--color-accent-ink)] disabled:opacity-60"><ArrowUp size={15} /></button>
            )}
          </div>
        </div>
      ))}
      {!single && (
        <div className="mt-3 flex justify-end">
          <button type="button" disabled={busy || !ready} onClick={() => submit()}
            className="rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">{t("Submit")}</button>
        </div>
      )}
    </div>
  );
}

export function RequestCard({ m, thread, active, bot }: { m: Message; thread: string; active: boolean; bot: Bot }) {
  const r = m.request;
  if (!r) return null;
  if (r.status === "resolved") return <Decided r={r} />;
  if (r.type === "permission") return null; // shown in the dock above the composer while it is open
  return <QuestionCard r={r} thread={thread} active={active} bot={bot} />;
}
