"use client";
import { useEffect } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keyboard behaviour for every modal dialog in the app (any `[role=dialog][aria-modal=true]`): focus moves into the topmost one when it opens,
 * Tab stays inside it, Escape closes it (through its own Close button or by pressing its backdrop), and focus returns to where it was. */
export function useDialogA11y() {
  useEffect(() => {
    const top = () => {
      const all = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].filter((d) => d.checkVisibility?.() !== false);
      return all[all.length - 1] ?? null;
    };
    const stack: { dialog: HTMLElement; from: HTMLElement | null }[] = [];
    const sync = () => {
      const open = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')];
      for (const d of open) {
        if (!stack.some((s) => s.dialog === d)) {
          stack.push({ dialog: d, from: document.activeElement as HTMLElement | null });
          if (!d.contains(document.activeElement)) (d.querySelector<HTMLElement>("[autofocus], input, textarea, select") ?? d.querySelector<HTMLElement>(FOCUSABLE))?.focus();
        }
      }
      for (let i = stack.length - 1; i >= 0; i--) {
        if (!document.contains(stack[i].dialog)) {
          const { from } = stack.splice(i, 1)[0];
          if (from && document.contains(from) && stack.length === 0) from.focus();
        }
      }
    };
    const obs = new MutationObserver(sync);
    obs.observe(document.body, { childList: true, subtree: true });
    sync();
    const onKey = (e: KeyboardEvent) => {
      const d = top();
      if (!d) return;
      if (e.key === "Escape" && !e.defaultPrevented) {
        const close = d.querySelector<HTMLElement>('[aria-label="Close"], [aria-label="Close settings"]');
        if (close) { e.preventDefault(); close.click(); return; }
        d.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); // a backdrop press closes the dialogs that have no button
        return;
      }
      if (e.key !== "Tab") return;
      const items = [...d.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.checkVisibility?.() !== false);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (!d.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { obs.disconnect(); document.removeEventListener("keydown", onKey); };
  }, []);
}
