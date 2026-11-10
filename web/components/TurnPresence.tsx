"use client";
import { useEffect, useState } from "react";
import type { Bot } from "@/lib/wire";
import { Mascot } from "./Mascot";

function elapsed(since: number | null, now: number): string {
  if (!since) return "";
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** The status line at the foot of a running turn: the bot's face, what it is doing, and how long it has been at it. */
export function TurnPresence({ bot, hasLiveText }: { bot: Bot; hasLiveText: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (hasLiveText && !bot.statusLine) return null;
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 py-1 text-[13px] text-ink-secondary">
      <Mascot color={bot.color} size={22} busy />
      <span className="thinking-shimmer">{bot.statusLine ?? "Working…"}</span>
      <span className="tabular-nums text-ink-tertiary">{elapsed(bot.turnStartedAt, now)}</span>
    </div>
  );
}
