// Phase 4 browser check against the running app (echo bots only, no real engine is started).
// Run with the app up (pnpm dev):  PW_PATH=<dir with node_modules/playwright-core> [EDGE=<msedge.exe>] [SHOTS=<dir>] node web/e2e/phase4.mjs
import { createRequire } from "node:module";
const require = createRequire((process.env.PW_PATH || ".") + "/");
const { chromium } = require("playwright-core");
const API = process.env.API || "http://127.0.0.1:8899", WEB = process.env.WEB || "http://127.0.0.1:5299", HOOK = process.env.HOOK || "http://127.0.0.1:8900";
const SHOTS = process.env.SHOTS || "web/e2e/shots";
import { mkdirSync } from "node:fs";
mkdirSync(SHOTS, { recursive: true });
const j = async (path, method = "GET", body) => {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : {} };
};
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) process.exitCode = 1; };

const echo = { instanceId: "echo", model: "echo-1" };
const mk = async (name, title) => (await j("/api/bots", "POST", { name, title, modelSelection: echo, approvalMode: "full" })).json;
const stamp = process.env.STAMP || 4242; // fixed so the screens can be compared with their baselines
const A = await mk(`Ada${stamp}`, "Lead"), B = await mk(`Bo${stamp}`, "Developer"), C = await mk(`Cy${stamp}`, "Tester");
await j(`/api/bots/${A.id}`, "PATCH", { approvalMode: "ask" });
const room = (await j("/api/groups", "POST", { name: `Crew ${stamp}`, members: [A.id, B.id, C.id], leader: A.id, responder: "leader" })).json;

