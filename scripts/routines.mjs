// Routines in a real browser: add (interval and daily), a bad schedule is refused with the server's message,
// Run now sends the message to the bot, the checkbox pauses it, and delete removes it. Needs `pnpm dev`.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { chromium } = createRequire(join(root, "web", "package.json"))("playwright-core");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const API = `http://127.0.0.1:${process.env.SERVER_PORT || 8899}`;
const WEB = `http://127.0.0.1:${process.env.WEB_PORT || 5299}`;
const j = async (m, p, b) => (await fetch(API + p, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined })).json();

const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(edge ? { executablePath: edge } : {}) });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const failures = [];
const step = (ok, label) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) failures.push(label); };

await j("PUT", "/api/config", { language: "en", skin: "daylight" });
for (const b of (await j("GET", "/api/bots")).bots) if (b.name === "Clock") await j("DELETE", `/api/bots/${b.id}`);
const bot = await j("POST", "/api/bots", { name: "Clock", modelSelection: { instanceId: "echo", model: "echo-1" } });
await page.goto(WEB);
await page.locator("[role=button][title=Clock]").click();
await page.getByLabel("Bot details").click();
await page.getByTestId("panel-overview").getByRole("button", { name: "Add a routine" }).click();
await page.getByTestId("routines-view").waitFor();
step(await page.getByText("No routines yet").isVisible(), "empty state is shown");

// a daily routine
await page.getByTestId("routines-view").getByRole("button", { name: "Add a routine" }).click();
await page.getByLabel("Routine message").fill("Good morning, what is on today?");
await page.getByLabel("Time of day").fill("07:45");
await page.getByRole("button", { name: "Save routine" }).click();
await page.getByTestId("routine-row").waitFor();
const first = await page.getByTestId("routine-row").first().innerText();
step(/Daily at 07:45/.test(first), `daily routine saved (${first.split("\n").slice(0, 2).join(" / ").slice(0, 70)})`);

// a bad interval is refused with the server's own message
await page.getByTestId("routines-view").getByRole("button", { name: "Add a routine" }).click();
await page.getByLabel("Routine message").fill("too often");
await page.getByLabel("Repeat").selectOption("interval");
await page.getByLabel("Minutes").fill("0");
await page.getByRole("button", { name: "Save routine" }).click();
const err = await page.getByTestId("routine-form").getByRole("alert").innerText();
step(/interval must be between 1 and 10080 minutes/.test(err), `bad interval refused: "${err}"`);
await page.getByLabel("Minutes").fill("30");
await page.getByRole("button", { name: "Save routine" }).click();
await page.waitForFunction(() => document.querySelectorAll("[data-testid=routine-row]").length === 2);
step(true, "interval routine saved");

// run now sends the message and the bot answers
const row = page.getByTestId("routine-row").filter({ hasText: "Good morning" });
await row.getByRole("button", { name: "Run now" }).click();
await page.getByText("You said: Good morning, what is on today?").waitFor({ timeout: 10000 });
step(true, "Run now sent the message and the bot answered");
const after = (await j("GET", `/api/bots/${bot.id}/routines`)).routines.find((r) => r.text.startsWith("Good morning"));
step(after.lastRun !== null, "last run was recorded");

// pause and delete
await row.getByRole("checkbox").uncheck();
await page.waitForTimeout(500);
step((await j("GET", `/api/bots/${bot.id}/routines`)).routines.find((r) => r.text.startsWith("Good morning")).enabled === false, "checkbox pauses the routine");
await row.getByRole("button", { name: "Delete routine" }).click();
await page.waitForFunction(() => document.querySelectorAll("[data-testid=routine-row]").length === 1);
step(true, "delete removes it");

await j("DELETE", `/api/bots/${bot.id}`);
await browser.close();
if (failures.length) { console.error(`\nroutines check failed:\n - ${failures.join("\n - ")}`); process.exit(1); }
console.log("\nroutines work end to end");
