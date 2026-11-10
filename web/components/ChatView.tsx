"use client";
import { ChevronDown, Menu, Monitor, Phone, Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { Bot, Message } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { Composer } from "./Composer";
import { Mascot } from "./Mascot";

function dayLabel(at: number): string {
  const d = new Date(at);
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function Bubble({ m }: { m: Message }) {
  const mine = m.role === "user";
  return (
    <div className={cn("flex w-full animate-msg-in", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "chat-text max-w-[min(35rem,80%)] whitespace-pre-wrap rounded-[18px] px-4 py-2.5 text-[17px]",
          mine ? "bg-bubble-user text-bubble-user-ink" : "bg-card text-ink",
          m.pending && "opacity-70",
        )}
      >
        {m.text}
        {m.streaming && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-caret bg-ink" />}
      </div>
    </div>
  );
}

function Header({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const inst = state.instances.find((i) => i.id === bot.modelSelection.instanceId);
  const model = inst?.models.find((m) => m.id === bot.modelSelection.model)?.label ?? bot.modelSelection.model;
  return (
    <header className="relative z-[3] flex h-[68px] shrink-0 items-center gap-3 px-5">
      <button
        type="button"
        aria-label="Open bot list"
        onClick={() => dispatch({ type: "drawer", open: true })}
        className="-ml-2 rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink md:hidden"
      >
        <Menu size={20} />
      </button>
      <Mascot color={bot.color} size={40} busy={bot.busy} />
      <h1 className="min-w-0 truncate text-[19px] font-semibold text-ink">{bot.name}</h1>
      <div className="ml-auto flex items-center gap-2.5">
        <button
          type="button"
          className="flex h-11 items-center gap-1.5 rounded-full border border-hairline px-4 text-[16px] text-ink-secondary transition-colors hover:bg-raised hover:text-ink"
        >
          <Plus size={16} /> Task
        </button>
        <button
          type="button"
          className="flex h-11 items-center gap-2 rounded-full bg-raised px-4 text-[17px] text-ink transition-colors hover:bg-raised-hover"
        >
          <span className="max-w-[16rem] truncate">{model}</span>
          <ChevronDown size={16} className="text-ink-secondary" />
        </button>
        <button type="button" aria-label="Call" className="rounded-md p-2 text-ink-secondary hover:text-ink">
          <Phone size={22} />
        </button>
        <button type="button" aria-label="Computer" className="rounded-md p-2 text-ink-secondary hover:text-ink">
          <Monitor size={22} />
        </button>
      </div>
    </header>
  );
}

export function ChatView({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const messages = state.messages[bot.id] ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (bot.unread) api(`/api/bots/${bot.id}/read`, { method: "POST" }).catch(() => {});
  }, [bot.id, bot.unread]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, bot.id]);

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col bg-chat">
      <Header bot={bot} />
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-5 pb-32"
      >
        <div className="chat-column flex w-full flex-col gap-3 pt-2">
          {messages.length > 0 && (
            <div className="py-3 text-center text-[16px] text-ink-secondary">{dayLabel(messages[0].at)}</div>
          )}
          {messages.length === 0 && (
            <div className="py-20 text-center text-[16px] text-ink-secondary">
              Say hello to {bot.name}.
            </div>
          )}
          {messages.map((m) => (
            <Bubble key={m.id} m={m} />
          ))}
        </div>
      </div>
      <Composer bot={bot} />
    </main>
  );
}
