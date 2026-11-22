import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pythonRuntime } from "./python-runtime.mjs";

test("installed Windows and Unix environments launch without uv synchronization", () => {
  const root = mkdtempSync(join(tmpdir(), "botteam-launch-test-"));
  try {
    for (const [platform, folder, binary] of [["win32", "Scripts", "python.exe"], ["linux", "bin", "python"]]) {
      const directory = join(root, "server", ".venv", folder);
      mkdirSync(directory, { recursive: true });
      const python = join(directory, binary);
      writeFileSync(python, "fixture");
      assert.deepEqual(pythonRuntime(root, platform), [python, []]);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a fresh checkout bootstraps its missing Python environment with uv", () => {
  const root = mkdtempSync(join(tmpdir(), "botteam-bootstrap-test-"));
  try {
    assert.deepEqual(pythonRuntime(root, "win32"), ["uv", ["run", "--project", "server", "python"]]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
