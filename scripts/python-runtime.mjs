import { existsSync } from "node:fs";
import { join } from "node:path";

// Starting a service must not reinstall its own executable while another instance
// is running. Dependency synchronization belongs to setup:server/install scripts.
export function pythonRuntime(root, platform = process.platform) {
  const python = join(root, "server", ".venv", ...(platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]));
  return existsSync(python)
    ? [python, []]
    : ["uv", ["run", "--project", "server", "python"]];
}
