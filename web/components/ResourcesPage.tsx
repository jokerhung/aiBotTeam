"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Hydrate explicit server snapshots when the resource route or library filters change. */
/* eslint-disable @next/next/no-img-element -- Versioned local image endpoints retain resource authorization and immutable identity. */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Copy, Download, FileText, Globe, ImageIcon, MoreHorizontal, Package, Plus, X } from "lucide-react";
import { api } from "@/state/api";
import { useStore } from "@/state/store";
import { useT } from "@/lib/i18n";
import { resourceContent, resourceHash, resourceLibraryItems, type Resource, type ResourceKind, type ResourceUse } from "@/lib/resources";
import { PageFrame } from "./layout/PageFrame";
import { ChatMarkdown } from "./ChatMarkdown";
import { FilePreview } from "./FilePreview";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "./ui/dropdown-menu";
import { BUTTON, INPUT, PRIMARY, trapDialog } from "./agents/shared";

const TYPE_LABELS = { html: "Pages", markdown: "Markdown", image: "Images", post: "Posts" };
const ICONS = { html: Globe, markdown: FileText, image: ImageIcon, post: Package };
async function copy(text: string) {
  try { if (navigator.clipboard) { await navigator.clipboard.writeText(text); return; } } catch { /* plain HTTP and browser permission fallback */ }
  const field = document.createElement("textarea"); field.value = text; field.style.position = "fixed"; field.style.opacity = "0";
  document.body.appendChild(field); field.select(); document.execCommand("copy"); field.remove();
}

export function ResourceChatCard({ resource }: { resource: { resource_id: string; version: number; title: string; kind: string } }) {
  const t = useT();
  return <a data-testid="resource-chat-card" href={resourceHash(resource.resource_id, resource.version)} className="flex max-w-md items-center gap-3 rounded-xl border border-edge bg-composer p-3 text-sm hover:bg-raised"><Package size={20} /><span className="min-w-0"><span className="block truncate">{resource.title}</span><code className="text-xs text-ink-tertiary">{resource.resource_id}@v{resource.version}</code></span><span className="ml-auto text-xs">{t("Open")}</span></a>;
}

