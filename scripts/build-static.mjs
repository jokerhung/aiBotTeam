// The web app as plain files that the Python server serves (one program, no Node at run time): web/.next-export
import { spawnSync } from "node:child_process";
const r = spawnSync("pnpm", ["--filter", "web", "exec", "next", "build"], { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, BOTTEAM_EXPORT: "1" } });
process.exit(r.status ?? 1);
