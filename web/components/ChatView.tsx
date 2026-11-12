"use client";
import { ArrowDown, Check, ChevronLeft, ChevronRight, Copy, Menu, Monitor, Pencil, PanelRight, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Bot, Message } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { AttachmentGallery } from "./AttachmentGallery";
import { ChatErrorBanner } from "./ChatErrorBanner";
import { ChatFindBar } from "./ChatFindBar";
import { ChatMarkdown } from "./ChatMarkdown";
import { Composer } from "./Composer";
import { ApprovalDock, RequestCard } from "./RequestCard";
import { Mascot } from "./Mascot";
import { ModelMenu } from "./ModelMenu";
import { TaskMenu } from "./TaskMenu";
import { ToolChip } from "./ToolChip";
import { TurnPresence } from "./TurnPresence";
import { RoutineCard, ThreadRefCard, WaitingForTeammates } from "./TeamCards";

const FLOAT_PILL =
  "bg-composer ring-[0.5px] ring-ink/10 shadow-(--shadow-float) transition-colors duration-[120ms] hover:bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_7%)]";

function dayLabel(at: number): string {
  const d = new Date(at);
  const lang = locale();
  const time = d.toLocaleTimeString([lang], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return `Today ${time}`;
  return `${d.toLocaleDateString([lang], { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}

type Tail = "first" | "last" | "single" | "mid";
const groupable = (m?: Message) => m && m.kind === "text";
function tailOf(list: Message[], i: number): Tail {
  const prev = groupable(list[i - 1]) && list[i - 1].role === list[i].role;
  const next = groupable(list[i + 1]) && list[i + 1].role === list[i].role;
  return prev && next ? "mid" : prev ? "last" : next ? "first" : "single";
}

function IconButton({ title, onClick, children, disabled }: { title: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:bg-ink/10 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function BranchSwitcher({ m, thread, onSwitched }: { m: Message; thread: string; onSwitched: () => void }) {
  const sibs = m.siblings ?? [];
  if (sibs.length < 2) return null;
  const i = sibs.indexOf(m.id);
  const go = async (to: string) => {
    await api(`/api/threads/${thread}/leaf`, { method: "PUT", body: JSON.stringify({ messageId: to }) }).catch(() => {});
    onSwitched();
  };
  return (
    <div className="flex items-center gap-0.5 self-end pr-1 text-[12px] tabular-nums text-ink-tertiary">
      <IconButton title="Previous version" disabled={i <= 0} onClick={() => go(sibs[i - 1])}><ChevronLeft size={14} /></IconButton>
      {i + 1}/{sibs.length}
      <IconButton title="Next version" disabled={i >= sibs.length - 1} onClick={() => go(sibs[i + 1])}><ChevronRight size={14} /></IconButton>
    </div>
  );
}

function BatchTranscript({ bot, notice }: { bot: Bot; notice: Message }) {
  const { state, dispatch } = useStore();
  const threadId = notice.threadRef!.threadId!;
  const stored = state.messages[threadId];
  const messages = useMemo(() => stored ?? [], [stored]);
  const snapshot = useRef(messages);
  useLayoutEffect(() => { snapshot.current = messages; }, [messages]);
  const [error, setError] = useState(false);
  const generation = (state.reload[threadId] ?? 0) + (state.connected ? 1000 : 0);
  useEffect(() => {
    if (!state.connected) return;
    let cancelled = false;
    const beforeFetch = snapshot.current;
    void (async () => {
      let before = "";
      let all: Message[] = [];
      do {
        const page = await api<{ messages: Message[]; hasMore: boolean }>(`/api/bots/${bot.id}/messages?thread=${threadId}${before ? `&before=${before}` : ""}`);
        if (cancelled) return;
        all = [...page.messages, ...all];
        before = page.hasMore ? page.messages[0]?.id ?? "" : "";
      } while (before);
      dispatch({ type: "history", threadId, messages: all, hasMore: false, generation, snapshot: beforeFetch });
      setError(false);
    })().catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [bot.id, threadId, generation, state.connected, dispatch]);
  const busy = bot.tasks.some((task) => task.threadId === threadId && task.busy);
  const batchBot = { ...bot, threadId, threadBusy: busy };
  return (
    <section data-testid="batch-transcript" className="flex min-w-0 flex-col gap-3">
      <div className="whitespace-pre-line text-center text-[13px] text-ink-tertiary">{notice.text}</div>
      {error && <div role="alert" className="text-[13px] text-danger">Could not load chat history.</div>}
      {messages.map((m, i) => <Row key={m.id} bot={batchBot} list={messages} i={i} busy={busy} detailed />)}
      {busy && <TurnPresence bot={batchBot} hasLiveText={messages.some((m) => m.streaming)} />}
    </section>
  );
}

function Row({ bot, list, i, busy, detailed = false }: { bot: Bot; list: Message[]; i: number; busy: boolean; detailed?: boolean }) {
  const m = list[i];
  const { dispatch } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  const [copied, setCopied] = useState(false);
  const mine = m.role === "user";
  const tail = tailOf(list, i);

  if (m.kind === "activity" && m.tool) return <ToolChip tool={m.tool} detailed={detailed} />;
  if (m.kind === "error") return <ChatErrorBanner bot={bot} m={m} />;
  if (m.kind === "request") {
    const lastOpen = [...list].reverse().find((x) => x.kind === "request" && x.request?.status === "open");
    return <RequestCard m={m} thread={bot.threadId} active={lastOpen?.id === m.id} bot={bot} />;
  }
  if (m.kind === "routine" && m.routine) return <RoutineCard m={m} />;
  if (m.kind === "notice" && m.threadRef?.botId === bot.id && m.threadRef.threadId && m.threadRef.threadId !== bot.threadId) return <BatchTranscript bot={bot} notice={m} />;
  if (m.threadRef) return <ThreadRefCard m={m} />;
  if (m.kind === "stopped" || m.kind === "notice") {
    return <div className="text-center text-[13px] text-ink-tertiary">{m.text}</div>;
  }

  const branch = (text: string, parentId: string | null | undefined) =>
    api(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text, threadId: bot.threadId, branch: true, parentId: parentId ?? null }) })
      .catch(() => dispatch({ type: "frame", frame: { kind: "message", botId: bot.id, threadId: bot.threadId, message: { id: `err-${Date.now()}`, role: "bot", kind: "error", text: "The bot is still answering. Stop it first.", at: Date.now(), error: { setup: false, terminal: false } } } }));
  const retry = () => {
    const prev = [...list.slice(0, i)].reverse().find((x) => x.role === "user" && x.kind === "text");
    if (prev) void branch(prev.text, prev.parentId);
  };

  return (
    <div data-message-id={m.id} className={cn("group flex w-full flex-col rounded-xl transition-[background-color] duration-700", mine ? "items-end" : "items-start")}>
      <div className={cn("flex w-full items-center gap-1.5", mine ? "justify-end" : "justify-start")}>
        {mine && !editing && (
          <div className="flex items-center gap-0.5 self-end pb-0.5 opacity-0 transition-opacity group-hover:opacity-100 touch:opacity-100">
            <IconButton title="Edit" disabled={busy || m.pending} onClick={() => { setDraft(m.text); setEditing(true); }}><Pencil size={13} /></IconButton>
          </div>
        )}
        {editing ? (
          <div className="w-full max-w-[min(var(--chat-bubble-max),100%)] rounded-[18px] bg-composer p-2 ring-1 ring-ink/20">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (draft.trim()) { void branch(draft.trim(), m.parentId); setEditing(false); }
                }
              }}
              rows={Math.min(8, draft.split("\n").length + 1)}
              className="block w-full resize-none bg-transparent px-2 py-1 text-[15px] leading-[22px] text-ink outline-none"
            />
            <div className="flex justify-end gap-1.5 pt-1">
              <button type="button" onClick={() => setEditing(false)} className="rounded-full px-3 py-1 text-[13px] text-ink-secondary hover:bg-ink/10">Cancel</button>
              <button type="button" disabled={!draft.trim()} onClick={() => { void branch(draft.trim(), m.parentId); setEditing(false); }}
                className="rounded-full bg-accent px-3 py-1 text-[13px] text-[var(--color-accent-ink)] disabled:opacity-50">Send</button>
            </div>
          </div>
        ) : (
          <div
            data-no-i18n=""
            title={new Date(m.at).toLocaleString()}
            className={cn(
              "w-fit min-w-9 max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct),calc(100%-82px))] rounded-[18px] px-3 py-[7px] text-[15px] leading-[22px]",
              mine ? "bg-bubble-user text-[var(--color-bubble-user-ink)]" : "bg-card text-ink",
              mine && (tail === "last" || tail === "single") && "rounded-ee-[6px]",
              !mine && (tail === "last" || tail === "single") && "rounded-es-[6px]",
              (m.pending || m.queued) && "opacity-60",
            )}
          >
            {m.sender && (
              <div data-no-i18n="" className="mb-0.5 text-[11.5px] font-medium opacity-80">{m.sender}</div>
            )}
            {mine ? (
              <>
                {m.attachments && m.attachments.length > 0 && <AttachmentGallery items={m.attachments} />}
                {m.text && <div className="chat-text whitespace-pre-wrap break-words">{m.text}</div>}
              </>
            ) : (
              <>
                <ChatMarkdown text={m.text} />
                {m.streaming && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-caret bg-ink" />}
              </>
            )}
          </div>
        )}
        {!mine && !m.streaming && (
          <div className="flex items-center gap-0.5 self-end pb-0.5 opacity-0 transition-opacity group-hover:opacity-100 touch:opacity-100">
            <IconButton title={copied ? "Copied" : "Copy"} onClick={() => { void navigator.clipboard?.writeText(m.text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </IconButton>
            <IconButton title="Try again" disabled={busy} onClick={retry}><RotateCcw size={13} /></IconButton>
          </div>
        )}
        {m.queued && (
          <>
            <span className="self-end pb-1 text-[11px] text-ink-tertiary">Queued</span>
            <IconButton title="Remove from queue" onClick={() => api(`/api/bots/${bot.id}/queue/${m.id}?thread=${bot.threadId}`, { method: "DELETE" }).catch(() => {})}>
              <X size={13} />
            </IconButton>
          </>
        )}
        {!m.queued && !editing && (
          <span className="self-end pb-1 text-[11px] tabular-nums text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100 touch:opacity-100">
            {new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </span>
        )}
      </div>
      {mine && <BranchSwitcher m={m} thread={bot.threadId} onSwitched={() => dispatch({ type: "frame", frame: { kind: "thread", botId: bot.id, threadId: bot.threadId, activeLeafId: "" } })} />}
    </div>
  );
}

function Header({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const panelOpen = state.panelBotId === bot.id;
  return (
    <div className="absolute inset-x-0 top-0 z-[25] bg-gradient-to-b from-app via-app/90 to-transparent">
      <div className="px-5 pb-2.5 pt-2.5 max-md:pl-14 max-md:pr-3">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(max-content,1fr)] items-center max-md:flex max-md:justify-between">
          <button type="button" aria-label="Open bot list" onClick={() => dispatch({ type: "drawer", open: true })}
            className="-ml-2 rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink md:hidden">
            <Menu size={20} />
          </button>
          <div className="col-start-2 flex min-w-0 items-center justify-self-center">
            <TaskMenu bot={bot} face={<Mascot color={bot.color} size={28} busy={bot.threadBusy} />} />
          </div>
          <div className="col-start-3 flex shrink-0 items-center justify-self-end gap-2">
            <ModelMenu bot={bot} />
            <button type="button" title="Bot details" aria-label="Bot details" aria-pressed={panelOpen}
              onClick={() => dispatch({ type: "panel", botId: panelOpen ? null : bot.id })}
              className={cn("relative flex size-8 items-center justify-center rounded-full text-ink-secondary hover:text-ink", FLOAT_PILL, panelOpen && "text-ink")}>
              <PanelRight size={15} />
            </button>
            <button type="button" data-tour="computer" data-testid="open-computer" title="Bot's screen" aria-label="Bot's screen" aria-pressed={state.computerBotId === bot.id}
              onClick={() => dispatch({ type: "computer", botId: state.computerBotId === bot.id ? null : bot.id })}
              className={cn("relative flex size-8 items-center justify-center rounded-full text-ink-secondary hover:text-ink", FLOAT_PILL, state.computerBotId === bot.id && "text-ink")}>
              <Monitor size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatView({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const thread = bot.threadId;
  const stored = state.messages[thread];
  const messages = useMemo(() => stored ?? [], [stored]);
  const hasMore = state.hasMore[thread] ?? false;
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const loadingOlder = useRef(false);

  useEffect(() => {
    if (bot.unread) api(`/api/bots/${bot.id}/read`, { method: "POST" }).catch(() => {});
  }, [bot.id, bot.unread, messages.length]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, state.messages, bot.threadBusy, thread]);

  const loadOlder = useCallback(async () => {
    const first = messages[0];
    if (!first || loadingOlder.current) return;
    loadingOlder.current = true;
    const el = scroller.current;
    const before = el?.scrollHeight ?? 0;
    try {
      const r = await api<{ messages: Message[]; hasMore: boolean }>(`/api/bots/${bot.id}/messages?thread=${thread}&before=${first.id}`);
      dispatch({ type: "older", threadId: thread, messages: r.messages, hasMore: r.hasMore });
      requestAnimationFrame(() => { if (el) el.scrollTop += el.scrollHeight - before; });
    } finally {
      loadingOlder.current = false;
    }
  }, [messages, bot.id, thread, dispatch]);

  // A search hit scrolls its message into view and flashes it.
  const focus = state.focusMessage;
  useEffect(() => {
    if (!focus || focus.threadId !== thread) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-message-id="${focus.messageId}"]`);
    if (!el) return;
    stick.current = false;
    el.scrollIntoView({ block: "center" });
    el.classList.add("bg-accent/20");
    const t = setTimeout(() => { el.classList.remove("bg-accent/20"); dispatch({ type: "focusMessage", target: null }); }, 2200);
    return () => clearTimeout(t);
  }, [focus, thread, messages.length, dispatch]);

  const openApproval = useMemo(() => [...messages].reverse().find((m) => m.kind === "request" && m.request?.status === "open" && m.request.type === "permission"), [messages]);
  const dividerAt = state.dividerAt[bot.id] ?? 0;
  const dividerIndex = dividerAt > 0 ? messages.findIndex((m) => m.role === "bot" && m.at > dividerAt) : -1;
  const liveText = messages.some((m) => m.streaming);
  const detailed = messages.some((m) => m.role === "user" && /^(telegram|zalo) /.test(m.sender ?? ""));

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col bg-app">
      <div className="relative min-h-0 flex-1">
        <Header bot={bot} />
        {state.findOpen && <ChatFindBar scroller={scroller} messages={messages} />}
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            stick.current = near;
            setAtBottom(near);
            if (el.scrollTop < 240 && hasMore) void loadOlder();
          }}
          className={cn("h-full overflow-y-auto overflow-x-hidden overscroll-y-contain px-5 pt-14 [overflow-anchor:none]", openApproval ? "pb-72" : "pb-32")}
        >
          <div role="log" aria-label={`Conversation with ${bot.name}`} className="chat-column relative flex w-full flex-col gap-3">
            {hasMore && <div className="py-2 text-center text-[13px] text-ink-tertiary">Loading earlier messages…</div>}
            {messages.length > 0 && (
              <div className="pb-1 pt-5 text-center text-[13px] leading-[18px] text-ink-secondary">{dayLabel(messages[0].at)}</div>
            )}
            {messages.length === 0 && <div className="py-20 text-center text-[14px] text-ink-secondary">{`Say hello to ${bot.name}.`}</div>}
            {messages.map((m, i) => {
              const group = tailOf(messages, i);
              return (
                <div
                  key={m.id}
                  className={cn(
                    "flex flex-col gap-3",
                    (group === "last" || group === "mid") && "-mt-2",
                    i < messages.length - 12 && "[contain-intrinsic-size:auto_64px] [content-visibility:auto]",
                  )}
                >
                  {i === dividerIndex && (
                    <div role="separator" className="flex items-center gap-3 py-1 text-[12px] font-medium text-accent-text">
                      <span className="h-px flex-1 bg-accent/40" /> New <span className="h-px flex-1 bg-accent/40" />
                    </div>
                  )}
                  <Row bot={bot} list={messages} i={i} busy={bot.threadBusy} detailed={detailed} />
                </div>
              );
            })}
            {bot.threadBusy && !bot.waitingFor?.length && <TurnPresence bot={bot} hasLiveText={liveText} />}
            <WaitingForTeammates bot={bot} />
          </div>
        </div>
        {!atBottom && (
          <button
            type="button"
            aria-label="Scroll to latest"
            onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })}
            className={cn("absolute bottom-24 left-1/2 z-[3] flex size-9 -translate-x-1/2 items-center justify-center rounded-full text-ink", FLOAT_PILL)}
          >
            <ArrowDown size={16} />
          </button>
        )}
        <Composer bot={bot} dock={openApproval ? <ApprovalDock m={openApproval} thread={bot.threadId} bot={bot} /> : undefined} />
      </div>
    </main>
  );
}
