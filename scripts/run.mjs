// Launch one service with ports from the root .env: node scripts/run.mjs <server|web|web-start>
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const serverPort = process.env.SERVER_PORT || "8899";
const webPort = process.env.WEB_PORT || "5299";
const hookPort = process.env.WEBHOOK_PORT || "8900";
const env = {
  ...process.env,
  SERVER_PORT: serverPort,
  WEB_PORT: webPort,
  WEBHOOK_PORT: hookPort,
  BOTTEAM_API: process.env.BOTTEAM_API || `http://127.0.0.1:${serverPort}`,
};

const targets = {
  server: ["uv", ["run", "--project", "server", "python", "-m", "uvicorn", "botteam.main:app", "--app-dir", "server",
    "--host", "127.0.0.1", "--port", serverPort, "--reload", "--loop", "botteam.loop:loop_factory"]],
  web: ["pnpm", ["--filter", "web", "exec", "next", "dev", "-p", webPort, "-H", "127.0.0.1"]],
  "web-start": ["pnpm", ["--filter", "web", "exec", "next", "start", "-p", webPort, "-H", "127.0.0.1"]],
};
const t = targets[process.argv[2]];
if (!t) { console.error(`usage: run.mjs <${Object.keys(targets).join("|")}>`); process.exit(2); }

const child = spawn(t[0], t[1], { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 1));
