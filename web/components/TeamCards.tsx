"use client";
import { ArrowUpRight, CalendarClock, Pause, Play, Undo2, Pencil, Users, Webhook as WebhookIcon } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Bot, Message } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { Mascot } from "./Mascot";

/** A hand-off a bot made: who got the work and where it went. Opens that teammate's conversation. */
export function ThreadRefCard({ m }: { m: Message }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const ref = m.threadRef!;
  const target = state.bots.find((b) => b.id === ref.botId);
  const open = async () => {
    if (!target) return;
    if (ref.threadId) await api(`/api/bots/${target.id}`, { method: "PATCH", body: JSON.stringify({ threadId: ref.threadId }) }).catch(() => {});
    dispatch({ type: "select", id: target.id });
  };
  return (
    <button type="button" data-testid="thread-ref" onClick={open}
      className="mx-auto flex max-w-[420px] items-center gap-2 rounded-full bg-ink/[0.05] py-1 pl-1.5 pr-3 text-[13px] text-ink-secondary ring-1 ring-ink/10 hover:bg-ink/[0.09]">
      {target ? <Mascot color={target.color} size={20} /> : <Users size={14} />}
      <span data-no-i18n="" className="min-w-0 truncate">{t("Handed work to")} {ref.bot}</span>
      <ArrowUpRight size={13} className="shrink-0 text-ink-tertiary" />
    </button>
  );
}

/** "Waiting for teammates": shown at the foot of a conversation whose bot has handed its work to others. */
export function WaitingForTeammates({ bot }: { bot: Bot }) {
  const t = useT();
  if (!bot.waitingFor?.length) return null;
  return (
    <div role="status" data-testid="waiting-for-teammates" className="flex items-center gap-2 py-1 text-[13px] text-ink-secondary">
      <Mascot color={bot.color} size={22} busy />
      <span className="thinking-shimmer">{t("Waiting for teammates")}</span>
      <span data-no-i18n="" className="text-ink-tertiary">· {bot.waitingFor.join(", ")}</span>
    </div>
  );
}

/** A routine or webhook a bot just made: a live card with Edit · Pause · Undo. */
export function RoutineCard({ m }: { m: Message }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const info = m.routine!;
  const [gone, setGone] = useState(false);
  const live = state.routines.find((r) => r.id === info.id);
  const hook = state.webhooks.find((w) => w.id === info.id);
  const exists = info.webhook ? !!hook : !!live;
  const enabled = info.webhook ? hook?.enabled : live?.enabled;
  const base = info.webhook ? `/api/webhooks/${info.id}` : `/api/routines/${info.id}`;
  const act = (fn: () => Promise<unknown>) => void fn().catch(() => {});
  const Icon = info.webhook ? WebhookIcon : CalendarClock;
  if (gone || !exists) {
    return <div className="text-center text-[13px] text-ink-tertiary">{gone || exists === false ? t("Routine removed") : ""}</div>;
  }
  return (
    <div data-testid="routine-card" className="mx-auto flex w-full max-w-[460px] items-center gap-3 rounded-2xl bg-card px-3.5 py-2.5 ring-[0.5px] ring-ink/10">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary"><Icon size={15} /></span>
      <div className="min-w-0 flex-1">
        <div data-no-i18n="" className="truncate text-[14px] font-medium text-ink">{live?.name ?? hook?.name ?? info.name}</div>
        <div data-no-i18n="" className={cn("truncate text-[12.5px] text-ink-tertiary", enabled === false && "line-through")}>
          {info.webhook ? "Webhook" : live?.schedule ?? info.schedule}{enabled === false ? ` · ${t("Paused")}` : ""}
        </div>
      </div>
      <button type="button" title={t("Edit")} aria-label={t("Edit")} onClick={() => dispatch({ type: "automations", open: true })}
        className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><Pencil size={14} /></button>
      <button type="button" title={enabled === false ? t("Resume") : t("Pause")} aria-label={enabled === false ? t("Resume") : t("Pause")}
        onClick={() => act(() => api(base, { method: "PATCH", body: JSON.stringify({ enabled: enabled === false }) }))}
        className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10">{enabled === false ? <Play size={14} /> : <Pause size={14} />}</button>
      <button type="button" title={t("Undo")} aria-label={t("Undo")}
        onClick={() => act(async () => { await api(base, { method: "DELETE" }); setGone(true); })}
        className="rounded-full p-1.5 text-ink-secondary hover:bg-danger/10 hover:text-danger"><Undo2 size={14} /></button>
    </div>
  );
}
