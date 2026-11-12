// Phase 5 browser journeys against the running app (echo bots; nothing real is started).
//   PW_PATH=<dir with node_modules/playwright-core> [EDGE=<msedge.exe>] [SHOTS=<dir>] node web/e2e/phase5.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const require = createRequire((process.env.PW_PATH || ".") + "/");
const { chromium } = require("playwright-core");
const API = process.env.API || "http://127.0.0.1:8899", WEB = process.env.WEB || "http://127.0.0.1:5299";
const SHOTS = process.env.SHOTS || "web/e2e/shots";
mkdirSync(SHOTS, { recursive: true });
const FAKE = resolve("server/tests/fake_mcp.py").replace(/\\/g, "/");
const PY = process.env.PYTHON || "python";
const j = async (path, method = "GET", body) => {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : {} };
};
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) process.exitCode = 1; };
const echo = { instanceId: "echo", model: "echo-1" };

// leftovers of an earlier run
for (const s of (await j("/api/mcp/servers")).json.servers) if (s.name.startsWith("E2E ")) await j(`/api/mcp/servers/${s.id}`, "DELETE");
for (const k of (await j("/api/skills")).json.skills) if (k.name.startsWith("E2E ")) await j(`/api/skills/${k.id}`, "DELETE");
for (const x of (await j("/api/sidebar-sections")).json.sections) if (x.name.startsWith("E2E Crew")) await j(`/api/sidebar-sections/${x.id}`, "DELETE");
for (const x of (await j("/api/bots")).json.bots) if (x.name.startsWith("E2E5 ")) await j(`/api/bots/${x.id}`, "DELETE");
const bot = (await j("/api/bots", "POST", { name: "E2E5 Bot", modelSelection: echo })).json;

