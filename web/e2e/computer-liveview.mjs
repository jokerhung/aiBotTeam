// Manual integration check of an existing Creator Computer. Only opens a terminal and prints a test label.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(new URL("../package.json", import.meta.url));
const { chromium } = require("playwright-core");
const API = process.env.API || "http://127.0.0.1:8899";
const WEB = process.env.BASE || "http://127.0.0.1:5299";
async function request(path, method = "GET", body) {
  const response = await fetch(API + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
  return response.json();
}
const bot = (await request("/api/bots")).bots.find((b) => b.id === (process.env.BOT_ID || "bot_87cee4fe993d"));
if (!bot?.toolbox?.computer?.enabled || bot.busy) throw new Error("Creator must have Computer enabled and be idle");
const base = `/api/bots/${bot.id}/computer`;
await request(`${base}/wake`, "POST");
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
mkdirSync("web/e2e/actual", { recursive: true });
const preview = page.locator('[data-testid="inline-liveview"][data-surface="computer"]');
async function live() {
  await preview.waitFor({ timeout: 30000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-surface="computer"] canvas');
    if (!canvas || canvas.width < 640 || canvas.height < 480) return false;
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4096) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 90) return true;
    return false;
  }, { timeout: 30000 });
}
try {
  await page.addInitScript(() => { localStorage.setItem("botteam-welcomed", "1"); localStorage.setItem("botteam-tour-done", "1"); localStorage.setItem("botteam-seen-release", "2026-11-toolbox"); });
  await page.goto(`${WEB}/#/chat/${bot.id}`);
  await live();
  if (await preview.getByRole("button", { name: "Take over", exact: true }).count()) throw new Error("Compact preview exposes takeover");
  await preview.screenshot({ path: "web/e2e/actual/creator-computer-inline.png" });
  console.log("PASS Real Computer noVNC desktop in compact chat preview; expand button only");
  await preview.getByRole("button", { name: "Expand live preview" }).click();
  await live();
  await preview.getByRole("button", { name: "Take over", exact: true }).click();
  await preview.getByRole("button", { name: "Give it back", exact: true }).waitFor();
  if (!(await request(`${base}/capability`)).held) throw new Error("Takeover not reflected on server");
  const screen = preview.getByRole("group", { name: "Live preview", exact: true });
  await screen.click({ position: { x: 400, y: 250 } });
  await screen.press("Control+Alt+t");
  // Wait for the remote terminal window; inspect the screenshot saved below.
  await page.waitForTimeout(1500);
  await preview.getByRole("textbox", { name: "Type into the screen" }).fill("printf 'BOTTEAM_COMPUTER_LIVEVIEW_TEST\\n'");
  await preview.getByRole("button", { name: "Send", exact: true }).click();
  await screen.press("Enter");
  await page.waitForTimeout(1500);
  const response = await fetch(API + `${base}/screen`);
  if (!response.ok) throw new Error("Could not capture actual desktop");
  writeFileSync("web/e2e/actual/creator-computer-input.png", Buffer.from(await response.arrayBuffer()));
  await preview.screenshot({ path: "web/e2e/actual/creator-computer-expanded.png" });
  await preview.getByRole("button", { name: "Give it back", exact: true }).click();
  if ((await request(`${base}/capability`)).held) throw new Error("Hand-back did not release control");
  await preview.getByRole("button", { name: "Close live preview" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  console.log("PASS Expanded Computer takeover, server input requests and hand-back");
  await page.goto(`${WEB}/#/project/grp_a61ffa54532d`);
  await live();
  await preview.screenshot({ path: "web/e2e/actual/creator-computer-project.png" });
  console.log("PASS Creator Computer desktop in SocialTeam project");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("PASS No browser JavaScript errors");
} catch (error) {
  await page.screenshot({ path: "web/e2e/actual/creator-computer-failure.png" }).catch(() => {});
  throw error;
} finally {
  await request(`${base}/control`, "POST", { holder: "bot" }).catch(() => {});
  await browser.close();
  await request(`${base}/sleep`, "POST");
}
