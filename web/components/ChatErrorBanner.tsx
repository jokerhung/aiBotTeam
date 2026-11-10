"use client";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { Bot, Message } from "@/lib/wire";
import { api } from "@/state/api";

function resetText(at?: number | null): string | null {
  if (!at) return null;
  const d = new Date(at);
  return `Resets ${d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

/** A failed turn, in the transcript: what went wrong and, when it is a setup problem, a way to re-check the engine. */
export function ChatErrorBanner({ bot, m }: { bot: Bot; m: Message }) {
  const [checking, setChecking] = useState(false);
  const info = m.error;
  const reset = resetText(info?.limitResetsAt);
  return (
    <div
      role="alert"
      className="flex w-full max-w-[min(var(--chat-bubble-max),100%)] items-start gap-2.5 rounded-[14px] bg-danger/10 px-3.5 py-2.5 text-[14px] leading-5 text-ink ring-[0.5px] ring-danger/30"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <div className="break-words">{m.text}</div>
        {info?.limit && <div className="mt-0.5 text-[13px] text-ink-secondary">{reset ?? "Usage limit reached."}</div>}
        {info?.setup && (
          <button
            type="button"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              try {
                await api(`/api/instances/${bot.modelSelection.instanceId}/check`, { method: "POST" });
              } finally {
                setChecking(false);
              }
            }}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-composer px-3 py-1 text-[13px] font-medium ring-1 ring-inset ring-ink/10 hover:bg-raised disabled:opacity-60"
          >
            <RefreshCw size={12} className={checking ? "animate-spin" : undefined} />
            Check engine again
          </button>
        )}
      </div>
    </div>
  );
}
