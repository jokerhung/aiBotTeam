// "Changing the skin is instant" and "the language switch reaches the screens", checked in a real browser.
//   Skin: click a skin in Settings > Appearance and time how long until <html data-skin> and the page colour change,
//   with no reload. Language: switch to Tiếng Việt and read the approval card, settings, menu and composer.
// Needs `pnpm dev` on the ports from .env.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const { vi: VI } = await import(pathToFileURL(join(fileURLToPath(new URL("..", import.meta.url)), "web", "lib", "i18n-vi.ts")).href);

const root = fileURLToPath(new URL("..", import.meta.url));
const { chromium } = createRequire(join(root, "web", "package.json"))("playwright-core");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const API = `http://127.0.0.1:${process.env.SERVER_PORT || 8899}`;
const WEB = `http://127.0.0.1:${process.env.WEB_PORT || 5299}`;
const j = async (m, p, b) => (await fetch(API + p, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined })).json();
const MAX_MS = 150;

const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(edge ? { executablePath: edge } : {}) });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const failures = [];
const before = (await j("GET", "/api/config")).settings;
if (before.language === "vi") before.language = "en"; // left over from an interrupted earlier run
for (const b of (await j("GET", "/api/bots")).bots) if (b.name === "Instant") await j("DELETE", `/api/bots/${b.id}`);
const bot = await j("POST", "/api/bots", { name: "Instant", modelSelection: { instanceId: "echo", model: "echo-1" }, approvalMode: "ask" });
await j("PUT", "/api/config", { skin: "daylight", language: "en" });
await page.goto(WEB);
await page.locator("nav[aria-label=Bots] [role=button][title=Instant]").click();
await page.evaluate(() => { window.__marker = "same-page"; });

// ---- skin: instant, no reload ----
await page.getByLabel("Profile and settings").click();
await page.getByText("Settings", { exact: true }).click();
await page.getByRole("button", { name: "Appearance" }).click();
for (const name of ["Midnight", "Pop", "Foundry", "Daylight"]) {
  const tile = page.getByRole("radio", { name });
  // time the change from the click itself
  const ms = await Promise.all([
    page.evaluate(() => new Promise((resolve) => {
      const html = document.documentElement, from = html.dataset.skin, bg = getComputedStyle(document.body).backgroundColor;
      let t0 = 0;
      document.addEventListener("click", () => { t0 = performance.now(); }, { capture: true, once: true });
      const tick = () => {
        if (t0 && html.dataset.skin !== from) resolve({ ms: performance.now() - t0, changedColour: getComputedStyle(document.body).backgroundColor !== bg });
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })),
    (async () => { await page.waitForTimeout(100); await tile.click(); })(),
  ]).then(([r]) => r);
  const same = await page.evaluate(() => window.__marker === "same-page");
  const ok = ms.ms <= MAX_MS && ms.changedColour && same;
  console.log(`  ${ok ? "ok  " : "FAIL"} -> ${name.padEnd(9)} ${ms.ms.toFixed(0)} ms, page colour changed: ${ms.changedColour}, no reload: ${same}`);
  if (!ok) failures.push(`${name}: ${JSON.stringify(ms)} sameDocument=${same}`);
}
await page.keyboard.press("Escape");

// ---- language ----
await page.getByLabel("Profile and settings").click();
await page.getByText("Settings", { exact: true }).click();
await page.getByRole("button", { name: "General" }).click();
await page.getByLabel("Language").selectOption("vi");
await page.waitForTimeout(500);
const expect = async (label, loc) => {
  const ok = await loc.first().waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false);
  console.log(`  ${ok ? "ok  " : "FAIL"} Vietnamese: ${label}`);
  if (!ok) failures.push(`vi: ${label}`);
};
await expect("settings nav 'Kết nối'", page.getByTestId("settings-modal").getByRole("button", { name: "Kết nối", exact: true }));
await expect("settings nav 'Giao diện'", page.getByRole("button", { name: "Giao diện", exact: true }));
await page.getByTestId("settings-modal").getByRole("button", { name: "Kết nối", exact: true }).click();
await expect("keys section 'Khoá'", page.getByTestId("settings-modal").getByText("Khoá", { exact: true }));
await page.keyboard.press("Escape");
await expect("sidebar 'Hộp thư'", page.getByText("Hộp thư", { exact: true }));
await expect("composer placeholder", page.getByPlaceholder("Instant").or(page.getByLabel(/Message Instant/)));
await page.locator("[role=button][title=Instant]").click({ button: "right" });
await expect("menu 'Ghim'", page.getByRole("menuitem", { name: "Ghim" }));
await expect("menu 'Nhân bản'", page.getByRole("menuitem", { name: "Nhân bản" }));
await page.keyboard.press("Escape");
const box = page.getByLabel(/Instant/).last();
await box.fill("/approve mkdir vi_test");
await box.press("Enter");
await page.getByTestId("approval-card").waitFor();
await expect("approval 'Cho phép lần này'", page.getByRole("button", { name: "Cho phép lần này" }));
await expect("approval 'Từ chối'", page.getByRole("button", { name: "Từ chối", exact: true }));
await expect("approval 'muốn chạy một lệnh'", page.getByText("muốn chạy một lệnh"));
await expect("blocked composer text", page.getByPlaceholder("Hãy trả lời yêu cầu duyệt phía trên để tiếp tục"));
await page.getByRole("button", { name: "Từ chối", exact: true }).click();
await expect("decided line 'Đã từ chối'", page.getByTestId("request-decided").filter({ hasText: "Đã từ chối" }));

