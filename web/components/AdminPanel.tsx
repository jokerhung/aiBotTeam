"use client";
import { MessageCircle, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { ChatView } from "./ChatView";
import { ModelMenu } from "./ModelMenu";

/** The Administrator's chat beside the conversation: ask it to make a bot or to change one you have. */
export function AdminPanel() {
  const { state, dispatch } = useStore();
  const t = useT();
  const bot = state.adminBot;
  if (!state.adminOpen || !bot) return null;
  return (
    <aside aria-label={t("Administrator")} data-testid="admin-panel" className="relative z-20 flex h-full w-[420px] shrink-0 animate-panel-in flex-col border-l-[0.5px] border-edge bg-app max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:w-full">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3">
        <MessageCircle size={16} className="text-ink-secondary" />
        <div className="min-w-0 flex-1 text-[14px] font-medium">{t("Administrator")}</div>
        <ModelMenu bot={bot} />
        <button type="button" aria-label={t("Close")} onClick={() => dispatch({ type: "admin", open: false })} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10 hover:text-ink"><X size={15} /></button>
      </div>
      <div className="shrink-0 px-4 pb-1 pt-1 text-[12.5px] leading-[1.4] text-ink-tertiary">{t("Ask it to make a new bot or to change one you have.")}</div>
      <ChatView key={bot.id} bot={bot} embedded />
    </aside>
  );
}
