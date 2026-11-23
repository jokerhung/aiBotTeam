import type { Bot } from "./wire";

export const EDITABLE_FIELDS = ["name", "title", "description", "soul", "color", "section", "modelSelection", "fallbackSelection", "approvalMode", "cwd", "notifications", "reportsTo", "chief", "managedSections", "skills", "memory", "mcpServers", "mcpAccess", "toolbox"] as const;
export function agentValues(bot: Bot): Partial<Bot> {
  return Object.fromEntries(EDITABLE_FIELDS.map((key) => [key, bot[key]]));
}
export function agentChanges(base: Bot, draft: Bot): Partial<Bot> {
  return Object.fromEntries(EDITABLE_FIELDS.filter((key) => JSON.stringify(base[key]) !== JSON.stringify(draft[key])).map((key) => [key, draft[key]]));
}
export function filterAgents(bots: Bot[], search: string, status: string, section: string) {
  const term = search.toLocaleLowerCase().trim();
  return bots.filter((b) => !b.admin && !b.inline && !b.ephemeral && (status === "all" || b.hidden === (status === "archived")) && (!section || b.section === section) && `${b.name} ${b.title} ${b.description}`.toLocaleLowerCase().includes(term));
}
export const agentHandle = (name: string) => name.trim().toLocaleLowerCase().replace(/\s+/g, "-");

// Registered only while an editor is mounted. Navigation events and browser Back share the same guard.
let guard: ((action: { type: string; id?: string | null; view?: string }) => boolean) | null = null;
export function registerAgentGuard(next: typeof guard) { guard = next; }
export function allowAgentNavigation(action: { type: string; id?: string | null; view?: string }) { return guard?.(action) ?? true; }

export function filterTemplates<T extends { name: string; description: string; industry: string }>(templates: T[], search: string, industry: string): T[] {
  const term = search.toLocaleLowerCase().trim();
  return templates.filter((template) => (!industry || template.industry === industry) && `${template.name} ${template.description}`.toLocaleLowerCase().includes(term));
}
