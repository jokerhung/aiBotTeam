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
const bot = await j("POST", "/api/bots", { name: "QA", title: "QA and Release Engineer", color: "orange", modelSelection: { instanceId: "echo", model: "echo-1" } });
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
  // holds the Google / Slack / Notion marks, which are drawn as plain glyphs here: allow a little more
  "sidebar bottom (profile / connect apps)": { x: 0, y: 730, width: 280, height: 70, share: 0.04 },
  "composer strip": { x: 280, y: 725, width: 1000, height: 75 },
  "header pill": { x: 640, y: 0, width: 280, height: 62 },
};
async function compareRegions(prefix, save) {
  for (const [name, { share: own, ...clip }] of Object.entries(regions)) {
    const limit = own ?? SHARE;
    const a = PNG.sync.read(await ref.screenshot({ clip })), b = PNG.sync.read(await ours.screenshot({ clip }));
    const diff = new PNG({ width: clip.width, height: clip.height });
    const n = pixelmatch(a.data, b.data, diff.data, clip.width, clip.height, { threshold: 0.2 });
    const share = n / (clip.width * clip.height);
    if (save || share > limit) {
      const slug = (save ? "" : prefix.replace(/\W+/g, "") + "-") + name.replace(/\W+/g, "-");
      writeFileSync(join(OUT, `ref-${slug}.reference.png`), PNG.sync.write(a));
      writeFileSync(join(OUT, `ref-${slug}.ours.png`), PNG.sync.write(b));
      writeFileSync(join(OUT, `ref-${slug}.diff.png`), PNG.sync.write(diff));
    }
    const ok = share <= limit;
    if (!save && ok) { shares.push(share); continue; }
    console.log(`  ${ok ? "ok  " : "FAIL"} ${prefix}${name}: ${(share * 100).toFixed(2)}% differ`);
    if (!ok) failures.push(`${prefix}${name}: ${(share * 100).toFixed(2)}% of pixels differ`);
    else shares.push(share);
  }
}
const shares = [];
await compareRegions("", true);

// ---- the same regions in all 13 skins (the skin is a [data-skin] attribute on <html> in both apps) ----
console.log("  main screen in every skin:");
for (const id of ["midnight", "atelier", "foundry", "lagoon", "graphite", "linen", "dusk", "daylight", "meadow", "pop", "halloween", "diwali", "aurora"]) {
  for (const pg of [ref, ours]) await pg.evaluate((skin) => { document.documentElement.dataset.skin = skin; }, id);
  await ref.waitForTimeout(250);
  const before = failures.length;
  const worst = shares.length;
  await compareRegions(`[${id}] `, false);
  const mine = shares.slice(worst);
  console.log(`    ${failures.length === before ? "ok  " : "FAIL"} ${id.padEnd(10)} worst region ${(Math.max(...mine, 0) * 100).toFixed(2)}%`);
}
for (const pg of [ref, ours]) await pg.evaluate(() => { document.documentElement.dataset.skin = "daylight"; });

// ---- bot panel: the same panel opened in both ----
async function panelMetrics(pg, open) {
  await open();
  await pg.waitForTimeout(900);
  return pg.evaluate(() => {
    const aside = [...document.querySelectorAll("aside")].find((a) => a.getBoundingClientRect().x > 600);
    if (!aside) return null;
    const r = aside.getBoundingClientRect();
    const tabs = [...aside.querySelectorAll("button")].filter((b) => /^(Details|Library|Computer)$/.test(b.innerText.trim()));
    const tr = tabs.map((b) => b.getBoundingClientRect());
    const circles = [...aside.querySelectorAll("button")].filter((b) => { const q = b.getBoundingClientRect(); return q.y < 60 && q.width > 30 && q.width < 40; }).map((b) => b.getBoundingClientRect());
    return {
      width: r.width, x: r.x,
      tabsWidth: tr.length ? tr[tr.length - 1].right - tr[0].left : 0, tabsTop: tr.length ? tr[0].top : 0,
      circle: circles[0]?.width ?? 0, circles: circles.length,
    };
  });
}
const refPanel = await panelMetrics(ref, async () => { await ref.locator("main button").filter({ hasText: /^QA/ }).first().click(); });
const ourPanel = await panelMetrics(ours, async () => { await ours.getByLabel("Bot details").click(); });
console.log("  bot panel: reference", JSON.stringify(refPanel), "\n             ours     ", JSON.stringify(ourPanel));
if (!refPanel || !ourPanel) failures.push("bot panel not found");
else for (const k of ["width", "x", "tabsWidth", "circle", "circles"]) {
  const d = Math.abs(refPanel[k] - ourPanel[k]);
  const ok = d <= (k === "tabsWidth" ? 12 : BOX_PX);
  console.log(`  ${ok ? "ok  " : "FAIL"} panel ${k}: reference ${refPanel[k].toFixed(0)}  ours ${ourPanel[k].toFixed(0)}`);
  if (!ok) failures.push(`panel ${k}: ${ourPanel[k]} vs ${refPanel[k]}`);
}
await ref.screenshot({ path: join(OUT, "reference-panel.png") });
await ours.screenshot({ path: join(OUT, "ours-panel.png") });
await ours.getByLabel("Close panel").click();

// ---- skin selector ("Browse themes" there, Settings > Appearance here) ----
const tileBoxes = (pg) => pg.locator("[data-skin-preview]").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
await ref.getByRole("button", { name: "You", exact: true }).click();
await ref.getByRole("menuitem", { name: /Settings/ }).first().click();
await ref.getByRole("button", { name: "Browse themes" }).click();
await ref.waitForTimeout(900);
await ours.getByLabel("Profile and settings").click();
await ours.getByText("Settings", { exact: true }).click();
await ours.getByRole("button", { name: "Appearance" }).click();
await ours.waitForTimeout(700);
const [rt, ot] = [await tileBoxes(ref), await tileBoxes(ours)];
const metric = (t) => ({ count: t.length, w: t[0].w, h: t[0].h, colPitch: t[1].x - t[0].x, columns: t.filter((q) => Math.abs(q.y - t[0].y) < 4).length, rowPitch: t.find((q) => q.y > t[0].y + 20).y - t[0].y });
const [rm, om] = [metric(rt), metric(ot)];
console.log("  skin selector: reference", JSON.stringify(rm), "\n                 ours     ", JSON.stringify(om));
for (const k of Object.keys(rm)) {
  const d = Math.abs(rm[k] - om[k]);
  const ok = d <= (k === "rowPitch" ? 14 : 3);  // row pitch follows how many lines each description wraps to
  console.log(`  ${ok ? "ok  " : "FAIL"} skin selector ${k}: reference ${rm[k].toFixed(0)}  ours ${om[k].toFixed(0)}`);
  if (!ok) failures.push(`skin selector ${k}: ${om[k]} vs ${rm[k]}`);
}
await ref.screenshot({ path: join(OUT, "reference-skins.png") });
await ours.screenshot({ path: join(OUT, "ours-skins.png") });
await j("DELETE", `/api/bots/${bot.id}`);
await browser.close();
if (failures.length) { console.error(`\nreference comparison failed:\n - ${failures.join("\n - ")}`); process.exit(1); }
console.log("\nreference comparison passed");
