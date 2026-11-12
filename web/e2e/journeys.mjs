// The six journeys of Phase 5 §10, end to end in a browser (echo bots; nothing real is started):
//   1 create a bot  2 chat  3 approve a command  4 delegate in a room  5 a routine runs  6 import a team
//   PW_PATH=<dir with node_modules/playwright-core> API=http://127.0.0.1:8898 WEB=http://127.0.0.1:8898 node web/e2e/journeys.mjs
import { createRequire } from "node:module";
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
const S = "J6"; // names end with this so a run that stopped half way is cleaned up by the next
const echo = { instanceId: "echo", model: "echo-1" };
const clean = async () => {
  for (const x of (await j("/api/bots")).json.bots) if (x.name.endsWith(S)) await j(`/api/bots/${x.id}`, "DELETE");
  for (const x of (await j("/api/groups")).json.groups) if (x.name.endsWith(S)) await j(`/api/groups/${x.id}`, "DELETE");
  for (const x of (await j("/api/routines")).json.routines) if (x.name.endsWith(S)) await j(`/api/routines/${x.id}`, "DELETE");
  for (const x of (await j("/api/sidebar-sections")).json.sections) if (x.name.endsWith(S)) await j(`/api/sidebar-sections/${x.id}`, "DELETE");
};
await clean();

const b = await chromium.launch({ executablePath: process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const p = await (await b.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto(WEB);
await p.waitForSelector('[data-testid="connect-apps"]', { timeout: 20000 });
// a first visit shows the welcome; skip it so the journeys start from the app
const skip = p.getByRole("button", { name: /Skip for now|Skip tour/ });
if (await skip.first().isVisible().catch(() => false)) await skip.first().click();

// --- 1 create a bot
await p.getByRole("button", { name: "New or share" }).click();
await p.getByRole("button", { name: "New bot", exact: true }).click();
await p.getByRole("dialog", { name: "New bot" }).waitFor();
await p.getByPlaceholder("Name").fill(`Ada${S}`);
await p.getByPlaceholder("e.g. Researcher").fill("Lead");
await p.getByRole("button", { name: "Create", exact: true }).click();
await p.waitForSelector(`text=Say hello to Ada${S}`, { timeout: 15000 }).catch(() => {});
const ada = (await j("/api/bots")).json.bots.find((x) => x.name === `Ada${S}`);
ok(!!ada, "1. the bot is created from the dialog");
await j(`/api/bots/${ada.id}`, "PATCH", { modelSelection: echo, approvalMode: "ask" });

// --- 2 chat
const box = p.getByLabel(`Message Ada${S}`);
await box.click();
await box.fill("hello there");
await p.keyboard.press("Enter");
await p.waitForFunction(() => document.body.innerText.includes("hello there"), null, { timeout: 15000 });
await p.waitForFunction(() => /echo|hello/i.test(document.querySelector('[role=log]')?.innerText ?? ""), null, { timeout: 15000 });
ok((await p.locator("[role=log]").innerText()).length > 20, "2. the bot answers in the chat");

// --- 3 approve a command
await box.fill("/approve mkdir demo");
await p.keyboard.press("Enter");
await p.getByRole("button", { name: "Allow once" }).waitFor({ timeout: 15000 });
ok(true, "3. a command asks first");
await p.screenshot({ path: `${SHOTS}/j-approval.png` });
await p.getByRole("button", { name: "Allow once" }).click();
await p.waitForFunction(() => document.body.innerText.includes("Allowed: ran mkdir demo"), null, { timeout: 15000 });
ok(true, "3. after Allow once the command runs");

// --- 4 delegate in a room
const bo = (await j("/api/bots", "POST", { name: `Bo${S}`, title: "Developer", modelSelection: echo, approvalMode: "full" })).json;
const room = (await j("/api/groups", "POST", { name: `Crew ${S}`, members: [ada.id, bo.id], leader: ada.id, responder: "leader" })).json;
await p.locator('[data-testid="group-row"]', { hasText: `Crew ${S}` }).click();
await p.waitForSelector('[data-testid="group-view"]');
const rbox = p.getByLabel(`Message Crew ${S}`);
await rbox.click();
await rbox.pressSequentially(`@Bo${S} `);
await rbox.pressSequentially("please check the build");
await p.keyboard.press("Enter");
await p.waitForFunction((n) => (document.querySelector('[data-testid="group-view"]')?.innerText ?? "").split(n).length > 2, `Bo${S}`, { timeout: 20000 });
ok(true, "4. the mentioned bot answers in the room");
await p.screenshot({ path: `${SHOTS}/j-room.png` });

// --- 5 a routine runs
const rt = (await j("/api/routines", "POST", { name: `Ping ${S}`, targetKind: "bot", targetId: bo.id, prompt: "report in", kind: "interval", everyMin: 60 })).json;
const rid = rt.id ?? rt.routine?.id;
ok(!!rid, "5. a routine is created");
await j(`/api/routines/${rid}/run`, "POST");
let ran = false;
for (let i = 0; i < 60 && !ran; i++) {
  await new Promise((r) => setTimeout(r, 500));
  ran = ((await j(`/api/routines/${rid}/runs`)).json.runs ?? []).some((r) => ["ok", "done", "completed", "succeeded"].includes(r.status));
}
ok(ran, "5. the routine ran and its run is recorded as done");

// --- 6 import a team
const sec = (await j("/api/sidebar-sections", "POST", { name: `Crew ${S}` })).json;
await j(`/api/bots/${bo.id}`, "PATCH", { section: sec.id });
const exp = (await j("/api/teams/export", "POST", { sectionId: sec.id })).json;
const text = exp.text ?? exp.markdown ?? exp.file ?? "";
ok(typeof text === "string" && text.includes("botteam.team"), "6. a section exports as one file");
await j(`/api/bots/${bo.id}`, "DELETE");
await p.getByRole("button", { name: "New or share" }).click();
await p.locator('[data-testid="import-team-item"]').click();
await p.getByLabel("Team file text").fill(text);
await p.locator('[data-testid="review-team"]').click();
await p.waitForSelector('[data-testid="import-review"]', { timeout: 15000 });
ok((await p.locator('[data-testid="import-review"]').innerText()).includes(`Bo${S}`), "6. the review lists the bots before anything is added");
await p.locator('[data-testid="add-team"]').click();
await p.waitForSelector('[data-testid="import-done"]', { timeout: 15000 });
const back = (await j("/api/bots")).json.bots.find((x) => x.name.startsWith(`Bo${S}`));
ok(!!back && back.approvalMode === "ask", "6. the imported bot is back and starts at Ask");
await p.screenshot({ path: `${SHOTS}/j-import.png` });

ok(errors.length === 0, `no page errors ${errors.slice(0, 2).join(" | ")}`);
await clean();
await b.close();
