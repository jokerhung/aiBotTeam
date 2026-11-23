// Live Browser preview against a running development app. Uses and removes one temporary Echo bot.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(new URL("../package.json", import.meta.url));
const { chromium } = require("playwright-core");
const API = process.env.API || "http://127.0.0.1:8899";
const WEB = process.env.BASE || "http://127.0.0.1:5299";
async function request(path, method = "GET", body) {
  const response = await fetch(API + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
  return response.json();
}
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
let bot, group;
try {
  bot = await request("/api/bots", "POST", { name: `Liveview test ${Date.now()}`, modelSelection: { instanceId: "echo", model: "echo-1" } });
  await page.addInitScript(() => { localStorage.setItem("botteam-welcomed", "1"); localStorage.setItem("botteam-tour-done", "1"); localStorage.setItem("botteam-seen-release", "2026-11-toolbox"); });
  await page.goto(`${WEB}/#/chat/${bot.id}`);
  await page.getByTestId("open-computer").waitFor();
  if (await page.getByTestId("inline-liveview").count()) throw new Error("Sleeping surfaces must not show a preview");
  await request(`/api/bots/${bot.id}/browser/wake`, "POST");
  const preview = page.getByTestId("inline-liveview");
  await preview.waitFor({ timeout: 30000 });
  if (await preview.getByRole("button", { name: "Take over", exact: true }).count()) throw new Error("Compact preview must not expose takeover controls");
  await preview.getByRole("button", { name: "Expand live preview" }).click();
  await page.getByRole("dialog").waitFor();
  await preview.getByRole("button", { name: "Take over", exact: true }).click();
  await preview.getByRole("button", { name: "Give it back", exact: true }).waitFor();
  await request(`/api/bots/${bot.id}/browser/input`, "POST", { type: "goto", url: "https://example.com" });
  await page.waitForFunction(() => document.querySelector('[data-testid="inline-liveview"] img')?.getAttribute("src")?.startsWith("data:image/"));
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-testid="inline-liveview"] img');
    if (!image?.complete || !image.naturalWidth) return false;
    const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 100;
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0, 160, 100);
    const pixels = context.getImageData(0, 0, 160, 100).data;
    return Array.from({ length: 16000 }, (_, i) => pixels[i * 4]).filter((value) => value < 180).length > 20;
  });
  await page.getByRole("button", { name: "Give it back", exact: true }).click();
  await page.getByRole("button", { name: "Take over", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  mkdirSync("web/e2e/actual", { recursive: true });
  await page.screenshot({ path: "web/e2e/actual/inline-browser.png" });
  group = await request("/api/groups", "POST", { name: "Liveview temporary project", members: [bot.id], leader: bot.id });
  await page.goto(`${WEB}/#/project/${group.id}`);
  await preview.waitFor();
  console.log("PASS Browser live frames, Take over/hand back, expand/close, direct chat and project");
  await request(`/api/bots/${bot.id}/browser/sleep`, "POST");
  await preview.waitFor({ state: "hidden" });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("PASS Sleeping preview disappears; no browser page errors");
} finally {
  await browser.close();
  if (group) await request(`/api/groups/${group.id}`, "DELETE");
  if (bot) await request(`/api/bots/${bot.id}`, "DELETE");
}
