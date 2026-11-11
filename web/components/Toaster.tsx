"use client";
import { useEffect, useState } from "react";

export interface Toast {
  id: number;
  text: string;
  undoLabel?: string;
  onUndo?: () => void;
  /** Runs when the toast times out without an undo. */
  onExpire?: () => void;
  ms: number;
}

type Listener = (t: Toast) => void;
const listeners = new Set<Listener>();
let next = 1;

export function toast(text: string, opts: { undoLabel?: string; onUndo?: () => void; onExpire?: () => void; ms?: number } = {}) {
  const t: Toast = { id: next++, text, ms: opts.ms ?? 5000, ...opts };
  listeners.forEach((l) => l(t));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const l: Listener = (t) => {
      setItems((x) => [...x, t]);
      setTimeout(() => {
        setItems((x) => x.filter((y) => y.id !== t.id));
        t.onExpire?.();
      }, t.ms);
    };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex flex-col items-center gap-2" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} role="status" className="pointer-events-auto flex items-center gap-3 rounded-full bg-ink px-4 py-2 text-[13px] text-app shadow-(--shadow-float)">
          <span>{t.text}</span>
          {t.onUndo && (
            <button
              type="button"
              className="font-semibold underline-offset-2 hover:underline"
              onClick={() => {
                // Undo cancels the pending action: its expiry callback must not run.
                setItems((x) => x.filter((y) => y.id !== t.id));
                t.onExpire = undefined;
                t.onUndo?.();
              }}
            >
              {t.undoLabel ?? "Undo"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
