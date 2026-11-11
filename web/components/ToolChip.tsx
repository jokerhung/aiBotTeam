"use client";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ToolInfo } from "@/lib/wire";

/** One tool call: a mono pill with its state; click to read what it was given and what it returned. */
export function ToolChip({ tool }: { tool: ToolInfo }) {
  const [open, setOpen] = useState(false);
  const running = tool.ok === null || tool.ok === undefined;
  const hasDetail = Boolean(tool.input || tool.output);
  return (
    <div data-no-i18n="" className="flex max-w-[min(var(--chat-bubble-max),100%)] flex-col items-start">
      <button
        type="button"
        aria-expanded={open}
        disabled={!hasDetail}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex max-w-full items-center gap-2 rounded-full bg-card px-3 py-1 font-mono text-[12.5px] leading-5 text-ink-secondary ring-[0.5px] ring-ink/10",
          hasDetail && "transition-colors hover:text-ink",
        )}
      >
        {running ? (
          <Loader2 size={13} className="shrink-0 animate-spin" />
        ) : tool.ok ? (
          <Check size={13} className="shrink-0 text-success" />
        ) : (
          <X size={13} className="shrink-0 text-danger" />
        )}
        <span className="shrink-0 font-medium text-ink">{tool.name}</span>
        {tool.summary && <span className="min-w-0 truncate">{tool.summary}</span>}
        {hasDetail && <ChevronDown size={12} className={cn("shrink-0 transition-transform", open && "rotate-180")} />}
      </button>
      {open && (
        <div className="mt-1.5 w-full max-w-[40rem] space-y-1.5 rounded-xl bg-inset p-3 font-mono text-[12px] leading-5">
          {tool.input && (
            <div>
              <div className="mb-0.5 text-[11px] uppercase tracking-wide text-ink-tertiary">Input</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{tool.input}</pre>
            </div>
          )}
          {tool.output && (
            <div>
              <div className="mb-0.5 text-[11px] uppercase tracking-wide text-ink-tertiary">Output</div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{tool.output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
