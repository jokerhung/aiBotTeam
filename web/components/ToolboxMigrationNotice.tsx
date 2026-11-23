"use client";
import { useEffect, useState } from "react";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { useT } from "@/lib/i18n";

export function ToolboxMigrationNotice() {
  const { state, dispatch } = useStore(); const t = useT();
  const [bots, setBots] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { if (state.hydrated) void api<{ dismissed: boolean; bots: { id: string; name: string }[] }>("/api/toolbox/migration").then((notice) => { if (!notice.dismissed) setBots(notice.bots); }); }, [state.hydrated]);
  if (!bots.length) return null;
  return <aside role="status" className="fixed bottom-5 right-5 z-40 max-w-sm rounded-xl border border-edge bg-composer p-4 shadow-xl"><h3 className="text-sm font-semibold">{t("Review your agents' delegates")}</h3><p className="mt-2 text-xs leading-5 text-ink-secondary">{t("Subagents was enabled to preserve existing collaboration for these agents:")} {bots.map((b) => b.name).join(", ")}. {t("Review and narrow the allowed delegates in Toolbox.")}</p><div className="mt-3 flex gap-3"><button className="text-sm underline" onClick={() => dispatch({ type: "view", view: "agents" })}>{t("Open Agents")}</button><button className="ml-auto text-sm" onClick={async () => { await api("/api/toolbox/migration/dismiss", { method: "POST" }); setBots([]); }}>{t("Dismiss")}</button></div></aside>;
}
