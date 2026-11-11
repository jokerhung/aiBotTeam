"use client";
import { Bell, BellRing, Check, Inbox as InboxIcon, Pin, PinOff, Trash2, X } from "lucide-react";
import { useState } from "react";
import { desktopAlertsOn, enableDesktopAlerts, DESKTOP_ALERTS_KEY } from "./useTeamBehaviors";
import { locale, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { InboxItem, Notification, RequestQuestion } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { Mascot } from "./Mascot";

const optionLabel = (o: NonNullable<RequestQuestion["options"]>[number]) => (typeof o === "string" ? o : o.label);

function ago(at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(at).toLocaleDateString([locale()], { month: "short", day: "numeric" });
}

/** The notification log in a right-hand panel the person can pin open. */
export function NotificationsPanel() {
  const { state, dispatch } = useStore();
  const t = useT();
  const [alerts, setAlerts] = useState(() => desktopAlertsOn());
  if (!state.notifOpen) return null;
  const toggleAlerts = async () => {
    if (alerts) { try { localStorage.setItem(DESKTOP_ALERTS_KEY, "0"); } catch { /* storage unavailable */ } setAlerts(false); return; }
    setAlerts(await enableDesktopAlerts());
  };
  const unread = state.notifications.filter((n) => !n.read).length;
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
      className="flex h-full w-[340px] shrink-0 flex-col border-l-[0.5px] border-edge bg-panel max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:shadow-xl">
      <div className="flex items-center gap-1 px-4 pb-2 pt-4">
        <h2 className="flex-1 text-[15px] font-medium text-ink">{t("Notifications")}{unread > 0 && <span className="ml-2 rounded-full bg-accent px-1.5 text-[11px] text-[var(--color-accent-ink)]">{unread}</span>}</h2>
        <button type="button" title={t("Desktop alerts")} aria-label={t("Desktop alerts")} aria-pressed={alerts} onClick={toggleAlerts}
          className={cn("rounded-full p-1.5 hover:bg-ink/10", alerts ? "text-accent-text" : "text-ink-secondary")}>{alerts ? <BellRing size={14} /> : <Bell size={14} />}</button>
        <button type="button" title={state.notifPinned ? t("Unpin") : t("Pin open")} aria-label={state.notifPinned ? t("Unpin") : t("Pin open")} aria-pressed={state.notifPinned}
          onClick={() => dispatch({ type: "notifPanel", pinned: !state.notifPinned })} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10">{state.notifPinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
        <button type="button" title={t("Mark all read")} aria-label={t("Mark all read")} disabled={!unread} onClick={() => void api("/api/notifications/read", { method: "POST", body: JSON.stringify({ all: true }) }).catch(() => {})}
          className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10 disabled:opacity-40"><Check size={14} /></button>
        <button type="button" title={t("Clear")} aria-label={t("Clear")} disabled={!state.notifications.length} onClick={() => void api("/api/notifications", { method: "DELETE" }).catch(() => {})}
          className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10 disabled:opacity-40"><Trash2 size={14} /></button>
        <button type="button" aria-label="Close" onClick={() => dispatch({ type: "notifPanel", open: false })} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><X size={14} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {state.notifications.length === 0 && <div className="py-12 text-center text-[13.5px] text-ink-tertiary">{t("Nothing yet. Approvals, finished work and failed routines show up here.")}</div>}
        {state.notifications.map((n) => {
          const bot = state.bots.find((b) => b.id === n.targetId);
          return (
            <button key={n.id} type="button" data-testid="notification" onClick={() => open(n)} className={cn("flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-raised/60", !n.read && "bg-accent/[0.06]")}>
              <span className="mt-0.5 shrink-0">{bot ? <Mascot color={bot.color} size={28} /> : <span className="flex size-7 items-center justify-center rounded-full bg-raised text-ink-secondary"><Bell size={13} /></span>}</span>
              <span className="min-w-0 flex-1">
                <span data-no-i18n="" className="block truncate text-[13.5px] font-medium text-ink">{n.title}</span>
                {n.body && <span data-no-i18n="" className="line-clamp-2 text-[12.5px] leading-4 text-ink-secondary">{n.body}</span>}
              </span>
              <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-ink-tertiary">{ago(n.at)}</span>
              {!n.read && <span aria-label="Unread" className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function InboxCard({ item }: { item: InboxItem }) {
  const { dispatch } = useStore();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const send = async (body: object) => {
    setBusy(true);
    await api(`/api/threads/${item.threadId}/requests/${item.requestId}`, { method: "POST", body: JSON.stringify(body) }).catch(() => {});
    dispatch({ type: "teamData", inbox: await api<{ items: InboxItem[] }>("/api/inbox").then((r) => r.items).catch(() => []) });
    setBusy(false);
  };
  const q = item.questions[0] ?? { question: item.summary, options: item.choices };
  const where = item.groupName ?? item.botName;
  return (
    <div data-testid="inbox-card" className="mb-2 rounded-2xl bg-card p-3 ring-[0.5px] ring-ink/10">
      <div className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
        <Mascot color={item.botColor} size={18} />
        <span data-no-i18n="" className="min-w-0 flex-1 truncate">{item.botName}{item.groupName ? ` · ${item.groupName}` : ""}</span>
        <span className="tabular-nums text-ink-tertiary">{ago(item.openedAt)}</span>
      </div>
      {item.type === "permission" ? (
        <>
          <div className="mt-1.5 text-[13.5px] text-ink">{item.command ? t("wants to run a command") : `${t("wants to use")} ${item.tool}`}</div>
          <pre data-no-i18n="" className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-inset px-2.5 py-1.5 font-mono text-[12px] text-ink-secondary">{item.command ?? item.summary}</pre>
          <div className="mt-2.5 flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => send({ behavior: "deny", message: "Denied from the inbox" })} className="h-8 rounded-full bg-raised px-3.5 text-[13px] font-medium text-ink hover:bg-raised-hover disabled:opacity-50">{t("Deny")}</button>
            <button type="button" disabled={busy} onClick={() => send({ behavior: "allow" })} className="h-8 rounded-full bg-accent px-3.5 text-[13px] font-medium text-[var(--color-accent-ink)] disabled:opacity-50">{t("Allow once")}</button>
          </div>
        </>
      ) : (
        <>
          <div data-no-i18n="" className="mt-1.5 text-[14px] font-medium text-ink">{q.question}</div>
          <div className="mt-2 flex flex-col gap-1.5">
            {(q.options ?? []).map((o, i) => (
              <button key={i} type="button" disabled={busy} onClick={() => send({ behavior: "allow", message: optionLabel(o), answers: { [q.question]: optionLabel(o) } })}
                className="min-h-9 rounded-xl px-3 py-1.5 text-left text-[13.5px] text-ink ring-[0.5px] ring-ink/15 hover:bg-ink/[0.04] disabled:opacity-60"><span data-no-i18n="">{optionLabel(o)}</span></button>
            ))}
          </div>
          <div className="mt-2 flex h-9 items-center rounded-xl bg-ink/[0.045] pl-3 pr-1">
            <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={t("Type your own answer")} placeholder={t("Type your own answer")}
              onKeyDown={(e) => { if (e.key === "Enter" && typed.trim() && !e.nativeEvent.isComposing) void send({ behavior: "allow", message: typed.trim(), answers: { [q.question]: typed.trim() } }); }}
              className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-tertiary" />
          </div>
        </>
      )}
      <span className="sr-only">{where}</span>
    </div>
  );
}

/** Every card waiting on the person, across all bots and rooms, answered in place. */
export function InboxPanel() {
  const { state, dispatch } = useStore();
  const t = useT();
  if (!state.inboxOpen) return null;
  return (
    <main data-testid="inbox-panel" className="relative flex h-full min-w-0 flex-1 flex-col bg-app">
      <header className="flex shrink-0 items-center gap-3 px-5 py-3 max-md:pl-14">
        <InboxIcon size={18} className="text-accent-text" />
        <h1 className="text-[18px] font-semibold text-ink">{t("Inbox")}</h1>
        <span className="text-[13px] text-ink-tertiary">{t("Everything waiting on you")}</span>
        <button type="button" aria-label="Close" onClick={() => dispatch({ type: "inboxPanel", open: false })} className="ml-auto rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><X size={16} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <div className="mx-auto w-full max-w-[640px]">
          {state.inbox.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-24 text-center text-ink-secondary">
              <BellRing size={28} className="text-ink-tertiary" />
              <div className="text-[15px]">{t("Nothing is waiting on you.")}</div>
            </div>
          )}
          {state.inbox.map((it) => <InboxCard key={it.requestId} item={it} />)}
        </div>
      </div>
    </main>
  );
}
