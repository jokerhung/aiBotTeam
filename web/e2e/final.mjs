// Phase 5 §10 against the running app: first paint, a 5,000-message transcript, and every main screen over 13 skins x 2 sizes.
//   PW_PATH=... API=http://127.0.0.1:8898 DATA=<data dir> PYTHON=<python> [REPORT=docs/visual-report.md] node web/e2e/final.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire((process.env.PW_PATH || ".") + "/");
const { chromium } = require("playwright-core");
const API = process.env.API || "http://127.0.0.1:8898", WEB = process.env.WEB || API;
const DATA = process.env.DATA, PY = process.env.PYTHON || "python";
const OUT = (process.env.SHOTS || "web/e2e/shots") + "/skins";
mkdirSync(OUT, { recursive: true });
const j = async (path, method = "GET", body) => {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : {} };
};
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) process.exitCode = 1; };
const SKINS = ["atelier", "aurora", "daylight", "diwali", "dusk", "foundry", "graphite", "halloween", "lagoon", "linen", "meadow", "midnight", "pop"];
const SIZES = { desktop: { width: 1360, height: 860 }, phone: { width: 390, height: 844 } };
const cleanup = async () => { for (const x of (await j("/api/bots")).json.bots) if (x.name.endsWith("FIN")) await j(`/api/bots/${x.id}`, "DELETE"); };
await cleanup();
const echo = { instanceId: "echo", model: "echo-1" };
const bot = (await j("/api/bots", "POST", { name: "ShortFIN", modelSelection: echo, approvalMode: "full" })).json;
const long = (await j("/api/bots", "POST", { name: "LongFIN", modelSelection: echo, approvalMode: "full" })).json;
await j(`/api/bots/${bot.id}/messages`, "POST", { text: "/md", threadId: bot.threadId });
await new Promise((r) => setTimeout(r, 2500));

