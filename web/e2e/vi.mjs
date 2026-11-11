// Every rendered string, not just the ones in the source: switch the interface to Vietnamese, visit each Phase 4 screen and list the
// visible text that is still plain English. What people wrote (bot names, messages) is marked data-no-i18n and skipped.
//   PW_PATH=<dir with node_modules/playwright-core> node web/e2e/vi.mjs      (app running)
import { createRequire } from "node:module";
const require = createRequire((process.env.PW_PATH || ".") + "/");
const { chromium } = require("playwright-core");
const API = process.env.API || "http://127.0.0.1:8899", WEB = process.env.WEB || "http://127.0.0.1:5299";
const j = async (path, method = "GET", body) => {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return t ? JSON.parse(t) : {};
};
const echo = { instanceId: "echo", model: "echo-1" };
for (const x of (await j("/api/bots")).bots) if (x.name.startsWith("Viet ")) await j(`/api/bots/${x.id}`, "DELETE"); // leftovers of a run that stopped half way
for (const g of (await j("/api/groups")).groups) if (g.name.startsWith("Viet ")) await j(`/api/groups/${g.id}`, "DELETE");
const before = (await j("/api/config")).settings.language;
await j("/api/config", "PUT", { language: "vi" });
const A = await j("/api/bots", "POST", { name: "Viet A", title: "Lead", modelSelection: echo });
const B = await j("/api/bots", "POST", { name: "Viet B", title: "Dev", modelSelection: echo, approvalMode: "ask" });
const room = await j("/api/groups", "POST", { name: "Viet room", members: [A.id, B.id], leader: A.id });
const routine = await j("/api/routines", "POST", { name: "Viet routine", prompt: "ping", targetKind: "bot", targetId: A.id, kind: "interval", everyMin: 60 });
const hook = (await j("/api/webhooks", "POST", { name: "Viet hook", targetId: A.id, prompt: "x" })).webhook;
await j(`/api/bots/${B.id}/messages`, "POST", { text: "/approve", threadId: B.threadId }); // one card waiting, so the Inbox and notifications have content

