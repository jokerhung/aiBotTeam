"use client";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Bot, InstanceInfo } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";

const FLOAT_PILL =
  "bg-composer ring-[0.5px] ring-ink/10 shadow-(--shadow-float) transition-colors duration-[120ms] hover:bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_7%)]";

export function modelLabel(instances: InstanceInfo[], bot: Bot): { inst?: InstanceInfo; label: string } {
  const inst = instances.find((i) => i.id === bot.modelSelection.instanceId);
  const label = inst?.models.find((m) => m.id === bot.modelSelection.model)?.label ?? bot.modelSelection.model;
  return { inst, label };
}

const EFFORT_NAMES: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

/** The model pill in the chat header and the menu behind it: engines grouped, models listed, effort when the engine has it. */
export function ModelMenu({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const { inst, label } = modelLabel(state.instances, bot);
  const engines = state.instances.filter((i) => !i.hidden && i.enabled && (i.driver !== "echo" || i.id === bot.modelSelection.instanceId || state.instances.every((x) => x.driver === "echo" || x.snapshot.state !== "available")));
  const choose = (instanceId: string, model: string, effort: string | null = bot.modelSelection.effort ?? null) => {
    void api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId, model, effort } }) });
    setOpen(false);
  };
  const efforts = inst?.capabilities.effortLevels ?? [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-tour="model"
        title={`${inst?.displayName ?? "Engine"} · ${label}`}
        className={cn("group flex h-8 shrink-0 items-center rounded-full pl-2.5 pr-2 text-[13px] leading-[18px] text-ink-secondary hover:text-ink aria-expanded:text-ink", FLOAT_PILL)}
      >
        <span className="max-w-[160px] min-w-0 truncate">{label}</span>
        <ChevronDown size={14} className="ml-1" />
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-[300px] gap-0 overflow-y-auto rounded-xl bg-menu p-1.5 text-ink ring-1 ring-ink/10">
        {engines.map((e) => {
          const ok = e.snapshot.state === "available";
          return (
            <div key={e.id} className="py-1">
              <div className="flex items-baseline justify-between px-2.5 pb-1 pt-1.5">
                <span className="text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{e.displayName}</span>
                {e.snapshot.version && <span className="text-[11px] text-ink-tertiary">{e.snapshot.version}</span>}
              </div>
              {!ok || e.snapshot.signedIn === false ? (
                <div className="px-2.5 pb-1.5 text-[12.5px] leading-4 text-warning">{e.snapshot.reason ?? "Unavailable"}</div>
              ) : null}
              {ok &&
                e.models.map((m) => {
                  const selected = bot.modelSelection.instanceId === e.id && bot.modelSelection.model === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => choose(e.id, m.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[14px] hover:bg-menu-hover"
                    >
                      <span className="min-w-0 flex-1 truncate">{m.label}</span>
                      {m.default && <span className="rounded bg-ink/[0.07] px-1.5 text-[11px] text-ink-secondary">default</span>}
                      {selected && <Check size={14} className="shrink-0 text-accent" />}
                    </button>
                  );
                })}
            </div>
          );
        })}
        {efforts.length > 0 && (
          <div className="mt-1 border-t border-ink/10 px-2.5 pb-1.5 pt-2.5">
            <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">Thinking</div>
            <div className="flex gap-1">
              {[null, ...efforts].map((lv) => (
                <button
                  key={lv ?? "auto"}
                  type="button"
                  onClick={() => choose(bot.modelSelection.instanceId, bot.modelSelection.model, lv)}
                  className={cn(
                    "rounded-full px-3 py-1 text-[13px] ring-1 ring-inset ring-ink/10 hover:bg-menu-hover",
                    (bot.modelSelection.effort ?? null) === lv && "bg-ink text-app ring-0 hover:bg-ink",
                  )}
                >
                  {lv ? EFFORT_NAMES[lv] ?? lv : "Auto"}
                </button>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
