"use client";
import { Users } from "lucide-react";
import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { mentionParts } from "@/lib/team";
import type { MemberInfo } from "@/lib/wire";
import { Mascot } from "./Mascot";

export interface MentionEditorHandle { focus: () => void }

/** A textarea that highlights @mentions through a mirror layer and offers a member picker while one is being typed. */
export const MentionEditor = forwardRef<MentionEditorHandle, {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  members: MemberInfo[];
  placeholder: string;
  disabled?: boolean;
  label: string;
}>(function MentionEditor({ value, onChange, onSubmit, members, placeholder, disabled, label }, handle) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(-1);
  const pendingCaret = useRef<number | null>(null);
  useImperativeHandle(handle, () => ({ focus: () => ref.current?.focus() }));
  // the caret lands after a picked mention as soon as the new text is in the box, before anything more is typed
  useLayoutEffect(() => {
    const pos = pendingCaret.current;
    if (pos === null || !ref.current) return;
    pendingCaret.current = null;
    ref.current.focus();
    ref.current.setSelectionRange(pos, pos);
  }, [value]);

  // the @fragment right before the caret, when it starts a word
  const frag = useMemo(() => {
    const m = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
    return m ? { text: m[1], start: caret - m[1].length - 1 } : null;
  }, [value, caret]);
  const options = useMemo(() => {
    if (!frag || frag.start === dismissed) return [];
    const q = frag.text.toLowerCase();
    const all: MemberInfo[] = members.length > 1 ? [{ id: "everyone", name: "everyone", color: "silver", title: `${members.length} bots in this chat` }] : [];
    return [...all, ...members].filter((m) => m.name.toLowerCase().includes(q)).slice(0, 8);
  }, [frag, members, dismissed]);

  const pick = (m: MemberInfo) => {
    if (!frag) return;
    const next = `${value.slice(0, frag.start)}@${m.name} ${value.slice(caret)}`;
    const pos = frag.start + m.name.length + 2;
    pendingCaret.current = pos;
    onChange(next);
    setCaret(pos);
  };

  const parts = mentionParts(value, members);
  const sync = (e: React.SyntheticEvent<HTMLTextAreaElement>) => setCaret(e.currentTarget.selectionStart ?? 0);
  return (
    <div className="mention-editor relative min-w-0 flex-1 self-center">
      {options.length > 0 && (
        <div role="listbox" aria-label="Mention a member" data-testid="mention-picker"
          className="absolute bottom-full left-0 z-20 mb-3 w-[290px] overflow-hidden rounded-2xl bg-menu p-1 text-ink shadow-(--shadow-float) ring-1 ring-ink/10">
          {options.map((m, i) => (
            <button key={m.id} type="button" role="option" aria-selected={i === index} onMouseDown={(e) => { e.preventDefault(); pick(m); }}
              onMouseEnter={() => setIndex(i)}
              className={cn("flex w-full items-center gap-2.5 rounded-xl px-2 py-[9px] text-left", i === index && "bg-menu-hover")}>
              {m.id === "everyone" ? <span className="flex size-7 items-center justify-center rounded-full bg-ink/[0.06] text-ink-secondary"><Users size={14} /></span> : <Mascot color={m.color as never} size={28} />}
              <span className="min-w-0 flex-1 leading-tight">
                <span data-no-i18n="" className="block truncate text-[14px] font-medium">{m.name}</span>
                {m.title && <span data-no-i18n={m.id === "everyone" ? undefined : ""} className="block truncate text-[12px] text-ink-tertiary">{m.title}</span>}
              </span>
              <span className="shrink-0 text-[12px] text-ink-tertiary">{m.id === "everyone" ? "Group chat" : "Agent"}</span>
            </button>
          ))}
        </div>
      )}
      <div aria-hidden data-no-i18n="" className="mention-editor-mirror pointer-events-none absolute inset-0 overflow-hidden px-0.5 py-1 text-[14px] leading-5">
        {parts.map((p, i) => (p.member
          ? <span key={i} className="mention-highlight" style={{ ["--mention-color" as string]: `var(--identity-${p.member.color})` }}>{p.text}</span>
          : <span key={i}>{p.text}</span>))}
        {value.endsWith("\n") ? "​" : null}
      </div>
      <textarea
        ref={ref}
        rows={1}
        dir="auto"
        value={value}
        disabled={disabled}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); sync(e); setIndex(0); setDismissed(-1); }}
        onSelect={sync}
        onClick={sync}
        onKeyUp={sync}
        onKeyDown={(e) => {
          if (options.length) {
            if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => (i + 1) % options.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => (i - 1 + options.length) % options.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(options[Math.min(index, options.length - 1)]); return; }
            if (e.key === "Escape") { e.preventDefault(); setDismissed(frag?.start ?? -1); return; }
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSubmit(); }
        }}
        onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 144)}px`; }}
        className="relative block max-h-[9rem] min-h-7 w-full resize-none overflow-y-auto bg-transparent px-0.5 py-1 text-[14px] leading-5 outline-none placeholder:text-ink-tertiary"
      />
    </div>
  );
});
