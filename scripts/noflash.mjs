// Checks that a saved skin never flashes: for several skins, reload and record the skin on <html> at the very first
// paint and every later change. The first paint must already carry the saved skin, with no change afterwards.
// Needs the dev stack (`pnpm dev`) on the ports from .env.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { chromium } = createRequire(join(root, "web", "package.json"))("playwright-core");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const API = `http://127.0.0.1:${process.env.SERVER_PORT || 8899}`;
const WEB = `http://127.0.0.1:${process.env.WEB_PORT || 5299}`;
const put = (b) => fetch(`${API}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(edge ? { executablePath: edge } : {}) });
const failures = [];
const before = await (await fetch(`${API}/api/config`)).json();

for (const skin of ["midnight", "foundry", "pop", "daylight", "aurora"]) {
  await put({ skin });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(WEB); // first visit: the boot script learns the skin through the app
  await page.waitForFunction((s) => document.documentElement.dataset.skin === s, skin);
  await page.waitForTimeout(500);
  // reload with the recorder installed before any page script runs
  await page.addInitScript(() => {
    const skin = () => document.documentElement?.dataset.skin;
    window.__skins = [];
    // the <html> element does not exist yet when this runs: watch the whole document
    new MutationObserver(() => window.__skins.push({ at: "change", skin: skin() })).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-skin"] });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__skins.push({ at: e.name, skin: skin(), bg: getComputedStyle(document.body).backgroundColor });
    }).observe({ type: "paint", buffered: true });
  });
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__skins.some((e) => e.at === "first-contentful-paint"), null, { timeout: 10000 });
  await page.waitForTimeout(1500); // let the app hydrate and fetch /api/config
  const log = await page.evaluate(() => window.__skins);
  const paints = log.filter((e) => e.at === "first-paint" || e.at === "first-contentful-paint");
  const wrongPaint = paints.find((e) => e.skin !== skin);
  const changed = log.filter((e) => e.at === "change" && e.skin !== skin);
  const ok = !wrongPaint && !changed.length;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${skin}: paints=${paints.map((p) => p.skin).join(",")} changes=${log.filter((e) => e.at === "change").map((e) => e.skin).join(",") || "none"}`);
  if (!ok) failures.push(`${skin}: ${JSON.stringify(log)}`);
  await ctx.close();
}
await put({ skin: before.settings?.skin || "daylight" });
await browser.close();
if (failures.length) { console.error(`\nskin flash detected:\n - ${failures.join("\n - ")}`); process.exit(1); }
console.log("\nno skin flash on reload");
