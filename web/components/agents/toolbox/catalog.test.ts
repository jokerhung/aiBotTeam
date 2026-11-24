import { describe, expect, it } from "vitest";
import { TOOLBOX_CATALOG, toolboxShelves } from "./catalog";
import { CAPABILITY_ART } from "./art.generated";
import { DRAWN_ART } from "./art.drawn";

describe("Toolbox reference catalog", () => {
  it("shows only implemented capabilities and omits empty shelves", () => {
    expect(TOOLBOX_CATALOG).toHaveLength(37);
    expect(new Set(TOOLBOX_CATALOG.map((entry) => entry.id)).size).toBe(37);
    expect(toolboxShelves("").map((shelf) => shelf.category)).toEqual(["Knowledge and memory", "Thinking and planning", "The web"]);
    const visible = toolboxShelves("").flatMap((shelf) => shelf.entries);
    expect(visible).toHaveLength(7);
    expect(visible.every((entry) => !!entry.resource)).toBe(true);
    expect(toolboxShelves("Charts")).toEqual([]);
    expect(TOOLBOX_CATALOG.filter((entry) => entry.resource).map((entry) => entry.resource)).toEqual(["resources", "memory", "skills", "apps", "subagents", "computer", "web"]);
    for (const entry of TOOLBOX_CATALOG) expect(CAPABILITY_ART[entry.artId ?? entry.id] ?? DRAWN_ART[entry.artId ?? entry.id], entry.id).toContain("<svg");
  });
  it("searches names, descriptions and translated labels without moving category order", () => {
    expect(toolboxShelves(" MEMORY ").flatMap((shelf) => shelf.entries).some((entry) => entry.id === "memory_files")).toBe(true);
    expect(toolboxShelves("Bộ nhớ", (text) => text === "Memory" ? "Bộ nhớ" : text).flatMap((shelf) => shelf.entries).map((entry) => entry.id)).toEqual(["memory_files"]);
    expect(toolboxShelves("not-a-capability")).toEqual([]);
  });
});
