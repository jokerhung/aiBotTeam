"use client";
import { ChevronDown, ChevronRight, Menu, Monitor } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { Bot, Message } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { Composer } from "./Composer";
import { Mascot } from "./Mascot";

const FLOAT_PILL =
  "bg-composer ring-[0.5px] ring-ink/10 shadow-(--shadow-float) transition-colors duration-[120ms] hover:bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_7%)]";

function dayLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}

function Bubble({ m, tail }: { m: Message; tail: "first" | "last" | "single" | "mid" }) {
  const mine = m.role === "user";
  return (
    <div className={cn("group flex w-full flex-col animate-msg-in", mine ? "items-end" : "items-start")}>
      <div className={cn("flex w-full items-center gap-1.5", mine ? "justify-end" : "justify-start")}>
        <div
          title={new Date(m.at).toLocaleString()}
          className={cn(
            "w-fit min-w-9 max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct),calc(100%-82px))] rounded-[18px] px-3 py-[7px] text-[15px] leading-[22px]",
            mine ? "bg-bubble-user text-[var(--color-bubble-user-ink)]" : "bg-card text-ink",
            mine && (tail === "last" || tail === "single") && "rounded-ee-[6px]",
            !mine && (tail === "last" || tail === "single") && "rounded-es-[6px]",
            m.pending && "opacity-70",
          )}
        >
          <div className="chat-md min-w-0 whitespace-pre-wrap">
            {m.text}
            {m.streaming && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-caret bg-ink" />}
          </div>
        </div>
        <span className="self-end pb-1 text-[11px] tabular-nums text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100">
          {new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
}

function Header({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const inst = state.instances.find((i) => i.id === bot.modelSelection.instanceId);
  const model = inst?.models.find((m) => m.id === bot.modelSelection.model)?.label ?? bot.modelSelection.model;
  return (
    <div className="absolute inset-x-0 top-0 z-[25] bg-gradient-to-b from-app via-app/90 to-transparent">
      <div className="px-5 pb-2.5 pt-2.5 max-md:pl-14 max-md:pr-3">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(max-content,1fr)] items-center max-md:flex max-md:justify-between">
          <button
            type="button"
            aria-label="Open bot list"
            onClick={() => dispatch({ type: "drawer", open: true })}
            className="-ml-2 rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink md:hidden"
          >
            <Menu size={20} />
          </button>
          <div className="col-start-2 flex min-w-0 items-center justify-self-center">
            <button
              type="button"
              title="Details and conversations"
              className={cn("group flex min-w-0 max-w-full items-center gap-2 rounded-full py-[7.5px] pl-[7.5px] pr-[13.5px] text-ink", FLOAT_PILL)}
            >
              <Mascot color={bot.color} size={28} busy={bot.busy} />
              <span dir="auto" className="min-w-0 truncate text-[14px] font-medium leading-5">
                {bot.name}
              </span>
              <ChevronRight size={14} className="-ml-0.5 shrink-0 text-ink-secondary" />
            </button>
          </div>
          <div className="col-start-3 flex shrink-0 items-center justify-self-end gap-2">
            <button
              type="button"
              title={`${inst?.displayName ?? "Engine"} · ${model}`}
              className={cn("group flex h-8 shrink-0 items-center rounded-full pl-2.5 pr-2 text-[13px] leading-[18px] text-ink-secondary hover:text-ink", FLOAT_PILL)}
            >
              <span className="max-w-[160px] min-w-0 truncate">{model}</span>
              <ChevronDown size={14} className="ml-1" />
            </button>
            <button
              type="button"
              title="Bot's screen"
              className={cn("relative flex size-8 items-center justify-center rounded-full text-ink-secondary hover:text-ink", FLOAT_PILL)}
            >
              <Monitor size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function tailOf(list: Message[], i: number): "first" | "last" | "single" | "mid" {
  const prev = list[i - 1]?.role === list[i].role;
  const next = list[i + 1]?.role === list[i].role;
  return prev && next ? "mid" : prev ? "last" : next ? "first" : "single";
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
    <main className="relative flex h-full min-w-0 flex-1 flex-col bg-app">
      <div className="relative min-h-0 flex-1">
        <Header bot={bot} />
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="h-full overflow-y-auto overflow-x-hidden overscroll-y-contain px-5 pb-28 pt-14 [overflow-anchor:none]"
        >
          <div role="log" className="chat-column relative flex w-full flex-col gap-3">
            {messages.length > 0 && (
              <div className="pb-1 pt-5 text-center text-[13px] leading-[18px] text-ink-secondary">{dayLabel(messages[0].at)}</div>
            )}
            {messages.length === 0 && (
              <div className="py-20 text-center text-[14px] text-ink-secondary">Say hello to {bot.name}.</div>
            )}
            {messages.map((m, i) => (
              <div key={m.id} className={cn("contents", tailOf(messages, i) === "last" || tailOf(messages, i) === "mid" ? "[&>*]:-mt-2" : "")}>
                <Bubble m={m} tail={tailOf(messages, i)} />
              </div>
            ))}
          </div>
        </div>
        <Composer bot={bot} />
      </div>
    </main>
  );
}
