// Opening/reopening uses saved data; only the Refresh button calls the refresh endpoint.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(new URL("../web/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
let releaseRefresh;
const refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(...args) { super(...args); window.connectionEvents = this; }
    };
  });
  await page.context().route("https://connect.composio.dev/test-authorization", (route) => route.fulfill({ contentType: "text/html", body: "Test sign-in completed" }));
  let saved = { configured: true, keyHint: "configured", source: "api", initialized: true, connectionsLoaded: true, error: null,
    apps: [{ slug: "gmail", label: "Gmail", blurb: "Saved in database", logo: null }], connections: {
      gmail: { connected: true, pending: false, status: "ACTIVE", accounts: [{ id: "ca_work", alias: "Work account", status: "ACTIVE" }] },
    } };
  const counts = { reads: 0, refresh: 0 };
  await page.route("**/api/apps**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/apps" && route.request().method() === "GET") {
      assert.equal(url.search, "", "normal reads must not request a remote section");
      counts.reads++;
      return route.fulfill({ json: saved });
    }
    if (url.pathname === "/api/apps/refresh" && route.request().method() === "POST") {
      counts.refresh++;
      await refreshGate;
      saved = { ...saved, apps: [...saved.apps, { slug: "slack", label: "Slack", blurb: "Manually refreshed", logo: null }] };
      return route.fulfill({ json: saved });
    }
    if (url.pathname === "/api/apps/slack/connect" && route.request().method() === "POST") {
      return route.fulfill({ json: { url: "https://connect.composio.dev/test-authorization" } });
    }
    return route.continue();
  });
  const open = async () => {
    await page.getByTestId("connect-apps").click();
    const dialog = page.getByTestId("connected-apps");
    await dialog.getByText("Work account", { exact: true }).waitFor();
    return dialog;
  };
  await page.goto(process.env.WEB_URL || "http://127.0.0.1:5299");
  let dialog = await open();
  assert.deepEqual(counts, { reads: 1, refresh: 0 });
  await dialog.getByRole("button", { name: /Close|\u0110\u00f3ng/, exact: true }).click();
  dialog = await open();
  assert.deepEqual(counts, { reads: 2, refresh: 0 });
  await page.reload();
  dialog = await open();
  assert.deepEqual(counts, { reads: 3, refresh: 0 });
  const refreshing = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/apps/refresh");
  await dialog.getByRole("button", { name: /Refresh|L\u00e0m m\u1edbi/, exact: true }).click();
  await refreshing;
  assert.equal(counts.refresh, 1);
  await dialog.getByText("Work account", { exact: true }).waitFor();
  releaseRefresh();
  await dialog.getByText("Slack", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: /Close|\u0110\u00f3ng/, exact: true }).click();
  dialog = await open();
  await dialog.getByText("Slack", { exact: true }).waitFor();
  assert.deepEqual(counts, { reads: 4, refresh: 1 });
  const popupOpened = page.waitForEvent("popup");
  await dialog.getByTestId("app-row").filter({ hasText: "Slack" }).getByRole("button", { name: /Connect|Kết nối/, exact: true }).click();
  const popup = await popupOpened;
  await popup.waitForLoadState();
  await popup.close();
  saved = { ...saved, connections: { ...saved.connections,
    slack: { connected: true, pending: false, status: "ACTIVE", accounts: [{ id: "ca_slack", alias: "New Slack account", status: "ACTIVE" }] },
  } };
  await page.evaluate(() => window.connectionEvents.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ kind: "mcp.changed" }) })));
  await dialog.getByText("New Slack account", { exact: true }).waitFor();
  assert.equal(counts.refresh, 1, "connection completion rereads the server-updated database without another manual refresh");
  console.log("PASS: normal opens read saved apps; manual Refresh updates the catalog; successful sign-in automatically rereads updated account data.");
} finally {
  releaseRefresh();
  await browser.close();
}
