"use client";
/* eslint-disable react-hooks/set-state-in-effect -- these effects hydrate from localStorage or reset form state when a dialog opens or the target changes */
import { ArrowUp, AudioLines, FileUp, FolderOpen, ImagePlus, Pencil, Plus, Shield, Square, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { tr, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { APPROVAL_MODES, type ApprovalMode, type Attachment, type Bot } from "@/lib/wire";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { ApprovalModeSelector } from "./ApprovalModeSelector";

const MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_MODE: ApprovalMode = "full";
const draftKey = (thread: string) => `botteam-draft:${thread}`;

interface Chip {
  key: string;
  filename: string;
  image: boolean;
  preview?: string;
  state: "uploading" | "done" | "error";
  error?: string;
  attachment?: Attachment;
}

async function upload(file: File): Promise<Attachment> {
  const res = await fetch("/api/attachments", {
    method: "POST",
    headers: { "x-filename": encodeURIComponent(file.name || "file"), "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : `Upload failed (${res.status})`);
  return body as Attachment;
}

export function Composer({ bot, dock }: { bot: Bot; dock?: React.ReactNode }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const thread = bot.threadId;
  const [text, setText] = useState("");
  const [wrapped, setWrapped] = useState(false);
  const [chips, setChips] = useState<Chip[]>([]);
  const [dragging, setDragging] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const inst = state.instances.find((i) => i.id === bot.modelSelection.instanceId);
  const canImages = !!inst?.capabilities.images;

  // Drafts live per conversation in localStorage.
  useEffect(() => {
    try { setText(localStorage.getItem(draftKey(thread)) ?? ""); } catch { setText(""); }
    setChips([]);
  }, [thread]);
  // Saved when it changes (not from an effect), so a dev-mode effect re-run cannot wipe it.
  const saveDraft = useCallback((v: string) => {
    setText(v);
    try { if (v) localStorage.setItem(draftKey(thread), v); else localStorage.removeItem(draftKey(thread)); } catch { /* storage unavailable */ }
  }, [thread]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
    setWrapped(el.scrollHeight > 36);
  }, [text]);

  useEffect(() => { ref.current?.focus(); }, [bot.id]);

  const addFiles = useCallback((files: File[]) => {
    for (const file of files) {
      const image = file.type.startsWith("image/");
      const key = crypto.randomUUID();
      if (image && !canImages) {
        setChips((c) => [...c, { key, filename: file.name, image, state: "error", error: `${inst?.displayName ?? "This engine"} cannot read images` }]);
        continue;
      }
      if (file.size > MAX_BYTES) {
        setChips((c) => [...c, { key, filename: file.name, image, state: "error", error: "Larger than 100 MB" }]);
        continue;
      }
      const preview = image ? URL.createObjectURL(file) : undefined;
      setChips((c) => [...c, { key, filename: file.name || "pasted file", image, preview, state: "uploading" }]);
      upload(file)
        .then((attachment) => setChips((c) => c.map((x) => (x.key === key ? { ...x, state: "done", attachment } : x))))
        .catch((e: Error) => setChips((c) => c.map((x) => (x.key === key ? { ...x, state: "error", error: e.message } : x))));
    }
  }, [canImages, inst?.displayName]);

  const ready = chips.every((c) => c.state !== "uploading");
  const sendable = (text.trim() !== "" || chips.some((c) => c.state === "done")) && ready;

  const send = async () => {
    if (!sendable) return;
    const t = text.trim();
    const atts = chips.filter((c) => c.state === "done" && c.attachment).map((c) => c.attachment!);
    const sendId = crypto.randomUUID();
    const before = { text, chips };
    saveDraft("");
    setChips([]);
    dispatch({
      type: "optimistic",
      threadId: thread,
      message: { id: `pending-${sendId}`, sendId, role: "user", kind: "text", text: t, at: Date.now(), pending: true, attachments: atts },
    });
    try {
      await api(`/api/bots/${bot.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: t || "(see attached)", sendId, threadId: thread, attachments: atts.map((a) => a.name) }),
      });
    } catch {
      dispatch({ type: "optimisticFailed", threadId: thread, sendId });
      saveDraft(before.text);
      setChips(before.chips);
    }
  };

  const setMode = (mode: ApprovalMode) => {
    void api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ approvalMode: mode }) });
    setModeOpen(false);
  };
  const chooseFolder = () => {
    const dir = window.prompt(tr("Working folder for this bot (absolute path)"), bot.cwd ?? "");
    if (dir !== null) void api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ cwd: dir.trim() || null }) });
  };

  // A queued message can be pulled back into the box to edit it before it runs.
  const queued = (state.messages[thread] ?? []).filter((m) => m.queued);
  const editQueued = async (id: string, body: string) => {
    await api(`/api/bots/${bot.id}/queue/${id}?thread=${thread}`, { method: "DELETE" }).catch(() => {});
    saveDraft(body);
    ref.current?.focus();
  };

  const round = "flex size-7 shrink-0 items-center justify-center rounded-full";
  const modeLabel = APPROVAL_MODES.find((m) => m.id === bot.approvalMode)?.label ?? bot.approvalMode;
  return (
    <div
      className="chat-column-dock pointer-events-none absolute inset-x-0 bottom-0 z-[2]"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); addFiles([...e.dataTransfer.files]); } setDragging(false); }}
    >
      <div className="pointer-events-none relative px-5 pb-4">
        <div className="pointer-events-auto relative w-full">
          <div className="relative">
            <div className="pointer-events-none absolute -left-5 -right-5 -bottom-4 top-0 bg-app" />
            {dock && <div className="relative z-[1]">{dock}</div>}
            <div
              className={cn(
                "relative z-[1] bg-composer p-2 ring-[0.5px] ring-ink/10 hover:ring-ink/[0.22] focus-within:ring-ink/[0.22]",
                "shadow-[0_2px_8px_-1px_rgb(0_0_0/0.05),0_1px_2px_rgb(0_0_0/0.03)] [transition:border-radius_300ms,box-shadow_150ms]",
                wrapped || chips.length ? "rounded-[18px]" : "rounded-[22px]",
                dragging && "ring-2 ring-accent",
              )}
            >
              {queued.length > 0 && (
                <div className="mb-1.5 flex flex-col gap-1 px-1">
                  {queued.map((q) => (
                    <div key={q.id} className="flex items-center gap-2 rounded-lg bg-ink/[0.05] px-2.5 py-1 text-[13px] text-ink-secondary opacity-80">
                      <span className="min-w-0 flex-1 truncate" data-no-i18n={undefined}>{`Queued: ${q.text}`}</span>
                      <button type="button" title="Edit" aria-label="Edit queued message" onClick={() => editQueued(q.id, q.text)} className="rounded-full p-1 hover:bg-ink/10"><Pencil size={12} /></button>
                      <button type="button" title="Remove" aria-label="Remove queued message" onClick={() => api(`/api/bots/${bot.id}/queue/${q.id}?thread=${thread}`, { method: "DELETE" }).catch(() => {})} className="rounded-full p-1 hover:bg-ink/10"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
              {chips.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5 px-1" aria-label="Attachments">
                  {chips.map((c) => (
                    <div key={c.key} title={c.error ?? c.filename}
                      className={cn("flex max-w-[220px] items-center gap-1.5 rounded-xl bg-ink/[0.07] py-1 pl-1.5 pr-1 text-[12.5px]", c.state === "error" && "bg-danger/15 text-danger")}>
                      {c.preview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.preview} alt="" className="size-6 rounded object-cover" />
                      ) : (
                        <FileUp size={14} className="shrink-0" />
                      )}
                      <span className="min-w-0 truncate">{c.state === "error" ? c.error : c.filename}</span>
                      {c.state === "uploading" && <span className="size-3 shrink-0 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />}
                      <button type="button" aria-label={`Remove ${c.filename}`} onClick={() => setChips((x) => x.filter((y) => y.key !== c.key))} className="rounded-full p-0.5 hover:bg-ink/15"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-1.5">
                <Popover open={plusOpen} onOpenChange={setPlusOpen}>
                  <PopoverTrigger
                    title="Add"
                    aria-label="Add"
                    className={cn(round, "bg-ink/[0.05] ring-[0.5px] ring-inset ring-ink/[0.07] text-ink-tertiary transition-colors hover:bg-ink/[0.09] hover:text-ink")}
                  >
                    <Plus size={16} />
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" className="w-[240px] gap-0 rounded-xl bg-menu p-1.5 text-ink ring-1 ring-ink/10">
                    <button type="button" onClick={() => { setPlusOpen(false); fileInput.current?.click(); }} className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[14px] hover:bg-menu-hover"><FileUp size={15} /> {t("Attach file")}</button>
                    <button type="button" disabled={!canImages} title={canImages ? undefined : "This engine cannot read images"} onClick={() => { setPlusOpen(false); imageInput.current?.click(); }}
                      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[14px] hover:bg-menu-hover disabled:opacity-40"><ImagePlus size={15} /> {t("Attach image")}</button>
                    <button type="button" onClick={() => { setPlusOpen(false); chooseFolder(); }} className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[14px] hover:bg-menu-hover">
                      <FolderOpen size={15} /> {t("Choose folder")}
                      {bot.cwd ? <span className="ml-auto max-w-[80px] truncate text-[11px] text-ink-tertiary">{bot.cwd.split(/[\\/]/).pop()}</span> : null}
                    </button>
                    <div className="my-1 border-t border-ink/10" />
                    <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{t("Approval")}</div>
                    <ApprovalModeSelector compact value={bot.approvalMode} onChange={(m) => { setPlusOpen(false); setMode(m); }} />
                  </PopoverContent>
                </Popover>
                <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
                <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
                {bot.approvalMode !== DEFAULT_MODE && (
                  <Popover open={modeOpen} onOpenChange={setModeOpen}>
                    <PopoverTrigger title="Approval mode" aria-label={`Approval mode: ${modeLabel}`}
                      className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-ink/[0.07] px-2.5 text-[12px] text-ink-secondary hover:bg-ink/[0.12]">
                      <Shield size={12} /> {modeLabel}
                    </PopoverTrigger>
                    <PopoverContent side="top" align="start" className="w-[280px] gap-0 rounded-xl bg-menu p-1.5 text-ink ring-1 ring-ink/10">
                      <ApprovalModeSelector compact value={bot.approvalMode} onChange={setMode} />
                    </PopoverContent>
                  </Popover>
                )}
                <div className="relative min-w-0 flex-1 self-center">
                  <textarea
                    ref={ref}
                    rows={1}
                    dir="auto"
                    value={text}
                    onChange={(e) => saveDraft(e.target.value)}
                    onPaste={(e) => {
                      const files = [...e.clipboardData.files];
                      if (files.length) { e.preventDefault(); addFiles(files); }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    placeholder={dock ? t("Answer the approval above to continue") : `${t("Message")} ${bot.name}`}
                    disabled={!!dock}
                    aria-label={`Message ${bot.name}`}
                    className="block max-h-[9rem] min-h-7 w-full resize-none overflow-y-auto bg-transparent px-0.5 py-1 text-[14px] leading-5 text-ink outline-none placeholder:text-ink-tertiary"
                  />
                </div>
                {bot.threadBusy && !sendable ? (
                  <button type="button" title="Stop" aria-label="Stop" onClick={() => api(`/api/bots/${bot.id}/interrupt?thread=${thread}`, { method: "POST" })} className={cn(round, "bg-ink text-app")}>
                    <Square size={11} fill="currentColor" />
                  </button>
                ) : sendable ? (
                  <button type="button" title="Send" aria-label="Send" onClick={send} className={cn(round, "bg-accent text-[var(--color-accent-ink)]")}>
                    <ArrowUp size={16} />
                  </button>
                ) : (
                  <button
                    type="button"
                    title={`Live call with ${bot.name}`}
                    style={{ background: `var(--identity-${bot.color})` }}
                    className={cn(round, "text-white transition-[filter] hover:brightness-110")}
                  >
                    <AudioLines size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