export function ResourcesPage() {
  const { state, dispatch } = useStore(); const t = useT();
  const [items, setItems] = useState<Resource[]>([]); const [kind, setKind] = useState<ResourceKind | "">(""); const [status, setStatus] = useState(""); const [query, setQuery] = useState(""); const [owner, setOwner] = useState(""); const [archived, setArchived] = useState(false); const [creating, setCreating] = useState(false); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { const result = await api<{ resources: Resource[] }>(`/api/resources?${new URLSearchParams({ archived: String(archived), ...(kind ? { kind } : {}), ...(status ? { status } : {}), ...(owner ? { bot: owner } : {}), ...(query ? { q: query } : {}) })}`); setItems(result.resources); setError(""); }
    catch (exc) { setError(exc instanceof Error ? exc.message : t("Could not load resources")); }
    finally { setLoading(false); }
  }, [archived, kind, status, owner, query, t]);
  useEffect(() => { void load(); const changed = () => void load(); window.addEventListener("resources-changed", changed); return () => window.removeEventListener("resources-changed", changed); }, [load]);
  const shown = resourceLibraryItems(items, kind).filter((item) => (!kind || item.kind === kind) && (!status || item.status === status) && (!owner || item.owner_bot === owner) && `${item.title} ${item.name} ${item.tags.join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const act = async (action: () => Promise<unknown>) => { try { await action(); await load(); } catch (exc) { setError(String(exc)); } };
  if (state.resourceId) return state.resourceVersion
    ? <ResourceViewer key={`${state.resourceId}@${state.resourceVersion}`} id={state.resourceId} version={state.resourceVersion} onClose={() => { location.hash = `#/resources/${encodeURIComponent(state.resourceId)}`; }} onChanged={() => void load()} />
    : <ResourceVersions key={state.resourceId} id={state.resourceId} onBack={() => dispatch({ type: "view", view: "resources" })} />;
  return <PageFrame title="Resources" icon={Package} testid="page-resources" wide actions={<button className={PRIMARY} onClick={() => setCreating(true)}><Plus size={15} />{t("New")}</button>}>
    <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label={t("Resource types")}>{(["", "post", "html", "markdown", "image"] as const).map((value) => <button key={value} role="tab" aria-selected={kind === value} className={`${BUTTON} ${kind === value ? "bg-raised font-medium" : ""}`} onClick={() => setKind(value)}>{t(value ? TYPE_LABELS[value] : "All")} <span className="text-xs text-ink-tertiary">{resourceLibraryItems(items, value).filter((item) => !value || item.kind === value).length}</span></button>)}</div>
    <div className="mb-5 flex flex-wrap gap-3"><input className={`${INPUT} max-w-xs`} aria-label={t("Search resources")} placeholder={t("Search resources")} value={query} onChange={(e) => setQuery(e.target.value)} /><select className={`${INPUT} max-w-44`} aria-label={t("Resource status")} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t("All statuses")}</option>{["draft", "approved", "published"].map((value) => <option key={value} value={value}>{t(value)}</option>)}</select><select className={`${INPUT} max-w-48`} aria-label={t("Resource owner")} value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">{t("All agents")}</option>{state.bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />{t("Archived")}</label></div>
    {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
    {loading ? <p className="py-16 text-center text-ink-tertiary">{t("Loading…")}</p> : !shown.length ? <div className="py-20 text-center"><Package className="mx-auto mb-4 text-ink-tertiary" size={32} /><h2 className="font-medium">{t("No resources yet")}</h2><p className="mx-auto mt-2 max-w-md text-sm text-ink-secondary">{t("Ask an agent to publish a report, image or post here, or create one yourself.")}</p></div> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{shown.map((item) => <ResourceTile key={item.id} item={item} owner={state.bots.find((bot) => bot.id === item.owner_bot)?.name ?? t("You")} act={act} />)}</div>}
    {creating && <ResourceForm onClose={() => setCreating(false)} onSaved={(resource) => { setCreating(false); void load(); location.hash = resourceHash(resource.id, resource.version); }} />}

  </PageFrame>;
}

function ResourceVersions({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useT();
  const [resource, setResource] = useState<Resource | null>(null);
  const [versions, setVersions] = useState<Resource[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [item, result] = await Promise.all([api<Resource>(`/api/resources/${id}`), api<{ versions: Resource[] }>(`/api/resources/${id}/versions`)]);
        if (active) { setResource(item); setVersions(result.versions); setError(""); }
      } catch (exc) { if (active) setError(String(exc)); }
      finally { if (active) setLoading(false); }
    };
    void load(); window.addEventListener("resources-changed", load);
    return () => { active = false; window.removeEventListener("resources-changed", load); };
  }, [id]);
  return <PageFrame title="Resource versions" icon={Package} testid="resource-versions" wide actions={<button className={BUTTON} onClick={onBack}><ArrowLeft size={14} />{t("Back to resources")}</button>}>
    <h2 data-no-i18n="" className="text-xl font-semibold">{resource?.title ?? id}</h2>
    <p className="mt-2 text-sm text-ink-secondary">{t("Choose a version to view its details.")}</p>
    <div className="mb-6 mt-2 flex items-center gap-3 text-xs text-ink-tertiary"><code>{id}</code>{resource && <span>{t(TYPE_LABELS[resource.kind])}</span>}<span>{versions.length} {t("Versions")}</span></div>
    {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
    {loading ? <p className="py-16 text-center text-ink-tertiary">{t("Loading…")}</p> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{versions.map((item) => {
      const Icon = ICONS[item.kind];
      return <a data-testid="resource-version-card" key={item.version} href={resourceHash(id, item.version)} className="overflow-hidden rounded-2xl border border-edge bg-panel transition-colors hover:bg-raised">
        <div className="relative grid h-32 place-items-center overflow-hidden bg-inset text-ink-tertiary">{(item.kind === "image" || item.preview_image) ? <img src={item.preview_image ? resourceContent(item.preview_image.resource_id, item.preview_image.version) : item.url} alt={item.preview_image?.alt || resource?.title || id} className="size-full object-cover" /> : <Icon size={32} />}<span className="absolute right-3 top-3 rounded-full border border-edge bg-panel px-3 py-1 text-sm font-medium text-ink">v{item.version}</span></div>
        <div className="space-y-3 p-4"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full bg-inset px-2 py-1">{t(item.status)}</span>{item.version === resource?.current_version && <span className="rounded-full bg-accent/10 px-2 py-1 text-accent-text">{t("Latest version")}</span>}{item.in_use && <span>{t("In use")}</span>}</div><code className="block truncate text-xs text-ink-tertiary">{item.ref}</code>{item.note && <p data-no-i18n="" className="line-clamp-2 text-sm">{item.note}</p>}<p className="text-xs text-ink-secondary">{new Date(item.created_at).toLocaleString()} · {(item.size / 1024).toFixed(1)} KB</p><span className="inline-block text-sm font-medium">{t("View details")}</span></div>
      </a>;
    })}</div>}
  </PageFrame>;
}

