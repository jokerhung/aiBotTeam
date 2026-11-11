import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dictionaries, translate } from "./translate";

// Fixed strings that are the same in every language (brand names, keys, code).
const SAME = new Set(["Inter", "Geist", "Ctrl F", "Promise", "Chief", "Skin", "Create", "Ctrl / ⌘ K"]);

const dir = join(__dirname, "..", "components");

/** Every fixed interface string in the components: JSX text, and placeholder / title / aria-label / label / hint attributes. */
function uiStrings(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
    const src = readFileSync(join(dir, file), "utf8");
    const found = new Set<string>();
    for (const m of src.matchAll(/>\s*([A-Z][A-Za-z0-9 ,.'’:!?&+/()\-—…“”]{2,80}?)\s*</g)) found.add(m[1].trim());
    for (const m of src.matchAll(/\b(?:placeholder|title|aria-label|label|hint|description)="([^"{}]{2,90})"/g)) found.add(m[1]);
    for (const text of found) if (!/^[a-z0-9_\-./]+$/.test(text)) out.push({ file, text });
  }
  return out;
}

describe("Vietnamese interface", () => {
  it("has an entry for every fixed string in the components", () => {
    const missing = uiStrings().filter(({ text }) => !SAME.has(text) && !(text in dictionaries.vi));
    expect(missing.map((m) => `${m.file}: ${m.text}`)).toEqual([]);
  });

  it("falls back to English for text it does not know", () => {
    expect(translate("vi", "A message someone wrote")).toBe("A message someone wrote");
    expect(translate("en", "Deny")).toBe("Deny");
    expect(translate("vi", "Deny")).toBe("Từ chối");
  });

  it("does not leave an entry empty", () => {
    for (const [k, v] of Object.entries(dictionaries.vi)) expect(v.trim(), k).not.toBe("");
  });
});