const b = await chromium.launch({ executablePath: process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const ctx = await b.newContext({ viewport: { width: 1360, height: 860 } });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("console", (m) => m.type() === "error" && !/status of 400/.test(m.text()) && errors.push(m.text())); // the refused key is a deliberate 400
await p.goto(WEB);
await p.waitForSelector('[data-testid="connect-apps"]', { timeout: 20000 });

// --- 1 + 2: Connected apps, and a custom MCP server added from the UI
await p.locator('[data-testid="connect-apps"]').click();
await p.waitForSelector('[data-testid="connected-apps"]');
await p.waitForSelector('[data-testid="apps-warning"]');
await p.waitForSelector('[data-testid="app-row"]');
ok(await p.locator('[data-testid="apps-warning"]').isVisible(), "Connected apps warns when nothing is connected");
ok((await p.locator('[data-testid="app-row"]').count()) >= 5, "the catalog lists the apps");
await p.getByLabel("Search apps").fill("git");
ok((await p.locator('[data-testid="app-row"]').count()) === 1, "the search narrows the list");
ok(await p.locator('input[type=password]').isVisible(), "without a key the dialog asks for the Composio project key (a secret field)");
ok(await p.getByRole("button", { name: "Connect", exact: true }).isDisabled(), "Connect waits until a Composio key is saved");
await p.getByLabel("Composio project key").fill("ck_personal");
await p.locator('[data-testid="save-composio-key"]').click();
await p.waitForSelector('[data-testid="connected-apps"] [role=alert]', { timeout: 10000 });
ok(/ak_/.test(await p.locator('[data-testid="connected-apps"] [role=alert]').first().innerText()), "a key that does not start with ak_ is refused");
await p.screenshot({ path: `${SHOTS}/p5-connected-apps.png` });
await p.locator('[data-testid="open-mcp"]').click();
await p.waitForSelector('[data-testid="mcp-panel"]');
await p.locator('[data-testid="add-mcp"]').click();
await p.waitForSelector('[data-testid="mcp-editor"]');
await p.getByLabel("Name", { exact: true }).fill("E2E Fake");
await p.getByLabel("Command", { exact: true }).fill(PY);
await p.getByLabel("Arguments", { exact: true }).fill(FAKE);
await p.getByLabel("Environment", { exact: true }).fill("FAKE_TOKEN=sk-e2e-secret");
await p.locator('[data-testid="mcp-editor"]').getByRole("button", { name: "Test" }).click();
await p.waitForSelector('[data-testid="mcp-test-result"]');
const tested = await p.locator('[data-testid="mcp-test-result"]').innerText();
ok(/echo/.test(tested) && /secret_env/.test(tested), "Test lists the server's tools");
await p.screenshot({ path: `${SHOTS}/p5-mcp-editor.png` });
await p.locator('[data-testid="mcp-editor"]').getByRole("button", { name: "Save", exact: true }).click();
await p.waitForSelector('[data-testid="mcp-row"]');
const listed = (await j("/api/mcp/servers")).json.servers.find((s) => s.name === "E2E Fake");
ok(!!listed && listed.env.FAKE_TOKEN === "********", "the saved server shows its secret as a mask");
ok(!JSON.stringify(await (await fetch(API + "/api/mcp/servers")).text()).includes("sk-e2e-secret"), "the secret is not in what the server returns");
await p.locator('[data-testid="mcp-row"]').first().getByRole("button", { name: "Test" }).click();
await p.waitForFunction(() => /\d+ tools/.test(document.querySelector('[data-testid="mcp-row"]')?.textContent ?? ""), null, { timeout: 15000 });
ok(true, "the list shows the connection state and the tool count");
await p.screenshot({ path: `${SHOTS}/p5-mcp-list.png` });
await p.locator('[data-testid="mcp-panel"]').getByRole("button", { name: "Close" }).click();

// --- the bot picks the server and how far it may go
await p.locator(`[role=button][title="E2E5 Bot"]`).click();
await p.getByTitle("Bot details").click();
await p.getByTitle("Bot settings").click();
await p.waitForSelector('[data-testid="bot-apps"]');
await p.getByLabel("Use E2E Fake").click();
await p.waitForTimeout(700);
let mine = (await j("/api/bots")).json.bots.find((x) => x.id === bot.id);
ok(mine.mcpServers.length === 1, "ticking the server gives it to the bot");
await p.getByLabel("E2E Fake access").selectOption("write");
await p.getByLabel("E2E Fake sending out").selectOption("ask");
await p.waitForTimeout(700);
mine = (await j("/api/bots")).json.bots.find((x) => x.id === bot.id);
ok(mine.mcpAccess[listed.id].scope === "write" && mine.mcpAccess[listed.id].outbound === "ask", "write access that asks before sending out is saved");

// --- 5: skills and memory in the bot's settings
await p.locator('[data-testid="new-skill"]').click();
await p.waitForSelector('[data-testid="skill-editor"]');
await p.locator('[data-testid="skill-editor"]').getByLabel("Name").fill("E2E Greeter");
await p.locator('[data-testid="skill-editor"]').getByLabel("When to use it").fill("Greeting people");
await p.locator('[data-testid="skill-editor"]').getByLabel("Instructions").fill("Say hello warmly.");
await p.locator('[data-testid="skill-editor"]').getByRole("button", { name: "Save", exact: true }).click();
await p.waitForSelector('[data-testid="skill-row"]');
await p.getByLabel("Give E2E Greeter").click();
await p.waitForTimeout(700);
mine = (await j("/api/bots")).json.bots.find((x) => x.id === bot.id);
ok(mine.skills.length === 1, "a skill made in the UI can be given to the bot");
const skillId = mine.skills[0];
await j(`/api/bots/${bot.id}/memory/file`, "PUT", { name: "MEMORY.md", text: ["- [2026-11-10] E2E likes tea", "- [2026-11-11] E2E prefers short answers", ""].join(String.fromCharCode(10)) });
await p.reload();
await p.locator(`[role=button][title="E2E5 Bot"]`).click();
await p.getByTitle("Bot details").click();
await p.getByTitle("Bot settings").click();
await p.waitForSelector('[data-testid="memory-entries"]');
ok((await p.locator('[data-testid="memory-entries"] >> text=E2E likes tea').count()) === 1, "the notes are listed with their dates");
ok(/2 \/ 200/.test(await p.locator('[data-testid="memory-gauge"]').innerText()), "the gauge shows lines against the 200-line budget");
await p.getByLabel("Delete note").first().click();
await p.waitForTimeout(600);
ok((await j(`/api/bots/${bot.id}/memory`)).json.entries.length === 1, "a note can be deleted from the list");
await p.getByLabel("Let this bot use memory").click();
await p.waitForTimeout(700);
ok((await j("/api/bots")).json.bots.find((x) => x.id === bot.id).memory === false, "memory can be switched off for the bot");
await p.screenshot({ path: `${SHOTS}/p5-bot-settings.png` });

// --- 6: share a section as one file and import it again
for (const x of (await j("/api/sidebar-sections")).json.sections) if (x.name.startsWith("E2E Crew")) await j(`/api/sidebar-sections/${x.id}`, "DELETE");
const sec = (await j("/api/sidebar-sections", "POST", { name: "E2E Crew" })).json;
const member = (await j("/api/bots", "POST", { name: "E2E5 Member", title: "Tester", modelSelection: echo })).json;
await j(`/api/bots/${member.id}`, "PATCH", { section: sec.id, soul: "Test things. The key is sk-" + "live1234567890abcdefghij.", approvalMode: "full", cwd: "C:/private/e2e" });
await p.reload();
await p.getByLabel("Share E2E Crew").waitFor({ state: "attached" });
await p.getByLabel("Share E2E Crew").click({ force: true });
await p.waitForSelector('[data-testid="share-counts"]');
const counts = await p.locator('[data-testid="share-counts"]').innerText();
ok(/Bots\s+1/.test(counts), "the share dialog counts exactly what the file holds");
ok(await p.locator('[data-testid="share-changed"]').isVisible(), "the dialog says what was changed (a key-looking text)");
await p.screenshot({ path: `${SHOTS}/p5-share.png` });
const [download] = await Promise.all([p.waitForEvent("download"), p.locator('[data-testid="save-team-file"]').click()]);
const fileText = await (await import("node:fs/promises")).readFile(await download.path(), "utf8");
ok(download.suggestedFilename().endsWith(".botteam.md") && fileText.startsWith("---"), "Save file downloads one Markdown file");
ok(!/sk-live|C:\/private|modelSelection|approvalMode|cwd/.test(fileText), "the file holds no key, folder, model or approval level");
await p.getByTitle("New or share").click();
await p.locator('[data-testid="import-team-item"]').click();
await p.waitForSelector('[data-testid="import-team"]');
await p.getByLabel("Team file text").fill(fileText);
await p.locator('[data-testid="review-team"]').click();
await p.waitForSelector('[data-testid="import-review"]');
ok((await j("/api/sidebar-sections")).json.sections.filter((x) => x.name.startsWith("E2E Crew")).length === 1, "the review creates nothing");
ok((await p.locator('[data-testid="import-review"]').innerText()).includes("skills are switched off"), "the review says what will be cautious");
await p.locator('[data-testid="add-team"]').click();
await p.waitForSelector('[data-testid="import-done"]');
const secs = (await j("/api/sidebar-sections")).json.sections.filter((x) => x.name.startsWith("E2E Crew"));
ok(secs.length === 2, "adding the team makes a second section next to the first");
const added = (await j("/api/bots")).json.bots.filter((x) => x.name === "E2E5 Member" && x.section === secs[1].id)[0];
ok(!!added && added.approvalMode === "ask" && added.cwd === null && !added.soul.includes("sk-live"), "the new bot is at Ask, has no folder and no key");
await p.locator('[data-testid="import-team"]').getByRole("button", { name: "Done" }).click();
for (const x of secs) await j(`/api/sidebar-sections/${x.id}`, "DELETE");
for (const x of (await j("/api/bots")).json.bots) if (x.name === "E2E5 Member") await j(`/api/bots/${x.id}`, "DELETE");

// --- 4: runs, the waterfall of a turn, the event log, usage and the export
const obs = (await j("/api/bots", "POST", { name: "E2E5 Obs", modelSelection: echo })).json;
await j(`/api/bots/${obs.id}/messages`, "POST", { text: "/tool look around", threadId: obs.threadId });
await j(`/api/bots/${obs.id}/messages`, "POST", { text: "and a plain turn", threadId: obs.threadId });
await p.waitForTimeout(6000);
await p.locator(`[role=button][title="E2E5 Obs"]`).click();
await p.getByTitle("Bot details").click();
await p.getByRole("button", { name: "Activity" }).first().click();
await p.waitForSelector('[data-testid="run-card"]');
ok((await p.locator('[data-testid="run-card"]').count()) >= 2, "Activity lists the recent runs of the bot");
ok(await p.locator('[data-testid="run-card"]', { hasText: "Bash" }).first().isVisible(), "a run shows the tools it used");
await p.locator('[data-testid="run-card"]', { hasText: "Bash" }).first().getByRole("button").first().click();
await p.waitForSelector('[data-testid="waterfall"]');
ok(/Bash/.test(await p.locator('[data-testid="waterfall"]').innerText()), "opening a run draws the waterfall of its tool calls");
await p.screenshot({ path: `${SHOTS}/p5-activity.png` });
await p.getByRole("button", { name: "Back" }).first().click();
await p.getByRole("button", { name: "Inspector" }).first().click();
await p.waitForSelector('[data-testid="inspector-view"]');
await p.waitForFunction(() => document.querySelectorAll('[data-testid="event-row"]').length > 5, null, { timeout: 10000 }).catch(() => {});
ok((await p.locator('[data-testid="event-row"]').count()) > 5, "the Inspector lists the thread's events");
await p.getByRole("button", { name: "item", exact: true }).click();
const filtered = await p.locator('[data-testid="event-row"] summary').allInnerTexts();
ok(filtered.length > 0 && filtered.every((x) => x.includes("item.")), "the filter keeps only one kind of event");
await p.locator('[data-testid="event-row"]').first().locator("summary").click();
ok((await p.locator('[data-testid="event-row"] pre').first().innerText()).includes('"eventId"'), "an event opens to its raw JSON");
// usage
await p.getByTitle("Profile and settings").click();
await p.locator('[data-testid="open-usage"]').click();
await p.waitForSelector('[data-testid="usage-total"]');
const api_total = (await j("/api/usage")).json.total;
const shownTurns = await p.locator('[data-testid="total-turns"]').innerText();
ok(Number(shownTurns.replace(/\D/g, "")) === api_total.turns && api_total.turns >= 2, "the Usage page total is the sum of the recorded turns");
await p.getByRole("button", { name: "By bot" }).click();
await p.locator('[data-testid="usage-row"]', { hasText: "E2E5 Obs" }).waitFor({ timeout: 10000 }).catch(() => {});
ok((await p.locator('[data-testid="usage-row"]', { hasText: "E2E5 Obs" }).count()) === 1, "usage can be grouped by bot");
await p.screenshot({ path: `${SHOTS}/p5-usage.png` });
await p.locator('[data-testid="usage-page"]').getByRole("button", { name: "Close" }).click();
// export
await p.getByRole("button", { name: "Back" }).first().click();
const [md] = await Promise.all([p.waitForEvent("download"), p.getByRole("link", { name: "Markdown" }).click()]);
const mdText = await (await import("node:fs/promises")).readFile(await md.path(), "utf8");
ok(md.suggestedFilename().endsWith(".md") && mdText.includes("look around") && mdText.startsWith("# E2E5 Obs"), "the transcript downloads as Markdown");
await j(`/api/bots/${obs.id}`, "DELETE");

ok(errors.filter((e) => !/favicon|404|ERR_ABORTED/.test(e)).length === 0, `no page errors ${errors.slice(0, 3).join(" | ")}`);
await b.close();
await j(`/api/mcp/servers/${listed.id}`, "DELETE");
await j(`/api/skills/${skillId}`, "DELETE");
await j(`/api/bots/${bot.id}`, "DELETE");
