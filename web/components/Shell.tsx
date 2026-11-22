"use client";
import { Loader2 } from "lucide-react";
import { useStore } from "@/state/store";
import type { Bot, Group } from "@/lib/wire";
import { hasChatList, itemOf, type View } from "@/lib/nav";
import { ChatView } from "./ChatView";
import { AutomationsPage } from "./AutomationsPage";
import { TeamMapPage } from "./TeamMapPage";
import { GroupPanelHost, GroupView } from "./GroupView";
import { InboxPanel, NotificationsPanel } from "./NotificationsPanel";
import { NewGroupDialog } from "./NewGroupDialog";
import { ConnectedApps } from "./ConnectedApps";
import { ImportBotDialog } from "./BotFile";
import { PairBrowser } from "./PairBrowser";
import { GuidedTour, WelcomeGate, WhatsNew } from "./Welcome";
import { UsagePage } from "./Observe";
import { ImportTeamDialog, ShareTeamDialog } from "./TeamShare";
import { BotPanel } from "./BotPanel";
import { AdminPanel } from "./AdminPanel";
import { ComputerPanel } from "./ComputerPanel";
import { CommandPalette } from "./CommandPalette";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { NewBotDialog } from "./NewBotDialog";
import { SettingsModal } from "./SettingsModal";
import { Toaster } from "./Toaster";
import { useLocalizer } from "@/lib/i18n";
import { useGlobalBehaviors } from "./useGlobalBehaviors";
import { useTeamBehaviors } from "./useTeamBehaviors";
import { useDialogA11y } from "./useDialogA11y";
import { TranscriptAnnouncer } from "./TranscriptAnnouncer";
import { Sidebar } from "./Sidebar";
import { AppRail } from "./layout/AppRail";
import { EmptyPage } from "./layout/PageFrame";
import { AgentsPage, AppsPage, DashboardPage, InboxPage, InputPage, ProjectsPage, SkillsPage } from "./layout/pages";
import { useHashRoute } from "./layout/useHashRoute";

/** What the main area shows when no bot or room is chosen: loading, or an invitation to make the first bot. */
function Fallback() {
  const { state, dispatch } = useStore();
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-app text-ink-secondary">
      {!state.hydrated ? (
        <>
          <Loader2 className="animate-spin" size={20} />
          <div className="text-[14px]">{state.connected ? "Loading…" : "Waiting for the server…"}</div>
          {!state.connected && (
            <code className="rounded bg-raised px-1.5 py-0.5 text-[12px]">npm run dev:server</code>
          )}
        </>
      ) : (
        <>
          <div className="text-[16px]">No bots yet.</div>
          <button
            type="button"
            onClick={() => dispatch({ type: "newBot", open: true })}
            className="rounded-full bg-accent px-5 py-2 text-[15px] text-[var(--color-accent-ink)]"
          >
            Create your first bot
          </button>
        </>
      )}
    </main>
  );
}

/** The chat of one bot with its side panels. */
function BotArea({ bot }: { bot: Bot }) {
  const { state } = useStore();
  return (
    <>
      <ChatView key={bot.id} bot={bot} />
      {state.panelBotId === bot.id && <BotPanel key={`panel-${bot.id}-${state.panelVersion}`} bot={bot} initialView={state.panelView} />}
      {state.computerBotId === bot.id && <ComputerPanel key={`computer-${bot.id}`} bot={bot} />}
      <AdminPanel />
    </>
  );
}

/** The page of the workspace layout that `view` names; a page nobody built yet is an empty page, not a missing one. */
function WorkspaceContent({ view, bot, group }: { view: View; bot: Bot | undefined; group: Group | undefined }) {
  switch (view) {
    case "chat": return bot ? <BotArea bot={bot} /> : <Fallback />;
    case "project": return group ? <><GroupView key={group.id} group={group} /><GroupPanelHost group={group} /></> : <ProjectsPage />;
    case "dashboard": return <DashboardPage />;
    case "inbox": return <InboxPage />;
    case "projects": return <ProjectsPage />;
    case "agents": return <AgentsPage />;
    case "routines": return <AutomationsPage />;
    case "skills": return <SkillsPage />;
    case "apps": return <AppsPage />;
    case "input": return <InputPage />;
    case "team-map": return <TeamMapPage />;
    default: {
      const item = itemOf(view);
      return item ? <EmptyPage title={item.label} icon={item.icon} testid={`page-${view}`} /> : <Fallback />;
    }
  }
}

export function Shell() {
  const { state } = useStore();
  useGlobalBehaviors();
  useTeamBehaviors();
  useDialogA11y();
  useLocalizer();
  const workspace = state.config.settings.layout !== "classic";
  useHashRoute(workspace);
  const bot = state.bots.find((b) => b.id === state.selectedId);
  const group = state.groups.find((g) => g.id === state.selectedGroupId);
  const noRealEngine = !state.instances.some((i) => i.driver !== "echo" && i.snapshot.state === "available" && i.snapshot.signedIn !== false);
  return (
    <div className="flex h-full flex-col">
      {!state.connected && (
        <div role="status" className="shrink-0 bg-warning/15 px-4 py-1.5 text-center text-[13px] text-warning">
          Connection lost — reconnecting…
        </div>
      )}
      {state.hydrated && noRealEngine && (
        <div role="status" className="shrink-0 bg-warning/15 px-4 py-1.5 text-center text-[13px] text-warning">
          No AI engine is ready. Install and sign in to the Claude Code, Codex or Antigravity CLI, or add an OpenAI-compatible endpoint.
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        {workspace ? (
          <>
            <AppRail />
            {hasChatList(state.view) && <Sidebar workspace />}
            <WorkspaceContent view={state.view} bot={bot} group={group} />
          </>
        ) : (
          <>
            <Sidebar />
            {state.teamMapOpen ? (
              <TeamMapPage />
            ) : state.automationsOpen ? (
              <AutomationsPage />
            ) : group ? (
              <>
                <GroupView key={group.id} group={group} />
                <GroupPanelHost group={group} />
              </>
            ) : bot ? (
              <BotArea bot={bot} />
            ) : (
              <Fallback />
            )}
          </>
        )}
        <InboxPanel />
        <NotificationsPanel />
      </div>
      <TranscriptAnnouncer />
      <WelcomeGate />
      <GuidedTour />
      <WhatsNew />
      <NewGroupDialog />
      <ConnectedApps />
      <PairBrowser />
      <UsagePage />
      <ShareTeamDialog />
      <ImportTeamDialog />
      <ImportBotDialog />
      <NewBotDialog />
      <SettingsModal />
      <CommandPalette />
      <KeyboardShortcutsModal />
      <Toaster />
    </div>
  );
}
