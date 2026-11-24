import { expect, it } from "vitest";
import { CATEGORIES, INDUSTRIES, filterSkills } from "./skills";
import { vi } from "./i18n-vi";
import type { Skill } from "./wire";

it("filters and sorts the library without mutating the original order", () => {
  const skills: Skill[] = [
    { id: "b", name: "Review", description: "Inspect a diff", body: "", enabled: true, category: "engineering", used_by: [{ id: "bot", name: "Dev", color: "blue" }] },
    { id: "a", name: "Answer", description: "Support customers", body: "", enabled: true, category: "operations", used_by: [] },
  ];
  expect(filterSkills(skills, "DIFF", [], "", "name").map(s => s.id)).toEqual(["b"]);
  expect(filterSkills(skills, "", ["operations"], "unused", "name").map(s => s.id)).toEqual(["a"]);
  expect(filterSkills(skills, "", [], "", "usage").map(s => s.id)).toEqual(["b", "a"]);
  expect(skills.map(s => s.id)).toEqual(["b", "a"]);
});

it("translates every industry and category", () => {
  for (const label of [...Object.values(INDUSTRIES), ...Object.values(CATEGORIES)]) expect(vi[label], label).toBeTruthy();
});
