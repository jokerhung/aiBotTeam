/** Pictures of a bot's browser arrive many times a second; they bypass the app store so only the panel that shows them re-renders. */
export interface Screen { image: string; url: string; title: string; at: number; width: number; height: number }
export interface ComputerControl { running: boolean; held: boolean; helpReason: string | null }

type Listener = () => void;
const screens = new Map<string, Screen>();
const controls = new Map<string, ComputerControl>();
const listeners = new Set<Listener>();

export const lastScreen = (botId: string) => screens.get(botId);
export const lastControl = (botId: string, surface = "computer") => controls.get(`${surface}:${botId}`);

export function onComputerFrame(f: { kind: string; botId?: string } & Record<string, unknown>): boolean {
  if (f.kind === "screen" && f.botId) {
    screens.set(f.botId, f as unknown as Screen);
  } else if ((f.kind === "computer-control" || f.kind === "browser-control") && f.botId) {
    const c = f as unknown as ComputerControl;
    controls.set(`${f.kind === "browser-control" ? "browser" : "computer"}:${f.botId}`, { running: c.running, held: c.held, helpReason: c.helpReason });
    if (!c.running && f.kind === "browser-control") screens.delete(f.botId);
  } else return false;
  listeners.forEach((l) => l());
  return true;
}

export function subscribeComputer(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
