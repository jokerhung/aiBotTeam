"use client";
import { ArrowUp, AudioLines, Plus, Square } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Bot } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";

export function Composer({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const [text, setText] = useState("");
  const [wrapped, setWrapped] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
    setWrapped(el.scrollHeight > 36);
  }, [text]);

  const send = async () => {
    const t = text.trim();
    if (!t || bot.busy) return;
    const sendId = crypto.randomUUID();
    setText("");
    dispatch({
      type: "optimistic",
      botId: bot.id,
      message: { id: `pending-${sendId}`, sendId, role: "user", kind: "text", text: t, at: Date.now(), pending: true },
    });
    try {
      await api(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: t, sendId }) });
    } catch {
      dispatch({ type: "optimisticFailed", botId: bot.id, sendId });
      setText(t);
    }
  };

  const round = "flex size-7 shrink-0 items-center justify-center rounded-full";
  return (
    <div className="chat-column-dock pointer-events-none absolute inset-x-0 bottom-0 z-[2]">
      <div className="pointer-events-none relative px-5 pb-4">
        <div className="pointer-events-auto relative w-full">
          <div className="relative">
            <div className="pointer-events-none absolute -left-5 -right-5 -bottom-4 top-0 bg-app" />
            <div
              className={cn(
                "relative z-[1] bg-composer p-2 ring-[0.5px] ring-ink/10 hover:ring-ink/[0.22] focus-within:ring-ink/[0.22]",
                "shadow-[0_2px_8px_-1px_rgb(0_0_0/0.05),0_1px_2px_rgb(0_0_0/0.03)] [transition:border-radius_300ms,box-shadow_150ms]",
                wrapped ? "rounded-[18px]" : "rounded-[22px]",
              )}
            >
              <div className="flex items-end gap-1.5">
                <button
                  type="button"
                  title="Add"
                  className={cn(round, "bg-ink/[0.05] ring-[0.5px] ring-inset ring-ink/[0.07] text-ink-tertiary transition-colors hover:bg-ink/[0.09] hover:text-ink")}
                >
                  <Plus size={16} />
                </button>
                <div className="relative min-w-0 flex-1 self-center">
                  <textarea
                    ref={ref}
                    rows={1}
                    dir="auto"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    placeholder={`Message ${bot.name}`}
                    aria-label={`Message ${bot.name}`}
                    className="block max-h-[9rem] min-h-7 w-full resize-none overflow-y-auto bg-transparent px-0.5 py-1 text-[14px] leading-5 text-ink outline-none placeholder:text-ink-tertiary"
                  />
                </div>
                {bot.busy ? (
                  <button type="button" title="Stop" aria-label="Stop" onClick={() => api(`/api/bots/${bot.id}/interrupt`, { method: "POST" })} className={cn(round, "bg-ink text-app")}>
                    <Square size={11} fill="currentColor" />
                  </button>
                ) : text.trim() ? (
                  <button type="button" title="Send" aria-label="Send" onClick={send} className={cn(round, "bg-accent text-[var(--color-accent-ink)]")}>
                    <ArrowUp size={16} />
                  </button>
                ) : (
                  <button
                    type="button"
                    title={`Live call with ${bot.name}`}
                    style={{ background: `var(--identity-${bot.color})` }}
                    className={cn(round, "text-white transition-[filter] hover:brightness-110")}
                  >
                    <AudioLines size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
