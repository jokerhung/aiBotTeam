"use client";
import { Check, ShieldAlert, ShieldCheck, ShieldX, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Message, RequestInfo, RequestQuestion } from "@/lib/wire";
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
  const allowed = r.behavior === "allow";
  const Icon = r.type === "question" ? Check : allowed ? ShieldCheck : ShieldX;
  const what = r.type === "question" ? (allowed ? "Answered" : "Skipped") : allowed ? "Allowed" : "Denied";
  const detail = r.type === "question" ? (r.answer && allowed ? ` “${r.answer.slice(0, 80)}”` : "") : ` ${r.command ?? r.summary}`.slice(0, 90);
  return (
    <div
      data-testid="request-decided"
      className={cn("flex items-center gap-2 text-[13px] text-ink-tertiary", "min-w-0")}
    >
      <Icon size={14} className={cn("shrink-0", !allowed && r.type === "permission" && "text-danger")} />
      <span className="truncate">
        {what}
        <span className="font-mono text-[12px]">{detail}</span> {WHO[r.source ?? "user"] ?? ""}
      </span>
    </div>
  );
}

function PermissionCard({ r, thread }: { r: RequestInfo; thread: string }) {
  const [busy, setBusy] = useState(false);
  const decide = async (behavior: "allow" | "deny", always = false) => {
    setBusy(true);
    await answer(thread, r.id, { behavior, always, message: behavior === "deny" ? "Denied from the chat" : undefined });
    setBusy(false);
  };
  return (
    <div role="group" aria-label={`Permission needed: ${r.tool}`} data-testid="approval-card"
      className="w-full max-w-[min(var(--chat-bubble-max),100%)] rounded-[18px] bg-card p-4 ring-[0.5px] ring-ink/10">
      <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
        <ShieldAlert size={16} className="text-warning" />
        Allow {r.tool}?
      </div>
      {r.command ? (
        <pre className="mt-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-inset px-3 py-2 font-mono text-[12.5px] leading-[18px] text-ink">{r.command}</pre>
      ) : (
        <div className="mt-2 break-all text-[13px] text-ink-secondary">{r.summary}</div>
      )}
      {r.cwd && <div className="mt-1.5 truncate font-mono text-[12px] text-ink-tertiary" title={r.cwd}>in {r.cwd}</div>}
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => decide("allow")}
          className="rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-[var(--color-accent-ink)] disabled:opacity-50">Allow</button>
        <button type="button" disabled={busy} onClick={() => decide("deny")}
          className="rounded-full bg-raised px-4 py-1.5 text-[13px] font-medium text-ink hover:bg-raised-hover disabled:opacity-50">Deny</button>
        {r.canAlways && (
          <button type="button" disabled={busy} onClick={() => decide("allow", true)}
            className="rounded-full px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-ink/10 disabled:opacity-50"
            title="Skip this prompt next time for this exact command in this folder">Always allow</button>
        )}
      </div>
    </div>
  );
}

function QuestionCard({ r, thread, active }: { r: RequestInfo; thread: string; active: boolean }) {
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
  return (
    <div role="group" aria-label="Question" data-testid="ask-card"
      className="relative w-full max-w-[840px] rounded-[18px] border border-hairline bg-card px-[18px] pb-[17px] pt-[17px]">
      <button type="button" aria-label="Dismiss question" title="Dismiss" onClick={dismiss}
        className="absolute right-[14px] top-[14px] flex size-7 items-center justify-center rounded-full text-ink-secondary hover:bg-ink/10 hover:text-ink">
        <X size={15} />
      </button>
      {qs.map((q, qi) => (
        <div key={qi} className={cn(qi > 0 && "mt-4 border-t border-hairline pt-4")}>
          <div className="pr-8 text-[16px] font-semibold leading-6 text-ink">{q.header ? `${q.header}: ` : ""}{q.question}</div>
          <div className="text-[14px] leading-5 text-ink-secondary">{q.multiSelect ? "Select all that apply" : "Pick whatever's closest, or type your own."}</div>
          <div className="mt-[15px] overflow-hidden rounded-lg border border-hairline" role="listbox" aria-label="Options">
            {(q.options ?? []).map((o, oi) => {
              const label = optionLabel(o);
              const on = (picked[qi] ?? []).includes(label) && !typed[qi]?.trim();
              return (
                <button key={oi} type="button" role="option" aria-selected={on} disabled={busy} onClick={() => choose(qi, label)}
                  className={cn("flex h-12 w-full items-center gap-3 px-3 text-left transition-colors hover:bg-ink/[0.05] disabled:opacity-60", oi > 0 && "border-t border-hairline", on && "bg-accent/15")}>
                  <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md bg-control text-[12px] font-medium text-ink-secondary", on && "bg-accent text-[var(--color-accent-ink)]")}>
                    {LETTERS[oi] ?? oi + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{label}</span>
                  {optionHint(o) && <span className="hidden min-w-0 truncate text-[12.5px] text-ink-tertiary sm:block">{optionHint(o)}</span>}
                </button>
              );
            })}
          </div>
          <input
            value={typed[qi] ?? ""}
            disabled={busy}
            onChange={(e) => setTyped((t) => ({ ...t, [qi]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && typed[qi]?.trim() && (single || ready)) { e.preventDefault(); void submit(); }
            }}
            placeholder="Type your own answer"
            aria-label="Type your own answer"
            className="mt-[13px] h-[43px] w-full rounded-lg bg-inset px-3.5 text-[15px] text-ink outline-none placeholder:text-ink-secondary focus:ring-1 focus:ring-ink/25"
          />
        </div>
      ))}
      {(!single || Object.values(typed).some((v) => v.trim())) && (
        <div className="mt-3.5 flex justify-end">
          <button type="button" disabled={busy || !ready} onClick={() => submit()}
            className="rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40">Submit</button>
        </div>
      )}
    </div>
  );
}

export function RequestCard({ m, thread, active }: { m: Message; thread: string; active: boolean }) {
  const r = m.request;
  if (!r) return null;
  if (r.status === "resolved") return <Decided r={r} />;
  return r.type === "question" ? <QuestionCard r={r} thread={thread} active={active} /> : <PermissionCard r={r} thread={thread} />;
}
