"use client";
import { ArrowUp, Mic, Plus, Square } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Bot } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";

export function Composer({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const [text, setText] = useState("");
  const [multi, setMulti] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
    setMulti(el.scrollHeight > 32);
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

  return (
    <div className="chat-column-dock pointer-events-none absolute inset-x-0 bottom-0 z-[2] px-5 pb-5">
      <div
        className={cn(
          "pointer-events-auto flex items-end gap-2 bg-composer px-3.5 py-2.5 ring-1 ring-composer-ring",
          multi ? "rounded-[18px]" : "rounded-[22px]",
        )}
      >
        <button type="button" aria-label="Attach" className="mb-0.5 rounded-full p-1.5 text-ink-secondary hover:text-ink">
          <Plus size={22} />
        </button>
        <textarea
          ref={ref}
          rows={1}
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
          className="max-h-60 min-h-8 flex-1 resize-none bg-transparent py-1 text-[17px] leading-6 text-ink outline-none placeholder:text-ink-secondary"
        />
        {bot.busy ? (
          <button
            type="button"
            aria-label="Stop"
            onClick={() => api(`/api/bots/${bot.id}/interrupt`, { method: "POST" })}
            className="mb-0.5 flex size-8 items-center justify-center rounded-full bg-ink text-app"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : text.trim() ? (
          <button
            type="button"
            aria-label="Send"
            onClick={send}
            className="mb-0.5 flex size-8 items-center justify-center rounded-full bg-accent text-accent-ink"
          >
            <ArrowUp size={18} />
          </button>
        ) : (
          <button type="button" aria-label="Dictate" className="mb-0.5 rounded-full p-1.5 text-ink-secondary hover:text-ink">
            <Mic size={20} />
          </button>
        )}
      </div>
    </div>
  );
}
