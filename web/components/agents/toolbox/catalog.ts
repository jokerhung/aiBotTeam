// Catalog labels/descriptions adapted from agenticos 1.89.1, inspected 2026-11-22.
// Apache-2.0; see LICENSE and root NOTICE. Added Connected apps; no agent configuration imported.
export interface ToolboxCapability {
  id: string;
  name: string;
  description: string;
  category: string;
  recommended: boolean;
  resource?: "memory" | "skills" | "apps" | "subagents" | "web" | "computer" | "resources";
  artId?: string;
}
export const TOOLBOX_CATALOG: readonly ToolboxCapability[] = [
  { id: "resources", name: "Resources", description: "Publish versioned pages, Markdown, images and posts for people to review and routines to reuse.", category: "Knowledge and memory", recommended: true, resource: "resources", artId: "memory_files" },
  {
    "id": "code_execution",
    "name": "Calculations",
    "description": "Lets the agent work out numbers with a short Python program instead of estimating them.",
    "category": "Work with data",
    "recommended": false
  },
  {
    "id": "charts",
    "name": "Charts",
    "description": "Draws a chart in the conversation, so people see the numbers instead of reading them.",
    "category": "Work with data",
    "recommended": true
  },
  {
    "id": "coding_agent",
    "name": "Coding agent",
    "description": "Hands software work to Claude Code or Codex, in the agent's sandbox or on this computer, while you watch each step in the chat.",
    "category": "Work with data",
    "recommended": false
  },
  {
    "id": "image_generation",
    "name": "Image generation",
    "description": "Creates an image from a description.",
    "category": "Work with data",
    "recommended": false
  },
  {
    "id": "mirage",
    "name": "Mirage (virtual terminal)",
    "description": "Mounts the services you choose - a Drive, a GitHub repository, Notion, a database, an SSH server - as folders, so the agent lists, searches and reads them with a shell, and writes where you allow it.",
    "category": "Work with data",
    "recommended": false
  },
  {
    "id": "sandbox",
    "name": "Sandbox",
    "description": "Gives the agent its own small computer: it creates and edits files and runs code, and the files are still there next time.",
    "category": "Work with data",
    "recommended": true
  },
  {
    "id": "text_to_speech",
    "name": "Text to speech",
    "description": "Reads a text aloud as an audio clip.",
    "category": "Work with data",
    "recommended": false
  },
  {
    "id": "video_generation",
    "name": "Video generation",
    "description": "Makes a short video from a description, or from an image it starts with.",
    "category": "Work with data",
    "recommended": false
  },
  {
    "id": "visuals",
    "name": "Visuals",
    "description": "Draws in the conversation - a diagram, an architecture map, an explainer with sliders, a 3D scene - live while the agent writes it. A drawing can be saved as an app.",
    "category": "Work with data",
    "recommended": true
  },
  {
    "id": "monitor",
    "name": "Watch a command",
    "description": "Starts a long-running command - a test watcher, a log tail, a CI poll - and tells the agent about its new output as it appears, so it does not have to poll.",
    "category": "Work with data",
    "recommended": true
  },
  {
    "id": "phone_calls",
    "name": "Telephone calls",
    "description": "Calls your opted-in verified number, reads a spoken report, or transfers this live call to an allowed contact.",
    "category": "Chat channels",
    "recommended": false
  },
  {
    "id": "context",
    "name": "Context",
    "description": "Gives the agent your company's standing information - a glossary, a policy, a brand voice - every time it answers.",
    "category": "Knowledge and memory",
    "recommended": true
  },
  {
    "id": "knowledge",
    "name": "Knowledge search",
    "description": "Lets the agent answer from your documents and say which one each answer came from.",
    "category": "Knowledge and memory",
    "recommended": false
  },
  {
    "id": "memory_files",
    "name": "Memory",
    "description": "Lets the agent keep notes from one conversation to the next, so it does not start from zero.",
    "category": "Knowledge and memory",
    "recommended": true,
    "resource": "memory"
  },
  {
    "id": "conversation_search",
    "name": "Past conversations",
    "description": "Lets the agent look up what was said in earlier conversations with the same person.",
    "category": "Knowledge and memory",
    "recommended": false
  },
  {
    "id": "skills",
    "name": "Skills",
    "description": "Lets the agent follow your written how-tos, loading one when the task needs it.",
    "category": "Knowledge and memory",
    "recommended": true,
    "resource": "skills"
  },
  {
    "id": "connected_apps",
    "name": "Connected apps",
    "description": "Services this agent can access",
    "category": "Knowledge and memory",
    "recommended": false,
    "resource": "apps",
    "artId": "mirage"
  },
  {
    "id": "background_tasks",
    "name": "Background topics",
    "description": "Starts independent work in a fresh topic while you keep talking; returns its result to the original agent.",
    "category": "Thinking and planning",
    "recommended": true
  },
  {
    "id": "planning",
    "name": "Planning",
    "description": "Lets the agent write a checklist for a bigger task and tick off each step, so the person sees its progress.",
    "category": "Thinking and planning",
    "recommended": false
  },
  {
    "id": "subagents",
    "resource": "subagents",
    "name": "Subagents",
    "description": "Lets the agent hand part of a job to another agent and use its answer.",
    "category": "Thinking and planning",
    "recommended": true
  },
  {
    "id": "background_tools",
    "name": "Work while tools run",
    "description": "Lets the agent start a slow tool - a long browse - and carry on with the rest of the request, using the result when it arrives.",
    "category": "Thinking and planning",
    "recommended": true
  },
  {
    "id": "computer_use",
    "resource": "computer",
    "name": "Computer use",
    "description": "Lets the agent operate a whole desktop - any application, not only web pages - by looking at screenshots and using the mouse and keyboard. You watch it live in the chat.",
    "category": "The web",
    "recommended": false
  },
  {
    "id": "web_fetch",
    "name": "Read web pages",
    "description": "Lets the agent open a link and read the page.",
    "category": "The web",
    "recommended": true
  },
  {
    "id": "browser_use",
    "resource": "web",
    "name": "Web browser",
    "description": "Gives the agent a real web browser it works step by step - reading pages, clicking, filling forms and searching - to finish a task.",
    "category": "The web",
    "recommended": false
  },
  {
    "id": "web_research",
    "name": "Web search",
    "description": "Lets the agent search the internet for current information.",
    "category": "The web",
    "recommended": true
  },
  {
    "id": "artifacts",
    "name": "Apps",
    "description": "Lets the agent publish a finished app - a report, a small dashboard - under a link people open in a browser.",
    "category": "Everyday",
    "recommended": true
  },
  {
    "id": "ask_user",
    "name": "Ask the user",
    "description": "Lets the agent ask a few multiple-choice questions instead of guessing.",
    "category": "Everyday",
    "recommended": true
  },
  {
    "id": "clock",
    "name": "Date and time",
    "description": "Tells the agent today's date and time, so it does not guess.",
    "category": "Everyday",
    "recommended": true
  },
  {
    "id": "drafts",
    "name": "Drafts",
    "description": "Shows text the agent writes for you to send - an e-mail, a chat reply, a post - as a card with a copy button on each part.",
    "category": "Everyday",
    "recommended": true
  },
  {
    "id": "follow_ups",
    "name": "Follow-ups",
    "description": "Offers up to three next steps as buttons under an answer, so what to ask next is one click away.",
    "category": "Everyday",
    "recommended": false
  },
  {
    "id": "guardrails",
    "name": "Guardrails",
    "description": "Hides passwords or personal data, or stops a run, when a message or an answer matches a rule you set.",
    "category": "Everyday",
    "recommended": false
  },
  {
    "id": "system_reminders",
    "name": "Instruction reminders",
    "description": "Repeats the agent's key instructions during a long task, so it does not drift away from them.",
    "category": "Advanced",
    "recommended": false
  },
  {
    "id": "compaction",
    "name": "Long conversations",
    "description": "Shortens the oldest part of a long conversation so the agent keeps going instead of hitting the model's limit.",
    "category": "Advanced",
    "recommended": true
  },
  {
    "id": "media",
    "name": "Media offload",
    "description": "Moves images out of a long conversation's history, so it stays small and cheaper to send.",
    "category": "Advanced",
    "recommended": true
  },
  {
    "id": "tool_output_limits",
    "name": "Tool output limits",
    "description": "Shortens a very large tool result, so it is not sent to the model again with every message.",
    "category": "Advanced",
    "recommended": true
  },
  {
    "id": "tool_search",
    "name": "Tool search",
    "description": "Lets an agent with many tools find the right one when it needs it, instead of reading all of them every time.",
    "category": "Advanced",
    "recommended": true
  }
];

export function toolboxShelves(query: string, translate: (text: string) => string = (text) => text) {
  const term = query.trim().toLocaleLowerCase();
  const matches = TOOLBOX_CATALOG.filter((entry) => !!entry.resource).filter((entry) => [entry.name, entry.description, translate(entry.name), translate(entry.description)].some((text) => text.toLocaleLowerCase().includes(term)));
  return [...new Set(matches.map((entry) => entry.category))].map((category) => ({ category, entries: matches.filter((entry) => entry.category === category) }));
}
