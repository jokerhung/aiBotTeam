"use client";
/* eslint-disable react-hooks/set-state-in-effect -- these effects hydrate from localStorage or reset form state when a dialog opens or the target changes */
import { Dices } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { APPROVAL_MODES, type ApprovalMode, type MausColor, type ModelSelection } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { ApprovalModeSelector } from "./ApprovalModeSelector";
import { Mascot } from "./Mascot";

const COLORS: MausColor[] = ["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral", "silver", "chrome"];
const NAMES = ["Maple", "Pixel", "Juniper", "Orbit", "Biscuit", "Nimbus", "Sprout", "Comet", "Pebble", "Tango", "Willow", "Zephyr", "Marlow", "Quill", "Bramble"];
const randomName = () => NAMES[Math.floor(Math.random() * NAMES.length)];

interface Defaults {
  modelSelection: ModelSelection;
  approvalMode: ApprovalMode;
  cwd: string | null;
}

export function NewBotDialog() {
  const { state, dispatch } = useStore();
  const open = state.newBotOpen;
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<MausColor>("green");
  const [sel, setSel] = useState<ModelSelection | null>(null);
  const [mode, setMode] = useState<ApprovalMode>("full");
  const [cwd, setCwd] = useState("");
  const [saveDefaults, setSaveDefaults] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [presets, setPresets] = useState<{ id: string; name: string; title: string; description: string; color: MausColor; instructions: string }[]>([]);
  const [soul, setSoul] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(randomName());
    setTitle("");
    setDescription("");
    setColor(COLORS[state.bots.length % 8]);
    setError("");
    setSoul("");
    api<{ presets: typeof presets }>("/api/presets").then((r) => setPresets(r.presets)).catch(() => {});
    api<Defaults>("/api/bot-defaults").then((d) => {
      setSel(d.modelSelection);
      setMode(d.approvalMode);
      setCwd(d.cwd ?? "");
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const close = () => dispatch({ type: "newBot", open: false });
  const engines = state.instances.filter((i) => !i.hidden && i.enabled && i.snapshot.state === "available");
  const value = sel ? `${sel.instanceId}::${sel.model}` : "";

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const bot = await api<{ id: string }>("/api/bots", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), title: title.trim(), description: description.trim(), color, modelSelection: sel ?? undefined, approvalMode: mode, cwd: cwd.trim() || undefined }),
      });
      if (saveDefaults) await api("/api/bot-defaults", { method: "PUT", body: JSON.stringify({ modelSelection: sel, approvalMode: mode, cwd: cwd.trim() || null }) });
      if (soul) await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ soul }) });
      dispatch({ type: "select", id: bot.id });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the bot");
    } finally {
      setBusy(false);
    }
  };

  const field = "h-10 rounded-lg bg-inset text-[14px]";
  const label = "mb-1 block text-[12px] font-medium uppercase tracking-wide text-ink-tertiary";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New bot"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === "Escape" && close()}
    >
      <div className="max-h-[92vh] w-[min(94vw,480px)] animate-pop-in overflow-y-auto rounded-2xl border border-hairline bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <Mascot color={color} size={48} />
          <h2 className="text-[18px] font-semibold text-ink">New bot</h2>
        </div>
        <label className={label} htmlFor="nb-preset">Starting role</label>
        <select id="nb-preset" defaultValue="" onChange={(e) => {
          const p = presets.find((x) => x.id === e.target.value);
          if (!p) return;
          setName(p.name); setTitle(p.title); setDescription(p.description); setColor(p.color); setSoul(p.instructions);
        }} className={cn(field, "mb-3 w-full border border-input px-2 text-ink outline-none")}>
          <option value="">Blank</option>
          {presets.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        <label className={label} htmlFor="nb-name">Name</label>
        <div className="flex gap-2">
          <Input id="nb-name" autoFocus value={name} placeholder="Name" onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()} className={cn(field, "flex-1")} />
          <button type="button" title="Suggest another name" aria-label="Suggest another name" onClick={() => setName(randomName())}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-secondary hover:text-ink"><Dices size={18} /></button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <div>
            <label className={label} htmlFor="nb-title">Title</label>
            <Input id="nb-title" value={title} placeholder="e.g. Researcher" onChange={(e) => setTitle(e.target.value)} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="nb-model">Model</label>
            <select id="nb-model" value={value} onChange={(e) => { const [instanceId, ...m] = e.target.value.split("::"); setSel({ instanceId, model: m.join("::") }); }}
              className={cn(field, "w-full border border-input px-2 text-ink outline-none")}>
              {engines.map((e) => (
                <optgroup key={e.id} label={e.displayName}>
                  {e.models.map((m) => <option key={m.id} value={`${e.id}::${m.id}`}>{m.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
        <label className={cn(label, "mt-3")} htmlFor="nb-desc">Description</label>
        <textarea id="nb-desc" value={description} rows={2} placeholder="What is this bot for?" onChange={(e) => setDescription(e.target.value)}
          className="w-full resize-none rounded-lg bg-inset px-3 py-2 text-[14px] text-ink outline-none placeholder:text-ink-tertiary" />
        <span className={cn(label, "mt-3")}>Mascot color</span>
        <div className="flex flex-wrap gap-1.5">
          {COLORS.map((c) => (
            <button key={c} type="button" title={c} aria-label={c} aria-pressed={c === color} onClick={() => setColor(c)}
              className={cn("size-7 rounded-full ring-offset-2 ring-offset-card transition-shadow", c === color && "ring-2 ring-ink")}
              style={{ background: `var(--identity-${c})` }} />
          ))}
        </div>
        <span className={cn(label, "mt-3")}>Approval</span>
        <ApprovalModeSelector value={mode} onChange={setMode} />
        <label className={cn(label, "mt-3")} htmlFor="nb-cwd">Working folder</label>
        <Input id="nb-cwd" value={cwd} placeholder="Optional absolute path" onChange={(e) => setCwd(e.target.value)} className={field} />
        <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-secondary">
          <input type="checkbox" checked={saveDefaults} onChange={(e) => setSaveDefaults(e.target.checked)} /> Use these model, approval and folder settings for new bots
        </label>
        {error && <div role="alert" className="mt-3 text-[13px] text-danger">{error}</div>}
        <div className="mt-5 flex items-center justify-between">
          <span className="text-[12px] text-ink-tertiary">Starts at {APPROVAL_MODES.find((m) => m.id === mode)?.label}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button onClick={create} disabled={busy || !name.trim()}>Create</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
