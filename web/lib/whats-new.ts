/** What changed, newest first. The profile menu shows a dot until the newest id has been opened. */
export interface Release { id: string; date: string; title: string; items: string[] }

export const RELEASES: readonly Release[] = [
  {
    id: "2026-11-extensions",
    date: "2026-11-11",
    title: "Hands, memory and sharing",
    items: [
      "Connect apps and your own MCP servers; every tool still asks first, as set for each bot.",
      "Bots keep notes between tasks and can use skills you write.",
      "Share a section of your team as one file and add someone else's, with a review first.",
      "Usage, an event inspector and a timeline of each turn show what your bots did.",
      "Run BotTeam with one command (botteam), from Docker, or from a script.",
    ],
  },
  {
    id: "2026-11-teams",
    date: "2026-11-01",
    title: "Teams and automations",
    items: ["Rooms where bots talk together, mentions and a leader.", "Routines on a schedule and webhooks from other apps.", "An inbox for everything waiting on you."],
  },
];

export const LATEST_RELEASE = RELEASES[0].id;
