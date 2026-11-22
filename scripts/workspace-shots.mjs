// Screenshots of the workspace layout for the README, from an isolated stack with demo data only (scratch data folder, its own ports,
// the built-in Echo engine): nothing of a real installation appears in them.
//   node scripts/workspace-shots.mjs            writes docs/screenshots/workspace-*.png
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const req = createRequire(join(root, "web", "package.json"));
const { chromium } = req("playwright-core");
const API_PORT = 18898, WEB_PORT = 15298;
const API = `http://127.0.0.1:${API_PORT}`, WEB = `http://127.0.0.1:${WEB_PORT}`;
const OUT = join(root, "docs", "screenshots");
mkdirSync(OUT, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "botteam-shots-"));
const env = { ...process.env, BOTTEAM_DATA_DIR: dataDir, SERVER_PORT: String(API_PORT), WEB_PORT: String(WEB_PORT), BOTTEAM_API: API, BOTTEAM_DIST_DIR: ".next-shots", ZALO_PORT: "18902", WEBHOOK_PORT: "18900", BOTTEAM_WORKSPACES: join(dataDir, "workspaces") };
const children = [];
const run = (args) => children.push(spawn("node", ["scripts/run.mjs", ...args], { cwd: root, env, stdio: "ignore" }));
const stop = async () => {
  for (const c of children) {
    if (process.platform === "win32") spawn("taskkill", ["/T", "/F", "/PID", String(c.pid)], { stdio: "ignore" });
    else c.kill("SIGTERM");
  }
  await new Promise((r) => setTimeout(r, 1000));
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(join(root, "web", ".next-shots"), { recursive: true, force: true });
};
const up = async (url, ms = 180000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(url)).status < 500) return; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)); }
  throw new Error(`${url} did not come up`);
};
const j = async (m, p, b) => (await fetch(API + p, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined })).json();

let browser;
try {
  run(["server"]);
  run(["web"]);
  await up(`${API}/api/config`);
  await j("PUT", "/api/config", { displayName: "Jordan", language: "en" });
  const echo = { instanceId: "echo", model: "echo-1" };
  const names = [["Maple", "Chief of staff", "blue"], ["Pebble", "Sales researcher", "orange"], ["Fern", "Support desk", "green"], ["Sage", "Finance analyst", "purple"]];
  const bots = [];
  for (const [name, title, color] of names) bots.push(await j("POST", "/api/bots", { name, title, color, modelSelection: echo, approvalMode: "ask", cwd: `/home/demo/${name.toLowerCase()}` }));
  await j("POST", "/api/groups", { name: "Fall launch", members: bots.slice(0, 3).map((b) => b.id) }).catch(() => {});
  await j("POST", "/api/groups", { name: "Treasury reporting", members: [bots[3].id, bots[0].id] }).catch(() => {});
  await j("POST", `/api/bots/${bots[0].id}/messages`, { text: "Draft the launch checklist for next week." });
  await up(WEB);
  const exe = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find(existsSync);
  browser = await chromium.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.addInitScript(() => { try { localStorage.setItem("botteam-welcomed", "1"); localStorage.setItem("botteam-tour-done", "1"); localStorage.setItem("botteam-seen-release", "x"); } catch { /* storage unavailable */ } });
  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="app-rail"]', { timeout: 120000 });
  if (process.argv.includes("--check")) {
    const { checkAgents } = await import("../web/e2e/agents.mjs");
    await checkAgents(page, (condition, message) => { console.log(`${condition ? "ok" : "FAIL"} ${message}`); if (!condition) throw new Error(message); });
  }
  if (process.argv.includes("--workspace")) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["web/e2e/workspace.mjs"], { cwd: root, env: { ...env, BASE: WEB }, stdio: "inherit" });
      child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Workspace check exited ${code}`)));
    });
  }
  const shots = [["chat", "chat"], ["dashboard", "dashboard"], ["agents", "agents"], ["workflows", "empty-page"], ["input", "input"]];
  for (const [hash, name] of shots) {
    await page.evaluate((h) => { location.hash = "#/" + h; }, hash);
    await page.waitForTimeout(hash === "chat" ? 6000 : 2500);
    await page.keyboard.press("Escape");
    await page.screenshot({ path: join(OUT, `workspace-${name}.png`) });
    console.log("wrote", `workspace-${name}.png`);
  }
  await page.evaluate((id) => { location.hash = `#/agents/${id}/build`; }, bots[0].id);
  await page.getByTestId("agent-editor").waitFor(); await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, "workspace-agent-editor.png") });
  await page.evaluate((id) => { location.hash = `#/agents/${id}/toolbox`; }, bots[0].id);
  await page.getByTestId("toolbox-gallery").waitFor();
  await page.addStyleTag({ content: ".toolbox-gallery .cap-art * { animation: none !important; transition: none !important; }" });
  await page.screenshot({ path: join(OUT, "workspace-agent-toolbox.png") });
  await browser.close();
} finally {
  await browser?.close();
  await stop();
}
