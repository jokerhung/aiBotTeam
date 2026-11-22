"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the saved collapse choice and the window size are read from the browser after the first render */
import { Bell, Hash, PanelLeft, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { NAV, PROJECTS_ITEM, hasChatList, type NavItem, type View } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { Mascot } from "../Mascot";
import { ProfileMenu } from "../Sidebar";

const KEY = "botteam-rail-collapsed";
const MAX_PROJECTS = 5;

const ROW = "flex h-[38px] w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px] text-ink-secondary outline-none transition-colors hover:bg-raised/70 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/25";

/** The left navigation of the workspace layout: pages grouped as Build, Knowledge and Connect, the rooms as Projects, and the person's own controls at the foot. */
export function AppRail() {
  const { state, dispatch } = useStore();
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { try { setCollapsed(localStorage.getItem(KEY) === "1"); } catch { /* storage unavailable */ } }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem(KEY, c ? "0" : "1"); } catch { /* storage unavailable */ } return !c; });
  // beside the chat list the rail gives up its labels on a middle-sized window, so the chat keeps its room
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px) and (max-width: 1099px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const icons = collapsed || (narrow && hasChatList(state.view));
  const go = (view: View) => dispatch({ type: "view", view });
  const waiting = state.inbox.length;

  const item = (n: NavItem) => {
    const active = state.view === n.view;
    const Icon = n.icon;
    return (
      <button key={n.view} type="button" data-testid={n.testid} title={t(n.label)} aria-current={active ? "page" : undefined}
        onClick={() => go(n.view)} className={cn(ROW, icons && "justify-center px-0", active && "bg-raised text-ink")}>
        <span className="relative flex shrink-0"><Icon size={17} strokeWidth={1.9} aria-hidden />
          {icons && n.view === "inbox" && waiting > 0 && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-warning" />}</span>
        {!icons && <span className="min-w-0 flex-1 truncate">{t(n.label)}</span>}
        {!icons && n.view === "inbox" && waiting > 0 && <span data-testid="inbox-count" className="rounded-full bg-warning px-1.5 text-[11.5px] font-semibold leading-5 text-[var(--color-danger-ink)]">{waiting}</span>}
        {!icons && n.placeholder && <span className="rounded-full bg-ink/[0.06] px-1.5 text-[10.5px] leading-4 text-ink-tertiary">{t("Soon")}</span>}
      </button>
    );
  };
  const label = (text: string) => (icons ? <div aria-hidden className="mx-2 my-2 h-px bg-edge" /> : <div className="px-2.5 pb-1 pt-4 text-[12px] font-medium text-ink-tertiary">{t(text)}</div>);

  const sections = state.sections.map((x) => ({ ...x, bots: state.bots.filter((b) => !b.hidden && b.section === x.id).length }));
  const projects = state.groups.filter((g) => !g.hidden).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)).slice(0, MAX_PROJECTS);
  const openProject = (id: string, unread: boolean) => {
    dispatch({ type: "selectGroup", id });
    if (unread) api(`/api/groups/${id}/read`, { method: "POST" }).catch(() => {});
  };
  const { icon: ProjectsIcon } = PROJECTS_ITEM;

  return (
    <>
      {state.railOpen && <div aria-hidden onMouseDown={() => dispatch({ type: "rail", open: false })} className="absolute inset-0 z-[45] bg-black/50 md:hidden" />}
      <nav aria-label={t("Main menu")} data-testid="app-rail" data-collapsed={icons ? "" : undefined}
        className={cn(
          "flex h-full shrink-0 flex-col border-r-[0.5px] border-edge bg-panel transition-[width] duration-200 motion-reduce:transition-none",
          icons ? "w-[64px]" : "w-[248px]",
          "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-[260px] max-md:transition-transform",
          !state.railOpen && "max-md:-translate-x-full",
        )}>
        <div className={cn("flex h-[60px] shrink-0 items-center gap-2 px-3", icons && "flex-col justify-center gap-1 px-0 pt-1")}>
          <span className="flex min-w-0 flex-1 items-center gap-2" aria-hidden={icons}>
            <Mascot color="blue" size={26} />
            {!icons && <span data-no-i18n="" className="truncate text-[15px] font-semibold text-ink">BotTeam</span>}
          </span>
          <button type="button" data-testid="rail-collapse" title={t(icons ? "Expand menu" : "Collapse menu")} aria-label={t(icons ? "Expand menu" : "Collapse menu")} aria-pressed={icons}
            onClick={toggle} className="hidden size-8 items-center justify-center rounded-full text-ink-secondary hover:bg-ink/10 hover:text-ink md:flex"><PanelLeft size={16} /></button>
        </div>
        <div className="px-3 pb-1">
          <button type="button" data-testid="rail-search" title={t("Search")} onClick={() => dispatch({ type: "palette", open: true })}
            className={cn("flex h-9 w-full items-center gap-2 rounded-lg bg-composer px-2.5 text-[14px] text-ink-tertiary ring-1 ring-inset ring-ink/[0.07] hover:text-ink", icons && "justify-center px-0")}>
            <Search size={15} aria-hidden />
            {!icons && <><span className="flex-1 text-left">{t("Search")}</span><kbd className="text-[11px]">⌘K</kbd></>}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          <div className="flex flex-col gap-0.5 pt-2">{NAV[0].items.map(item)}</div>
          {label("Projects")}
          <div className="flex flex-col gap-0.5" data-testid="rail-projects">
            {sections.map((x) => {
              const active = state.view === "section" && state.selectedSectionId === x.id;
              return (
                <button key={x.id} type="button" title={x.name} data-testid="rail-section" aria-current={active ? "page" : undefined} onClick={() => dispatch({ type: "openSection", id: x.id })}
                  className={cn(ROW, icons && "justify-center px-0", active && "bg-raised text-ink")}>
                  <Hash size={16} strokeWidth={1.9} aria-hidden className="shrink-0" />
                  {!icons && <span data-no-i18n="" className="min-w-0 flex-1 truncate">{x.name}</span>}
                  {!icons && <span className="text-[11.5px] tabular-nums text-ink-tertiary">{x.bots}</span>}
                </button>
              );
            })}
            {projects.map((g) => {
              const active = state.view === "project" && state.selectedGroupId === g.id;
              return (
                <button key={g.id} type="button" title={g.name} data-testid="rail-project" aria-current={active ? "page" : undefined} onClick={() => openProject(g.id, g.unread)}
                  className={cn(ROW, icons && "justify-center px-0", active && "bg-raised text-ink")}>
                  <Hash size={16} strokeWidth={1.9} aria-hidden className="shrink-0" />
                  {!icons && <span data-no-i18n="" className="min-w-0 flex-1 truncate">{g.name}</span>}
                  {!icons && g.unread && <span aria-label={t("Unread")} className="size-2 shrink-0 rounded-full bg-accent" />}
                </button>
              );
            })}
            <button type="button" data-testid={PROJECTS_ITEM.testid} title={t(PROJECTS_ITEM.label)} aria-current={state.view === "projects" ? "page" : undefined}
              onClick={() => go("projects")} className={cn(ROW, icons && "justify-center px-0", state.view === "projects" && "bg-raised text-ink")}>
              <ProjectsIcon size={17} strokeWidth={1.9} aria-hidden />
              {!icons && <span className="min-w-0 flex-1 truncate">{t(PROJECTS_ITEM.label)}</span>}
            </button>
          </div>
          {NAV.slice(1).map((g) => (
            <div key={g.label}>
              {label(g.label ?? "")}
              <div className="flex flex-col gap-0.5">{g.items.map(item)}</div>
            </div>
          ))}
        </div>
        <div className={cn("flex shrink-0 items-center gap-2 border-t-[0.5px] border-edge px-3 py-2.5", icons && "flex-col px-0")}>
          <ProfileMenu icons={icons} />
          {!icons && (
            <button type="button" data-testid="rail-version" title={t("What's new")} onClick={() => dispatch({ type: "whatsNew", open: true })}
              className="min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-left text-[12px] text-ink-tertiary hover:bg-raised/70 hover:text-ink">
              <span data-no-i18n="">{state.config.settings.displayName || "You"}</span>
            </button>
          )}
          <button type="button" data-testid="rail-bell" title={t("Notifications")} aria-label={t("Notifications")} aria-pressed={state.notifOpen}
            onClick={() => dispatch({ type: "notifPanel", open: !state.notifOpen })}
            className="relative flex size-9 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-ink/10 hover:text-ink">
            <Bell size={16} />
            {state.notifications.some((n) => !n.read) && <span data-testid="notif-dot" className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent ring-2 ring-panel" />}
          </button>
        </div>
        <span className="sr-only" aria-live="polite">{hasChatList(state.view) ? "" : t(state.view)}</span>
      </nav>
    </>
  );
}
