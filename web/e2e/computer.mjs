// The Computer panel against a running app: wake the bot's browser, see its screen, take control, type, give it back, sleep.
//   PW_PATH=<dir with node_modules/playwright-core> API=http://127.0.0.1:8898 WEB=http://127.0.0.1:8898 node web/e2e/computer.mjs
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
const require = createRequire((process.env.PW_PATH || ".") + "/");
const { chromium } = require("playwright-core");
const API = process.env.API || "http://127.0.0.1:8898", WEB = process.env.WEB || API;
const SHOTS = process.env.SHOTS || "web/e2e/shots";
mkdirSync(SHOTS, { recursive: true });
const j = async (path, method = "GET", body) => {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : {} };
};
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) process.exitCode = 1; };

const site = createServer((_, res) => {
  res.setHeader("content-type", "text/html");
  res.end(`<html><head><title>Shop</title></head><body style="font:28px sans-serif"><h1>Hello from the shop</h1>
    <button style="font-size:40px;padding:30px" onclick="document.title='Clicked';document.getElementById('o').textContent='Order placed'">Buy</button><p id=o></p></body></html>`);
}).listen(0, "127.0.0.1");
await new Promise((r) => site.once("listening", r));
const SITE = `http://127.0.0.1:${site.address().port}/`;

for (const x of (await j("/api/bots")).json.bots) if (x.name.startsWith("E2EC ")) await j(`/api/bots/${x.id}`, "DELETE");
const bot = (await j("/api/bots", "POST", { name: "E2EC Bot", modelSelection: { instanceId: "echo", model: "echo-1" } })).json;
await j("/api/computer/settings", "PUT", { allowLocal: true });

const b = await chromium.launch({ executablePath: process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const p = await (await b.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto(WEB);
await p.waitForSelector('[data-testid="open-computer"]', { timeout: 20000 });
await p.locator('[data-testid="open-computer"]').click();
await p.waitForSelector('[data-testid="computer-panel"]');
ok(/asleep/.test(await p.locator('[data-testid="computer-screen"]').innerText()), "the screen starts asleep");
ok(await p.getByText("E2EC Bot's screen").isVisible(), "the label names the bot");

await p.locator('[data-testid="computer-wake"]').click();
await p.waitForSelector('[data-testid="computer-sleep"]', { timeout: 20000 });
ok(true, "Open desktop starts the browser");

// the person takes it, goes to a page, and the picture follows
await p.locator('[data-testid="computer-control"]').click();
await p.getByText("You are in control").waitFor();
await p.getByLabel("Address").fill(SITE);
await p.getByLabel("Address").press("Enter");
await p.waitForSelector('[data-testid="computer-screen"] img', { timeout: 20000 });
ok(true, "a picture of the page appears");
await p.waitForFunction(() => document.querySelector('[data-testid="computer-screen"] img')?.alt.includes("Shop"), null, { timeout: 15000 });
ok(true, "the picture is of the page that was opened (title Shop)");
const img = p.locator('[data-testid="computer-screen"] img');
const box = await img.boundingBox();
// the Buy button is at about (80,150) of the 1280x800 page
await img.click({ position: { x: (110 / 1280) * box.width, y: (210 / 800) * box.height } });
await p.waitForFunction(() => document.querySelector('[data-testid="computer-screen"] img')?.alt.includes("Clicked"), null, { timeout: 15000 });
ok(true, "a click on the picture reaches the page");
await p.screenshot({ path: `${SHOTS}/p5-computer-panel.png` });

await p.locator('[data-testid="computer-control"]').click();
await p.waitForFunction(() => !document.body.innerText.includes("You are in control"));
ok((await j(`/api/bots/${bot.id}/computer`)).json.held === false, "Give it back returns the browser to the bot");
await p.locator('[data-testid="computer-sleep"]').click();
await p.waitForSelector('[data-testid="computer-wake"]');
ok((await j(`/api/bots/${bot.id}/computer`)).json.running === false, "Sleep closes the browser");
ok(errors.length === 0, `no page errors ${errors.slice(0, 2).join(" | ")}`);

await j("/api/computer/settings", "PUT", { allowLocal: false });
await j(`/api/bots/${bot.id}`, "DELETE");
await b.close();
site.close();