// ---- every screen in Vietnamese: nothing the dictionary knows may be left in English ----
const untranslated = (pg) => pg.evaluate((dict) => {
  const bad = [];
  const skip = "script,style,textarea,input,code,pre,[data-no-i18n]";
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.currentNode; n; n = w.nextNode()) {
    if (n.nodeType === 3) {
      const el = n.parentElement; if (!el || el.closest(skip)) continue;
      const t = n.nodeValue.trim();
      if (t && dict[t] && dict[t] !== t) bad.push(`text: ${t}`);
    } else if (!n.closest?.(skip)) {
      for (const a of ["placeholder", "title", "aria-label"]) { const v = n.getAttribute?.(a); if (v && dict[v] && dict[v] !== v) bad.push(`${a}: ${v}`); }
    }
  }
  return [...new Set(bad)];
}, VI);
const screens = [];
const check = async (name) => {
  await page.waitForTimeout(350);
  const bad = await untranslated(page);
  screens.push(name);
  console.log(`  ${bad.length ? "FAIL" : "ok  "} no English left on: ${name}${bad.length ? " -> " + bad.slice(0, 6).join(" | ") : ""}`);
  if (bad.length) failures.push(`${name}: ${bad.join(" | ")}`);
};
await check("chat with the approval card answered");
await page.getByLabel("Hồ sơ và cài đặt").click();
await page.getByText("Cài đặt", { exact: true }).click();
for (const label of ["Chung", "Kết nối", "Công cụ AI", "Giao diện"]) {
  await page.getByTestId("settings-modal").getByRole("button", { name: label, exact: true }).click();
  await check(`settings: ${label}`);
}
await page.keyboard.press("Escape");
await page.getByLabel("Chi tiết bot").click();
await check("bot panel: details");
for (const row of ["Hoạt động", "Trình kiểm tra"]) {
  await page.getByTestId("panel-overview").getByRole("button", { name: row }).click();
  await check(`bot panel: ${row}`);
  await page.getByRole("button", { name: "Quay lại" }).click();
}
await page.getByRole("button", { name: "Cài đặt bot" }).click();
await check("bot panel: bot settings");
for (const tab of ["Thư viện", "Máy tính"]) {
  await page.getByRole("tab", { name: tab }).click();
  await check(`bot panel: ${tab}`);
}
await page.getByLabel("Đóng bảng").click();
await page.getByTitle("Bot mới").click();
await check("new bot dialog");
await page.keyboard.press("Escape");
await page.keyboard.press("Control+k");
await check("command palette");
await page.keyboard.press("Escape");
await page.keyboard.press("Control+f");
await check("find bar");
await page.keyboard.press("Escape");
await page.getByLabel("Thêm", { exact: true }).click();
await check("composer plus menu");
await page.keyboard.press("Escape");
await page.getByLabel("Hồ sơ và cài đặt").click();
await page.getByText("Phím tắt", { exact: true }).click();
await check("keyboard shortcuts");
await page.keyboard.press("Escape");
await page.locator("[role=button][title=Instant]").click({ button: "right" });
await check("bot menu");
await page.keyboard.press("Escape");
// ---- text assembled at run time, native prompts and toasts ----
const dialogs = [];
page.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });
await page.getByRole("button", { name: "+ Nhóm mới" }).click();
await page.waitForTimeout(300);
const promptOk = dialogs.some((m) => m === "Tên của nhóm mới");
console.log(`  ${promptOk ? "ok  " : "FAIL"} Vietnamese: native prompt text (${JSON.stringify(dialogs[0])})`);
if (!promptOk) failures.push("prompt not translated");
const fresh = await j("POST", "/api/bots", { name: "Fresh", modelSelection: { instanceId: "echo", model: "echo-1" } });
await page.locator("[role=button][title=Fresh]").click();
await expect("empty chat 'Chào Fresh một tiếng.'", page.getByText("Chào Fresh một tiếng."));
await page.getByLabel(/Fresh/).last().fill("xin chào");
await page.getByLabel(/Fresh/).last().press("Enter");
await expect("day label 'Hôm nay …'", page.getByText(/^Hôm nay /));
await page.getByLabel("Chi tiết bot").click();
await expect("routines block 'Quy trình định kỳ'", page.getByText("Quy trình định kỳ", { exact: true }));
await expect("routines row 'Thêm quy trình định kỳ'", page.getByText("Thêm quy trình định kỳ", { exact: true }));
await page.getByLabel("Đóng bảng").click();
await page.locator("[role=button][title=Fresh]").click({ button: "right" });
await page.getByRole("menuitem", { name: "Xóa" }).click();
await expect("delete toast 'Đã xóa Fresh'", page.getByText("Đã xóa Fresh"));
await j("DELETE", `/api/bots/${fresh.id}`).catch(() => {});
console.log(`  checked ${screens.length} screens`);

await j("DELETE", `/api/bots/${bot.id}`);
await j("PUT", "/api/config", { skin: before.skin, language: before.language });
await browser.close();
if (failures.length) { console.error(`\ninstant skin / language check failed:\n - ${failures.join("\n - ")}`); process.exit(1); }
console.log("\nskin changes are instant and the language switch reaches the screens");
