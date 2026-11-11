import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const comps = join(root, "components");
const files = readdirSync(comps).filter((f) => f.endsWith(".tsx"));
const css = readFileSync(join(root, "app", "globals.css"), "utf8");

describe("accessibility", () => {
  it("every pair of text and surface in all 13 skins meets WCAG AA (scripts/check-skin-contrast.mjs)", () => {
    const out = execFileSync(process.execPath, [join(root, "..", "scripts", "check-skin-contrast.mjs")], { encoding: "utf8" });
    expect(out.match(/^✓ /gm)?.length).toBeGreaterThanOrEqual(13);
    expect(out).not.toMatch(/✗|~ /);
  });

  it("a control shown only on hover is also shown on touch screens", () => {
    const bad: string[] = [];
    for (const f of files) {
      readFileSync(join(comps, f), "utf8").split("\n").forEach((line, i) => {
        if (/opacity-0/.test(line) && /group-hover/.test(line) && !/touch:opacity-100/.test(line)) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it("every modal dialog has a name and says it is modal", () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(comps, f), "utf8");
      for (const m of src.matchAll(/<div\s+role="dialog"([^>]*)>/g)) if (!/aria-modal="true"/.test(m[1]) || !/aria-label=/.test(m[1])) bad.push(f);
    }
    expect(bad).toEqual([]);
  });

  it("the system's reduced-motion and forced-colours settings are honoured, and chat text is directed per line", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*,/);
    expect(css).toMatch(/@media \(forced-colors: active\)\s*\{\s*button/);
    expect(css).toMatch(/\.chat-text\s*\{[^}]*unicode-bidi:\s*plaintext/);
    expect(css).toMatch(/\.mention-editor-mirror\s*\{[^}]*unicode-bidi:\s*plaintext/);
  });

  it("the shell announces new messages and keeps keyboard focus inside dialogs", () => {
    const shell = readFileSync(join(comps, "Shell.tsx"), "utf8");
    expect(shell).toContain("<TranscriptAnnouncer />");
    expect(shell).toContain("useDialogA11y()");
    expect(readFileSync(join(comps, "TranscriptAnnouncer.tsx"), "utf8")).toContain('aria-live="polite"');
  });
});
