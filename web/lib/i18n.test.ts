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

  it("translates text with a name or number inside it, leaving the name alone", () => {
    const cases: [string, string][] = [
      ["Say hello to Maple.", "Chào Maple một tiếng."], ["Ledger asks", "Ledger hỏi"], ["Deleted Alpha", "Đã xóa Alpha"],
      ["Today 9:41 AM", "Hôm nay 9:41 AM"], ["3 selected", "3 đã chọn"], ["Actions for Dev", "Thao tác cho Dev"],
      ["Delete 2 bots? You can undo for a few seconds.", "Xóa 2 bot? Bạn có thể hoàn tác trong vài giây."],
      ["Upload failed (413)", "Tải lên thất bại (413)"], ["Echo cannot read images", "Echo không đọc được ảnh"], ["1m 5s", "1 phút 5 giây"], ["Notes Maple keeps", "Ghi chú Maple lưu giữ"], ["No bots match “x”.", "Không có bot nào khớp “x”."],
    ];
    for (const [en, out] of cases) expect(translate("vi", en), en).toBe(out);
  });

  it("knows every fixed message the server can send", () => {
    const serverDir = join(__dirname, "..", "..", "server", "botteam");
    const found = new Set<string>();
    const grab = (file: string, re: RegExp) => { for (const m of readFileSync(join(serverDir, file), "utf8").matchAll(re)) found.add(m[1]); };
    grab("main.py", /HTTPException\(\d+, "([^"{}]+)"\)/g);
    grab("routines.py", /return "([^"{}]+)"/g);
    grab("turns.py", /_add_error\([^"\n]*"([^"{}]+)"/g);
    grab("drivers/echo.py", /message="([^"{}]+)"/g);
    const missing = [...found].filter((m) => /\s/.test(m) && translate("vi", m) === m); // words alone are keys, not sentences
    expect(missing).toEqual([]);
    // messages with a value inside
    for (const sample of ["unknown key: groq", "files are limited to 100 MB", "Could not start Codex: boom", "Claude Code exited unexpectedly: x", "Endpoint error: 500", "an interval must be between 1 and 10080 minutes"]) {
      expect(translate("vi", sample), sample).not.toBe(sample);
    }
  });
});
