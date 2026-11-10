"use client";
import { ChevronRight, MessageSquare, Pencil, Pin, PinOff, Plus, Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Bot } from "@/lib/wire";
import { api } from "@/state/api";

const FLOAT_PILL =
  "bg-composer ring-[0.5px] ring-ink/10 shadow-(--shadow-float) transition-colors duration-[120ms] hover:bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_7%)]";

/** The header pill: the bot's face and name; opens the bot's conversations (its main chat and its tasks). */
export function TaskMenu({ bot, face }: { bot: Bot; face: ReactNode }) {
  const [open, setOpen] = useState(false);
  const active = bot.tasks.find((t) => t.threadId === bot.threadId);
  const away = active && !active.main;
  const go = (threadId: string) => {
    void api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ threadId }) });
    setOpen(false);
  };
  const tasks = bot.tasks.filter((t) => !t.closed);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        title="Details and conversations"
        className={cn("group flex min-w-0 max-w-full items-center gap-2 rounded-full py-[7.5px] pl-[7.5px] pr-[13.5px] text-ink", FLOAT_PILL)}
      >
        {face}
        <span dir="auto" className="min-w-0 truncate text-[14px] font-medium leading-5">{bot.name}</span>
        {away && <span className="min-w-0 max-w-[10rem] truncate text-[13px] text-ink-secondary">· {active.title || "New task"}</span>}
        <ChevronRight size={14} className={cn("-ml-0.5 shrink-0 text-ink-secondary transition-transform", open && "rotate-90")} />
      </PopoverTrigger>
      <PopoverContent align="center" className="w-[320px] gap-0 rounded-xl bg-menu p-1.5 text-ink ring-1 ring-ink/10">
        <div className="px-2.5 pb-1 pt-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">Conversations</div>
        {tasks.map((t) => (
          <div key={t.threadId} className={cn("group/row flex items-center gap-1 rounded-md pr-1 hover:bg-menu-hover", t.threadId === bot.threadId && "bg-ink/[0.05]")}>
            <button type="button" onClick={() => go(t.threadId)} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-[14px]">
              <MessageSquare size={14} className="shrink-0 text-ink-secondary" />
              <span className="min-w-0 flex-1 truncate">{t.main ? "Main conversation" : t.title || "New task"}</span>
              {t.busy && <span title="Working" className="size-2 shrink-0 animate-pulse rounded-full bg-accent" />}
              {t.pinned && <Pin size={11} className="shrink-0 text-ink-tertiary" />}
            </button>
            {!t.main && (
              <span className="flex opacity-0 transition-opacity group-hover/row:opacity-100 touch:opacity-100">
                <RowButton title={t.pinned ? "Unpin" : "Pin"} onClick={() => api(`/api/bots/${bot.id}/tasks/${t.threadId}`, { method: "PATCH", body: JSON.stringify({ pinned: !t.pinned }) })}>
                  {t.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                </RowButton>
                <RowButton title="Rename" onClick={() => {
                  const title = window.prompt("Rename task", t.title);
                  if (title?.trim()) void api(`/api/bots/${bot.id}/tasks/${t.threadId}`, { method: "PATCH", body: JSON.stringify({ title: title.trim() }) });
                }}>
                  <Pencil size={13} />
                </RowButton>
                <RowButton title="Close" onClick={() => api(`/api/bots/${bot.id}/tasks/${t.threadId}`, { method: "PATCH", body: JSON.stringify({ closed: true }) })}>
                  <X size={13} />
                </RowButton>
                <RowButton title="Delete" danger onClick={() => {
                  if (window.confirm(`Delete "${t.title || "this task"}"?`)) void api(`/api/bots/${bot.id}/tasks/${t.threadId}`, { method: "DELETE" });
                }}>
                  <Trash2 size={13} />
                </RowButton>
              </span>
            )}
          </div>
        ))}
        <div className="my-1 border-t border-ink/10" />
        <button
          type="button"
          onClick={async () => {
            await api(`/api/bots/${bot.id}/tasks`, { method: "POST", body: JSON.stringify({}) });
            setOpen(false);
          }}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[14px] hover:bg-menu-hover"
        >
          <Plus size={14} className="text-ink-secondary" /> New task
        </button>
      </PopoverContent>
    </Popover>
  );
}

function RowButton({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn("flex size-7 items-center justify-center rounded-md text-ink-secondary hover:bg-ink/10 hover:text-ink", danger && "hover:text-danger")}
    >
      {children}
    </button>
  );
}
