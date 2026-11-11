"use client";
import { Check, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { APPROVAL_MODES, type ApprovalMode } from "@/lib/wire";

/** Ask · Edits · Auto · Full, with what each one lets the bot do without asking. */
export function ApprovalModeSelector({ value, onChange, compact }: { value: ApprovalMode; onChange: (m: ApprovalMode) => void; compact?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Approval mode" className={cn("flex", compact ? "flex-col gap-0.5" : "gap-1.5 max-sm:flex-col")}>
      {APPROVAL_MODES.map((m) => {
        const on = m.id === value;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(m.id)}
            className={cn(
              "flex min-w-0 items-start gap-2 rounded-xl px-3 py-2 text-left ring-1 ring-inset ring-ink/10 transition-colors hover:bg-ink/[0.06]",
              !compact && "flex-1",
              on && "bg-accent/12 ring-accent/50",
              compact && "ring-0",
            )}
          >
            <Shield size={14} className={cn("mt-0.5 shrink-0", on ? "text-accent" : "text-ink-tertiary")} />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium text-ink">{m.label}</span>
              <span className="block text-[12px] leading-4 text-ink-tertiary">{m.hint}</span>
            </span>
            {on && compact && <Check size={14} className="mt-0.5 shrink-0 text-accent" />}
          </button>
        );
      })}
    </div>
  );
}
