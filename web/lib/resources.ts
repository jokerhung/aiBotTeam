export type ResourceKind = "html" | "markdown" | "image" | "post";
export interface Resource {
  id: string; kind: ResourceKind; name: string; title: string; owner_bot: string | null;
  tags: string[]; current_version: number; version: number; version_count: number; ref: string; status: "draft" | "approved" | "published";
  url: string; viewer_url: string; size: number; updated_at: number; created_at: number; created_by: string;
  note: string; archived: boolean; missing: boolean; in_use?: boolean;
  preview_text?: string; preview_image?: { resource_id: string; version: number; alt: string }; run_count?: number; latest_run?: number | null;
  used_by?: ResourceUse[]; content?: string; alt?: string; truncated?: boolean;
  post?: { platform: string; text: string; hashtags: string[]; media: { resource_id: string; version: number; alt: string }[]; link?: string; scheduleHint?: string };
}
export interface ResourceUse { kind: "routine" | "resource"; id: string; title?: string; version: number; ref: string; source_ref?: string; source_version?: number }
export const resourceHash = (id: string, version: number) => `#/resources/${encodeURIComponent(id)}/v/${version}`;
export const resourceContent = (id: string, version: number) => `/api/resources/${encodeURIComponent(id)}/versions/${version}/content`;

/** Referenced images belong to their post/page card; the Images tab still lists every image. */
export function resourceLibraryItems(items: Resource[], kind: ResourceKind | ""): Resource[] {
  return kind === "image" ? items : items.filter((item) => item.kind !== "image" || !item.used_by?.some((use) => use.kind === "resource"));
}
