// Checks automatic job-conversation selection, live details and compact main summaries.
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
    tasks: [{ threadId: "batch-test", title: "b_test", busy: true, main: false, closed: false, pinned: false, at: Date.now() }],
  };
  let started = false;
  const summary = "Telegram shop: counting in conversation b_test.";
  const message = (id, text, extra = {}) => ({ id, text, role: "bot", kind: "text", at: Date.now(), ...extra });
  await page.route("**/api/**", async (route) => {
    if (route.request().method() === "PATCH" && new URL(route.request().url()).pathname === "/api/bots/inventory-test") {
      target.threadId = route.request().postDataJSON().threadId;
      await route.fulfill({ json: target });
      await page.evaluate((bot) => window.channelEvents.onmessage({ data: JSON.stringify({ kind: "bot", bot }) }), target);
      return;
    }
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
      return route.fulfill({ json: { messages: [
        message("prompt", "Full original Telegram prompt", { role: "user", sender: "telegram shop" }),
        message("answer", "Counting inventory", { streaming: true }),
        message("tool", "", { kind: "activity", tool: { name: "shell", summary: "Inspect inventory", input: "inspect inventory", output: "Inventory details visible", ok: null } }),
      ], hasMore: false } });
    }
    return route.fulfill({ json: { messages: [message("notice", started ? summary : "Telegram shop: receiving 6 photos; waiting for Check", {
      kind: "notice", channelBatchId: "b_test", threadRef: started ? { botId: target.id, bot: target.name, threadId: "batch-test" } : null,
    })], hasMore: false } });
  });
  await page.goto(process.env.WEB_URL || "http://127.0.0.1:5299");
  await page.getByText("Telegram shop: receiving 6 photos; waiting for Check", { exact: true }).waitFor();
  started = true;
  target.threadId = "batch-test";
  target.threadBusy = true;
  await page.evaluate((bot) => window.channelEvents.onmessage({ data: JSON.stringify({ kind: "bot", bot }) }), target);
  const log = page.getByRole("log");
  await log.getByText("Full original Telegram prompt", { exact: true }).waitFor();
  await log.getByText("Inventory details visible", { exact: true }).waitFor();
  assert.equal(await log.getByText(summary, { exact: true }).count(), 0);
  await page.getByTitle("Details and conversations").getByText(/b_test/).waitFor();
  await page.evaluate((botId) => {
    const emit = (frame) => window.channelEvents.onmessage({ data: JSON.stringify(frame) });
    emit({ kind: "message.patch", botId, threadId: "batch-test", message: { id: "answer", text: "Counting live in job conversation", streaming: true } });
    emit({ kind: "message.patch", botId, threadId: "batch-test", message: { id: "tool", tool: { name: "shell", input: "inspect inventory", output: "Live result: 42 items", ok: true } } });
  }, target.id);
  await log.getByText("Counting live in job conversation", { exact: true }).waitFor();
  await log.getByText("Live result: 42 items", { exact: true }).waitFor();
  target.threadId = "main-test";
  target.threadBusy = false;
  await page.evaluate((bot) => window.channelEvents.onmessage({ data: JSON.stringify({ kind: "bot", bot }) }), target);
  await log.getByText(summary, { exact: true }).waitFor();
  assert.equal(await log.getByText("Live result: 42 items", { exact: true }).count(), 0);
  assert.equal(await log.getByText("Full original Telegram prompt", { exact: true }).count(), 0);
  await page.getByTestId("thread-ref").click();
  await log.getByText("Inventory details visible", { exact: true }).waitFor();
  console.log("PASS: job auto-selection shows live details; main contains only a compact reference that reopens the job.");

} finally {
  await browser.close();
}
