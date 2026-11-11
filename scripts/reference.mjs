// Compares our chat screen with the reference app running at REFERENCE_URL (default http://localhost:5199).
// Both get a bot called "QA" (orange) selected at 1280x800; regions that do not depend on data are cropped and
// compared pixel by pixel, and the layout boxes are compared in pixels.
//   Needs the reference app running and `pnpm dev` (or any stack on SERVER_PORT / WEB_PORT from .env).
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const req = createRequire(join(root, "web", "package.json"));
const { chromium } = req("playwright-core");
const { PNG } = req("pngjs");
const pixelmatch = req("pixelmatch").default ?? req("pixelmatch");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));

const REF = process.env.REFERENCE_URL || "http://localhost:5199";
const API = `http://127.0.0.1:${process.env.SERVER_PORT || 8899}`;
const WEB = `http://127.0.0.1:${process.env.WEB_PORT || 5299}`;
const SHARE = 0.03;  // up to 3% of the pixels in a region may differ
const BOX_PX = 6;    // layout boxes may be this many pixels off
const OUT = join(root, "web", "e2e", "actual");
mkdirSync(OUT, { recursive: true });

const j = async (m, p, b) => (await fetch(API + p, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined })).json();
const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(edge ? { executablePath: edge } : {}) });
const mk = async () => (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage();
const failures = [];

// ---- reference: dismiss the intro, open the QA bot ----
const ref = await mk();
await ref.goto(REF);
// the reference opens intro dialogs ("Simple mode", later a notifications prompt): dismiss whatever is in front
const dismissAll = async () => {
  for (let i = 0; i < 6; i++) {
    const scrim = ref.locator(".ui-scrim").first();
    if (await scrim.isVisible({ timeout: 1500 }).catch(() => false)) {
      const texts = await scrim.locator("button").allInnerTexts();
      console.log("  reference dialog buttons:", JSON.stringify(texts));
      const pick = scrim.locator("button").filter({ hasText: /^(Done|Not now|Skip|Maybe later|Close|Got it|No thanks|Later)$/ }).first();
      if (await pick.count()) await pick.click().catch(() => {}); else await ref.keyboard.press("Escape");
      await ref.waitForTimeout(500);
      continue;
    }
    break;
  }
  for (let i = 0; i < 0; i++) {
    const dismiss = ref.getByRole("button", { name: /^(Done|Not now|Skip|Maybe later|Close|Got it)$/ }).first();
    if (!(await dismiss.isVisible({ timeout: 1500 }).catch(() => false))) break;
    await dismiss.click().catch(() => {});
    await ref.waitForTimeout(400);
  }
};
await dismissAll();
await ref.getByLabel("Message QA").waitFor({ timeout: 8000 }).catch(() => {}); // the app reopens the last bot by itself
await dismissAll();
if (!(await ref.getByLabel("Message QA").count())) {
  await ref.locator("[role=button][title^=QA]").first().click();
}
await ref.getByLabel("Message QA").waitFor();
await ref.waitForTimeout(1500);
await dismissAll();

// ---- ours: same bot name and colour ----
for (const b of (await j("GET", "/api/bots")).bots) if (b.name === "QA") await j("DELETE", `/api/bots/${b.id}`);
const bot = await j("POST", "/api/bots", { name: "QA", color: "orange", modelSelection: { instanceId: "echo", model: "echo-1" } });
await j("PUT", "/api/config", { skin: "daylight" });
const ours = await mk();
await ours.goto(WEB);
await ours.locator("nav[aria-label=Bots] [role=button][title=QA]").click();
await ours.getByLabel("Message QA").waitFor();
await ours.waitForTimeout(600);
await ref.waitForTimeout(600);
await ref.screenshot({ path: join(OUT, "reference-full.png") });
await ours.screenshot({ path: join(OUT, "ours-full.png") });

// ---- layout boxes ----
const box = async (page, loc) => (await loc.first().boundingBox());
const probes = {
  "composer": (p) => p.getByLabel("Message QA").locator("xpath=ancestor::div[contains(@class,'bg-composer')][1]"),
  "search button": (p) => p.locator("aside button").nth(0),
  "new bot button": (p) => p.locator("aside button").nth(1),
};
for (const [name, find] of Object.entries(probes)) {
  const a = await box(ref, find(ref)).catch(() => null), b = await box(ours, find(ours)).catch(() => null);
  if (!a || !b) { failures.push(`${name}: not found (${a ? "ours" : "reference"} missing)`); continue; }
  const d = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
  console.log(`  ${d <= BOX_PX ? "ok  " : "FAIL"} ${name}: reference ${Math.round(a.x)},${Math.round(a.y)} ${Math.round(a.width)}x${Math.round(a.height)}  ours ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}  (max ${d.toFixed(1)}px)`);
  if (d > BOX_PX) failures.push(`${name}: layout differs by ${d.toFixed(1)}px`);
}
const sidebar = async (page) => (await page.locator("aside, [data-sidebar-root]").first().boundingBox())?.width ?? 0;
const [sa, sb] = [await sidebar(ref), await sidebar(ours)];
console.log(`  ${Math.abs(sa - sb) <= BOX_PX ? "ok  " : "FAIL"} sidebar width: reference ${Math.round(sa)}  ours ${Math.round(sb)}`);
if (Math.abs(sa - sb) > BOX_PX) failures.push(`sidebar width ${sb} vs ${sa}`);

// ---- pixel regions that carry no data ----
const regions = {
  "sidebar top (search / new bot / inbox)": { x: 0, y: 0, width: 280, height: 110 },
  "sidebar bottom (profile / connect apps)": { x: 0, y: 730, width: 280, height: 70 },
  "composer strip": { x: 280, y: 725, width: 1000, height: 75 },
  "header pill": { x: 640, y: 0, width: 280, height: 62 },
};
for (const [name, clip] of Object.entries(regions)) {
  const a = PNG.sync.read(await ref.screenshot({ clip })), b = PNG.sync.read(await ours.screenshot({ clip }));
  const diff = new PNG({ width: clip.width, height: clip.height });
  const n = pixelmatch(a.data, b.data, diff.data, clip.width, clip.height, { threshold: 0.2 });
  const share = n / (clip.width * clip.height);
  const slug = name.replace(/\W+/g, "-");
  writeFileSync(join(OUT, `ref-${slug}.reference.png`), PNG.sync.write(a));
  writeFileSync(join(OUT, `ref-${slug}.ours.png`), PNG.sync.write(b));
  writeFileSync(join(OUT, `ref-${slug}.diff.png`), PNG.sync.write(diff));
  console.log(`  ${share <= SHARE ? "ok  " : "FAIL"} ${name}: ${(share * 100).toFixed(2)}% differ`);
  if (share > SHARE) failures.push(`${name}: ${(share * 100).toFixed(2)}% of pixels differ`);
}
await j("DELETE", `/api/bots/${bot.id}`);
await browser.close();
if (failures.length) { console.error(`\nreference comparison failed:\n - ${failures.join("\n - ")}`); process.exit(1); }
console.log("\nreference comparison passed");
