"use client";
import { MoreHorizontal, Pencil } from "lucide-react";
import { useState, type ReactNode, type KeyboardEvent } from "react";
import { useStore } from "@/state/store";
import { api } from "@/state/api";
import { useT } from "@/lib/i18n";
import type { Bot, MausColor } from "@/lib/wire";
import { exportBotFile } from "../BotFile";
import { deleteBotWithUndo, useBotMenu } from "../BotContextMenu";
import { toast } from "../Toaster";

export const COLORS: MausColor[] = ["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral", "silver", "chrome"];
export const INPUT = "w-full rounded-lg border border-edge bg-composer px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent";
export const BUTTON = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-edge bg-composer px-3 text-sm text-ink hover:bg-raised disabled:opacity-40";
export const PRIMARY = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-transparent bg-ink px-3 text-sm text-app hover:opacity-90 disabled:opacity-40";
export function trapDialog(event: KeyboardEvent<HTMLElement>, close: () => void) {
  if (event.key === "Escape") { event.stopPropagation(); close(); }
  if (event.key !== "Tab") return;
  const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href]')].filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);
  const first = nodes[0], last = nodes.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
export function Field({ label, children }: { label: string; children: ReactNode }) { const t = useT(); return <div className="mb-5"><div className="mb-2 text-sm font-medium">{t(label)}</div>{children}</div>; }
export function Card({ title, children }: { title: string; children: ReactNode }) { const t = useT(); return <details open className="mb-6 rounded-xl border border-edge bg-composer p-5"><summary className="mb-5 cursor-pointer text-base font-medium">{t(title)}</summary>{children}</details>; }
export function ColorPicker({ value, onChange }: { value: MausColor; onChange: (value: MausColor) => void }) {
  return <div role="radiogroup" aria-label="Mascot color" className="flex flex-wrap gap-2">{COLORS.map((color) => <button key={color} type="button" role="radio" aria-label={color} aria-checked={value === color} onClick={() => onChange(color)} className={`size-7 rounded-full border-2 ${value === color ? "border-ink" : "border-transparent"}`} style={{ background: `var(--identity-${color})` }} />)}</div>;
}
export function AgentActions({ bot, edit = false, onColor }: { bot: Bot; edit?: boolean; onColor?: () => void }) {
  const { dispatch } = useStore(); const t = useT();
  const extras = useBotMenu(bot).filter((entry) => entry !== "sep" && !["edit", "dup", "export", "hide", "delete"].includes(entry.key));
  const [open, setOpen] = useState(false); const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null); const [typed, setTyped] = useState(""); const [error, setError] = useState("");
  const run = async (action: () => Promise<unknown>) => { setError(""); try { await action(); setOpen(false); } catch (e) { setError(String(e)); } };
  const hide = (id: string, hidden: boolean) => dispatch({ type: "frame", frame: { kind: "bot", bot: { ...bot, id, hidden } } });
  return <div className="relative flex items-center gap-1" onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
    {edit && <button className="rounded p-2 hover:bg-raised" aria-label={`${t("Edit agent")}: ${bot.name}`} onClick={() => dispatch({ type: "openAgent", id: bot.id })}><Pencil size={16} /></button>}
    <button className="rounded p-2 hover:bg-raised" aria-label={`${t("Agent actions")}: ${bot.name}`} aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontal size={18} /></button>
    {open && <><button tabIndex={-1} className="fixed inset-0 z-20 cursor-default" aria-label="Close menu" onClick={() => setOpen(false)} /><div role="menu" className="absolute right-0 top-full z-30 w-52 rounded-xl border border-edge bg-composer p-1 shadow-xl">
      {[
        ["Open in chat", () => dispatch({ type: "select", id: bot.id })],
        ["Duplicate", () => void run(async () => { const b = await api<Bot>(`/api/bots/${bot.id}/duplicate`, { method: "POST" }); dispatch({ type: "frame", frame: { kind: "bot", bot: b } }); dispatch({ type: "openAgent", id: b.id }); })],
        ["Export bot file", () => void run(() => exportBotFile(bot))],
        ...(onColor ? [["Change mascot color", onColor]] : []),
        [bot.hidden ? "Restore" : "Archive", () => { setConfirm("archive"); setOpen(false); }],
        ["Delete permanently", () => { setConfirm("delete"); setTyped(""); setOpen(false); }],
        ...extras.filter((entry) => entry !== "sep").map((entry) => [entry.label, entry.run]),
      ].map(([label, action]) => <button key={label as string} role="menuitem" className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-raised" onClick={() => { setOpen(false); (action as () => void)(); }}>{t(label as string)}</button>)}
    </div></>}
    {confirm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t(confirm === "delete" ? "Delete permanently" : bot.hidden ? "Restore agent" : "Archive agent")} onKeyDown={(e) => trapDialog(e, () => setConfirm(null))}><div className="w-full max-w-md rounded-2xl bg-composer p-6 shadow-xl">
      <h2 className="mb-4 text-lg font-medium">{t(confirm === "delete" ? "Delete permanently" : bot.hidden ? "Restore agent" : "Archive agent")}: <span data-no-i18n>{bot.name}</span></h2>
      {confirm === "delete" && <label className="mb-4 block text-sm">{t("Type the agent name to confirm")}<input autoFocus className={`${INPUT} mt-2`} value={typed} onChange={(e) => setTyped(e.target.value)} /></label>}
      <div className="flex justify-end gap-2"><button autoFocus={confirm !== "delete"} className={BUTTON} onClick={() => setConfirm(null)}>{t("Cancel")}</button><button className={PRIMARY} disabled={confirm === "delete" && typed !== bot.name} onClick={() => {
        if (confirm === "delete") { deleteBotWithUndo(bot, hide); dispatch({ type: "view", view: "agents" }); setConfirm(null); }
        else void run(async () => { const updated = await api<Bot>(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ hidden: !bot.hidden }) }); dispatch({ type: "frame", frame: { kind: "bot", bot: updated } }); setConfirm(null); toast(t("Saved")); });
      }}>{t(confirm === "delete" ? "Delete" : bot.hidden ? "Restore" : "Archive")}</button></div>{error && <p role="alert">{error}</p>}
    </div></div>}
    {error && !confirm && <span role="alert" className="text-xs text-danger">{error}</span>}
  </div>;
}
