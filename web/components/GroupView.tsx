"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the draft is read from localStorage when the room changes */
import { ArrowUp, Menu, PanelRight, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Bot, Group, Message } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { ChatMarkdown } from "./ChatMarkdown";
import { GroupAvatar } from "./GroupAvatar";
import { mentionParts } from "@/lib/team";
import { MentionEditor } from "./MentionEditor";
import { Mascot } from "./Mascot";
import { ApprovalDock, RequestCard } from "./RequestCard";
import { RoomPanel } from "./RoomPanel";
import { ThreadRefCard, RoutineCard } from "./TeamCards";
import { ToolChip } from "./ToolChip";

const FLOAT_PILL = "bg-composer ring-[0.5px] ring-ink/10 shadow-(--shadow-float) transition-colors duration-[120ms] hover:bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_7%)]";

function RoomHeader({ group }: { group: Group }) {
  const { state, dispatch } = useStore();
  const open = state.groupPanelId === group.id;
  return (
    <div className="absolute inset-x-0 top-0 z-[25] bg-gradient-to-b from-app via-app/90 to-transparent">
      <div className="px-5 pb-2.5 pt-2.5 max-md:pl-14 max-md:pr-3">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(max-content,1fr)] items-center max-md:flex max-md:justify-between">
          <button type="button" aria-label="Open bot list" onClick={() => dispatch({ type: "drawer", open: true })}
            className="-ml-2 rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink md:hidden"><Menu size={20} /></button>
          <div className="col-start-1 row-start-1 flex min-w-0 items-center justify-self-start">
            <div data-no-i18n="" className="truncate text-[15px] font-medium text-ink" title={group.memberInfo.map((m) => m.name).join(", ")}>{group.name}</div>
          </div>
          <div className="col-start-3 flex shrink-0 items-center justify-self-end gap-2">
            <GroupAvatar members={group.memberInfo} size={32} />
            <button type="button" title="Room details" aria-label="Room details" aria-pressed={open}
              onClick={() => dispatch({ type: "groupPanel", id: open ? null : group.id })}
              className={cn("relative flex size-8 items-center justify-center rounded-full text-ink-secondary hover:text-ink", FLOAT_PILL, open && "text-ink")}>
              <PanelRight size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RoomMessage({ group, list, i }: { group: Group; list: Message[]; i: number }) {
  const { state } = useStore();
  const m = list[i];
  const mine = m.role === "user";
  const author = m.author ? state.bots.find((b) => b.id === m.author) : undefined;
  if (m.kind === "activity" && m.tool) return <ToolChip tool={m.tool} />;
  if (m.kind === "request") {
    const lastOpen = [...list].reverse().find((x) => x.kind === "request" && x.request?.status === "open");
    return author ? <RequestCard m={m} thread={group.threadId} active={lastOpen?.id === m.id} bot={author} /> : null;
  }
  if (m.kind === "routine" && m.routine) return <RoutineCard m={m} />;
  if (m.threadRef) return <ThreadRefCard m={m} />;
  if (m.kind === "stopped" || m.kind === "notice") return <div className="text-center text-[13px] text-ink-tertiary">{m.text}</div>;
  if (m.kind === "error") return <div role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-[13.5px] text-danger">{m.text}</div>;
  const prev = list[i - 1];
  const sameAuthor = prev && prev.kind === "text" && prev.role === m.role && prev.author === m.author;
  const members = group.memberInfo;
  return (
    <div data-message-id={m.id} className={cn("group flex w-full gap-2", mine ? "justify-end" : "justify-start")}>
      <div className={cn("flex min-w-0 max-w-[min(var(--chat-bubble-max),100%)] flex-col", mine ? "items-end" : "items-start")}>
        {!mine && !sameAuthor && (
          <span data-no-i18n="" className="mb-1 flex items-center gap-1 px-0.5 text-[11px] font-medium" style={{ color: `var(--identity-${author?.color ?? "green"})` }}>
            {author && <Mascot color={author.color} size={14} />}
            {author?.name ?? m.sender ?? "Bot"}{author?.id === group.leader && <span className="ml-1 text-ink-tertiary">· leader</span>}
          </span>
        )}
        <div data-no-i18n="" title={new Date(m.at).toLocaleString()}
          className={cn("w-fit min-w-9 rounded-[18px] px-3 py-[7px] text-[15px] leading-[22px]", mine ? "bg-bubble-user text-[var(--color-bubble-user-ink)]" : "bg-card text-ink", (m.pending || m.queued) && "opacity-60")}>
          {mine ? (
            <div className="chat-text whitespace-pre-wrap break-words">
              {mentionParts(m.text, members).map((p, k) => p.member
                ? <span key={k} className="mention-highlight">{p.text}</span>
                : <span key={k}>{p.text}</span>)}
            </div>
          ) : (
            <>
              <ChatMarkdown text={m.text} />
              {m.streaming && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-caret bg-ink" />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function QueueStrip({ group }: { group: Group }) {
  const t = useT();
  if (!group.queue.length) return null;
  const why: Record<string, string> = { mention: "mentioned", leader: "leader", auto: "chosen", chained: "handed over" };
  return (
    <div data-testid="room-queue" className="mb-2 flex flex-wrap items-center gap-1.5 px-1 text-[12.5px] text-ink-secondary">
      <span className="text-ink-tertiary">{t("Turn order")}</span>
      {group.queue.map((q, i) => (
        <span key={q.id} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 ring-1 ring-ink/10", q.state === "running" ? "bg-accent/15 text-ink" : "bg-ink/[0.05]")}>
          <span className="tabular-nums text-ink-tertiary">{i + 1}</span>
          <span data-no-i18n="">{q.name}</span>
          <span className="text-ink-tertiary">{q.state === "running" ? t("answering") : t(why[q.reason] ?? q.reason)}</span>
        </span>
      ))}
    </div>
  );
}

function RoomComposer({ group, dock }: { group: Group; dock?: React.ReactNode }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const key = `botteam-draft:${group.threadId}`;
  const [text, setText] = useState("");
  useEffect(() => {
    try { setText(localStorage.getItem(key) ?? ""); } catch { setText(""); }
  }, [key]);
  const save = (v: string) => {
    setText(v);
    try { if (v) localStorage.setItem(key, v); else localStorage.removeItem(key); } catch { /* storage unavailable */ }
  };
  const members = group.memberInfo;
  const send = async () => {
    const body = text.trim();
    if (!body) return;
    const sendId = crypto.randomUUID();
    save("");
    dispatch({ type: "optimistic", threadId: group.threadId, message: { id: `pending-${sendId}`, sendId, role: "user", kind: "text", text: body, at: Date.now(), pending: true } });
    try {
      await api(`/api/groups/${group.id}/messages`, { method: "POST", body: JSON.stringify({ text: body, sendId, threadId: group.threadId }) });
    } catch {
      dispatch({ type: "optimisticFailed", threadId: group.threadId, sendId });
      save(body);
    }
  };
  void state;
  const round = "flex size-7 shrink-0 items-center justify-center rounded-full";
  return (
    <div className="chat-column-dock pointer-events-none absolute inset-x-0 bottom-0 z-[2]">
      <div className="pointer-events-none relative px-5 pb-4">
        <div className="pointer-events-auto relative w-full">
          <div className="pointer-events-none absolute -left-5 -right-5 -bottom-4 top-0 bg-app" />
          {dock && <div className="relative z-[1]">{dock}</div>}
          <div className="relative z-[1]"><QueueStrip group={group} /></div>
          <div className="relative z-[1] rounded-[22px] bg-composer p-2 ring-[0.5px] ring-ink/10 hover:ring-ink/[0.22] focus-within:ring-ink/[0.22]">
            <div className="flex items-end gap-1.5">
              <MentionEditor value={text} onChange={save} onSubmit={send} members={members} disabled={!!dock} label={`Message ${group.name}`}
                placeholder={dock ? t("Answer the approval above to continue") : `${t("Message")} ${group.name}`} />
              {group.busy && !text.trim() ? (
                <button type="button" title="Stop" aria-label="Stop" onClick={() => api(`/api/groups/${group.id}/interrupt`, { method: "POST" })} className={cn(round, "bg-ink text-app")}>
                  <Square size={11} fill="currentColor" />
                </button>
              ) : (
                <button type="button" title="Send" aria-label="Send" disabled={!text.trim()} onClick={send} className={cn(round, "bg-accent text-[var(--color-accent-ink)] disabled:opacity-40")}>
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GroupView({ group }: { group: Group }) {
  const { state, dispatch } = useStore();
  const thread = group.threadId;
  const stored = state.messages[thread];
  const messages = useMemo(() => stored ?? [], [stored]);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (group.unread) api(`/api/groups/${group.id}/read`, { method: "POST" }).catch(() => {});
  }, [group.id, group.unread, messages.length]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, group.busy, thread]);

  const openApproval = useMemo(() => [...messages].reverse().find((m) => m.kind === "request" && m.request?.status === "open" && m.request.type === "permission"), [messages]);
  const approver: Bot | undefined = openApproval?.author ? state.bots.find((b) => b.id === openApproval.author) : undefined;
  const running = group.queue.find((q) => q.state === "running");
  const runner = running ? state.bots.find((b) => b.id === running.botId) : undefined;
  void dispatch;

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col bg-app" data-testid="group-view">
      <div className="relative min-h-0 flex-1">
        <RoomHeader group={group} />
        <div ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
          className={cn("h-full overflow-y-auto overflow-x-hidden overscroll-y-contain px-5 pt-14 [overflow-anchor:none]", openApproval ? "pb-80" : "pb-40")}>
          <div role="log" aria-label={`Room ${group.name}`} className="chat-column relative flex w-full flex-col gap-3">
            {messages.length === 0 && <div className="py-20 text-center text-[14px] text-ink-secondary">{`Start the conversation in ${group.name}. Use @ to ask a member.`}</div>}
            {messages.map((m, i) => <RoomMessage key={m.id} group={group} list={messages} i={i} />)}
            {runner && (
              <div role="status" aria-live="polite" className="flex items-center gap-2 py-1 text-[13px] text-ink-secondary">
                <Mascot color={runner.color} size={22} busy />
                <span className="thinking-shimmer">{`${runner.name} is answering…`}</span>
              </div>
            )}
          </div>
        </div>
        <RoomComposer group={group} dock={openApproval && approver ? <ApprovalDock m={openApproval} thread={thread} bot={approver} /> : undefined} />
      </div>
    </main>
  );
}

export function GroupPanelHost({ group }: { group: Group }) {
  const { state } = useStore();
  return state.groupPanelId === group.id ? <RoomPanel key={group.id} group={group} /> : null;
}

