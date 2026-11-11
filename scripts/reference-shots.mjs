// Geometry of the question card, bot context menu and settings modal against the reference app running at
// REFERENCE_URL (default http://localhost:5199): the card from its own gallery page (question-cards-preview.html),
// the menu and modal from the app itself at 1440x900. Ours are measured the same way, in the same skin.
//   Needs the reference app and `pnpm dev`.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { chromium } = createRequire(join(root, "web", "package.json"))("playwright-core");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const REF = process.env.REFERENCE_URL || "http://localhost:5199";
const API = `http://127.0.0.1:${process.env.SERVER_PORT || 8899}`;
const WEB = `http://127.0.0.1:${process.env.WEB_PORT || 5299}`;
const TOL = 3; // css px
const j = async (m, p, b) => (await fetch(API + p, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined })).json();

const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(edge ? { executablePath: edge } : {}) });
const newPage = async (w, h) => (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();

// ---------- reference ----------
const ref = {};
{ // question card from the reference's gallery page
  const p = await newPage(1280, 800);
  await p.goto(`${REF}/question-cards-preview.html?state=question&skin=daylight`);
  await p.getByText("Ledger asks", { exact: true }).waitFor({ timeout: 15000 });
  await p.waitForTimeout(800);
  ref.card = await p.evaluate(() => {
    const card = [...document.querySelectorAll("div")].find((e) => e.textContent.startsWith("Ledger asks") && e.getBoundingClientRect().width > 500 && parseFloat(getComputedStyle(e).borderTopLeftRadius) >= 12);
    const c = card.getBoundingClientRect();
    const rows = [...card.querySelectorAll("button")].filter((b) => /^(Yes|No)/.test(b.innerText.trim())).map((b) => b.getBoundingClientRect());
    const input = card.querySelector("input,textarea").parentElement.getBoundingClientRect();
    let comp = document.querySelector("textarea,input[placeholder*=Message]");
    while (comp && comp.getBoundingClientRect().width < 950) comp = comp.parentElement;
    const cb = comp.getBoundingClientRect();
    return { x: c.x - cb.x, w: c.width, rowH: rows[0].height, rowPitch: rows[1].y - rows[0].y, rowW: rows[0].width, inputH: input.height, firstRowFromTop: rows[0].y - c.y, inputFromRows: input.y - (rows[2].y + rows[2].height) };
  });
  await p.context().close();
}
{ // menu and settings from the app itself
  const p = await newPage(1440, 900);
  await p.goto(REF);
  await p.waitForTimeout(2500);
  for (let i = 0; i < 4; i++) {
    const d = p.getByRole("button", { name: /^(Done|Not now)$/ }).first();
    if (!(await d.isVisible().catch(() => false))) break;
    await d.click().catch(() => {});
    await p.waitForTimeout(500);
  }
  await p.locator("[role=button][title^=Dev]").first().click({ button: "right" });
  await p.locator("[role=menu]").waitFor();
  await p.waitForTimeout(300);
  ref.menu = await p.evaluate(() => {
    const m = document.querySelector("[role=menu]"), r = m.getBoundingClientRect();
    const items = [...m.querySelectorAll("[role=menuitem]")].map((e) => e.getBoundingClientRect());
    return { w: r.width, itemH: items[0].height, firstItemFromTop: items[0].y - r.y, pitch: items[1].y - items[0].y };
  });
  await p.keyboard.press("Escape");
  await p.getByRole("button", { name: "You", exact: true }).click();
  await p.getByRole("menuitem", { name: /Settings/ }).first().click();
  await p.locator("[role=dialog] h2").first().waitFor();
  await p.waitForTimeout(600);
  ref.modal = await p.evaluate(() => {
    const d = document.querySelector("[role=dialog]"), r = d.getBoundingClientRect(), nav = d.querySelector("nav").getBoundingClientRect();
    const card = [...d.querySelectorAll("div")].find((e) => { const b = e.getBoundingClientRect(); return b.width > 560 && b.width < 640 && parseFloat(getComputedStyle(e).borderTopLeftRadius) >= 10; });
    const c = card.getBoundingClientRect();
    return { w: r.width, h: r.height, navW: nav.width, cardX: c.x - r.x, cardW: c.width };
  });
  await p.context().close();
}
console.log("reference:", JSON.stringify(ref));

// ---------- ours ----------
const ours = {};
for (const b of (await j("GET", "/api/bots")).bots) if (b.name === "Ledger") await j("DELETE", `/api/bots/${b.id}`);
await j("PUT", "/api/config", { skin: "daylight", language: "en" });
const bot = await j("POST", "/api/bots", { name: "Ledger", color: "teal", modelSelection: { instanceId: "echo", model: "echo-1" }, approvalMode: "ask" });
{
  const p = await newPage(1280, 800);
  await p.goto(WEB);
  await p.locator("nav[aria-label=Bots] [role=button][title=Ledger]").click();
  const box = p.getByLabel("Message Ledger");
  await box.fill("/ask Should I apply the fix to the pricing page? | Yes, only the footer text | Yes, the welcome text too | No");
  await box.press("Enter");
  await p.getByTestId("ask-card").waitFor();
  await p.waitForTimeout(700);
  ours.card = await p.evaluate(() => {
    const card = document.querySelector("[data-testid=ask-card]"), c = card.getBoundingClientRect();
    const rows = [...card.querySelectorAll("[role=option]")].map((b) => b.getBoundingClientRect());
    const input = card.querySelector("input").parentElement.getBoundingClientRect();
    let comp = document.querySelector("textarea");
    while (comp && comp.getBoundingClientRect().width < 950) comp = comp.parentElement;
    const cb = comp.getBoundingClientRect();
    return { x: c.x - cb.x, w: c.width, rowH: rows[0].height, rowPitch: rows[1].y - rows[0].y, rowW: rows[0].width, inputH: input.height, firstRowFromTop: rows[0].y - c.y, inputFromRows: input.y - (rows[2].y + rows[2].height) };
  });
  await p.context().close();
}
{
  const p = await newPage(1440, 900);
  await p.goto(WEB);
  await p.locator("nav[aria-label=Bots] [role=button][title=Ledger]").click({ button: "right" });
  await p.getByRole("menuitem", { name: "Delete" }).waitFor();
  await p.waitForTimeout(300);
  ours.menu = await p.evaluate(() => {
    const m = document.querySelector("[data-slot=context-menu-content]"), r = m.getBoundingClientRect();
    const items = [...m.querySelectorAll("[role=menuitem]")].map((e) => e.getBoundingClientRect());
    return { w: r.width, itemH: items[0].height, firstItemFromTop: items[0].y - r.y, pitch: items[1].y - items[0].y };
  });
  await p.keyboard.press("Escape");
  await p.getByLabel("Profile and settings").click();
  await p.getByText("Settings", { exact: true }).click();
  await p.getByRole("button", { name: "Connections" }).click();
  await p.getByTestId("keys-card").waitFor();
  await p.waitForTimeout(600);
  ours.modal = await p.evaluate(() => {
    const d = document.querySelector("[data-testid=settings-modal]"), r = d.getBoundingClientRect(), nav = d.querySelector("nav").getBoundingClientRect();
    const c = document.querySelector("[data-testid=keys-card]").getBoundingClientRect();
    return { w: r.width, h: r.height, navW: nav.width, cardX: c.x - r.x, cardW: c.width };
  });
  await p.context().close();
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
  console.log(`  ${ok ? "ok  " : "FAIL"} ${k.padEnd(22)} reference ${refF[k].toFixed(1).padStart(7)}  ours ${(oursF[k] ?? NaN).toFixed(1).padStart(7)}  (off ${d.toFixed(1)}px)`);
  if (!ok) failures.push(`${k}: ${oursF[k]?.toFixed(1)} vs ${refF[k].toFixed(1)}`);
}
if (failures.length) { console.error(`\ngeometry differs from the reference app:\n - ${failures.join("\n - ")}`); process.exit(1); }
console.log("\nquestion card, context menu and settings modal match the reference app");
