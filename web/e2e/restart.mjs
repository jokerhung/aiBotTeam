// Criterion 3 end to end: kill the real server while B is running a handed-off task, start it again on the same data,
// and check that B ran again exactly once and A received one report.  node web/e2e/restart.mjs   (needs `uv`)
import { spawn, execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const PORT = 8991, HOOK = 8992, API = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "botteam-restart-"));
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) process.exitCode = 1; };
const j = async (path, method = "GET", body) => {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const start = () => spawn("uv", ["run", "--project", "server", "python", "-m", "uvicorn", "botteam.main:app", "--app-dir", "server", "--host", "127.0.0.1", "--port", String(PORT), "--loop", "botteam.loop:loop_factory"],
  { env: { ...process.env, BOTTEAM_DATA_DIR: dir, WEBHOOK_PORT: String(HOOK) }, stdio: "ignore", shell: true });
const stop = (child) => { try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" }); } catch { /* already gone */ } };
const until = async (fn, ms = 40000, label = "") => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn().catch(() => null); if (v) return v; await sleep(250); } throw new Error("timeout " + label); };

let srv = start();
try {
  await until(() => fetch(API + "/api/bots").then((r) => r.ok), 60000, "server up");
  const echo = { instanceId: "echo", model: "echo-1" };
  const A = await j("/api/bots", "POST", { name: "Ann", modelSelection: echo, approvalMode: "full" });
  const B = await j("/api/bots", "POST", { name: "Ben", modelSelection: echo, approvalMode: "full" });
  await j(`/api/bots/${A.id}/messages`, "POST", { text: "/coordinate Ben | /slow work", threadId: A.threadId });
  const running = await until(async () => (await j("/api/assignments")).assignments.find((a) => a.botId === B.id && a.status === "running"), 20000, "B running");
  ok(!!running, "Ben is running the handed-off task");
  stop(srv); // the process dies in the middle of Ben's turn
  await sleep(1500);
  srv = start();
  await until(() => fetch(API + "/api/bots").then((r) => r.ok), 60000, "server up");
  const report = await until(async () => {
    const m = (await j(`/api/bots/${A.id}/messages?thread=${A.threadId}`)).messages;
    return m.filter((x) => x.sender === "Team report").length >= 1 ? m : null;
  });
  await sleep(4000); // time for any duplicate to show up
  const msgs = (await j(`/api/bots/${A.id}/messages?thread=${A.threadId}`)).messages;
  ok(msgs.filter((x) => x.sender === "Team report").length === 1, "Ann received exactly one report");
  const rows = (await j("/api/assignments")).assignments.filter((a) => a.botId === B.id);
  ok(rows.length === 1 && rows[0].status === "completed", `Ben's assignment completed (${rows.map((r) => r.status).join(",")})`);
  const detail = await j(`/api/assignments/${rows[0].id}`);
  ok(detail.assignment.restarts === 1, `Ben ran again exactly once (restarts=${detail.assignment.restarts})`);
  void report;
} catch (e) {
  ok(false, String(e));
} finally {
  stop(srv);
}
