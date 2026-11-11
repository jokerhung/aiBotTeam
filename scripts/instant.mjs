// "Changing the skin is instant" and "the language switch reaches the screens", checked in a real browser.
//   Skin: click a skin in Settings > Appearance and time how long until <html data-skin> and the page colour change,
//   with no reload. Language: switch to Tiếng Việt and read the approval card, settings, menu and composer.
// Needs `pnpm dev` on the ports from .env.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
await expect("keys heading 'Khoá'", page.getByRole("heading", { name: "Khoá" }));
await page.keyboard.press("Escape");
await expect("sidebar 'Hộp thư'", page.getByText("Hộp thư", { exact: true }));
await expect("composer placeholder", page.getByPlaceholder("Instant").or(page.getByLabel(/Message Instant/)));
await page.locator("nav[aria-label=Bots] [role=button][title=Instant]").click({ button: "right" });
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

await j("DELETE", `/api/bots/${bot.id}`);
await j("PUT", "/api/config", { skin: before.skin, language: before.language });
await browser.close();
if (failures.length) { console.error(`\ninstant skin / language check failed:\n - ${failures.join("\n - ")}`); process.exit(1); }
console.log("\nskin changes are instant and the language switch reaches the screens");
