import { expect, it } from "vitest";
import { resourceLibraryItems, type Resource } from "./resources";

it("groups referenced images under their parent while retaining standalone images and the explicit Images view", () => {
  const items = [
    { id: "post", kind: "post", used_by: [] },
    { id: "photo", kind: "image", used_by: [{ kind: "resource", id: "post" }] },
    { id: "standalone", kind: "image", used_by: [] },
    { id: "report", kind: "markdown", used_by: [] },
  ] as unknown as Resource[];
  expect(resourceLibraryItems(items, "").map(item => item.id)).toEqual(["post", "standalone", "report"]);
  expect(resourceLibraryItems(items, "image").map(item => item.id)).toEqual(items.map(item => item.id));
  expect(items).toHaveLength(4);
});
