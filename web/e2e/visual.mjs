// Visual comparison of our screens with the reference app (pixelmatch over the main pane, a threshold per screen).
// Needs both apps up:  PW_PATH=<dir with node_modules/playwright-core> node web/e2e/visual.mjs
// Regression baselines of our own screens live in web/e2e/baseline-p4 (written with UPDATE=1).
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
const require = createRequire((process.env.PW_PATH || ".") + "/");
const { chromium } = require("playwright-core");
const wreq = createRequire(process.cwd() + "/web/");
const { PNG } = wreq("pngjs");
const pm = await import(pathToFileURL(wreq.resolve("pixelmatch")).href);
const pixelmatch = pm.default;
const OURS = process.env.WEB || "http://127.0.0.1:5299", REF = process.env.REF || "http://localhost:5199/";
const OUT = process.env.SHOTS || "web/e2e/shots", BASE = "web/e2e/baseline-p4";
mkdirSync(OUT, { recursive: true }); mkdirSync(BASE, { recursive: true });
const MAIN = { x: 280, y: 0, width: 1080, height: 860 }; // everything right of the sidebar

const b = await chromium.launch({ executablePath: process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = async (url) => { const p = await (await b.newContext({ viewport: { width: 1360, height: 860 } })).newPage(); await p.goto(url); await p.waitForTimeout(2500); return p; };

function diff(aBuf, bBuf, name) {
  const a = PNG.sync.read(aBuf), c = PNG.sync.read(bBuf);
  const w = Math.min(a.width, c.width), h = Math.min(a.height, c.height);
  const crop = (img) => { const o = new PNG({ width: w, height: h }); PNG.bitblt(img, o, 0, 0, w, h, 0, 0); return o; };
  const A = crop(a), C = crop(c), D = new PNG({ width: w, height: h });
  const n = pixelmatch(A.data, C.data, D.data, w, h, { threshold: 0.25 });
  writeFileSync(`${OUT}/diff-${name}.png`, PNG.sync.write(D));
  return n / (w * h);
}
const leftovers = async () => { // what an earlier run that stopped half way left behind
  const J = async (path, method = "GET") => (await fetch((process.env.API || "http://127.0.0.1:8899") + path, { method })).json().catch(() => ({}));
  for (const x of (await J("/api/bots")).bots ?? []) if (/^(Vis |Viet |Ledger$)/.test(x.name)) await J(`/api/bots/${x.id}`, "DELETE");
  for (const g of (await J("/api/groups")).groups ?? []) if (/^(Vis |Viet )/.test(g.name)) await J(`/api/groups/${g.id}`, "DELETE");
  for (const r of (await J("/api/routines")).routines ?? []) if (/^(Vis |Viet |Keep an eye)/.test(r.name)) await J(`/api/routines/${r.id}`, "DELETE");
  for (const w of (await J("/api/webhooks")).webhooks ?? []) if (/^(Vis |Viet |Deploy events)/.test(w.name)) await J(`/api/webhooks/${w.id}`, "DELETE");
};
await leftovers();
let failed = false;
const ok2 = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); failed ||= !c; };
const report = (name, ratio, max, what) => { const ok = ratio <= max; failed ||= !ok; console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${(ratio * 100).toFixed(2)}% of pixels differ (limit ${(max * 100).toFixed(1)}%) — ${what}`); };

// 1. Automations, empty: ours against the reference app
{
  const ref = await page(REF);
  await ref.getByRole("button", { name: "Done", exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await ref.getByRole("button", { name: "You", exact: true }).click();
  await ref.getByText("Automations", { exact: true }).first().click();
  await ref.waitForTimeout(800);
  const refHasRoutine = (await ref.getByText("Keep an eye on my day").count()) > 0;  // the reference grows a routine of its own after a while
  const refShot = await ref.screenshot({ clip: MAIN });
  writeFileSync(`${OUT}/ref-automations.png`, refShot);
  const ours = await page(OURS);
  await ours.getByTitle("Profile and settings").click();
  await ours.locator('[data-testid="open-automations"]').click();
  await ours.waitForSelector('[data-testid="automations-empty"]');
  await ours.waitForTimeout(500);
  const ourShot = await ours.screenshot({ clip: MAIN });
  writeFileSync(`${OUT}/ours-automations.png`, ourShot);
  const HDR = { x: 280, y: 0, width: 1080, height: 60 };  // the page header is on screen in either state of the reference
  const rh = await ref.screenshot({ clip: HDR }), oh = await ours.screenshot({ clip: HDR });
  writeFileSync(`${OUT}/ref-automations-header.png`, rh); writeFileSync(`${OUT}/ours-automations-header.png`, oh);
  report("automations header vs reference", diff(rh, oh, "automations-header"), Number(process.env.LIMIT_HEADER_AUTO || 0.08), "icon, title, subtitle, filter, List/Calendar, New");
  if (refHasRoutine) {
    // the live reference now lists a routine of its own, so its empty state is read from the capture of it kept in the repo (1280x800, taken from :5199)
    const stored = PNG.sync.read(readFileSync("web/e2e/reference/automations-empty-1280x800.png"));
    const region = { x: 280, y: 0, width: 1000, height: 800 };
    const refPart = new PNG({ width: region.width, height: region.height });
    PNG.bitblt(stored, refPart, region.x, region.y, region.width, region.height, 0, 0);
    const small = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await small.goto(OURS); await small.waitForTimeout(2500);
    await small.getByTitle("Profile and settings").click();
    await small.locator('[data-testid="open-automations"]').click();
    await small.waitForSelector('[data-testid="automations-empty"]'); await small.waitForTimeout(500);
    const mine = await small.screenshot({ clip: region });
    writeFileSync(`${OUT}/ref-automations-stored.png`, PNG.sync.write(refPart)); writeFileSync(`${OUT}/ours-automations-1280.png`, mine);
    report("automations-empty vs stored reference capture", diff(PNG.sync.write(refPart), mine, "automations-empty-stored"), Number(process.env.LIMIT_AUTOMATIONS || 0.04), "main pane, 1280x800");
  } else report("automations-empty vs reference", diff(refShot, ourShot, "automations-empty"), Number(process.env.LIMIT_AUTOMATIONS || 0.04), "main pane");
}

// 1b. Routine dialog ("What should happen?"): pixel comparison of the dialog box, ours against the reference
const API = process.env.API || "http://127.0.0.1:8899";
const jj = async (path, method = "GET", body) => (await fetch(API + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const dismiss = (p) => p.getByRole("button", { name: "Done", exact: true }).first().click({ timeout: 3000 }).catch(() => {});
{
  const ref = await page(REF);
  await dismiss(ref);
  await ref.getByRole("button", { name: "You", exact: true }).click();
  await ref.getByText("Automations", { exact: true }).first().click();
  await ref.waitForTimeout(600);
  await ref.getByRole("button", { name: /New/ }).last().click();
  await ref.waitForTimeout(800);
  const rd = ref.getByRole("dialog").first();
  const rb = await rd.boundingBox();
  const refShot = await ref.screenshot({ clip: rb });
  const ours = await page(OURS);
  await ours.getByTitle("Profile and settings").click();
  await ours.locator('[data-testid="open-automations"]').click();
  await ours.getByRole("button", { name: "New routine" }).first().click();
  await ours.waitForSelector('[data-testid="routine-ask"]');
  await ours.waitForTimeout(500);
  const ob = await ours.locator('[data-testid="routine-ask"] > div').boundingBox();
  const ourShot = await ours.screenshot({ clip: ob });
  writeFileSync(`${OUT}/ref-routine-dialog.png`, refShot); writeFileSync(`${OUT}/ours-routine-dialog.png`, ourShot);
  report("routine dialog vs reference", diff(refShot, ourShot, "routine-dialog"), Number(process.env.LIMIT_DIALOG || 0.08), `dialog ${Math.round(rb.width)}x${Math.round(rb.height)} vs ${Math.round(ob.width)}x${Math.round(ob.height)}`);
}

// 1c. Room header and mention picker: same member names, titles and colours on both sides, so the crops can be compared pixel by pixel
{
  const echo = { instanceId: "echo", model: "echo-1" };
  const mk = (name, title, color) => jj("/api/bots", "POST", { name, title, color, modelSelection: echo });
  const [x, y, z] = [await mk("Leader", "Tech Lead", "purple"), await mk("Dev", "Fullstack Developer", "green"), await mk("QA", "QA and Release Engineer", "orange")];
  const g = await jj("/api/groups", "POST", { name: "botTeam Project", members: [x.id, y.id, z.id], leader: x.id });
  const ref = await page(REF);
  await dismiss(ref);
  await ref.getByText("botTeam Project").first().click();
  await ref.waitForTimeout(1200);
  const ours = await page(OURS);
  await ours.locator('[data-testid="group-row"]', { hasText: "botTeam Project" }).click();
  await ours.waitForSelector('[data-testid="group-view"]');
  await ours.waitForTimeout(500);
  const HEAD = { x: 1240, y: 0, width: 120, height: 56 }; // the avatar stack (the title area has the reference's scrolled messages fading behind it)
  const refHead = await ref.screenshot({ clip: HEAD }), ourHead = await ours.screenshot({ clip: HEAD });
  writeFileSync(`${OUT}/ref-room-header.png`, refHead); writeFileSync(`${OUT}/ours-room-header.png`, ourHead);
  report("room header vs reference", diff(refHead, ourHead, "room-header"), Number(process.env.LIMIT_HEADER || 0.1), "avatar stack of the same three members");
  const open = async (p, picker) => {
    const box = p.locator("textarea").first();
    await box.click(); await box.pressSequentially("@"); await p.waitForTimeout(700);
    return p.locator(picker).first();
  };
  const rp = await open(ref, "[role=listbox], [role=menu], [class*=shadow]:has(> button)");
  const op = await open(ours, '[data-testid="mention-picker"]');
  const rb = await rp.boundingBox(), ob = await op.boundingBox();
  const rows = 4, rowH = 53; // everyone + the three members (the reference lists one more, "devs", below them)
  const refPk = await ref.screenshot({ clip: { x: rb.x, y: rb.y, width: rb.width, height: rowH * rows + 8 } });
  const ourPk = await ours.screenshot({ clip: { x: ob.x, y: ob.y, width: ob.width, height: rowH * rows + 8 } });
  writeFileSync(`${OUT}/ref-picker.png`, refPk); writeFileSync(`${OUT}/ours-picker.png`, ourPk);
  report("mention picker vs reference", diff(refPk, ourPk, "picker"), Number(process.env.LIMIT_PICKER || 0.1), `first 4 rows, ${Math.round(rb.width)}px vs ${Math.round(ob.width)}px wide`);
  await jj(`/api/groups/${g.id}`, "DELETE"); for (const b2 of [x, y, z]) await jj(`/api/bots/${b2.id}`, "DELETE");
}

// 1d. Notifications panel: header, filter and footer of the panel (the rows hold each side's own events)
{
  const ref = await page(REF);
  await dismiss(ref);
  await ref.getByRole("button", { name: "You", exact: true }).click();
  await ref.getByText("Settings", { exact: true }).first().click();
  await ref.getByLabel("Show the notification feed").first().click({ force: true });
  await ref.getByRole("button", { name: "Close settings" }).click();
  await ref.waitForTimeout(600);
  await ref.getByRole("button", { name: "Notifications" }).first().click();
  await ref.waitForTimeout(900);
  const ours = await page(OURS);
  await ours.getByRole("button", { name: "Notifications" }).first().click();
  await ours.waitForSelector('[data-testid="notifications-panel"]');
  await ours.waitForTimeout(500);
  const TOP = { x: 1060, y: 0, width: 300, height: 100 }, FOOT = { x: 1060, y: 820, width: 300, height: 40 };
  for (const [name, clip, limit] of [["header + filter", TOP, 0.1], ["footer", FOOT, 0.1]]) {
    const r = await ref.screenshot({ clip }), o = await ours.screenshot({ clip });
    writeFileSync(`${OUT}/ref-notif-${name.split(" ")[0]}.png`, r); writeFileSync(`${OUT}/ours-notif-${name.split(" ")[0]}.png`, o);
    report(`notifications panel ${name} vs reference`, diff(r, o, `notif-${name.split(" ")[0]}`), Number(process.env.LIMIT_NOTIF || limit), "panel chrome");
  }
}

// 1e. Automations calendar with data and the full "New automation" form, ours against the reference. The reference keeps its own
// routines, so what is compared is what both draw from the same inputs: the month, the week header, the hour axis, the form's top.
{
  const echo = { instanceId: "echo", model: "echo-1" };
  const bot = await jj("/api/bots", "POST", { name: "Vis Cal", modelSelection: echo });
  const routine = await jj("/api/routines", "POST", { name: "Vis routine", prompt: "ping", targetKind: "bot", targetId: bot.id, kind: "interval", everyMin: 60 });
  const ref = await page(REF);
  await dismiss(ref);
  await ref.getByRole("button", { name: "You", exact: true }).click();
  await ref.getByText("Automations", { exact: true }).first().click();
  await ref.waitForTimeout(500);
  await ref.getByRole("button", { name: "Calendar", exact: true }).click();
  await ref.waitForTimeout(1000);
  const ours = await page(OURS);
  await ours.getByTitle("Profile and settings").click();
  await ours.locator('[data-testid="open-automations"]').click();
  await ours.getByRole("button", { name: "Calendar", exact: true }).click();
  await ours.waitForSelector('[data-testid="calendar-grid"]');
  await ours.waitForTimeout(800);
  ok2((await ours.locator('[data-testid="routine-block"]').count()) > 0, "calendar shows our routine's blocks");
  const crops = [
    ["month grid", { x: 0, y: 112, width: 320, height: 250 }, 0.06],
    ["week header", { x: 320, y: 110, width: 1040, height: 70 }, 0.08],
    ["navigation row", { x: 0, y: 60, width: 1000, height: 50 }, 0.08],
  ];
  for (const [name, clip, limit] of crops) {
    const r = await ref.screenshot({ clip }), o = await ours.screenshot({ clip });
    const slug = name.replace(/ /g, "-");
    writeFileSync(`${OUT}/ref-cal-${slug}.png`, r); writeFileSync(`${OUT}/ours-cal-${slug}.png`, o);
    report(`calendar ${name} vs reference`, diff(r, o, `cal-${slug}`), Number(process.env.LIMIT_CAL || limit), "same month, same week");
  }
  // the form: open it on both sides and compare the top of the dialog (title, When, date and time, repeat chips)
  await ref.getByRole("button", { name: /New/ }).last().click(); await ref.waitForTimeout(500);
  await ref.getByText("Set it up yourself").click(); await ref.waitForTimeout(500);
  await ref.getByRole("button", { name: "Continue" }).click(); await ref.waitForTimeout(800);
  await ours.getByRole("button", { name: "New routine" }).first().click();
  await ours.getByRole("button", { name: "Set it up yourself" }).click();
  await ours.getByRole("button", { name: "Continue" }).click();
  await ours.waitForSelector('[data-testid="routine-editor"]'); await ours.waitForTimeout(600);
  const rbx = await ref.getByRole("dialog").first().boundingBox();
  const obx = await ours.locator('[data-testid="routine-editor"] > div').boundingBox();
  const clipOf = (bx) => ({ x: bx.x, y: bx.y, width: 760, height: 300 });
  const rf = await ref.screenshot({ clip: clipOf(rbx) }), of = await ours.screenshot({ clip: clipOf(obx) });
  writeFileSync(`${OUT}/ref-form.png`, rf); writeFileSync(`${OUT}/ours-form.png`, of);
  report("new-automation form vs reference", diff(rf, of, "form"), Number(process.env.LIMIT_FORM || 0.1), `top of the dialog; dialogs ${Math.round(rbx.width)}px vs ${Math.round(obx.width)}px wide`);
  await jj(`/api/routines/${routine.id}`, "DELETE"); await jj(`/api/bots/${bot.id}`, "DELETE");
}

// 1f. Inbox panel (empty) and the "When another app sends something" dialog: ours against the reference
{
  const ref = await page(REF);
  await dismiss(ref);
  await ref.getByRole("button", { name: "Inbox" }).first().click();
  await ref.waitForTimeout(900);
  const ours = await page(OURS);
  await ours.locator('[data-testid="inbox-button"]').click();
  await ours.waitForSelector('[data-testid="inbox-panel"]');
  await ours.waitForTimeout(600);
  const rbx = await ref.locator("aside, [role=complementary]").filter({ hasText: "Nothing for you yet" }).first().boundingBox();
  const obx = await ours.locator('[data-testid="inbox-panel"]').boundingBox();
  const clip = (bx) => ({ x: bx.x, y: 0, width: Math.min(bx.width, 320), height: 230 });
  const ri = await ref.screenshot({ clip: clip(rbx) }), oi = await ours.screenshot({ clip: clip(obx) });
  writeFileSync(`${OUT}/ref-inbox-panel.png`, ri); writeFileSync(`${OUT}/ours-inbox-panel.png`, oi);
  report("inbox panel (empty) vs reference", diff(ri, oi, "inbox-panel"), Number(process.env.LIMIT_INBOX || 0.1), `panel ${Math.round(rbx.width)}px vs ${Math.round(obx.width)}px wide`);

  await ref.getByRole("button", { name: "You", exact: true }).click();
  await ref.getByText("Automations", { exact: true }).first().click(); await ref.waitForTimeout(500);
  await ref.getByRole("button", { name: /New/ }).last().click(); await ref.waitForTimeout(500);
  await ref.getByText("Set it up yourself").click(); await ref.waitForTimeout(500);
  await ref.getByText("When another app sends something").click();
  await ref.getByRole("button", { name: "Continue" }).click(); await ref.waitForTimeout(900);
  await ours.getByTitle("Profile and settings").click();
  await ours.locator('[data-testid="open-automations"]').click();
  await ours.getByRole("button", { name: "New routine" }).first().click();
  await ours.getByRole("button", { name: "Set it up yourself" }).click();
  await ours.getByRole("radio", { name: "When another app sends something" }).click();
  await ours.getByRole("button", { name: "Continue" }).click();
  await ours.waitForSelector('[data-testid="webhook-dialog"]'); await ours.waitForTimeout(600);
  const rd = await ref.getByRole("dialog").first().boundingBox(), od = await ours.locator('[data-testid="webhook-dialog"] > div').boundingBox();
  for (const [name, top] of [["header", true], ["footer", false]]) {
    const h = top ? 110 : 66;
    const cr = (bx) => ({ x: bx.x, y: top ? bx.y : bx.y + bx.height - h, width: 560, height: h });
    const r = await ref.screenshot({ clip: cr(rd) }), o = await ours.screenshot({ clip: cr(od) });
    writeFileSync(`${OUT}/ref-hook-${name}.png`, r); writeFileSync(`${OUT}/ours-hook-${name}.png`, o);
    report(`webhook dialog ${name} vs reference`, diff(r, o, `hook-${name}`), Number(process.env.LIMIT_HOOK || 0.1), `dialog ${Math.round(rd.width)}px vs ${Math.round(od.width)}px wide`);
  }
}

// 1g. List cards with data (a routine and a webhook against the reference's own routine card) and an inbox question card against the reference's
// question card (same bot name and question, so the text is the same on both sides)
{
  const echo = { instanceId: "echo", model: "echo-1" };
  const bot = await jj("/api/bots", "POST", { name: "Ledger", color: "teal", modelSelection: echo, approvalMode: "ask" });
  const routine = await jj("/api/routines", "POST", { name: "Keep an eye on my day", prompt: "keeps an eye on your day for you", targetKind: "bot", targetId: bot.id, kind: "interval", everyMin: 15 });
  const made = await jj("/api/webhooks", "POST", { name: "Deploy events", targetId: bot.id, prompt: "Summarise each deploy event." });
  const ref = await page(REF);
  await dismiss(ref);
  await ref.getByRole("button", { name: "Inbox" }).first().click();  // the reference's own routine ("Keep an eye on my day") appears once the inbox has been opened
  await ref.waitForTimeout(1500);
  await ref.getByRole("button", { name: "You", exact: true }).click();
  await ref.getByText("Automations", { exact: true }).first().click();
  await ref.waitForTimeout(900);
  const hasCard = (await ref.getByText("Keep an eye on my day").count()) > 0;
  const rcard = hasCard ? await ref.getByText("Keep an eye on my day").first().evaluate((el) => {
    let n = el; while (n && !(n.getBoundingClientRect().width >= 600 && parseFloat(getComputedStyle(n).borderTopLeftRadius) >= 10)) n = n.parentElement;  // the rounded card around the text
    const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  }) : null;
  const ours = await page(OURS);
  await ours.getByTitle("Profile and settings").click();
  await ours.locator('[data-testid="open-automations"]').click();
  await ours.waitForSelector('[data-testid="routine-row"]');
  await ours.waitForTimeout(500);
  const ocard = await ours.locator('[data-testid="routine-row"]').first().boundingBox();
  const sides = [["status dot column", (bx) => ({ x: bx.x, y: bx.y, width: 60, height: Math.min(bx.height, 94) }), 0.08], ["switch column", (bx) => ({ x: bx.x + bx.width - 64, y: bx.y, width: 64, height: Math.min(bx.height, 94) }), 0.08]];
  const cardLimit = Number(process.env.LIMIT_CARD || 0.1);
  if (!rcard) console.log("SKIP  list cards vs reference: the reference has no routine on screen right now (its empty state is compared above)");
  if (rcard) report("list card size", Math.abs(rcard.width - ocard.width) / rcard.width, 0.03, `width ${Math.round(rcard.width)}px vs ${Math.round(ocard.width)}px`);
  if (rcard) for (const [name, f, limit] of sides) {
    const r = await ref.screenshot({ clip: f(rcard) }), o = await ours.screenshot({ clip: f(ocard) });
    const slug = name.replace(/ /g, "-");
    writeFileSync(`${OUT}/ref-card-${slug}.png`, r); writeFileSync(`${OUT}/ours-card-${slug}.png`, o);
    report(`routine card ${name} vs reference`, diff(r, o, `card-${slug}`), Math.max(limit, cardLimit), "same card chrome");
  }
  await ours.getByRole("tab", { name: "Webhooks" }).click();
  await ours.waitForSelector('[data-testid="webhook-row"]');
  await ours.waitForTimeout(400);
  const wcard = await ours.locator('[data-testid="webhook-row"]').first().boundingBox();
  if (rcard) report("webhook card size", Math.abs(rcard.width - wcard.width) / rcard.width, 0.03, `width ${Math.round(rcard.width)}px vs ${Math.round(wcard.width)}px`);
  if (rcard) for (const [name, f, limit] of sides) {
    const r = await ref.screenshot({ clip: f(rcard) }), o = await ours.screenshot({ clip: f(wcard) });
    const slug = name.replace(/ /g, "-");
    writeFileSync(`${OUT}/ours-hookcard-${slug}.png`, o);
    report(`webhook card ${name} vs reference routine card`, diff(r, o, `hookcard-${slug}`), Math.max(limit, cardLimit), "same card chrome");
  }
  // inbox question card
  const question = "What wording should the new footer text on the pricing page use?";
  await jj(`/api/bots/${bot.id}/messages`, "POST", { text: `/ask ${question}`, threadId: bot.threadId });
  await ours.waitForTimeout(1500);
  await ours.locator('[data-testid="inbox-button"]').click();
  await ours.locator('[title="Expand"], [aria-label="Expand"]').first().click();
  await ours.waitForSelector('[data-testid="inbox-card"] [data-testid="ask-card"]');
  await ours.waitForTimeout(500);
  const qprev = await page(REF.replace(/\/$/, "") + "/question-cards-preview.html?state=open&skin=daylight");
  const rq = await qprev.getByText("Ledger asks").first().locator("xpath=ancestor::div[@role='group'][1]").boundingBox();
  const oq = await ours.locator('[data-testid="ask-card"]').first().boundingBox();
  const qclip = (bx) => ({ x: bx.x, y: bx.y, width: Math.min(bx.width, 520), height: 72 });
  const rqs = await qprev.screenshot({ clip: qclip(rq) }), oqs = await ours.screenshot({ clip: qclip(oq) });
  writeFileSync(`${OUT}/ref-inbox-card.png`, rqs); writeFileSync(`${OUT}/ours-inbox-card.png`, oqs);
  report("inbox question card vs reference question card", diff(rqs, oqs, "inbox-card"), Number(process.env.LIMIT_QCARD || 0.1), "header and question text");
  await jj(`/api/bots/${bot.id}/interrupt`, "POST");
  await jj(`/api/routines/${routine.id}`, "DELETE"); await jj(`/api/webhooks/${made.webhook.id}`, "DELETE"); await jj(`/api/bots/${bot.id}`, "DELETE");
}

// 2. Our own screens against stored baselines (regression, tighter limit); UPDATE=1 rewrites them
const snaps = readdirSync(OUT).filter((f) => /^p4-.*\.png$/.test(f)).map((f) => ({ name: f.replace(/\.png$/, ""), path: `${OUT}/${f}` })); // written by phase4.mjs
for (const { name, path } of snaps) {
  const shot = readFileSync(path), base = `${BASE}/${name}.png`;
  if (process.env.UPDATE === "1" || !existsSync(base)) { writeFileSync(base, shot); console.log(`BASE  ${name} written`); continue; }
  report(`${name} vs baseline`, diff(readFileSync(base), shot, name), Number(process.env.LIMIT_BASELINE || 0.02), "regression");
}
await b.close();
process.exitCode = failed ? 1 : 0;
