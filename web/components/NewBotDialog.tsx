"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/state/api";
import { useStore } from "@/state/store";

export function NewBotDialog() {
  const { state, dispatch } = useStore();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  if (!state.newBotOpen) return null;
  const close = () => dispatch({ type: "newBot", open: false });
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const bot = await api<{ id: string }>("/api/bots", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      dispatch({ type: "select", id: bot.id });
      setName("");
      close();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New bot"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === "Escape" && close()}
    >
      <div className="w-[min(92vw,420px)] animate-pop-in rounded-2xl border border-hairline bg-card p-6 shadow-2xl">
        <h2 className="mb-4 text-[18px] font-semibold text-ink">New bot</h2>
        <Input
          autoFocus
          value={name}
          placeholder="Name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          className="h-11 rounded-lg bg-inset text-[16px]"
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy || !name.trim()}>
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}
