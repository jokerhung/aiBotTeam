"use client";
/* eslint-disable react-hooks/set-state-in-effect -- these effects hydrate from localStorage or reset form state when a dialog opens or the target changes */
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Message } from "@/lib/wire";
import { useStore } from "@/state/store";

type Range = globalThis.Range;

/** Ctrl/Cmd+F inside the conversation: highlights every match in the transcript and steps through them. */
export function ChatFindBar({ scroller, messages }: { scroller: RefObject<HTMLDivElement | null>; messages: Message[] }) {
  const { dispatch } = useStore();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  const ranges = useRef<Range[]>([]);

  useEffect(() => {
    const root = scroller.current;
    const found: Range[] = [];
    const needle = q.trim().toLowerCase();
    if (root && needle) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n.nodeValue ?? "").toLowerCase();
        for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
          const r = document.createRange();
          r.setStart(n, at);
          r.setEnd(n, at + needle.length);
          found.push(r);
        }
      }
    }
    ranges.current = found;
    setCount(found.length);
    setIndex(0);
  }, [q, messages, scroller]);

  useEffect(() => {
    const h = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HL = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!h || !HL) return;
    h.set("find", new HL(...ranges.current));
    const cur = ranges.current[index];
    if (cur) {
      h.set("find-current", new HL(cur));
      cur.startContainer.parentElement?.scrollIntoView({ block: "center" });
    } else h.delete("find-current");
    return () => { h.delete("find"); h.delete("find-current"); };
  }, [index, count, q]);

  const step = (d: number) => count && setIndex((i) => (i + d + count) % count);
  return (
    <div role="search" className="absolute right-5 top-14 z-[30] flex items-center gap-1 rounded-full bg-composer py-1 pl-3.5 pr-1.5 ring-[0.5px] ring-ink/15 shadow-(--shadow-float)">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") dispatch({ type: "find", open: false });
          if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
        }}
        placeholder="Find in conversation"
        aria-label="Find in conversation"
        className="h-7 w-44 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-tertiary"
      />
      <span className="min-w-10 text-center text-[12px] tabular-nums text-ink-tertiary">{q.trim() ? (count ? `${index + 1}/${count}` : "0") : ""}</span>
      <button type="button" aria-label="Previous match" onClick={() => step(-1)} className="rounded-full p-1 text-ink-secondary hover:bg-ink/10"><ChevronUp size={14} /></button>
      <button type="button" aria-label="Next match" onClick={() => step(1)} className="rounded-full p-1 text-ink-secondary hover:bg-ink/10"><ChevronDown size={14} /></button>
      <button type="button" aria-label="Close find" onClick={() => dispatch({ type: "find", open: false })} className="rounded-full p-1 text-ink-secondary hover:bg-ink/10"><X size={14} /></button>
    </div>
  );
}
