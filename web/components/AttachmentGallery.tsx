"use client";
import { FileText } from "lucide-react";
import { useState } from "react";
import type { Attachment } from "@/lib/wire";
import { FilePreview, previewKind } from "./FilePreview";

const href = (a: Attachment) => `/api/attachments/${encodeURIComponent(a.name)}`;
const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Files sent with a message: images as thumbnails that open in a preview, other files as download chips. */
export function AttachmentGallery({ items }: { items: Attachment[] }) {
  const [open, setOpen] = useState<Attachment | null>(null);
  return (
    <>
      <div className="mb-1 flex flex-wrap gap-1.5">
        {items.map((a) =>
          a.image ? (
            <button key={a.name} type="button" title={a.filename} onClick={() => setOpen(a)} className="overflow-hidden rounded-xl ring-1 ring-ink/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={href(a)} alt={a.filename} className="max-h-40 max-w-[220px] object-cover" />
            </button>
          ) : previewKind(a.filename, a.mime) === "text" ? (
            <button key={a.name} type="button" title={a.filename} onClick={() => setOpen(a)} className="flex max-w-[240px] items-center gap-2 rounded-xl bg-ink/10 px-2.5 py-1.5 text-[13px] hover:bg-ink/15">
              <FileText size={15} className="shrink-0" />
              <span className="min-w-0 truncate">{a.filename}</span>
              <span className="shrink-0 text-[11px] opacity-70">{size(a.size)}</span>
            </button>
          ) : (
            <a key={a.name} href={href(a)} download={a.filename} className="flex max-w-[240px] items-center gap-2 rounded-xl bg-ink/10 px-2.5 py-1.5 text-[13px] hover:bg-ink/15">
              <FileText size={15} className="shrink-0" />
              <span className="min-w-0 truncate">{a.filename}</span>
              <span className="shrink-0 text-[11px] opacity-70">{size(a.size)}</span>
            </a>
          ),
        )}
      </div>
      {open && <FilePreview src={href(open)} kind={previewKind(open.filename, open.mime) ?? "image"} name={open.filename} downloadName={open.filename} onClose={() => setOpen(null)} />}
    </>
  );
}
