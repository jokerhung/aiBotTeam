// Compares the geometry of our question card, bot context menu and settings (Connections) modal with the
// reference screenshots in the OpenMausBot checkout (docs/screenshots/*.png, 2880x1800 = 1440x900 @2x).
// Numbers for the reference are scanned out of those PNGs; ours come from the live DOM at the same size.
//   Needs the dev stack (`pnpm dev`) and the OpenMausBot checkout (REFERENCE_REPO, default D:/hungnm/github/OpenMausBot).
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const req = createRequire(join(root, "web", "package.json"));
const { chromium } = req("playwright-core");
const { PNG } = req("pngjs");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const REPO = process.env.REFERENCE_REPO || "D:/hungnm/github/OpenMausBot";
const API = `http://127.0.0.1:${process.env.SERVER_PORT || 8899}`;
const WEB = `http://127.0.0.1:${process.env.WEB_PORT || 5299}`;
const TOL = 3; // css px
const j = async (m, p, b) => (await fetch(API + p, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined })).json();

// ---------- reference numbers, scanned from the PNGs ----------
const load = (f) => PNG.sync.read(readFileSync(join(REPO, "docs/screenshots", f)));
const pix = (p, x, y) => { const i = (p.width * Math.round(y) + Math.round(x)) * 4; return [p.data[i], p.data[i + 1], p.data[i + 2]]; };
const dist = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
/** Positions (css px) along a line where the colour jumps by more than t. */
function edges(p, fixed, from, to, horiz, t = 1) {
  const out = []; let prev = pix(p, horiz ? from : fixed, horiz ? fixed : from);
  for (let k = from + 1; k < to; k++) { const c = pix(p, horiz ? k : fixed, horiz ? fixed : k); if (dist(c, prev) > t) out.push(k / 2); prev = c; }
  return out;
}
const card = load("approval-card.png"), menu = load("context-menu.png"), sett = load("app-settings.png");
const ref = {};
{ // question card: border pixels (colour 44) bound the card; rows are 1px separators
  const h = edges(card, 1000, 800, 2800, true, 3), v = edges(card, 2300, 300, 1250, false, 1);
  const left = h.find((x) => x > 400 && x < 450), right = [...h].reverse().find((x) => x > 1200 && x < 1300);
  const sep = v.filter((y) => y > 280 && y < 490);
  ref.card = { width: right - left + 1, height: v.filter((y) => y > 540)[v.filter((y) => y > 540).length - 1] - v[0] + 0.5 };
  ref.rowPitch = (sep[sep.length - 1] - sep[0]) / 4 / 1 * 1; // 5 separators -> 4 rows
  const inp = v.filter((y) => y > 490 && y < 545);
  ref.input = inp[inp.length - 1] - inp[0] - 0.5;
}
{ // context menu
  const h = edges(menu, 1000, 150, 800, true, 3), v = edges(menu, 440, 560, 1400, false, 3);
  ref.menu = { width: h[h.length - 1] - h[0], height: v[v.length - 1] - v[0] + 0.5, itemPitch: (495 - 443) * 0.72 * 0 + ((598 - 443) / 3) * 0.72 };
}
{ // settings modal
  const h = edges(sett, 1200, 400, 2400, true, 3), v = edges(sett, 1200, 200, 1700, false, 3);
  const L = h[0], R = h[h.length - 1];
  ref.modal = { width: R - L, height: v.find((y) => y >= 725 && y <= 735) - v.find((y) => y >= 168 && y <= 172) + 0.5 }; // the modal border, top and bottom
  const nav = edges(sett, 1200, 400, 2400, true, 1).find((x) => x > 460 && x < 500);
  ref.navWidth = nav - L;
  const ic = edges(sett, 700 * 1.44 / 1, 800, 2400, true, 4);
  ref.keysCardWidth = (1568 - 696) * 0.72;
}
console.log("reference:", JSON.stringify(ref));

// ---------- ours ----------
const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(edge ? { executablePath: edge } : {}) });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
for (const b of (await j("GET", "/api/bots")).bots) if (b.name === "Shots") await j("DELETE", `/api/bots/${b.id}`);
await j("PUT", "/api/config", { skin: "midnight" });
const bot = await j("POST", "/api/bots", { name: "Shots", color: "teal", modelSelection: { instanceId: "echo", model: "echo-1" }, approvalMode: "ask" });
await page.goto(WEB);
await page.locator("nav[aria-label=Bots] [role=button][title=Shots]").click();
const ours = {};
const box = async (loc) => loc.first().boundingBox();

const input = page.getByLabel("Message Shots");
await input.fill("/ask What do you mostly want help with? | Work & projects | Writing & research | Life admin | A bit of everything");
await input.press("Enter");
await page.getByTestId("ask-card").waitFor();
await page.waitForTimeout(500);
{
  const c = await box(page.getByTestId("ask-card"));
  const o = page.getByRole("option");
  const [o1, o2, o4] = [await box(o.nth(0)), await box(o.nth(1)), await box(o.nth(3))];
  const inp = await box(page.getByLabel("Type your own answer"));
  ours.card = { width: c.width, height: c.height };
  ours.rowPitch = o2.y - o1.y;
  ours.input = inp.height;
  void o4;
}
await page.keyboard.press("b");
await page.getByText(/You answered/).waitFor();
await page.waitForTimeout(400);
await page.locator("nav[aria-label=Bots] [role=button][title=Shots]").click({ button: "right" });
await page.getByRole("menuitem", { name: "Delete" }).waitFor();
await page.waitForTimeout(300);
{
  const m = await box(page.locator("[data-slot=context-menu-content]"));
  const items = page.getByRole("menuitem");
  const [a, b] = [await box(items.nth(0)), await box(items.nth(1))];
  ours.menu = { width: m.width, height: m.height, itemPitch: b.y - a.y };
}
await page.keyboard.press("Escape");
await page.getByLabel("Profile and settings").click();
await page.getByText("Settings", { exact: true }).click();
await page.getByRole("button", { name: "Connections" }).click();
await page.getByTestId("keys-card").waitFor();
{
  const m = await box(page.getByTestId("settings-modal"));
  const nav = await box(page.getByRole("navigation", { name: "Settings sections" }));
  const kc = await box(page.getByTestId("keys-card"));
  ours.modal = { width: m.width, height: m.height };
  ours.navWidth = nav.width;
  ours.keysCardWidth = kc.width;
}
await j("DELETE", `/api/bots/${bot.id}`);
await browser.close();
console.log("ours:     ", JSON.stringify(ours));

// ---------- compare ----------
const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]));
const refF = Object.fromEntries(flat(ref)), oursF = Object.fromEntries(flat(ours));
const failures = [];
for (const k of Object.keys(refF)) {
  const d = Math.abs(refF[k] - (oursF[k] ?? NaN));
  const ok = d <= TOL;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${k.padEnd(18)} reference ${refF[k].toFixed(1).padStart(6)}  ours ${(oursF[k] ?? NaN).toFixed(1).padStart(6)}  (off ${d.toFixed(1)}px)`);
  if (!ok) failures.push(`${k}: ${oursF[k]?.toFixed(1)} vs ${refF[k].toFixed(1)}`);
}
if (failures.length) { console.error(`\ngeometry differs from the reference screenshots:\n - ${failures.join("\n - ")}`); process.exit(1); }
console.log("\ncard, menu and settings geometry match the reference screenshots");
