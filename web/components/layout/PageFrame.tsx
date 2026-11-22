"use client";
import { Menu, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useStore } from "@/state/store";

/** One page of the workspace layout: a title bar (with the menu button on a narrow screen) and a scrolling body. */
export function PageFrame({ title, icon: Icon, description, actions, testid, wide = false, children }: {
  title: string; icon: LucideIcon; description?: string; actions?: ReactNode; testid: string; wide?: boolean; children: ReactNode;
}) {
  const { dispatch } = useStore();
  const t = useT();
  return (
    <main data-testid={testid} aria-label={t(title)} className="flex h-full min-w-0 flex-1 flex-col bg-app">
      <header className="flex min-h-[60px] shrink-0 items-center gap-3 border-b-[0.5px] border-edge px-5 max-md:flex-wrap max-md:gap-y-2 max-md:py-2">
        <button type="button" aria-label={t("Open menu")} onClick={() => dispatch({ type: "rail", open: true })} className="-ml-2 rounded-md p-1.5 text-ink-secondary hover:bg-raised md:hidden"><Menu size={18} /></button>
        <Icon size={17} className="shrink-0 text-accent-text" aria-hidden />
        <div className="min-w-0 flex-1 leading-tight">
          <h1 className="truncate text-[17px] font-semibold text-ink">{t(title)}</h1>
          {description && <p className="hidden truncate text-[12px] text-ink-tertiary xl:block">{t(description)}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("mx-auto w-full px-5 py-5", wide ? "max-w-[1100px]" : "max-w-[900px]")}>{children}</div>
      </div>
    </main>
  );
}

/** A page for something BotTeam does not have yet: a title and one honest sentence, nothing to press. */
export function EmptyPage({ title, icon: Icon, testid }: { title: string; icon: LucideIcon; testid: string }) {
  const t = useT();
  return (
    <PageFrame title={title} icon={Icon} testid={testid}>
      <div data-testid="empty-page" className="flex flex-col items-center gap-2 px-6 py-24 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-raised text-ink-tertiary"><Icon size={22} aria-hidden /></span>
        <div className="text-[15px] font-semibold text-ink">{t("Nothing here yet")}</div>
        <div className="max-w-[360px] text-[13px] leading-5 text-ink-secondary">{t("This part of BotTeam is not built yet.")}</div>
      </div>
    </PageFrame>
  );
}
