"use client";
import { Loader2 } from "lucide-react";
import { useStore } from "@/state/store";
import { ChatView } from "./ChatView";
import { AutomationsPage } from "./AutomationsPage";
import { TeamMapPage } from "./TeamMapPage";
import { GroupPanelHost, GroupView } from "./GroupView";
import { InboxPanel, NotificationsPanel } from "./NotificationsPanel";
import { NewGroupDialog } from "./NewGroupDialog";
import { ConnectedApps } from "./ConnectedApps";
import { GuidedTour, WelcomeGate, WhatsNew } from "./Welcome";
import { UsagePage } from "./Observe";
import { ImportTeamDialog, ShareTeamDialog } from "./TeamShare";
import { McpServersPanel } from "./McpServers";
import { BotPanel } from "./BotPanel";
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

export function Shell() {
  const { state, dispatch } = useStore();
  useGlobalBehaviors();
  useTeamBehaviors();
  useDialogA11y();
  useLocalizer();
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
          No AI engine is ready. Install and sign in to the Claude Code or Codex CLI, or add an OpenAI-compatible endpoint.
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
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
          <>
            <ChatView key={bot.id} bot={bot} />
            {state.panelBotId === bot.id && <BotPanel key={`panel-${bot.id}`} bot={bot} />}
          </>
        ) : (
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
      <UsagePage />
      <ShareTeamDialog />
      <ImportTeamDialog />
      <McpServersPanel />
      <NewBotDialog />
      <SettingsModal />
      <CommandPalette />
      <KeyboardShortcutsModal />
      <Toaster />
    </div>
  );
}
