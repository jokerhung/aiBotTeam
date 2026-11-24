"use client";
import { useState, type MouseEvent, type ReactNode } from "react";
import { FilePreview, previewKind } from "./FilePreview";

/** A link to a screen of this app (an address with `#/…`, on this host or another that points at this app): opened in place, not in a new tab. */
export function appHash(href: string | undefined): string | null {
  if (!href || typeof window === "undefined") return null;
  try {
    const u = new URL(href, window.location.href);
    if (!/^https?:$/.test(u.protocol) || !u.hash.startsWith("#/") || u.pathname !== "/" || u.port !== window.location.port) return null;
    return u.hash;
  } catch { return null; }
}

export function AppLink({ href, children, className }: { href?: string; children: ReactNode; className?: string }) {
  const [preview, setPreview] = useState(false);
  const kind = previewKind(href);
  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const hash = appHash(href);
    if (hash) { e.preventDefault(); window.location.hash = hash; return; }
    if (kind) { e.preventDefault(); setPreview(true); }  // a picture or a text file: shown here in a pop-up
  };
  return (
    <>
      <a href={href} target="_blank" rel="noreferrer noopener" onClick={open} className={className ?? "text-accent-text underline underline-offset-2"}>{children}</a>
      {preview && href && kind && <FilePreview src={href} kind={kind} onClose={() => setPreview(false)} />}
    </>
  );
}

export const URL_RE = /https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g;

/** Plain text (a person's message) with its web addresses made into links. */
export function Linkify({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(<AppLink key={at} href={m[0]} className="underline underline-offset-2">{m[0]}</AppLink>);
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
