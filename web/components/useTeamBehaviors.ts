"use client";
import { useEffect, useRef } from "react";
import { useStore } from "@/state/store";

export const DESKTOP_ALERTS_KEY = "botteam-desktop-alerts";

/** Whether the person turned desktop alerts on (and the browser allows them). */
export function desktopAlertsOn(): boolean {
  try {
    return typeof Notification !== "undefined" && Notification.permission === "granted" && localStorage.getItem(DESKTOP_ALERTS_KEY) === "1";
  } catch { return false; }
}

/** Asks for permission when the person switches alerts on; returns whether they are now on. */
export async function enableDesktopAlerts(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  try { localStorage.setItem(DESKTOP_ALERTS_KEY, perm === "granted" ? "1" : "0"); } catch { /* storage unavailable */ }
  return perm === "granted";
}

/** The unread count in the tab title, and a browser notification for what arrives while the tab is hidden. */
export function useTeamBehaviors() {
  const { state } = useStore();
  const base = useRef<string>("");
  const seen = useRef<string | null>(null);
  const count = state.inbox.length + state.notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!base.current) base.current = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = count > 0 ? `(${count}) ${base.current}` : base.current;
  }, [count]);

  const newest = state.notifications[0];
  useEffect(() => {
    if (!newest) return;
    if (seen.current === null) { seen.current = newest.id; return; }  // what was already there at load is not news
    if (seen.current === newest.id) return;
    seen.current = newest.id;
    if (document.visibilityState === "visible" || !desktopAlertsOn()) return;
    try { new Notification(newest.title, { body: newest.body, tag: newest.id }); } catch { /* blocked by the browser */ }
  }, [newest]);
}