const b = await chromium.launch({ executablePath: process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const p = await (await b.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
await p.goto(WEB);
await p.waitForSelector('[data-testid="group-row"]');
await p.waitForTimeout(800);
if (process.env.DBG) await p.evaluate(() => { window.__dbg = true; });

const english = () => p.evaluate(() => {
  const skip = "script,style,textarea,input,code,pre,[data-no-i18n],svg";
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const el = n.parentElement;
    const text = n.nodeValue.trim();
    if (!el || el.closest(skip) || !text || !el.checkVisibility?.()) continue;
    // plain English: only ASCII letters and punctuation, at least one word of three letters
    if (/^[\x20-\x7e]+$/.test(text) && /[A-Za-z]{3,}/.test(text) && !/^[\d\s.,:;/()+\-–—·%#@&_*|"'’“”[\]]+$/.test(text)) out.push(text + (window.__dbg ? ` @${el.tagName}.${String(el.className).slice(0, 50)} < ${el.parentElement?.tagName}.${String(el.parentElement?.className).slice(0, 40)}` : ""));
  }
  const attrs = [...document.querySelectorAll("[placeholder],[title],[aria-label]")].filter((e) => !e.closest("[data-no-i18n]") && e.checkVisibility?.())
    .flatMap((e) => ["placeholder", "title", "aria-label"].map((a) => e.getAttribute(a)).filter(Boolean)).filter((x) => /^[\x20-\x7e]+$/.test(x) && /[A-Za-z]{3,}/.test(x));
  return [...new Set([...out, ...attrs.map((a) => `[attr] ${a}`)])];
});
// words that are the same in Vietnamese (product and technology terms), model and engine names, time zones
const ALLOW = new Set(["BotTeam", "Ctrl F", "Ctrl / ⌘ K", "Chief", "Agent", "Bot", "Webhook", "Header Bearer", "Bearer", "OK", "AM", "PM", "G", "N", "Notion", "Slack"]);
const ALLOW_RE = /^(\d+:\d+ \d+ thg \d+|GMT[+-]\d+|\d+:\d+ ?(AM|PM)?|Echo.*|Claude.*|Codex.*|GPT.*|\[attr\] (Bot|Webhook|cam|chrome|[A-Z][a-z]+\/[A-Z][A-Za-z_]+))$/;
const seen = new Map();
const scan = async (name) => {
  for (const t of await english()) {
    if (ALLOW.has(t) || ALLOW_RE.test(t)) continue;
    if (!seen.has(t)) seen.set(t, name);
  }
};
const step = async (name, fn) => { try { await fn(); await p.waitForTimeout(500); await scan(name); } catch (e) { console.log(`FAIL  ${name}: ${String(e).split("\n")[0]}`); process.exitCode = 1; } };

await step("sidebar", async () => {});
await step("room", async () => { await p.locator('[data-testid="group-row"]', { hasText: "Viet room" }).click(); await p.waitForSelector('[data-testid="group-view"]'); });
await step("mention picker", async () => { const box = p.locator("textarea").first(); await box.click(); await box.pressSequentially("@"); await p.waitForSelector('[data-testid="mention-picker"]'); await box.fill(""); });
await step("room panel", async () => { await p.getByLabel(/Chi tiết phòng|Room details/).first().click(); await p.waitForSelector('[data-testid="room-panel"]'); await p.getByRole("radio").nth(2).click(); });
await step("new group", async () => { await p.getByLabel(/Chi tiết phòng|Room details/).first().click(); await p.getByTitle(/Mới hoặc chia sẻ|New or share/).click(); await p.locator('[data-testid="new-group-item"]').click(); await p.waitForSelector('[data-testid="new-group"]'); });
await step("new group closed", async () => { await p.keyboard.press("Escape"); await p.getByRole("button", { name: /Hủy|Cancel/ }).first().click(); });
await step("inbox", async () => { await p.locator('[data-testid="inbox-button"]').click(); await p.waitForSelector('[data-testid="inbox-card"]'); });
await step("notifications", async () => { await p.getByLabel(/Thông báo|Notifications/).first().click(); await p.waitForSelector('[data-testid="notifications-panel"]'); });
await step("profile menu", async () => { await p.getByTitle(/Hồ sơ|Profile/).click(); });
await step("team map", async () => { await p.locator('[data-testid="open-team-map"]').click(); await p.waitForSelector('[data-testid="team-map"]'); await p.getByRole("button", { name: /Quay lại|Back/ }).click(); });
await step("automations list", async () => { await p.getByTitle(/Hồ sơ|Profile/).click(); await p.locator('[data-testid="open-automations"]').click(); await p.waitForSelector('[data-testid="automations-page"]'); });
await step("routine ask", async () => { await p.getByRole("button", { name: /Routine mới|New routine/ }).first().click(); await p.waitForSelector('[data-testid="routine-ask"]'); });
await step("routine when", async () => { await p.getByRole("button", { name: /Tự thiết lập|Set it up yourself/ }).click(); await p.waitForSelector('[data-testid="routine-when"]'); });
await step("routine form", async () => { await p.getByRole("button", { name: /Tiếp tục|Continue/ }).click(); await p.waitForSelector('[data-testid="routine-editor"]'); await p.getByRole("button", { name: /Tùy chọn khác|More options/ }).click(); });
await step("routine form closed", async () => { await p.getByRole("button", { name: /Hủy|Cancel/ }).click(); });
await step("calendar", async () => { await p.getByRole("button", { name: /Lịch|Calendar/, exact: true }).click(); await p.waitForSelector('[data-testid="calendar-grid"]'); });
await step("run log open", async () => { await p.getByRole("button", { name: /Nhật ký chạy|Run log/ }).click(); });
await step("webhooks", async () => { await p.getByRole("tab", { name: /Webhook/ }).click(); await p.waitForSelector('[data-testid="webhook-row"]'); await p.getByRole("button", { name: /Lượt gọi|Attempts/ }).first().click(); });
await step("webhook form", async () => { await p.getByRole("button", { name: /Webhook mới|New webhook/ }).click(); await p.waitForSelector('[data-testid="webhook-form"]'); });
await step("bot panel", async () => { await p.getByRole("button", { name: /Quay lại|Back/ }).click(); await p.locator(`[role=button][title="Viet B"]`).click(); await p.getByTitle(/Chi tiết bot|Bot details/).click(); await p.getByTitle(/Cài đặt bot|Bot settings/).click(); });

const left = [...seen].map(([t, where]) => `${where}: ${t}`);
console.log(left.length ? `FAIL  ${left.length} rendered strings are still English:\n  ${left.join("\n  ")}` : "PASS  no plain-English text is left on any Phase 4 screen in Vietnamese");
if (left.length) process.exitCode = 1;
await b.close();
await j(`/api/routines/${routine.id}`, "DELETE"); await j(`/api/webhooks/${hook.id}`, "DELETE"); await j(`/api/groups/${room.id}`, "DELETE");
for (const x of [A, B]) await j(`/api/bots/${x.id}`, "DELETE");
await j("/api/config", "PUT", { language: before });
