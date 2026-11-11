"use client";
import { Bell, BellRing, Inbox as InboxIcon, Maximize2, Minimize2, Pin, PinOff, Trash2, X } from "lucide-react";
import { useState } from "react";
import { desktopAlertsOn, enableDesktopAlerts, DESKTOP_ALERTS_KEY } from "./useTeamBehaviors";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { InboxItem, Message, Notification, RequestInfo } from "@/lib/wire";
import { ApprovalDock, QuestionCard } from "./RequestCard";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { Mascot } from "./Mascot";

const KIND_LABEL: Record<string, [string, string]> = {
  approval: ["Approval", "text-warning"], question: ["Question", "text-warning"], turn_done: ["Done", "text-success"],
  assignment_failed: ["Failed", "text-danger"], routine_failed: ["Failed", "text-danger"], webhook_failed: ["Failed", "text-danger"],
};

function agoText(at: number): string {
  const m = Math.max(0, Math.floor((Date.now() - at) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} m ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  return `${Math.floor(m / 1440)} d ago`;
}

/** The notification log in a right-hand panel the person can pin open (same layout as the reference: filter, rows, footer). */
export function NotificationsPanel() {
  const { state, dispatch } = useStore();
  const t = useT();
  const [alerts, setAlerts] = useState(() => desktopAlertsOn());
  const [filter, setFilter] = useState("all");
  if (!state.notifOpen) return null;
  const toggleAlerts = async () => {
    if (alerts) { try { localStorage.setItem(DESKTOP_ALERTS_KEY, "0"); } catch { /* storage unavailable */ } setAlerts(false); return; }
    setAlerts(await enableDesktopAlerts());
  };
  const unread = state.notifications.filter((n) => !n.read).length;
  const shown = state.notifications.filter((n) => filter === "all" || n.targetId === filter);
  const open = async (n: Notification) => {
    void api("/api/notifications/read", { method: "POST", body: JSON.stringify({ ids: [n.id] }) }).catch(() => {});
    if (n.targetKind === "group" && state.groups.some((g) => g.id === n.targetId)) dispatch({ type: "selectGroup", id: n.targetId });
    else if (state.bots.some((b) => b.id === n.targetId)) {
      if (n.threadId) await api(`/api/bots/${n.targetId}`, { method: "PATCH", body: JSON.stringify({ threadId: n.threadId }) }).catch(() => {});
      dispatch({ type: "select", id: n.targetId });
    }
    if (!state.notifPinned) dispatch({ type: "notifPanel", open: false });
  };
  return (
    <aside aria-label={t("Notifications")} data-testid="notifications-panel"
      className="flex h-full w-[300px] shrink-0 flex-col border-l-[0.5px] border-edge bg-panel max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:shadow-xl">
      <div className="flex h-[44px] shrink-0 items-center gap-1 px-4">
        <h2 className="flex-1 text-[13px] font-medium text-ink">{t("Notifications")}</h2>
        <button type="button" disabled={!unread} onClick={() => void api("/api/notifications/read", { method: "POST", body: JSON.stringify({ all: true }) }).catch(() => {})}
          className="mr-1 text-[12.5px] text-accent-text hover:underline disabled:opacity-40">{t("Mark all read")}</button>
        <button type="button" title={state.notifPinned ? t("Unpin") : t("Pin open")} aria-label={state.notifPinned ? t("Unpin") : t("Pin open")} aria-pressed={state.notifPinned}
          onClick={() => dispatch({ type: "notifPanel", pinned: !state.notifPinned })} className="rounded-full p-1 text-ink-secondary hover:bg-ink/10">{state.notifPinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
        <button type="button" aria-label="Close" onClick={() => dispatch({ type: "notifPanel", open: false })} className="rounded-full p-1 text-ink-secondary hover:bg-ink/10"><X size={14} /></button>
      </div>
      <div className="shrink-0 border-y-[0.5px] border-edge px-2.5 py-2">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("Filter by bot")} className="h-9 w-full rounded-xl bg-raised px-3 text-[13.5px] text-ink">
          <option value="all">{t("All bots")}</option>
          {state.bots.filter((b) => !b.hidden).map((b) => <option key={b.id} value={b.id} data-no-i18n="">{b.name}</option>)}
          {state.groups.map((g) => <option key={g.id} value={g.id} data-no-i18n="">{g.name}</option>)}
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 && <div className="px-6 py-12 text-center text-[13.5px] text-ink-tertiary">{t("Nothing yet. Approvals, finished work and failed routines show up here.")}</div>}
        {shown.map((n) => {
          const bot = state.bots.find((b) => b.id === n.targetId);
          const who = bot?.name ?? state.groups.find((g) => g.id === n.targetId)?.name ?? "";
          const [label, tone] = KIND_LABEL[n.kind] ?? ["", ""];
          const what = who && n.title.startsWith(who) ? n.title.slice(who.length).trim() : n.title;
          return (
            <button key={n.id} type="button" data-testid="notification" onClick={() => open(n)}
              className={cn("flex w-full items-start gap-2.5 border-b-[0.5px] border-edge px-4 py-3 text-left hover:bg-raised/60", !n.read && "bg-accent/[0.05]")}>
              <span className="mt-0.5 shrink-0">{bot ? <Mascot color={bot.color} size={24} /> : <span className="flex size-6 items-center justify-center rounded-full bg-raised text-ink-secondary"><Bell size={12} /></span>}</span>
              <span className="min-w-0 flex-1 leading-[18px]">
                <span className="flex items-baseline gap-1.5">
                  <span data-no-i18n="" className="min-w-0 flex-1 truncate text-[13px] text-ink"><span className="font-medium">{who}</span> <span className="text-ink-tertiary">·</span> {what}</span>
                  {label && <span className={cn("shrink-0 text-[11.5px] font-medium", tone)}>{t(label)}</span>}
                </span>
                {n.body && <span data-no-i18n="" className="block truncate text-[12.5px] text-ink-secondary">{n.body}</span>}
                <span className="block text-[11.5px] text-ink-tertiary">{t(agoText(n.at))}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="relative flex h-[34px] shrink-0 items-center justify-center border-t-[0.5px] border-edge text-[12px] text-ink-tertiary">
        <button type="button" title={t("Desktop alerts")} aria-label={t("Desktop alerts")} aria-pressed={alerts} onClick={toggleAlerts}
          className={cn("absolute left-2 rounded-full p-1 hover:bg-ink/10", alerts ? "text-accent-text" : "text-ink-tertiary")}>{alerts ? <BellRing size={13} /> : <Bell size={13} />}</button>
        {t("Last 500 events, newest first")}
        <button type="button" title={t("Clear")} aria-label={t("Clear")} disabled={!state.notifications.length} onClick={() => void api("/api/notifications", { method: "DELETE" }).catch(() => {})}
          className="absolute right-2 rounded-full p-1 text-ink-tertiary hover:bg-ink/10 disabled:opacity-40"><Trash2 size={13} /></button>
      </div>
    </aside>
  );
}


/** A card waiting on the person, drawn with the same components as in the chat (so it looks, and answers, the same), under a line saying where it is from. */
function InboxCard({ item }: { item: InboxItem }) {
  const { state } = useStore();
  const t = useT();
  const bot = state.bots.find((b) => b.id === item.botId);
  if (!bot) return null;
  const req: RequestInfo = { id: item.requestId, type: item.type, tool: item.tool, summary: item.summary, command: item.command, cwd: item.cwd, canAlways: item.canAlways, status: "open",
    openedAt: item.openedAt, choices: item.choices, questions: item.questions };
  const msg: Message = { id: item.requestId, role: "bot", kind: "request", text: "", at: item.openedAt, request: req };
  return (
    <div data-testid="inbox-card" className="mb-3">
      <div className="mb-1.5 flex items-center gap-2 px-1 text-[12px] text-ink-tertiary">
        <span data-no-i18n="" className="min-w-0 flex-1 truncate">{item.botName}{item.groupName ? ` · ${item.groupName}` : ""}</span>
        <span className="tabular-nums">{t(agoText(item.openedAt))}</span>
      </div>
      {item.type === "permission" ? <ApprovalDock m={msg} thread={item.threadId} bot={bot} /> : <QuestionCard r={req} thread={item.threadId} active={false} bot={bot} />}
    </div>
  );
}

/** Every card waiting on the person, across all bots and rooms, answered in place: a right-hand panel like the reference's, which can be widened. */
export function InboxPanel() {
  const { state, dispatch } = useStore();
  const t = useT();
  const [wide, setWide] = useState(false);
  if (!state.inboxOpen) return null;
  return (
    <aside aria-label={t("Inbox")} data-testid="inbox-panel"
      className={cn("flex h-full shrink-0 flex-col border-l-[0.5px] border-edge bg-panel max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:shadow-xl", wide ? "w-[560px]" : "w-[320px]")}>
      <div className="flex h-[60px] shrink-0 items-center gap-2 px-5">
        <InboxIcon size={15} className="text-ink-secondary" />
        <h2 className="flex-1 text-[14px] font-medium text-ink">{t("Inbox")}</h2>
        <button type="button" title={t(wide ? "Narrow" : "Expand")} aria-label={t(wide ? "Narrow" : "Expand")} aria-pressed={wide} onClick={() => setWide((v) => !v)}
          className="flex size-8 items-center justify-center rounded-full bg-composer text-ink-secondary ring-1 ring-ink/10 hover:text-ink">{wide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        <button type="button" aria-label="Close" onClick={() => dispatch({ type: "inboxPanel", open: false })}
          className="flex size-8 items-center justify-center rounded-full bg-composer text-ink-secondary ring-1 ring-ink/10 hover:text-ink"><X size={14} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {state.inbox.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 px-6 pt-8 text-center">
            <InboxIcon size={20} className="mb-1 text-ink-tertiary" />
            <div className="text-[13.5px] font-semibold text-ink">{t("Nothing for you yet.")}</div>
            <div className="text-[12px] leading-[18px] text-ink-secondary">{t("When a bot needs your OK, has a question or finishes something, it shows up here.")}</div>
          </div>
        )}
        {state.inbox.map((it) => <InboxCard key={it.requestId} item={it} />)}
      </div>
    </aside>
  );
}
