"use client";
import { BellDot, Copy, EyeOff, Pin, PinOff, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { Bot } from "@/lib/wire";
import { api } from "@/state/api";

const patch = (id: string, body: object) => api(`/api/bots/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export function BotContextMenu({ bot, children }: { bot: Bot; children: ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div />}>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-[228px] rounded-xl border border-hairline bg-menu p-1.5 text-ink">
        <ContextMenuItem onClick={() => patch(bot.id, { pinned: !bot.pinned })}>
          {bot.pinned ? <PinOff /> : <Pin />}
          {bot.pinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => patch(bot.id, { unread: !bot.unread })}>
          <BellDot />
          {bot.unread ? "Mark as Read" : "Mark as Unread"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => navigator.clipboard?.writeText(bot.threadId)}>
          <Copy />
          Copy conversation ID
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => patch(bot.id, { hidden: true })}>
          <EyeOff />
          Hide from sidebar
        </ContextMenuItem>
        <ContextMenuItem
          className="text-danger focus:text-danger"
          onClick={() => {
            if (confirm(`Delete ${bot.name}? This cannot be undone.`)) api(`/api/bots/${bot.id}`, { method: "DELETE" });
          }}
        >
          <Trash2 />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