function ResourceTile({ item, owner, act }: { item: Resource; owner: string; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const t = useT(); const Icon = ICONS[item.kind];
  return <article data-testid="resource-card" className="overflow-hidden rounded-xl border border-edge bg-composer">
    <a href={`#/resources/${encodeURIComponent(item.id)}`} className="grid h-36 place-items-center overflow-hidden bg-inset text-ink-tertiary">{(item.kind === "image" || item.preview_image) ? <img src={item.preview_image ? resourceContent(item.preview_image.resource_id, item.preview_image.version) : item.url} alt={item.title} className="size-full object-cover" /> : <Icon size={36} />}</a>
    <div className="p-4"><div className="flex gap-2 text-[11px]"><span className="rounded bg-raised px-2 py-0.5">{t(TYPE_LABELS[item.kind])}</span><span className={`rounded px-2 py-0.5 ${item.status === "draft" ? "bg-warning/15" : "bg-success/15"}`}>{t(item.status)}</span></div><h2 className="mt-3 truncate font-medium" title={item.title}><a href={`#/resources/${encodeURIComponent(item.id)}`}>{item.title}</a></h2><code className="text-xs text-ink-tertiary">{item.id} · {item.version_count} {t("Versions")}</code><p className="mt-2 truncate text-xs text-ink-secondary">{owner} · {new Date(item.updated_at).toLocaleString()}</p><p className="mt-1 text-xs text-ink-tertiary">{t("Used by routines")}: {item.used_by?.filter((use) => use.kind === "routine").length ?? 0} · {(item.size / 1024).toFixed(1)} KB</p>
      <div className="mt-4 flex flex-wrap gap-2"><a className={BUTTON} href={`#/resources/${encodeURIComponent(item.id)}`}>{t("Open")}</a>
        <DropdownMenu><DropdownMenuTrigger className={BUTTON} aria-label={t("Resource actions")}><MoreHorizontal size={16} /></DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={6} className="w-48 border border-edge bg-panel text-ink shadow-xl"><DropdownMenuItem onClick={() => copy(item.ref)}>{t("Copy reference")}</DropdownMenuItem><DropdownMenuItem onClick={() => { const title = prompt(t("Title"), item.title); if (title) void act(() => api(`/api/resources/${item.id}`, { method: "PATCH", body: JSON.stringify({ title }) })); }}>{t("Rename")}</DropdownMenuItem><DropdownMenuItem onClick={() => { const tags = prompt(t("Tags (comma separated)"), item.tags.join(", ")); if (tags !== null) void act(() => api(`/api/resources/${item.id}`, { method: "PATCH", body: JSON.stringify({ tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) }) })); }}>{t("Tags")}</DropdownMenuItem><DropdownMenuItem onClick={() => void act(() => api(`/api/resources/${item.id}`, { method: "PATCH", body: JSON.stringify({ archived: !item.archived }) }))}>{t(item.archived ? "Restore" : "Archive")}</DropdownMenuItem><DropdownMenuItem className="text-danger focus:text-danger" onClick={() => { if (confirm(t("Delete this resource? Referenced routines will stop working."))) void act(() => api(`/api/resources/${item.id}?force=true`, { method: "DELETE" })); }}>{t("Delete")}</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  </article>;
}

