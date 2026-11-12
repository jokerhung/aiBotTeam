// Checks inline channel history, pagination and live updates against the dev UI.
// All bot transcripts and events are mocked; no live bot is run or changed.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(new URL("../web/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    for (const key of ["botteam-welcomed", "botteam-tour-done"]) localStorage.setItem(key, "1");
    window.EventSource = class {
      constructor() { window.channelEvents = this; setTimeout(() => this.onopen?.(), 100); }
      close() {}
    };
  });
  const target = {
    id: "inventory-test", threadId: "main-test", mainThreadId: "main-test", name: "Inventory test", title: "", description: "", color: "green",
    notifications: true, unread: false, busy: true, threadBusy: false, activity: "working", turnStartedAt: Date.now(), statusLine: null,
    modelSelection: { instanceId: "echo", model: "echo-1" }, pinned: false, hidden: false, section: null, cwd: null, approvalMode: "full",
    soul: "", chief: false, fallbackSelection: null, lastText: "", lastAt: null, readAt: 0, usage: {},
    tasks: [{ threadId: "batch-test", title: "Telegram batch", busy: true, main: false, closed: false, pinned: false, at: Date.now() }],
  };
  let olderLoaded = false;
  const message = (id, text, extra = {}) => ({ id, text, role: "bot", kind: "text", at: Date.now(), ...extra });
  await page.route("**/api/**", async (route) => {
    const payload = {
      "/api/bots": { bots: [target] }, "/api/config": { settings: { language: "en" }, keys: {}, keyCatalog: [] },
      "/api/instances": { instances: [] }, "/api/sidebar-sections": { sections: [] }, "/api/groups": { groups: [] },
      "/api/routines": { routines: [] }, "/api/routine-runs": { runs: [] }, "/api/webhooks": { webhooks: [] },
      "/api/notifications": { notifications: [] }, "/api/inbox": { items: [] },
    }[new URL(route.request().url()).pathname] ?? {};
    await route.fulfill({ json: payload });
  });
  await page.route("**/api/bots/*/messages?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("thread") === "batch-test") {
      if (url.searchParams.has("before")) {
        olderLoaded = true;
        return route.fulfill({ json: { messages: [message("older", "Full original Telegram prompt", { role: "user", sender: "telegram shop" })], hasMore: false } });
      }
      return route.fulfill({ json: { messages: [
        message("answer", "Counting inventory", { streaming: true }),
        message("tool", "", { kind: "activity", tool: { name: "shell", input: "inspect inventory", output: "Inventory details visible", ok: null } }),
      ], hasMore: true } });
    }
    return route.fulfill({ json: { messages: [message("notice", "Telegram shop: running", { kind: "notice", threadRef: { botId: target.id, bot: target.name, threadId: "batch-test" } })], hasMore: false } });
  });
  await page.goto(process.env.WEB_URL || "http://127.0.0.1:5299");
  const transcript = page.getByTestId("batch-transcript");
  await transcript.getByText("Full original Telegram prompt", { exact: true }).waitFor();
  await transcript.getByText("Inventory details visible", { exact: true }).waitFor();
  assert(olderLoaded, "loads earlier pages automatically");
  assert.equal(await transcript.getByTestId("thread-ref").count(), 0);
  await page.evaluate((botId) => {
    const emit = (frame) => window.channelEvents.onmessage({ data: JSON.stringify(frame) });
    emit({ kind: "message.patch", botId, threadId: "batch-test", message: { id: "answer", text: "Counting live without clicks", streaming: true } });
    emit({ kind: "message.patch", botId, threadId: "batch-test", message: { id: "tool", tool: { name: "shell", input: "inspect inventory", output: "Live result: 42 items", ok: true } } });
  }, target.id);
  await transcript.getByText("Counting live without clicks", { exact: true }).waitFor();
  await transcript.getByText("Live result: 42 items", { exact: true }).waitFor();
  console.log("PASS: full paginated history and live text/tool results appear without clicks.");
} finally {
  await browser.close();
}
