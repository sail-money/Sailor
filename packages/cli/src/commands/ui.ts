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
 * Wait until something is listening on `port`, or `timeoutMs` elapses. The UI
 * server binds the port once it's ready, so a successful TCP connect is the
 * real "started" signal — far more reliable than a fixed sleep + pid check,
 * which raced the server's startup and reported a false "exited immediately".
 * Returns false on timeout.
 */
function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = (): void => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, 150);
      });
    };
    attempt();
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
  const envPort = Number(process.env.PORT);
  const port = await findFreePort(Number.isInteger(envPort) && envPort > 0 && envPort <= 65535 ? envPort : projectPort(projectRoot));

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

  // Capture the detached child's output to a log file so a real startup error
  // surfaces (with stdio:"ignore" it vanished, leaving only a misleading
  // "exited immediately" message).
  const runtimeDir = path.join(projectRoot, ".sail", "runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const logFile = path.join(runtimeDir, "ui.log");
  const logFd = fs.openSync(logFile, "a");

  const child = spawn(process.execPath, [serverBundle], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, SAIL_DIR: sailDir, SERVE_DIST: "1", PORT: String(port), SAILOR_UI_DIST: uiDistDir },
  });

  child.unref();
  fs.closeSync(logFd); // the child holds its own copy of the fd

  // Wait for the server to actually bind the port — the true readiness signal.
  // Bail early if the process dies before that.
  const READY_TIMEOUT_MS = 10_000;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let ready = false;
  while (Date.now() < deadline) {
    if (!isAlive(child.pid!)) break;
    if (await waitForPort(port, 500)) { ready = true; break; }
  }
  if (!ready) {
    let tail = "";
    try { tail = fs.readFileSync(logFile, "utf-8").split("\n").filter(Boolean).slice(-15).join("\n"); } catch { /* no log */ }
    throw new Error(
      `Sailor UI failed to start within ${READY_TIMEOUT_MS / 1000}s on port ${port}.` +
        (tail ? `\n\nServer output:\n${tail}` : ` See ${path.relative(projectRoot, logFile)}.`),
    );
  }

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
