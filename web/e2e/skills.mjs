// Skill library, offline gallery migration, editor/files and assignment against a running app.
// The 80 gallery skills are retained: installing them is the requested migration, not test data.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(new URL("../package.json", import.meta.url));
const { chromium } = require("playwright-core");
const API = process.env.API || "http://127.0.0.1:8899";
const BASE = process.env.BASE || "http://127.0.0.1:5299";
async function json(path, method = "GET", body) {
  const response = await fetch(API + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw Error(`${method} ${path}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}
const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
await context.addInitScript(() => { localStorage.setItem("botteam-welcomed", "1"); localStorage.setItem("botteam-tour-done", "1"); localStorage.setItem("botteam-seen-release", "2026-11-toolbox"); });
const page = await context.newPage(); const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
mkdirSync("web/e2e/actual", { recursive: true });
const before = (await json("/api/skills")).skills;
let made, bot;
try {
  await page.goto(BASE + "/#/skills");
  await page.getByRole("button", { name: "Skill gallery", exact: true }).click();
  let gallery = page.getByRole("dialog", { name: "Skill gallery", exact: true });
  await gallery.getByTestId("gallery-industry").first().waitFor();
  if (await gallery.getByTestId("gallery-industry").count() !== 7) throw Error("Expected seven industry shelves");
  const installAll = gallery.getByTestId("install-gallery-all");
  if (await installAll.isEnabled()) {
    await installAll.click();
    await gallery.getByRole("status").waitFor({ timeout: 30000 });
  }
  await gallery.getByRole("button", { name: /Software teams/ }).click();
  gallery = page.getByRole("dialog", { name: "Software teams", exact: true });
  if (await gallery.getByTestId("gallery-skill").count() !== 20) throw Error("Expected twenty software skills");
  const first = gallery.getByTestId("gallery-skill").first();
  await first.getByRole("button", { name: "Preview", exact: true }).click();
  await first.getByRole("heading", { name: "Budgets and limits", exact: true }).waitFor();
  await page.screenshot({ path: "web/e2e/actual/skills-gallery.png" });
  await gallery.getByRole("button", { name: "Close", exact: true }).click();
  const data = await json("/api/skills/gallery");
  const all = data.industries.flatMap((industry) => industry.skills);
  if (all.length !== 80 || all.some((skill) => !skill.installed)) throw Error("Gallery migration incomplete");
  const after = (await json("/api/skills")).skills;
  for (const old of before) {
    const kept = after.find((skill) => skill.id === old.id);
    if (!kept || kept.body !== old.body || kept.enabled !== old.enabled || kept.description !== old.description) throw Error(`Migration changed existing ${old.id}`);
  }
  const again = await json("/api/skills/gallery/install", "POST", { keys: all.map((skill) => skill.key) });
  if (again.installed.length || again.skipped.length !== 80) throw Error("Migration is not idempotent");
  console.log("PASS Migrated all 80 gallery skills, preserved existing skills, repeated migration skips all");
  const search = page.getByRole("textbox", { name: "Search skills", exact: true });
  await search.fill("agenticos-guide");
  const guide = page.getByTestId("skill-card").filter({ hasText: "agenticos-guide" });
  await guide.getByRole("button", { name: "agenticos-guide", exact: true }).click();
  let editor = page.getByTestId("skill-editor");
  await editor.getByRole("button", { name: "docs/api.md", exact: true }).click();
  await editor.getByRole("heading", { name: /API/ }).first().waitFor();
  await page.screenshot({ path: "web/e2e/actual/skills-files.png" });
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  console.log("PASS Gallery supporting files are available in the editor");
  await search.fill("");
  await page.getByTestId("new-skill").click();
  editor = page.getByTestId("skill-editor");
  const name = `Skill E2E ${Date.now()}`;
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await editor.getByRole("textbox", { name: "When to use it", exact: true }).fill("When verifying skill assignment");
  await editor.getByRole("combobox", { name: "Category", exact: true }).selectOption("engineering");
  await editor.getByRole("textbox", { name: "Instructions", exact: true }).fill("# Original instructions\n\nCheck the original skill.");
  await editor.getByRole("button", { name: "Preview", exact: true }).click();
  await editor.getByRole("heading", { name: "Original instructions", exact: true }).waitFor();
  await editor.getByRole("button", { name: "Create", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  made = (await json("/api/skills")).skills.find((skill) => skill.name === name);
  if (!made) throw Error("New skill was not saved");
  const original = after[0];
  bot = await json("/api/bots", "POST", { name: `Skill E2E agent ${Date.now()}`, modelSelection: { instanceId: "echo", model: "echo-1" } });
  await json(`/api/bots/${bot.id}`, "PATCH", { skills: [original.id] });
  await search.fill(name);
  let card = page.getByTestId("skill-card").filter({ hasText: name });
  await card.getByRole("button", { name: "Add to an agent", exact: true }).click();
  const assign = page.getByRole("dialog", { name: "Add to an agent", exact: true });
  await assign.getByRole("checkbox", { name: bot.name, exact: true }).check();
  await assign.getByRole("button", { name: "Add", exact: true }).click();
  await assign.waitFor({ state: "hidden" });
  const assigned = (await json("/api/bots")).bots.find((item) => item.id === bot.id);
  if (!assigned.skills.includes(made.id) || !assigned.skills.includes(original.id)) throw Error("Assignment lost an existing skill");
  await card.getByText(bot.name, { exact: true }).waitFor();
  await page.getByRole("button", { name: "Filters", exact: false }).click();
  await page.getByRole("checkbox", { name: "Engineering", exact: true }).check();
  if (await page.getByTestId("skill-card").count() !== 1) throw Error("Filter mismatch");
  await card.getByRole("button", { name, exact: true }).click();
  editor = page.getByTestId("skill-editor");
  await editor.getByRole("textbox", { name: "Instructions", exact: true }).fill("# Updated instructions");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  if (!(await json("/api/skills")).skills.find((skill) => skill.id === made.id).body.includes("Updated")) throw Error("Edit was not persisted");
  await search.fill("");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.screenshot({ path: "web/e2e/actual/skills-library.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300); // Let the responsive rail's slide-out animation settle.
  await page.screenshot({ path: "web/e2e/actual/skills-mobile.png" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  if (overflow) throw Error("Skills page overflows on mobile");
  if (errors.length) throw Error(errors.join("\n"));
  console.log("PASS Search, filters, creation/preview/edit, assignment preserving existing skills and mobile layout");
} catch (error) {
  await page.screenshot({ path: "web/e2e/actual/skills-failure.png" }).catch(() => {});
  throw error;
} finally {
  if (made) await json(`/api/skills/${made.id}`, "DELETE").catch(() => {});
  if (bot) await json(`/api/bots/${bot.id}`, "DELETE").catch(() => {});
  await browser.close();
}
