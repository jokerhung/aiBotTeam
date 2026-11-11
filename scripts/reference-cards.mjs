// The permission card against the reference's own card gallery (localhost:5199/question-cards-preview.html?state=approval).
// Both are 1280x800 in the Daylight skin with the same bot name and command; boxes and pixels are compared.
//   Needs the reference app and `pnpm dev`.
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
const BOX_PX = 4, SHARE = 0.08;
const OUT = join(root, "web", "e2e", "actual");
mkdirSync(OUT, { recursive: true });
const j = async (m, p, b) => (await fetch(API + p, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined })).json();
const COMMAND = 'git push origin fix/pricing-page-footer && gh pr create --base main --title "Fix: pricing page footer"';

const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(edge ? { executablePath: edge } : {}) });
const mk = async () => (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage();
const failures = [];

const ref = await mk();
await ref.goto(`${REF}/question-cards-preview.html?state=approval&skin=daylight`);
await ref.getByText("Ledger wants to run a command", { exact: true }).waitFor({ timeout: 15000 });
await ref.waitForTimeout(800);

for (const b of (await j("GET", "/api/bots")).bots) if (b.name === "Ledger") await j("DELETE", `/api/bots/${b.id}`);
const bot = await j("POST", "/api/bots", { name: "Ledger", color: "teal", modelSelection: { instanceId: "echo", model: "echo-1" }, approvalMode: "ask" });
await j("PUT", "/api/config", { skin: "daylight" });
const ours = await mk();
await ours.goto(WEB);
await ours.locator("nav[aria-label=Bots] [role=button][title=Ledger]").click();
const box = ours.getByLabel("Message Ledger");
await box.fill(`/approve ${COMMAND}`);
await box.press("Enter");
await ours.getByTestId("approval-card").waitFor();
await ours.waitForTimeout(800);

// the reference card is the first ancestor of its header that is as wide as the composer and has rounded corners
const refCard = await ref.getByText("Ledger wants to run a command", { exact: true }).evaluate((el) => {
  let n = el;
  while (n && !(n.getBoundingClientRect().width > 900 && parseFloat(getComputedStyle(n).borderTopLeftRadius) >= 12)) n = n.parentElement;
  const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
});
const ourCard = await ours.getByTestId("approval-card").boundingBox();
const btn = async (p, name) => (await p.getByRole("button", { name, exact: true }).first().boundingBox());
// the reference gallery has no sidebar, so positions are taken relative to the composer box below the card
// the composer pill: the first ancestor of the input that is as wide as the card
const input = (p) => p.getByPlaceholder("Answer the approval above to continue").evaluate((el) => {
  let n = el;
  while (n && n.getBoundingClientRect().width < 900) n = n.parentElement;
  const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
});
const [ri, oi] = [await input(ref), await input(ours)];
const rows = {
  "card x (to composer)": [refCard.x - ri.x, ourCard.x - oi.x], "card width": [refCard.width, ourCard.width],
  "card height": [refCard.height, ourCard.height], "card y (to composer)": [refCard.y - ri.y, ourCard.y - oi.y],
};
for (const [label, name] of [["Deny", "Deny"], ["Allow once", "Allow once"]]) {
  const [a, b] = [await btn(ref, name), await btn(ours, name)];
  rows[`${label} width`] = [a.width, b.width]; rows[`${label} height`] = [a.height, b.height]; rows[`${label} y (to composer)`] = [a.y - ri.y, b.y - oi.y];
}
for (const [k, [a, b]] of Object.entries(rows)) {
  const d = Math.abs(a - b), ok = d <= BOX_PX;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${k.padEnd(18)} reference ${a.toFixed(1).padStart(7)}  ours ${b.toFixed(1).padStart(7)}`);
  if (!ok) failures.push(`${k}: ${b.toFixed(1)} vs ${a.toFixed(1)}`);
}
// pixels: the card header and command box (the button row also holds our extra "Always allow")
const clip = { x: Math.round(refCard.x), y: Math.round(refCard.y), width: Math.round(refCard.width), height: 74 };
const a = PNG.sync.read(await ref.screenshot({ clip })), b = PNG.sync.read(await ours.screenshot({ clip: { ...clip, x: Math.round(ourCard.x), y: Math.round(ourCard.y) } }));
const diff = new PNG({ width: clip.width, height: clip.height });
const n = pixelmatch(a.data, b.data, diff.data, clip.width, clip.height, { threshold: 0.2 });
const share = n / (clip.width * clip.height);
writeFileSync(join(OUT, "card-reference.png"), PNG.sync.write(a)); writeFileSync(join(OUT, "card-ours.png"), PNG.sync.write(b)); writeFileSync(join(OUT, "card-diff.png"), PNG.sync.write(diff));
console.log(`  ${share <= SHARE ? "ok  " : "FAIL"} header + command pixels: ${(share * 100).toFixed(2)}% differ (limit ${SHARE * 100}%)`);
if (share > SHARE) failures.push(`card pixels ${(share * 100).toFixed(2)}%`);
await ours.screenshot({ path: join(OUT, "ours-approval-full.png") });
await ref.screenshot({ path: join(OUT, "reference-approval-full.png") });
await j("DELETE", `/api/bots/${bot.id}`);
await browser.close();
if (failures.length) { console.error(`\npermission card differs from the reference:\n - ${failures.join("\n - ")}`); process.exit(1); }
console.log("\npermission card matches the reference");
