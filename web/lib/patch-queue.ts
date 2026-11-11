import { api } from "@/state/api";

const chains = new Map<string, Promise<unknown>>();

/** Bot patches go out one at a time per bot, in the order they were made, so quick typing never lands out of order. */
export function queuePatch(botId: string, body: object): Promise<unknown> {
  const prev = chains.get(botId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(() => api(`/api/bots/${botId}`, { method: "PATCH", body: JSON.stringify(body) }));
  chains.set(botId, next);
  next.finally(() => { if (chains.get(botId) === next) chains.delete(botId); }).catch(() => undefined);
  return next;
}
