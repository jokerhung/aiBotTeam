// Workspace layout check: every menu item opens its page, the empty ones are empty, the address follows the page (Back, Forward, reload),
// the rail collapses and remembers it, and a narrow screen opens the menu as a drawer.
//   node web/e2e/workspace.mjs            against the running app (BASE, default http://127.0.0.1:5299)
// It clicks through the menu and, for the chat check, makes one throw-away Echo bot and deletes it again.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const req = createRequire(fileURLToPath(new URL("../package.json", import.meta.url)));
const { chromium } = req("playwright-core");
const BASE = process.env.BASE || "http://127.0.0.1:5299";
const exe = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);

let failed = 0;
const ok = (cond, what) => { console.log(`${cond ? "ok  " : "FAIL"} ${what}`); if (!cond) failed++; };

const browser = await chromium.launch({ executablePath: exe, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="app-rail"]');

const PAGES = [
  ["nav-dashboard", "page-dashboard", "#/dashboard"], ["nav-inbox", "page-inbox", "#/inbox"], ["nav-projects", "page-projects", "#/projects"],
  ["nav-agents", "page-agents", "#/agents"], ["nav-workflows", "page-workflows", "#/workflows"], ["nav-routines", "automations-page", "#/routines"],
  ["nav-bases", "page-bases", "#/bases"], ["nav-documents", "page-documents", "#/documents"], ["nav-skills", "page-skills", "#/skills"],
  ["nav-apps", "page-apps", "#/apps"], ["nav-input", "page-input", "#/input"],
];
for (const [nav, pageId, hash] of PAGES) {
  await page.click(`[data-testid="${nav}"]`);
  await page.waitForSelector(`[data-testid="${pageId}"]`, { timeout: 5000 }).catch(() => {});
  ok(await page.locator(`[data-testid="${pageId}"]`).count() > 0, `${nav} opens ${pageId}`);
  ok(await page.evaluate(() => location.hash) === hash, `${nav} writes ${hash}`);
  ok(await page.locator(`[data-testid="${nav}"]`).getAttribute("aria-current") === "page", `${nav} is the current page`);
}
for (const [nav, pageId] of [["nav-workflows", "page-workflows"], ["nav-bases", "page-bases"], ["nav-documents", "page-documents"]]) {
  await page.click(`[data-testid="${nav}"]`);
  ok(await page.locator(`[data-testid="${pageId}"] [data-testid="empty-page"]`).count() === 1, `${pageId} is an empty page`);
  ok(await page.locator(`[data-testid="${pageId}"] [data-testid="empty-page"] button, [data-testid="${pageId}"] [data-testid="empty-page"] a`).count() === 0, `${pageId} has nothing to press`);
}

// projects: every group of bots in the chat list is a project in the menu and opens its own page
const sections = await page.evaluate(async () => (await (await fetch("/api/sidebar-sections")).json()).sections ?? []);
if (sections.length) {
  ok(await page.locator('[data-testid="rail-section"]').count() === sections.length, "the menu lists every group of bots as a project");
  await page.locator('[data-testid="rail-section"]').first().click();
  await page.waitForSelector('[data-testid="chat-list-title"]', { timeout: 5000 }).catch(() => {});
  ok((await page.evaluate(() => location.hash)).startsWith("#/section/"), "a project writes its address");
  const firstId = sections[0].id;
  const inProject = await page.evaluate(async (id) => (await (await fetch("/api/bots")).json()).bots.filter((b) => !b.hidden && b.section === id).length, firstId);
  ok(await page.locator('[data-testid="chat-list-title"]').innerText() === sections[0].name, "a project shows the chat list titled with its name");
  ok(await page.locator('nav[aria-label="Bots"] [role="button"]').count() === inProject, "the list holds only the bots of that project");
  if (inProject > 1) {
    await page.locator('nav[aria-label="Bots"] [role="button"]').nth(1).click();
    await page.waitForTimeout(400);
    ok((await page.evaluate(() => location.hash)).startsWith("#/section/") && await page.locator('[data-testid="chat-list-title"]').innerText() === sections[0].name, "choosing a bot of the project stays in the project");
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="chat-list-title"]', { timeout: 8000 }).catch(() => {});
  ok((await page.evaluate(() => location.hash)).startsWith("#/section/") && await page.locator('[data-testid="chat-list-title"]').innerText() === sections[0].name, "a reload keeps the project");
  // opening a project from a bare #/chat address (no bot in it) still writes the project's address
  await page.goto(`${BASE}/#/chat`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="rail-section"]').first().click();
  await page.waitForTimeout(400);
  ok((await page.evaluate(() => location.hash)).startsWith("#/section/"), "a project opened from #/chat writes its address");
}

// the go-to keys: G then a letter
await page.click('[data-testid="nav-dashboard"]');
await page.keyboard.press("g");
await page.keyboard.press("a");
await page.waitForSelector('[data-testid="page-agents"]', { timeout: 3000 }).catch(() => {});
ok(await page.locator('[data-testid="page-agents"]').count() === 1, "G then A opens Agents");
await page.keyboard.press("g");
await page.keyboard.press("w");
ok(await page.locator('[data-testid="page-workflows"]').count() === 1, "G then W opens Workflows");
await page.keyboard.press("a");
ok(await page.locator('[data-testid="page-workflows"]').count() === 1, "a letter alone does nothing");

// a chat message to a throw-away Echo bot (the demo engine: no model is called), removed afterwards
const made = await page.evaluate(async () => {
  const r = await fetch("/api/bots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "E2E check", modelSelection: { instanceId: "echo", model: "echo-1" }, approvalMode: "ask" }) });
  return r.ok ? r.json() : null;
});
if (made) {
  await page.click('[data-testid="nav-chat"]');
  await page.evaluate((id) => { location.hash = `#/chat/${id}`; }, made.id);
  await page.waitForSelector("textarea, [contenteditable=true]", { timeout: 8000 }).catch(() => {});
  const box = page.locator('[contenteditable="true"], textarea').last();
  await box.click();
  await page.keyboard.type("hello from the workspace check");
  await page.keyboard.press("Enter");
  await page.waitForSelector("text=You said: hello from the workspace check", { timeout: 15000 }).catch(() => {});
  ok(await page.locator("text=You said: hello from the workspace check").count() > 0, "a message sent from the Chat page is answered");
  await page.evaluate((id) => fetch(`/api/bots/${id}`, { method: "DELETE" }), made.id);
} else ok(false, "could not make the Echo bot for the chat check");

// Back, Forward and reload
await page.click('[data-testid="nav-agents"]');
await page.click('[data-testid="nav-skills"]');
await page.goBack();
await page.waitForSelector('[data-testid="page-agents"]');
ok(await page.evaluate(() => location.hash) === "#/agents", "Back returns to Agents");
await page.goForward();
await page.waitForSelector('[data-testid="page-skills"]');
ok(true, "Forward returns to Skills");
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="page-skills"]', { timeout: 8000 }).catch(() => {});
ok(await page.locator('[data-testid="page-skills"]').count() === 1, "a reload keeps the page");

// the chat list shows only beside Chat
await page.click('[data-testid="nav-chat"]');
ok(await page.locator('[data-testid="chat-list-title"]').count() === 1, "Chat shows the chat list");
await page.click('[data-testid="nav-dashboard"]');
ok(await page.locator('[data-testid="chat-list-title"]').count() === 0, "other pages do not");

// collapse and remember
await page.click('[data-testid="rail-collapse"]');
ok(await page.locator('[data-testid="app-rail"]').getAttribute("data-collapsed") !== null, "the rail collapses");
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="app-rail"]');
ok(await page.locator('[data-testid="app-rail"]').getAttribute("data-collapsed") !== null, "and stays collapsed after a reload");
await page.click('[data-testid="rail-collapse"]');

// a narrow screen: the menu is a drawer
await page.setViewportSize({ width: 390, height: 800 });
await page.waitForTimeout(300);
ok(!(await page.locator('[data-testid="app-rail"]').isVisible() && (await page.locator('[data-testid="app-rail"]').boundingBox())?.x >= 0), "the rail is off screen on a phone");
await page.goto(`${BASE}/#/dashboard`, { waitUntil: "networkidle" });
await page.click('button[aria-label="Open menu"]');
await page.waitForTimeout(300);
ok((await page.locator('[data-testid="app-rail"]').boundingBox())?.x >= 0, "the menu button opens the drawer");
await page.click('[data-testid="nav-agents"]');
await page.waitForSelector('[data-testid="page-agents"]');
await page.waitForTimeout(300);
ok((await page.locator('[data-testid="app-rail"]').boundingBox())?.x < 0, "choosing a page closes the drawer");

ok(errors.length === 0, `no page errors${errors.length ? ": " + errors[0].slice(0, 120) : ""}`);
await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
