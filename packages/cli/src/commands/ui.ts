import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { cliDistDir, packageRoot, projectPort } from "../lib/packagePaths.js";
import {
  tailnetDnsName,
  tailscaleAvailable,
  tailscaleServeDown,
  tailscaleServeUp,
} from "../lib/tailscale.js";

const UI_STATE_FILE = path.join(".sail", "runtime", "ui.json");

type UiState = {
  pid: number;
  port: number;
  startedAt: string;
  /** Set when the dashboard was exposed over the tailnet (F9) so `stop` can tear it down. */
  exposed?: boolean;
};

export interface UiOptions {
  /** `tailscale` to proxy the dashboard onto the tailnet over HTTPS (F9). */
  expose?: string;
}

function readState(projectRoot: string): UiState | null {
  const file = path.join(projectRoot, UI_STATE_FILE);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")) as UiState; } catch { return null; }
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** The CLI's own installed version, read from its package manifest. */
function installedCliVersion(): string | null {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(packageRoot(), "package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Version handshake (F4). A running dashboard serves the version it booted with;
 * if `npx sailor` upgrades the package mid-session, the still-running dashboard
 * keeps serving the old assets/code, which surfaced as confusing connector
 * errors at the seam. Query the dashboard's /api/version and warn — with a
 * restart hint — when its running version differs from this CLI's. Best-effort:
 * any error (unreachable, older server without the endpoint) is ignored.
 */
async function warnIfVersionSkew(port: number): Promise<void> {
  const cli = installedCliVersion();
  if (!cli) return;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/version`, {
      signal: AbortSignal.timeout(500),
    });
    if (!res.ok) return;
    const { running } = (await res.json()) as { running?: string };
    if (running && running !== cli) {
      console.warn(
        `⚠ Version skew: the running dashboard is v${running}, but the installed CLI is v${cli}.\n` +
          "  Restart it to load the new version:  sailor ui stop && sailor ui start",
      );
    }
  } catch {
    /* dashboard unreachable or no /api/version (older server) — ignore */
  }
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
export async function uiCommand(opts: UiOptions = {}): Promise<void> {
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

  // F9 — opt-in tailnet HTTPS exposure. Resolve the tailnet origin BEFORE the
  // server starts so it can be added to the server's allowed CORS origins
  // (the dashboard is served from https://<node>.ts.net and its API calls must
  // be accepted from that origin). The actual `tailscale serve` proxy is started
  // after the server is ready.
  let tailnetUrl: string | null = null;
  if (opts.expose) {
    if (opts.expose !== "tailscale") {
      throw new Error(`Unknown --expose mode "${opts.expose}". Supported: tailscale.`);
    }
    if (!tailscaleAvailable()) {
      throw new Error(
        "tailscale CLI not found. Install Tailscale and run `tailscale up`, " +
          "or start the dashboard without --expose to keep it local-only.",
      );
    }
    const dns = tailnetDnsName();
    if (!dns) {
      throw new Error(
        "Could not resolve this node's tailnet name. Is tailscale running and logged in? " +
          "Run `tailscale status` to check.",
      );
    }
    tailnetUrl = `https://${dns}`;
  }

  const existing = readState(projectRoot);
  if (existing && isAlive(existing.pid)) {
    console.log(`Sailor UI is already running (pid ${existing.pid}) at http://localhost:${existing.port}`);
    if (opts.expose) {
      console.log("To expose it on the tailnet, stop it first: sailor ui stop && sailor ui start --expose tailscale");
    }
    await warnIfVersionSkew(existing.port);
    return;
  }

  // Capture the detached child's output to a log file so a real startup error
  // surfaces (with stdio:"ignore" it vanished, leaving only a misleading
  // "exited immediately" message).
  const runtimeDir = path.join(projectRoot, ".sail", "runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const logFile = path.join(runtimeDir, "ui.log");
  const logFd = fs.openSync(logFile, "a");

  // Allow the tailnet origin through CORS (F8 plumbing), merged with any the
  // operator already set, so the exposed dashboard's API calls are accepted.
  const corsOrigins = [process.env.SAILOR_CORS_ORIGINS, tailnetUrl].filter(Boolean).join(",");

  const child = spawn(process.execPath, [serverBundle], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      SAIL_DIR: sailDir,
      SERVE_DIST: "1",
      PORT: String(port),
      SAILOR_UI_DIST: uiDistDir,
      ...(corsOrigins ? { SAILOR_CORS_ORIGINS: corsOrigins } : {}),
    },
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

  // Start the tailnet proxy now the server is listening. Best-effort: if it
  // fails, keep the local server running and surface why.
  let exposed = false;
  if (tailnetUrl) {
    try {
      tailscaleServeUp(port);
      exposed = true;
    } catch (err) {
      console.warn(
        `⚠ Could not expose on the tailnet: ${(err as Error).message}\n` +
          "  The dashboard is still running locally.",
      );
    }
  }

  fs.writeFileSync(
    path.join(projectRoot, UI_STATE_FILE),
    JSON.stringify({ pid: child.pid, port, startedAt: new Date().toISOString(), exposed }, null, 2),
  );

  console.log(`Sailor UI started at http://localhost:${port}  (pid ${child.pid})`);
  if (exposed) console.log(`Exposed on your tailnet at ${tailnetUrl}/`);
  console.log(`Stop it with: sailor ui stop`);
}

export async function uiStatus(): Promise<void> {
  const state = readState(process.cwd());
  if (state && isAlive(state.pid)) {
    console.log(`● running  http://localhost:${state.port}  (pid ${state.pid})`);
    await warnIfVersionSkew(state.port);
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
  if (state.exposed) {
    tailscaleServeDown();
    console.log("Tailnet exposure removed.");
  }
  fs.rmSync(path.join(projectRoot, UI_STATE_FILE), { force: true });
  console.log(`Stopped Sailor UI (pid ${state.pid}).`);
}
