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
let failed = false;
const report = (name, ratio, max, what) => { const ok = ratio <= max; failed ||= !ok; console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${(ratio * 100).toFixed(2)}% of pixels differ (limit ${(max * 100).toFixed(1)}%) — ${what}`); };

// 1. Automations, empty: ours against the reference app
{
  const ref = await page(REF);
  await ref.getByRole("button", { name: "Done", exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await ref.getByRole("button", { name: "You", exact: true }).click();
  await ref.getByText("Automations", { exact: true }).first().click();
  await ref.waitForTimeout(800);
  const refShot = await ref.screenshot({ clip: MAIN });
  writeFileSync(`${OUT}/ref-automations.png`, refShot);
  const ours = await page(OURS);
  await ours.getByTitle("Profile and settings").click();
  await ours.locator('[data-testid="open-automations"]').click();
  await ours.waitForSelector('[data-testid="automations-empty"]');
  await ours.waitForTimeout(500);
  const ourShot = await ours.screenshot({ clip: MAIN });
  writeFileSync(`${OUT}/ours-automations.png`, ourShot);
  report("automations-empty vs reference", diff(refShot, ourShot, "automations-empty"), Number(process.env.LIMIT_AUTOMATIONS || 0.04), "main pane");
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

// 1c. Room and mention picker: geometry of the same elements in the reference and in ours (their data differs, their layout must not)
{
  const echo = { instanceId: "echo", model: "echo-1" };
  const mk = (name) => jj("/api/bots", "POST", { name, modelSelection: echo });
  const [x, y, z] = [await mk("Vis A"), await mk("Vis B"), await mk("Vis C")];
  const g = await jj("/api/groups", "POST", { name: "Vis room", members: [x.id, y.id, z.id], leader: x.id });
  const ref = await page(REF);
  await dismiss(ref);
  await ref.getByText("botTeam Project").first().click();
  await ref.waitForTimeout(1200);
  const ours = await page(OURS);
  await ours.locator('[data-testid="group-row"]', { hasText: "Vis room" }).click();
  await ours.waitForSelector('[data-testid="group-view"]');
  const measure = async (p, picker, title) => {
    const box = p.locator("textarea").first();
    await box.click(); await box.pressSequentially("@"); await p.waitForTimeout(600);
    const pk = await p.locator(picker).first().boundingBox();
    const comp = await box.evaluate((e) => { const r = (e.closest("[class*=rounded-]") || e).getBoundingClientRect(); return { w: r.width, h: r.height }; });
    const heads = await p.getByText(title, { exact: true }).evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y }; }));
    const head = heads.find((h) => h.y < 60 && h.x > 280);  // the title in the room header, not the sidebar row or a message
    return { pk, comp, head };
  };
  const R = await measure(ref, "[role=listbox], [role=menu], [class*=shadow]:has(> button)", "botTeam Project");
  const O = await measure(ours, '[data-testid="mention-picker"]', "Vis room");
  const near = (name, a, b, tol) => { const ok = Math.abs(a - b) <= tol; failed ||= !ok; console.log(`${ok ? "PASS" : "FAIL"}  ${name}: reference ${Math.round(a)}, ours ${Math.round(b)} (tolerance ${tol}px)`); };
  near("room title x", R.head.x, O.head.x, 12);
  near("room title y", R.head.y, O.head.y, 12);
  near("mention picker width", R.pk.width, O.pk.width, 12);
  near("mention picker left edge", R.pk.x, O.pk.x, 12);
  near("mention picker row height (picker height / 5 rows vs 4)", R.pk.height / 5, O.pk.height / 4, 6);
  near("composer width", R.comp.w, O.comp.w, 12);
  await ours.screenshot({ clip: MAIN, path: `${OUT}/ours-room-mention.png` });
  await ref.screenshot({ clip: MAIN, path: `${OUT}/ref-room-mention.png` });
  await jj(`/api/groups/${g.id}`, "DELETE"); for (const b2 of [x, y, z]) await jj(`/api/bots/${b2.id}`, "DELETE");
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
