"use client";
import { BellDot, Copy, CopyPlus, Crown, EyeOff, FolderPlus, MoreHorizontal, Pencil, Pin, PinOff, Trash2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Bot, Section } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { toast } from "./Toaster";

const patch = (id: string, body: object) => api(`/api/bots/${id}`, { method: "PATCH", body: JSON.stringify(body) });

type Entry = { key: string; label: string; icon: LucideIcon; run: () => void; danger?: boolean } | "sep";

/** Delete with a short undo: the bot disappears at once and is only really removed when the toast times out. */
export function deleteBotWithUndo(bot: Bot, hide: (id: string, hidden: boolean) => void) {
  hide(bot.id, true);
  toast(`Deleted ${bot.name}`, {
    undoLabel: "Undo",
    ms: 6000,
    onUndo: () => hide(bot.id, false),
    onExpire: () => { void api(`/api/bots/${bot.id}`, { method: "DELETE" }).catch(() => hide(bot.id, false)); },
  });
}

export function useBotMenu(bot: Bot) {
  const { state, dispatch } = useStore();
  const sections: Section[] = state.sections;
  const hideLocal = (id: string, hidden: boolean) => {
    const b = state.bots.find((x) => x.id === id);
    if (b) dispatch({ type: "frame", frame: { kind: "bot", bot: { ...b, hidden } } });
  };
  const newSection = async () => {
    const name = window.prompt("Name of the new section");
    if (!name?.trim()) return;
    const sec = await api<Section>("/api/sidebar-sections", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
    await api(`/api/bots/${bot.id}/move`, { method: "POST", body: JSON.stringify({ section: sec.id }) });
  };
  const entries: Entry[] = [
    { key: "pin", label: bot.pinned ? "Unpin" : "Pin", icon: bot.pinned ? PinOff : Pin, run: () => void patch(bot.id, { pinned: !bot.pinned }) },
    { key: "chief", label: bot.chief ? "Remove as Chief of Staff" : "Make Chief of Staff", icon: Crown, run: () => void patch(bot.id, { chief: !bot.chief }) },
    { key: "section", label: "Move to new section", icon: FolderPlus, run: () => void newSection() },
    ...sections.filter((s) => s.id !== bot.section).map((s): Entry => ({
      key: `to-${s.id}`, label: `Move to ${s.name}`, icon: FolderPlus,
      run: () => void api(`/api/bots/${bot.id}/move`, { method: "POST", body: JSON.stringify({ section: s.id }) }),
    })),
    ...(bot.section ? [{ key: "unsection", label: "Remove from section", icon: FolderPlus, run: () => void api(`/api/bots/${bot.id}/move`, { method: "POST", body: JSON.stringify({ section: null }) }) } as Entry] : []),
    { key: "unread", label: bot.unread ? "Mark as Read" : "Mark as Unread", icon: BellDot, run: () => void patch(bot.id, { unread: !bot.unread }) },
    "sep",
    { key: "edit", label: "Edit Profile", icon: Pencil, run: () => { dispatch({ type: "select", id: bot.id }); dispatch({ type: "panel", botId: bot.id }); } },
    { key: "dup", label: "Duplicate", icon: CopyPlus, run: () => void api<{ id: string }>(`/api/bots/${bot.id}/duplicate`, { method: "POST" }).then((b) => dispatch({ type: "select", id: b.id })) },
    "sep",
    { key: "copy", label: "Copy conversation ID", icon: Copy, run: () => void navigator.clipboard?.writeText(bot.threadId) },
    "sep",
    { key: "hide", label: "Hide from sidebar", icon: EyeOff, run: () => void patch(bot.id, { hidden: true }) },
    { key: "delete", label: "Delete", icon: Trash2, danger: true, run: () => deleteBotWithUndo(bot, hideLocal) },
  ];
  return entries;
}

const MENU = "w-[228px] rounded-xl border border-hairline bg-menu p-1.5 text-ink";
const ITEM = "h-[37px] gap-3 px-[9px] text-[15px] [&_svg]:size-4";

export function BotContextMenu({ bot, children }: { bot: Bot; children: ReactNode }) {
  const entries = useBotMenu(bot);
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div />}>{children}</ContextMenuTrigger>
      <ContextMenuContent className={MENU}>
        {entries.map((e, i) =>
          e === "sep" ? (
            <ContextMenuSeparator key={`s${i}`} />
          ) : (
            <ContextMenuItem key={e.key} className={cn(ITEM, e.danger && "text-danger focus:text-danger")} onClick={e.run}>
              <e.icon />
              {e.label}
            </ContextMenuItem>
          ),
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The same menu behind the row's "Actions for {bot}" button, for touch and keyboard. */
export function BotActionsButton({ bot, className }: { bot: Bot; className?: string }) {
  const entries = useBotMenu(bot);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${bot.name}`}
        title={`Actions for ${bot.name}`}
        className={cn("flex size-7 items-center justify-center rounded-full text-ink-secondary hover:bg-ink/10 hover:text-ink aria-expanded:bg-ink/10", className)}
      >
        <MoreHorizontal size={16} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={MENU}>
        {entries.map((e, i) =>
          e === "sep" ? (
            <DropdownMenuSeparator key={`s${i}`} />
          ) : (
            <DropdownMenuItem key={e.key} className={cn(ITEM, e.danger && "text-danger focus:text-danger")} onClick={e.run}>
              <e.icon />
              {e.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
