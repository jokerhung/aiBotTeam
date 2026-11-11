"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the live region is updated when a message arrives */
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/state/store";

/** A polite live region that reads out what a bot says (or asks) in the conversation on screen, for people who cannot see the chat. */
export function TranscriptAnnouncer() {
  const { state } = useStore();
  const [text, setText] = useState("");
  const seen = useRef<{ thread: string; id: string | null }>({ thread: "", id: null });
  const bot = state.bots.find((b) => b.id === state.selectedId);
  const group = state.groups.find((g) => g.id === state.selectedGroupId);
  const thread = group?.threadId ?? bot?.threadId ?? "";
  const list = state.messages[thread];
  useEffect(() => {
    const last = list?.length ? list[list.length - 1] : undefined;
    if (!last) { seen.current = { thread, id: null }; return; }
    const first = seen.current.thread !== thread;  // opening a conversation is not news
    const fresh = seen.current.id !== last.id;
    seen.current = { thread, id: last.id };
    if (first || !fresh || last.role !== "bot" || last.streaming) return;
    const who = last.author ? state.bots.find((b) => b.id === last.author)?.name : bot?.name;
    if (last.kind === "request" && last.request?.status === "open") setText(`${who ?? "A bot"} needs you: ${last.request.summary}`);
    else if (last.kind === "text" && last.text) setText(`${who ?? "Bot"}: ${last.text.slice(0, 400)}`);
    else if (last.kind === "error") setText(`Error: ${last.text}`);
  }, [list, thread, bot?.name, state.bots]);
  return <div data-testid="transcript-announcer" role="status" aria-live="polite" aria-atomic="true" className="sr-only">{text}</div>;
}
