import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { cliDistDir, packageRoot, projectPort } from "../lib/packagePaths.js";

const UI_STATE_FILE = path.join(".sail", "runtime", "ui.json");

type UiState = { pid: number; port: number; startedAt: string };

function readState(projectRoot: string): UiState | null {
  const file = path.join(projectRoot, UI_STATE_FILE);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")) as UiState; } catch { return null; }
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function findFreePort(from: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => findFreePort(from + 1).then(resolve, reject));
    server.listen(from, "127.0.0.1", () => server.close(() => resolve(from)));
  });
}

/**
 * `sailor ui` / `sailor ui start` — serves the UI via the bundled Express server.
 *
 * Path layout (works in both the monorepo and an installed npm package):
 *   packages/cli/dist/index.cjs   ← this bundle
 *   packages/cli/dist/server.cjs  ← bundled UI server
 *   packages/ui/dist/             ← pre-built static UI assets
 */
export async function uiCommand(): Promise<void> {
  const distDir = cliDistDir();
  const uiDistDir = path.join(packageRoot(), "packages", "ui", "dist");
  const serverBundle = path.resolve(distDir, "server.cjs");
  const projectRoot = process.cwd();
  const sailDir = path.join(projectRoot, ".sail");
  const port = await findFreePort(projectPort(projectRoot));

  if (!fs.existsSync(serverBundle)) {
    throw new Error(`Server bundle not found at ${serverBundle}. Re-run the sailor build.`);
  }
  if (!fs.existsSync(path.join(uiDistDir, "index.html"))) {
    throw new Error(`UI dist not found at ${uiDistDir}. Re-run the sailor build.`);
  }

  const existing = readState(projectRoot);
  if (existing && isAlive(existing.pid)) {
    console.log(`Sailor UI is already running (pid ${existing.pid}) at http://localhost:${existing.port}`);
    return;
  }

  const child = spawn(process.execPath, [serverBundle], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, SAIL_DIR: sailDir, SERVE_DIST: "1", PORT: String(port), SAILOR_UI_DIST: uiDistDir },
  });

  child.unref();

  // Give the process ~300 ms to bind and stabilise before reporting success.
  await new Promise((r) => setTimeout(r, 300));
  if (!isAlive(child.pid!)) {
    throw new Error(`Sailor UI process exited immediately. Check that the server bundle is intact.`);
  }

  fs.mkdirSync(path.join(projectRoot, ".sail", "runtime"), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, UI_STATE_FILE),
    JSON.stringify({ pid: child.pid, port, startedAt: new Date().toISOString() }, null, 2),
  );

  console.log(`Sailor UI started at http://localhost:${port}  (pid ${child.pid})`);
  console.log(`Stop it with: sailor ui stop`);
}

export function uiStatus(): void {
  const state = readState(process.cwd());
  if (state && isAlive(state.pid)) {
    console.log(`● running  http://localhost:${state.port}  (pid ${state.pid})`);
  } else {
    if (state) fs.rmSync(path.join(process.cwd(), UI_STATE_FILE), { force: true });
    console.log("○ Sailor UI is not running");
  }
}

export function uiStop(): void {
  const projectRoot = process.cwd();
  const state = readState(projectRoot);
  if (!state) {
    console.log("Sailor UI is not running.");
    return;
  }
  if (!isAlive(state.pid)) {
    fs.rmSync(path.join(projectRoot, UI_STATE_FILE), { force: true });
    console.log("Sailor UI is not running (stale state file removed).");
    return;
  }
  process.kill(state.pid, "SIGTERM");
  fs.rmSync(path.join(projectRoot, UI_STATE_FILE), { force: true });
  console.log(`Stopped Sailor UI (pid ${state.pid}).`);
}