const b = await chromium.launch({ executablePath: process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const newPage = async (size, skin) => {
  const ctx = await b.newContext({ viewport: size });
  await ctx.addInitScript((s) => { try { localStorage.setItem("botteam-skin", s); localStorage.setItem("botteam-seen-release", "x"); localStorage.setItem("botteam-welcomed", "1"); localStorage.setItem("botteam-tour-done", "1"); } catch {} }, skin);
  return ctx.newPage();
};

// --- first paint on localhost
{
  const p = await newPage(SIZES.desktop, "daylight");
  await p.addInitScript(() => { window.__fcp = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") window.__fcp = e.startTime; }).observe({ type: "paint", buffered: true }); });
  await p.goto(WEB);
  await p.waitForSelector('[data-testid="connect-apps"]');
  // headless Edge may report no paint entry: then the time until the app is on screen stands in for it
  const fcp = await p.evaluate(() => window.__fcp || performance.getEntriesByName("first-contentful-paint")[0]?.startTime || performance.now());
  ok(fcp > 0 && fcp < 1500, `first paint ${Math.round(fcp)} ms (limit 1500)`);
  await p.close();
}

// --- a 5,000-message transcript
{
  execFileSync(PY, ["web/e2e/seed_long.py", `${DATA}/messages.db`, long.id, long.threadId, "5000"], { stdio: "inherit" });
  const p = await newPage(SIZES.desktop, "daylight");
  await p.addInitScript(() => { window.__long = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({ type: "longtask", buffered: true }); } catch {} });
  await p.goto(WEB);
  await p.waitForSelector('[data-testid="connect-apps"]');
  const t0 = Date.now();
  await p.locator("text=LongFIN").first().click();
  await p.waitForFunction(() => document.body.innerText.includes("Message 4999"), null, { timeout: 15000 });
  ok(true, `the newest message shows ${Date.now() - t0} ms after opening`);
  const log = p.locator("[role=log]");
  let reached = false;
  const t1 = Date.now();
  let count = 0;
  await log.hover();
  for (let i = 0; i < 400 && !reached; i++) {
    await p.mouse.wheel(0, -6000);
    await p.waitForTimeout(60);
    reached = await p.evaluate(() => document.body.innerText.includes("Message 0."));
    count = i;
  }
  console.log(`INFO  ${count} wheel steps`);
  ok(reached, `scrolling up reaches the first of 5000 messages (${Math.round((Date.now() - t1) / 1000)} s)`);
  const frames = await log.evaluate(async (el) => {
    const gaps = []; let prev = performance.now(); let y = 0;
    await new Promise((done) => { const step = () => { const now = performance.now(); gaps.push(now - prev); prev = now; y += 900; el.scrollTop = y; if (y < el.scrollHeight && gaps.length < 300) requestAnimationFrame(step); else done(); }; requestAnimationFrame(step); });
    gaps.sort((a, c) => a - c); return { p95: gaps[Math.floor(gaps.length * 0.95)], max: gaps[gaps.length - 1], n: gaps.length };
  });
  const long5 = await p.evaluate(() => Math.max(0, ...window.__long));
  ok(frames.p95 < 100, `scrolling a long transcript: p95 frame ${Math.round(frames.p95)} ms, worst ${Math.round(frames.max)} ms over ${frames.n} frames`);
  console.log(`INFO  longest main-thread task while loading and scrolling: ${Math.round(long5)} ms`);
  await p.close();
}

// --- every main screen, 13 skins x 2 sizes
const rows = [];
const screens = [
  ["chat", async (p) => { await p.locator("text=ShortFIN").first().click(); await p.waitForTimeout(500); }],
  ["bot-panel", async (p) => { await p.locator("text=ShortFIN").first().click(); await p.getByRole("button", { name: "Bot details" }).click(); await p.waitForSelector('[data-testid="bot-panel"]'); }],
  ["computer", async (p) => { await p.locator("text=ShortFIN").first().click(); await p.getByRole("button", { name: "Bot's screen" }).click(); await p.waitForSelector('[data-testid="computer-panel"]'); }],
  ["automations", async (p) => { await p.getByRole("button", { name: "Profile and settings" }).click(); await p.locator('[data-testid="open-automations"]').click(); await p.waitForTimeout(600); }],
  ["connected-apps", async (p) => { await p.locator('[data-testid="connect-apps"]').click(); await p.waitForSelector('[data-testid="connected-apps"]'); }],
  ["usage", async (p) => { await p.getByRole("button", { name: "Profile and settings" }).click(); await p.locator('[data-testid="open-usage"]').click(); await p.waitForTimeout(600); }],
  ["new-bot", async (p) => { await p.getByRole("button", { name: "New or share" }).click(); await p.getByRole("button", { name: "New bot", exact: true }).click(); await p.getByRole("dialog", { name: "New bot" }).waitFor(); }],
];
let shots = 0, bad = 0;
for (const skin of (process.env.ONLY ? process.env.ONLY.split(",") : SKINS)) for (const [sizeName, size] of Object.entries(SIZES)) {
  for (const [name, go] of screens) {
    const p = await newPage(size, skin);
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(WEB);
    let state = "ok", note = "";
    try {
      await p.waitForSelector('[data-testid="connect-apps"], [aria-label="Open bot list"]', { timeout: 20000 });
      if (sizeName === "phone") await p.getByRole("button", { name: "Open bot list" }).click().catch(() => {});
      await go(p);
      await p.waitForTimeout(250);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) { state = "overflow"; note = `${over}px wider than the screen`; }
      if (errs.length) { state = "error"; note = errs[0].slice(0, 80); }
      await p.screenshot({ path: `${OUT}/${skin}-${sizeName}-${name}.png` });
      shots++;
    } catch (e) { state = "failed"; note = String(e.message).split("\n")[0].slice(0, 80); }
    if (state !== "ok") { bad++; console.log(`FAIL  ${skin} ${sizeName} ${name}: ${state} ${note}`); }
    rows.push({ skin, size: sizeName, screen: name, state, note });
    await p.context().close();
  }
}
ok(bad === 0, `${shots} screenshots over ${SKINS.length} skins x 2 sizes x ${screens.length} screens, ${bad} problems`);
if (process.env.REPORT) {
  const head = `# Visual check\n\nGenerated by \`web/e2e/final.mjs\`: every main screen over ${SKINS.length} skins at two sizes (1360x860 and 390x844). A screen passes when it opens, throws no page error and does not scroll sideways. Contrast of every skin is checked separately by \`scripts/check-skin-contrast.mjs\`.\n\n`;
  const table = ["| skin | size | " + screens.map((s) => s[0]).join(" | ") + " |", "|---|---|" + screens.map(() => "---").join("|") + "|"];
  for (const skin of (process.env.ONLY ? process.env.ONLY.split(",") : SKINS)) for (const sz of Object.keys(SIZES)) table.push(`| ${skin} | ${sz} | ` + screens.map(([n]) => { const r = rows.find((x) => x.skin === skin && x.size === sz && x.screen === n); return r.state === "ok" ? "ok" : `**${r.state}**`; }).join(" | ") + " |");
  writeFileSync(process.env.REPORT, head + table.join("\n") + `\n\n${shots} screens checked, ${bad} problems.\n`);
}
await cleanup();
await b.close();
