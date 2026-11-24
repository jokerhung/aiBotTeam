"use client";
import { useEffect, useState } from "react";
import { api } from "@/state/api";
import { useT } from "@/lib/i18n";
import type { Routine } from "@/lib/wire";
import { resourceHash, type Resource } from "@/lib/resources";

export function RoutineResourceFields({ id, version, requireApproved, onChange }: { id: string; version: number | null; requireApproved: boolean; onChange: (id: string, version: number | null, requireApproved: boolean) => void }) {
  const t = useT(); const [resources, setResources] = useState<Resource[]>([]); const [versions, setVersions] = useState<Resource[]>([]); const [error, setError] = useState("");
  useEffect(() => { void api<{ resources: Resource[] }>("/api/resources").then((result) => setResources(result.resources)).catch((exc: Error) => setError(exc.message)); }, []);
  useEffect(() => { if (id) void api<{ versions: Resource[] }>(`/api/resources/${id}/versions`).then((result) => setVersions(result.versions)).catch((exc: Error) => setError(exc.message)); }, [id]);
  const selected = versions.find((item) => item.id === id && item.version === version);
  return <section className="space-y-3 rounded-xl border border-edge p-3"><label className="block text-sm">{t("Resource")}<select aria-label={t("Resource")} className="mt-1 w-full rounded-lg bg-inset p-2" value={id} onChange={(e) => { const item = resources.find((item) => item.id === e.target.value); onChange(e.target.value, item?.version ?? null, item?.kind === "post"); }}><option value="">{t("None")}</option>{id && !resources.some((item) => item.id === id) && <option value={id}>{id}</option>}{resources.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.ref}</option>)}</select></label>
    {id && <><label className="block text-sm">{t("Version")}<select aria-label={t("Resource version")} className="mt-1 w-full rounded-lg bg-inset p-2" value={version ?? ""} onChange={(e) => onChange(id, Number(e.target.value), requireApproved)}>{versions.filter((item) => item.id === id).map((item) => <option key={item.version} value={item.version}>v{item.version} · {t(item.status)}{item.in_use ? ` · ${t("In use")}` : ""}</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={requireApproved} onChange={(e) => onChange(id, version, e.target.checked)} />{t("Only run when approved")}</label>{selected && requireApproved && selected.status === "draft" && <p role="status" className="text-xs text-warning">{t("This version is not approved. Runs will be skipped until you approve it.")}</p>}{selected && selected.version < selected.current_version && <p className="text-xs text-warning">{t("Newer version available")}: v{selected.current_version}</p>}</>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </section>;
}

export function RoutineResourceBadge({ routine }: { routine: Routine }) {
  const t = useT(); const [item, setItem] = useState<Resource | null>(null);
  useEffect(() => {
    const load = () => { if (routine.resource_id && routine.resource_version) void api<Resource>(`/api/resources/${routine.resource_id}/versions/${routine.resource_version}`).then(setItem).catch(() => setItem(null)); };
    load(); window.addEventListener("resources-changed", load);
    return () => window.removeEventListener("resources-changed", load);
  }, [routine.resource_id, routine.resource_version]);
  if (!routine.resource_id || !routine.resource_version) return null;
  return <div className="mt-2 text-xs"><a className="inline-block rounded-md bg-accent/10 px-2 py-1" href={resourceHash(routine.resource_id, routine.resource_version)}>{routine.resource_id}@v{routine.resource_version}</a>{item?.status === "draft" && routine.require_approved && <p className="mt-1 text-warning">{t("Waiting for resource approval")}</p>}{item && item.version < item.current_version && <p className="mt-1 text-warning">{t("Newer version available")}: v{item.current_version}</p>}</div>;
}