function ResourceForm({ item, onClose, onSaved }: { item?: Resource; onClose: () => void; onSaved: (resource: Resource) => void }) {
  const t = useT(); const [kind, setKind] = useState<ResourceKind>(item?.kind ?? "post"); const [title, setTitle] = useState(item?.title ?? ""); const [name, setName] = useState(item?.name ?? ""); const [text, setText] = useState(item?.post?.text ?? item?.content ?? ""); const [platform, setPlatform] = useState(item?.post?.platform ?? "threads"); const [images, setImages] = useState(item?.post?.media.map((image) => `${image.resource_id}@v${image.version}`).join("\n") ?? ""); const [alt, setAlt] = useState(item?.alt ?? ""); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try {
      const path = item ? `/api/resources/${item.id}/versions` : "/api/resources";
      let body: BodyInit;
      let headers: HeadersInit | undefined;
      if (file) {
        const form = new FormData(); form.set("file", file); form.set("kind", kind); form.set("name", name); form.set("title", title); form.set("alt", alt); if (item) form.set("base_version", String(item.version)); body = form;
      } else {
        headers = { "content-type": "application/json" };
        body = JSON.stringify({ kind, name, title, ...(item ? { base_version: item.version } : {}), ...(kind === "post" ? { text, platform, images: images.split("\n").map((value) => value.trim()).filter(Boolean) } : { content: text }) });
      }
      const response = await fetch(path, { method: "POST", headers, body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? response.statusText);
      onSaved(result);
    } catch (exc) { setError(exc instanceof Error ? exc.message : String(exc)); } finally { setBusy(false); }
  };
  return <div role="dialog" aria-modal="true" aria-label={t(item ? "Edit resource" : "New resource")} className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 p-4" onKeyDown={(e) => trapDialog(e, onClose)}><div className="max-h-[92vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl bg-panel p-5"><header className="flex items-center"><h2 className="flex-1 font-medium">{t(item ? "Edit resource" : "New resource")}</h2><button className={BUTTON} aria-label={t("Close")} onClick={onClose}><X size={16} /></button></header><label className="block text-sm">{t("Resource type")}<select className={`${INPUT} mt-1`} value={kind} disabled={!!item} onChange={(e) => setKind(e.target.value as ResourceKind)}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label><label className="block text-sm">{t("Title")}<input className={`${INPUT} mt-1`} value={title} onChange={(e) => { setTitle(e.target.value); if (!item) setName(e.target.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80)); }} maxLength={200} /></label>{!item && <label className="block text-sm">{t("Resource name")}<input className={`${INPUT} mt-1`} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>}
    {kind === "post" ? <><label className="block text-sm">{t("Platform")}<input className={`${INPUT} mt-1`} value={platform} onChange={(e) => setPlatform(e.target.value)} /></label><label className="block text-sm">{t("Caption")}<textarea className={`${INPUT} mt-1 min-h-40`} value={text} onChange={(e) => setText(e.target.value)} maxLength={20000} /></label><label className="block text-sm">{t("Image references (one res_id@vN per line)")}<textarea className={`${INPUT} mt-1`} value={images} onChange={(e) => setImages(e.target.value)} /></label></> : <>{kind !== "image" && <label className="block text-sm">{t("Content")}<textarea className={`${INPUT} mt-1 min-h-60 font-mono`} value={text} onChange={(e) => setText(e.target.value)} /></label>}<label className="block text-sm">{t("Upload file")}<input type="file" className="mt-1 block w-full text-sm" accept={kind === "image" ? ".png,.jpg,.jpeg,.gif,.webp" : kind === "html" ? ".html" : ".md,.txt"} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>{kind === "image" && <label className="block text-sm">{t("Image description")}<input className={`${INPUT} mt-1`} value={alt} onChange={(e) => setAlt(e.target.value)} /></label>}</>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}<p className="text-xs text-ink-tertiary">{t("Saving creates a new draft version. Existing approvals and routine references stay on their original version.")}</p><button className={PRIMARY} disabled={busy || !title.trim() || (!item && !name)} onClick={() => void save()}>{t(busy ? "Saving…" : "Save")}</button></div></div>;
}

function ResourceViewer({ id, version, onClose, onChanged }: { id: string; version: number | null; onClose: () => void; onChanged: () => void }) {
  const { dispatch } = useStore(); const t = useT(); const [item, setItem] = useState<Resource | null>(null); const [versions, setVersions] = useState<Resource[]>([]); const [uses, setUses] = useState<ResourceUse[]>([]); const [error, setError] = useState(""); const [edit, setEdit] = useState(false); const [image, setImage] = useState<{ src: string; name: string } | null>(null);
  const load = useCallback(async () => {
    try {
      let number = version;
      if (!number) { const current = await api<Resource>(`/api/resources/${id}`); number = current.version; history.replaceState(null, "", resourceHash(id, number)); dispatch({ type: "openResource", id, version: number }); }
      const [resource, historyRows, used] = await Promise.all([api<Resource>(`/api/resources/${id}/versions/${number}`), api<{ versions: Resource[] }>(`/api/resources/${id}/versions`), api<{ used_by: ResourceUse[] }>(`/api/resources/${id}/used-by`)]);
      if (resource.kind === "markdown" && resource.truncated) {
        const response = await fetch(resource.url);
        if (!response.ok) throw new Error("Could not load resource content");
        resource.content = await response.text();
      }
      setItem(resource); setVersions(historyRows.versions); setUses(used.used_by); setError("");
    } catch (exc) { setError(String(exc)); }
  }, [id, version, dispatch]);
  useEffect(() => { void load(); const refresh = () => void load(); window.addEventListener("resources-changed", refresh); return () => window.removeEventListener("resources-changed", refresh); }, [load]);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); onChanged(); } catch (exc) { setError(String(exc)); } };
  const status = () => item && void act(() => api(`/api/resources/${id}/versions/${item.version}`, { method: "PATCH", body: JSON.stringify({ status: item.status === "draft" ? "approved" : "draft" }) }));
  return <PageFrame title="Resource preview" icon={Package} testid="resource-viewer" wide actions={<button className={BUTTON} onClick={onClose}><ArrowLeft size={14} />{t("Back to versions")}</button>}><div className="rounded-xl border border-edge bg-panel"><header className="flex flex-wrap items-center gap-3 border-b border-edge p-4"><h2 className="min-w-0 flex-1 truncate text-sm font-medium">{item?.title ?? t("Resource preview")}</h2>{item && <><code className="text-xs">{item.ref}</code><select aria-label={t("Resource version")} className="rounded-lg bg-inset p-2 text-xs" value={item.version} onChange={(e) => { location.hash = resourceHash(id, Number(e.target.value)); }}>{versions.map((row) => <option key={row.version} value={row.version}>v{row.version} · {t(row.status)}{row.in_use ? ` · ${t("In use")}` : ""}</option>)}</select><a className={BUTTON} aria-label={t("Download")} href={`${item.url}?download=true`} download><Download size={14} /></a><button className={BUTTON} aria-label={t("Copy reference")} onClick={() => copy(item.ref)}><Copy size={14} /></button></>}</header>
    <div className="min-h-0 flex-1 overflow-auto p-5">{error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}{item && <>{item.kind === "html" ? <iframe title={item.ref} sandbox="allow-scripts" src={item.url} className="h-[60vh] w-full rounded-lg border border-edge bg-white" /> : item.kind === "markdown" ? <ChatMarkdown text={item.content ?? ""} /> : item.kind === "image" ? <button className="block w-full" onClick={() => setImage({ src: item.url, name: item.ref })}><img src={item.url} alt={item.alt ?? item.title} className="mx-auto max-h-[65vh] object-contain" /></button> : item.post && <article className="mx-auto max-w-xl overflow-hidden rounded-xl border border-edge bg-composer"><div className="p-4 text-sm font-medium">{item.post.platform}</div><div className="space-y-3">{item.post.media.map((media) => <figure key={`${media.resource_id}-${media.version}`}><button className="block w-full" onClick={() => setImage({ src: resourceContent(media.resource_id, media.version), name: `${media.resource_id}@v${media.version}` })}><img src={resourceContent(media.resource_id, media.version)} alt={media.alt} className="max-h-96 w-full object-contain" /></button><figcaption className="px-4 py-1 text-xs text-ink-tertiary"><a href={resourceHash(media.resource_id, media.version)}>{media.resource_id}@v{media.version}</a></figcaption></figure>)}</div><p className="whitespace-pre-wrap px-4 pb-4 text-sm">{item.post.text}</p><button className={`${BUTTON} mb-4 ml-4`} onClick={() => copy(item.post!.text)}>{t("Copy caption")}</button></article>}
      <div className="my-5 flex flex-wrap gap-2"><button className={PRIMARY} onClick={status}>{t(item.status === "draft" ? "Approve" : "Back to draft")}</button><button className={BUTTON} onClick={() => setEdit(true)}>{t("Edit")}</button><button className={BUTTON} onClick={() => void act(async () => { const result = await api<Resource>(`/api/resources/${id}/versions`, { method: "POST", body: JSON.stringify({ base_version: item.current_version, restore: item.version }) }); location.hash = resourceHash(id, result.version); })}>{t("Restore this version")}</button><span className="self-center text-xs text-ink-secondary">{t(item.status)}</span></div>
      <p className="mb-3 text-xs text-ink-tertiary">{t("Completed resource runs")}: {item.run_count ?? 0}{item.latest_run ? ` / ${new Date(item.latest_run).toLocaleString()}` : ""}</p><section className="border-t border-edge pt-4"><h3 className="mb-2 text-sm font-medium">{t("Used by")}</h3>{!uses.length && <p className="text-xs text-ink-tertiary">{t("No references")}</p>}{uses.map((use) => <div key={`${use.kind}-${use.id}-${use.source_version ?? use.version}`} className="mb-2 flex flex-wrap items-center gap-2 text-xs"><a className="underline underline-offset-2" href={use.kind === "routine" ? "#/routines" : resourceHash(use.id, use.source_version ?? 1)}>{use.title ?? use.source_ref ?? use.id}</a><a href={resourceHash(id, use.version)}><code>{use.ref}</code></a>{use.version < item.current_version && <><span className="text-warning">{t("Newer version available")}: v{item.current_version}</span>{use.kind === "routine" && <button className={BUTTON} onClick={() => void act(() => api(`/api/routines/${use.id}`, { method: "PATCH", body: JSON.stringify({ resource_version: item.current_version }) }))}>{t("Use current version")}</button>}</>}</div>)}</section>
    </>}</div></div>{edit && item && <ResourceForm key={item.ref} item={item} onClose={() => setEdit(false)} onSaved={(resource) => { setEdit(false); location.hash = resourceHash(id, resource.version); onChanged(); }} />}{image && <FilePreview {...image} kind="image" onClose={() => setImage(null)} />}</PageFrame>;
}
