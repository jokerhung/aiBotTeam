"use client";
import { useEffect, useRef } from "react";
import { applyLook } from "@/lib/skins";
import { api } from "@/state/api";
import { useStore } from "@/state/store";

/** Keyboard shortcuts, skin/appearance application and "a bot needs you" notifications, all at the app root. */
export function useGlobalBehaviors() {
  const { state, dispatch } = useStore();
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // Look settings -> <html> (the boot script already painted the saved ones).
  const s = state.config.settings;
  useEffect(() => {
    applyLook(s);
  }, [s.skin, s.chatWidth, s.font, s.reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      const st = stateRef.current;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "k") { e.preventDefault(); dispatch({ type: "palette", open: !st.paletteOpen }); return; }
      if (mod && k === "f" && st.selectedId) { e.preventDefault(); dispatch({ type: "find", open: true }); return; }
      if (mod && !e.shiftKey && k === "n") { e.preventDefault(); dispatch({ type: "newBot", open: true }); return; }
      if (mod && e.shiftKey && k === "n" && st.selectedId) {
        e.preventDefault();
        void api(`/api/bots/${st.selectedId}/tasks`, { method: "POST", body: JSON.stringify({ title: "New task" }) });
        return;
      }
      if (mod && /^[1-9]$/.test(e.key)) {
        const visible = st.bots.filter((b) => !b.hidden);
        const bot = visible[Number(e.key) - 1];
        if (bot) { e.preventDefault(); dispatch({ type: "select", id: bot.id }); }
        return;
      }
      if (e.key === "?" && !mod && !typing(e.target)) { e.preventDefault(); dispatch({ type: "shortcuts", open: true }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  // A bot that starts waiting on you while the tab is hidden gets a browser notification; the title shows how many wait.
  const before = useRef<Record<string, string>>({});
  useEffect(() => {
    const waiting = state.bots.filter((b) => b.activity === "waiting-on-you");
    document.title = waiting.length ? `(${waiting.length}) BotTeam` : "BotTeam";
    for (const b of state.bots) {
      const was = before.current[b.id];
      if (b.activity === "waiting-on-you" && was !== "waiting-on-you" && was !== undefined && document.hidden && b.notifications
        && typeof Notification !== "undefined" && Notification.permission === "granted") {
        const n = new Notification(`${b.name} needs you`, { body: "Waiting for your approval or answer.", tag: `needs-${b.id}` });
        n.onclick = () => { window.focus(); dispatch({ type: "select", id: b.id }); n.close(); };
      }
      before.current[b.id] = b.activity;
    }
  }, [state.bots, dispatch]);
}
