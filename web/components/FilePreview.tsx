"use client";
import { Download, ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;
const TEXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|log|xml|ya?ml|toml|ini|env|conf|html?|css|js|jsx|ts|tsx|py|sh|bat|ps1|sql|rb|go|rs|java|kt|c|h|cpp|cs|php)$/i;
const MAX_CHARS = 200_000;

export type PreviewKind = "image" | "text";

/** What a link or a file name points at, if it can be shown in a pop-up: a picture or a plain-text file. */
export function previewKind(ref: string | undefined, mime?: string): PreviewKind | null {
  if (mime) {
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("text/") || /json|xml|yaml|csv/.test(mime)) return "text";
  }
  if (!ref) return null;
  let path = ref;
  try { path = decodeURIComponent(new URL(ref, "http://x").pathname); } catch { /* use as written */ }
  return IMAGE.test(path) ? "image" : TEXT.test(path) ? "text" : null;
}

const nameOf = (src: string) => { try { return decodeURIComponent(new URL(src, "http://x").pathname.split("/").pop() || src); } catch { return src; } };

/** A pop-up that shows a picture or the text of a file, with Download and Open in a new tab. Esc, the backdrop or the X closes it. */
export function FilePreview({ src, kind, name, downloadName, onClose }: { src: string; kind: PreviewKind; name?: string; downloadName?: string; onClose: () => void }) {
  const t = useT();
  const title = name ?? nameOf(src);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (kind !== "text") return;
    let cancelled = false;
    fetch(src).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((body) => { if (!cancelled) setText(body.length > MAX_CHARS ? `${body.slice(0, MAX_CHARS)}\n…` : body); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [src, kind]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} data-testid="file-preview" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-full w-full max-w-[min(960px,100%)] flex-col overflow-hidden rounded-2xl bg-panel text-ink shadow-xl ring-1 ring-ink/10">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-4">
          <span data-no-i18n="" className="min-w-0 flex-1 truncate text-[14px] font-medium">{title}</span>
          <a href={src} download={downloadName ?? title} title={t("Download")} aria-label={t("Download")} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><Download size={15} /></a>
          <a href={src} target="_blank" rel="noreferrer noopener" title={t("Open in a new tab")} aria-label={t("Open in a new tab")} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><ExternalLink size={15} /></a>
          <button type="button" autoFocus aria-label={t("Close preview")} onClick={onClose} className="rounded-full p-1.5 text-ink-secondary hover:bg-ink/10"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-app">
          {kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={title} className="mx-auto max-h-[80vh] max-w-full object-contain" />
          ) : error ? (
            <div role="alert" className="p-6 text-center text-[13.5px] text-ink-secondary">{t("This file cannot be shown here.")} <a href={src} target="_blank" rel="noreferrer noopener" className="text-accent-text underline">{t("Open in a new tab")}</a></div>
          ) : text === null ? (
            <div role="status" className="p-6 text-center text-[13.5px] text-ink-tertiary">{t("Loading…")}</div>
          ) : (
            <pre data-no-i18n="" data-testid="file-preview-text" className="whitespace-pre-wrap break-words p-4 font-mono text-[12.5px] leading-5">{text}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
