// Visual regression: boots an isolated stack (scratch data dir, its own ports), drives the demo engine through the
// Phase 3 screens and compares screenshots with the committed baselines (web/e2e/baseline).
//   pnpm test:visual            compare; fails when a screen differs by more than THRESHOLD
//   pnpm test:visual -- --update  rewrite the baselines
// Stop `pnpm dev` first: both would use the same Next.js build folder.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const web = join(root, "web");
const req = createRequire(join(web, "package.json"));
const { chromium } = req("playwright-core");
const { PNG } = req("pngjs");
const pixelmatch = req("pixelmatch").default ?? req("pixelmatch");

const UPDATE = process.argv.includes("--update");
const THRESHOLD = 0.003; // share of pixels allowed to differ per screen
const API_PORT = 18899, WEB_PORT = 15299;
const API = `http://127.0.0.1:${API_PORT}`, WEB = `http://127.0.0.1:${WEB_PORT}`;
const BASE = join(web, "e2e", "baseline");
const OUT = join(web, "e2e", "actual");
mkdirSync(BASE, { recursive: true });
mkdirSync(OUT, { recursive: true });

const dataDir = mkdtempSync(join(tmpdir(), "botteam-visual-"));
const env = { ...process.env, BOTTEAM_DATA_DIR: dataDir, SERVER_PORT: String(API_PORT), WEB_PORT: String(WEB_PORT) };
const children = [];
const run = (args) => {
  const c = spawn("node", ["scripts/run.mjs", ...args], { cwd: root, env, stdio: "ignore", shell: false });
  children.push(c);
};
const stop = async () => {
  for (const c of children) {
    if (process.platform === "win32") spawn("taskkill", ["/T", "/F", "/PID", String(c.pid)], { stdio: "ignore" });
    else c.kill("SIGTERM");
  }
  await new Promise((r) => setTimeout(r, 800));
  rmSync(dataDir, { recursive: true, force: true });
};
const up = async (url, ms = 120000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
};
const j = async (m, p, b) => (await fetch(API + p, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined })).json();

const failures = [];
function compare(name, buf) {
  const file = `${name}.png`;
  writeFileSync(join(OUT, file), buf);
  const basePath = join(BASE, file);
  if (UPDATE || !existsSync(basePath)) { writeFileSync(basePath, buf); console.log(`  baseline written  ${name}`); return; }
  const a = PNG.sync.read(readFileSync(basePath)), b = PNG.sync.read(buf);
  if (a.width !== b.width || a.height !== b.height) { failures.push(`${name}: size ${b.width}x${b.height} vs ${a.width}x${a.height}`); console.log(`  FAIL ${name} (size)`); return; }
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  const share = n / (a.width * a.height);
  const ok = share <= THRESHOLD;
  if (!ok) { writeFileSync(join(OUT, `${name}.diff.png`), PNG.sync.write(diff)); failures.push(`${name}: ${(share * 100).toFixed(2)}% of pixels differ`); }
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}  ${(share * 100).toFixed(3)}%`);
}

try {
  run(["server"]);
  run(["web"]);
  await up(`${API}/api/config`);
  await up(WEB);
  const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(edge ? { executablePath: edge } : {}) });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage();
  const shot = async (name) => {
    await page.evaluate(() => { // times and dates move with the clock: pin them
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        n.nodeValue = n.nodeValue.replace(/\b\d{1,2}:\d{2}\s?[AP]M\b/g, "9:41 AM").replace(/\b\d+s\b(?=\s*$)/g, "1s");
      }
    });
    await page.waitForTimeout(250);
    compare(name, await page.screenshot());
  };
  const bot = await j("POST", "/api/bots", { name: "Maple", title: "Tester", modelSelection: { instanceId: "echo", model: "echo-1" }, approvalMode: "ask" });
  await j("POST", "/api/bots", { name: "Beta", modelSelection: { instanceId: "echo", model: "echo-1" } });
  await page.goto(WEB);
  await page.locator("nav[aria-label=Bots] [role=button][title=Maple]").click();
  await page.getByText("Say hello to Maple.").waitFor();

  console.log("approval, question and menus");
  const box = page.getByLabel("Message Maple");
  await box.fill("/approve mkdir demo_dir");
  await box.press("Enter");
  await page.getByTestId("approval-card").waitFor();
  await shot("approval-open");
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await page.getByText("Allowed: ran mkdir demo_dir").waitFor();
  await page.waitForTimeout(600);
  await shot("approval-decided");
  await box.fill("/ask Which one?");
  await box.press("Enter");
  await page.getByTestId("ask-card").waitFor();
  await shot("question-card");
  await page.keyboard.press("b");
  await page.getByText("You answered: Beta").waitFor();
  await page.waitForTimeout(600);
  await page.locator("nav[aria-label=Bots] [role=button][title=Maple]").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).waitFor();
  await shot("context-menu");
  await page.keyboard.press("Escape");
  await page.getByLabel("Bot details").click();
  await page.getByLabel("Name", { exact: true }).waitFor();
  await shot("bot-panel");
  await page.getByLabel("Close panel").click();
  await page.getByLabel("Profile and settings").click();
  await page.getByText("Settings", { exact: true }).click();
  await page.getByRole("button", { name: "Connections" }).click();
  await shot("settings-connections");
  await page.getByRole("button", { name: "Appearance" }).click();
  await shot("settings-skins");
  await page.keyboard.press("Escape");

  console.log("main screen in every skin");
  for (const id of ["midnight", "atelier", "foundry", "lagoon", "graphite", "linen", "dusk", "daylight", "meadow", "pop", "halloween", "diwali", "aurora"]) {
    await fetch(`${API}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ skin: id }) });
    await page.reload();
    await page.locator("nav[aria-label=Bots] [role=button][title=Maple]").waitFor();
    await page.waitForFunction((s) => document.documentElement.dataset.skin === s, id);
    await shot(`skin-${id}`);
  }
  await browser.close();
} catch (e) {
  failures.push(String(e?.stack ?? e));
} finally {
  await stop();
}
if (failures.length) {
  console.error(`\nvisual check failed:\n - ${failures.join("\n - ")}`);
  process.exit(1);
}
console.log(UPDATE ? "\nbaselines updated" : "\nvisual check passed");