const b = await chromium.launch({ executablePath: process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const ctx = await b.newContext({ viewport: { width: 1360, height: 860 } });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await p.goto(WEB);
await p.waitForSelector('[data-testid="group-row"]', { timeout: 20000 });
ok(true, "sidebar shows a group row");

// --- room: open, mention picker, answering
await p.locator('[data-testid="group-row"]', { hasText: `Crew ${stamp}` }).click();
await p.waitForSelector('[data-testid="group-view"]');
await p.screenshot({ clip: { x: 280, y: 0, width: 1080, height: 860 }, path: `${SHOTS}/p4-room-empty.png` });
const box = p.getByLabel(`Message Crew ${stamp}`);
await box.click();
await box.pressSequentially("@");
await p.waitForSelector('[data-testid="mention-picker"]');
ok((await p.locator('[data-testid="mention-picker"] [role=option]').count()) === 3, "mention picker lists the three members");
await p.screenshot({ clip: { x: 280, y: 0, width: 1080, height: 860 }, path: `${SHOTS}/p4-mention-picker.png` });
await box.pressSequentially(`Bo`);
await p.keyboard.press("Enter");
ok((await box.inputValue()).startsWith(`@Bo${stamp} `), "Enter picks the highlighted member");
await box.pressSequentially("please check the build");
await p.keyboard.press("Enter");
await p.waitForFunction((n) => document.body.innerText.includes(n), `Bo${stamp}`, { timeout: 15000 });
await p.waitForTimeout(2500);
const names = await p.locator('[role=log] [data-no-i18n] >> text=/^(Ada|Bo|Cy)\\d+/').allInnerTexts();
ok(names.some((n) => n.startsWith(`Bo${stamp}`)), "the mentioned bot answered in the room");
ok(!names.some((n) => n.startsWith(`Cy${stamp}`)), "an unmentioned member stayed quiet");
await p.screenshot({ clip: { x: 280, y: 0, width: 1080, height: 860 }, path: `${SHOTS}/p4-room-chat.png` });
// leader answers when nobody is mentioned
await box.click();
await box.pressSequentially("status please");
await p.keyboard.press("Enter");
await p.waitForTimeout(3500);
const msgs = (await j(`/api/groups/${room.id}/messages`)).json.messages;
ok(msgs.some((m) => m.role === "bot" && m.author === A.id), "the leader answered an unaddressed message");

// --- room panel
await p.getByLabel("Room details").first().click();
await p.waitForSelector('[data-testid="room-panel"]');
await p.screenshot({ clip: { x: 280, y: 0, width: 1080, height: 860 }, path: `${SHOTS}/p4-room-panel.png` });
await p.getByRole("radio", { name: /Automatic/ }).click();
await p.waitForSelector('[data-testid="decider-select"]');
ok(true, "the chooser-model select appears for an Automatic room");
await p.getByRole("radio", { name: /^Leader/ }).click();
await p.getByLabel("Room details").first().click();

// --- Automations: empty (no routines) then with data
await p.getByTitle("Profile and settings").click();
await p.locator('[data-testid="open-automations"]').click();
await p.waitForSelector('[data-testid="automations-page"]');
const existing = (await j("/api/routines")).json.routines;
ok(true, `automations page opened (${existing.length} routines present)`);
if (!existing.length) {
  ok(await p.locator('[data-testid="automations-empty"]').isVisible(), "empty state shown");
  await p.screenshot({ clip: { x: 280, y: 0, width: 1080, height: 860 }, path: `${SHOTS}/p4-automations-empty.png` });
}
await p.getByRole("button", { name: /New routine/ }).first().click();
await p.waitForSelector('[data-testid="routine-editor"]');
await p.screenshot({ clip: { x: 280, y: 0, width: 1080, height: 860 }, path: `${SHOTS}/p4-routine-editor.png` });
await p.getByLabel("Send to").selectOption(`bot:${B.id}`);
await p.getByLabel("Routine message").fill("every five minutes ping");
await p.getByLabel("Name", { exact: true }).fill(`Ping ${stamp}`);
await p.getByRole("button", { name: "Save routine" }).click();
await p.waitForSelector('[data-testid="routine-row"]');
ok(await p.locator('[data-testid="routine-row"]', { hasText: `Ping ${stamp}` }).isVisible(), "the new routine is listed");
await p.getByRole("button", { name: "Calendar", exact: true }).click();
await p.waitForSelector('[data-testid="calendar-grid"]');
await p.waitForTimeout(500);
ok((await p.locator('[data-testid="routine-block"]').count()) > 0, "the calendar shows routine blocks");
await p.screenshot({ clip: { x: 280, y: 0, width: 1080, height: 860 }, path: `${SHOTS}/x-automations-data.png` });
await p.getByRole("button", { name: "Day", exact: true }).click();
await p.getByRole("button", { name: "3 days", exact: true }).click();
await p.getByRole("button", { name: "Week", exact: true }).click();
await p.getByRole("button", { name: "List", exact: true }).click();
const rid = (await j("/api/routines")).json.routines.find((r) => r.name === `Ping ${stamp}`).id;
await j(`/api/routines/${rid}/run`, "POST");
await p.waitForTimeout(2500);
ok((await p.locator('[data-testid="run-row"]').count()) > 0, "the run log lists the run");

// --- webhooks tab: create, secret once, curl 202 / 401
await p.getByRole("tab", { name: "Webhooks" }).click();
await p.getByRole("button", { name: /New webhook/ }).click();
await p.getByLabel("Name", { exact: true }).fill(`Deploys ${stamp}`);
await p.getByLabel("Bot", { exact: true }).selectOption(B.id);
await p.getByRole("button", { name: "Create webhook" }).click();
await p.waitForSelector('[data-testid="webhook-secret"]');
const secret = (await p.locator('[data-testid="webhook-secret"] code').nth(1).innerText()).trim();
ok(secret.startsWith("whsec_"), "the secret is shown once after creating a webhook");
const hooks = (await j("/api/webhooks")).json.webhooks;
const hook = hooks.find((h) => h.name === `Deploys ${stamp}`);
const good = await fetch(`${HOOK}/hooks/${hook.id}`, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify({ event: "deploy" }) });
const bad = await fetch(`${HOOK}/hooks/${hook.id}`, { method: "POST", headers: { authorization: "Bearer nope" }, body: "{}" });
ok(good.status === 202 && bad.status === 401, `curl: good secret ${good.status}, wrong secret ${bad.status}`);
await p.getByRole("button", { name: "Done" }).click();
ok((await p.locator('[data-testid="webhook-secret"]').count()) === 0, "the secret is gone once dismissed");
await p.getByRole("button", { name: "Attempts" }).first().click();
await p.waitForSelector('[data-testid="webhook-attempts"]');
const rows = await p.locator('[data-testid="webhook-attempts"]').innerText();
ok(rows.includes("401") && rows.includes("202"), "attempts list both calls");
await p.screenshot({ clip: { x: 280, y: 0, width: 1080, height: 860 }, path: `${SHOTS}/p4-webhooks.png` });

// --- inbox: an /approve turn waits for the person, answerable from the Inbox
await p.getByRole("button", { name: "Back" }).click();
await p.locator("[data-testid=group-row]").first().waitFor();
await j(`/api/bots/${A.id}/messages`, "POST", { text: "/approve", threadId: A.threadId });
await p.waitForFunction(() => /^\d+$/.test(document.querySelector('[data-testid="inbox-count"]')?.textContent ?? ""), null, { timeout: 15000 });
ok(true, "the Inbox counts the waiting card");
ok(/^\(\d+\)/.test(await p.title()), `tab title carries the count: ${await p.title()}`);
await p.locator('[data-testid="inbox-button"]').click();
await p.waitForSelector('[data-testid="inbox-card"]');
await p.screenshot({ clip: { x: 280, y: 0, width: 1080, height: 860 }, path: `${SHOTS}/p4-inbox.png` });
await p.getByRole("button", { name: "Allow once" }).first().click();
await p.waitForFunction(() => !document.querySelector('[data-testid="inbox-card"]'), null, { timeout: 15000 });
ok(true, "the card was answered from the Inbox");

// --- notifications panel
await p.getByLabel("Notifications").first().click();
await p.waitForSelector('[data-testid="notifications-panel"]');
await p.waitForTimeout(400);
await p.screenshot({ clip: { x: 280, y: 0, width: 1080, height: 860 }, path: `${SHOTS}/p4-notifications.png` });

// --- coordinate: A hands work to B and C; a hand-off card shows in A's conversation
await p.getByRole("button", { name: "Close" }).first().click().catch(() => {});
await p.locator('[role=button][title="Ada' + stamp + '"]').click();
await j(`/api/bots/${A.id}/messages`, "POST", { text: `/coordinate Bo${stamp}, Cy${stamp} | write the notes`, threadId: A.threadId });
await p.waitForSelector('[data-testid="thread-ref"]', { timeout: 20000 });
ok((await p.locator('[data-testid="thread-ref"]').count()) >= 2, "A's conversation shows a hand-off card per teammate");
await p.waitForTimeout(6000);
const after = (await j(`/api/bots/${A.id}/messages?thread=${A.threadId}`)).json.messages;
ok(after.filter((m) => m.role === "bot" && m.kind === "text").length >= 1, "A was woken with the results");
await p.screenshot({ clip: { x: 280, y: 0, width: 1080, height: 860 }, path: `${SHOTS}/x-handoff.png` });

ok(errors.filter((e) => !/favicon|404|ERR_ABORTED/.test(e)).length === 0, `no page errors ${errors.slice(0, 3).join(" | ")}`);
await b.close();

// clean up what this run created
await j(`/api/routines/${rid}`, "DELETE");
await j(`/api/webhooks/${hook.id}`, "DELETE");
await j(`/api/groups/${room.id}`, "DELETE");
for (const x of [A, B, C]) await j(`/api/bots/${x.id}`, "DELETE");
