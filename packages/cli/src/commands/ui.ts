import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { ANVIL_MISSING_MESSAGE, getSandboxForks, resetSandbox, sandboxDirFor } from "@sail/sandbox";
import { cliDistDir, packageRoot, projectPort } from "../lib/packagePaths.js";
import { anvilOnPath, findFreePort, isProcessAlive } from "../lib/process.js";
import {
  tailnetDnsName,
  tailscaleAvailable,
  tailscaleServeDown,
  tailscaleServeUp,
} from "../lib/tailscale.js";

type UiMode = "live" | "sandbox";

type UiState = {
  pid: number;
  port: number;
  startedAt: string;
  /** Set when the dashboard was exposed over the tailnet (F9) so `stop` can tear it down. */
  exposed?: boolean;
};

export interface UiOptions {
  /** `tailscale` to proxy the dashboard onto the tailnet over HTTPS (F9). Live mode only. */
  expose?: string;
}

/**
 * The live dashboard and the sandbox both run this same bundled server, just
 * pointed at different roots and ports — never the same process. These four
 * helpers are the only mode-specific plumbing; everything else in this file
 * (spawn, readiness wait, version-skew check) is shared.
 */
function uiStateRelPath(mode: UiMode): string {
  return mode === "sandbox" ? path.join(".shipyard", "sandbox", "runtime", "ui.json") : path.join(".sail", "runtime", "ui.json");
}

function sailDirFor(projectRoot: string, mode: UiMode): string {
  return mode === "sandbox" ? sandboxDirFor(projectRoot) : path.join(projectRoot, ".sail");
}

function portSeedFor(projectRoot: string, mode: UiMode): string {
  // A distinct seed for sandbox mode so its deterministic port differs from
  // the live dashboard's for the same project — the two run concurrently.
  return mode === "sandbox" ? `${projectRoot}:sandbox` : projectRoot;
}

function labelFor(mode: UiMode): string {
  return mode === "sandbox" ? "Sailor Sandbox" : "Sailor UI";
}

/**
 * Sandbox-only preflight: refuse before anything is spawned when Foundry is
 * missing.
 *
 * `startFork` already raises the same error, but it runs inside the UI *server*
 * process behind `POST /api/sandbox/forks` — so without this the terminal
 * prints "Sailor Sandbox running" and the user only learns Foundry is missing
 * when the browser reports a fork failure seconds later. Live `sailor ui` never
 * forks anything, so it must stay unaffected: Foundry is not a requirement for
 * normal Sailor use.
 */
export function assertSandboxPrerequisites(
  mode: UiMode,
  hasAnvil: () => boolean = anvilOnPath,
): void {
  if (mode !== "sandbox") return;
  if (!hasAnvil()) throw new Error(ANVIL_MISSING_MESSAGE);
}

function readState(projectRoot: string, mode: UiMode): UiState | null {
  const file = path.join(projectRoot, uiStateRelPath(mode));
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")) as UiState; } catch { return null; }
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
 * Shared implementation behind `sailor ui start` and the Sandbox onboarding
 * path's on-demand server. `mode` picks the root (`.sail/` vs
 * `.shipyard/sandbox/`), the port seed, and the runtime state file — nothing
 * else differs, and in particular there is no branch here that reads or
 * writes the *other* mode's directory.
 *
 * Path layout (works in both the monorepo and an installed npm package):
 *   packages/cli/dist/index.cjs   ← this bundle
 *   packages/cli/dist/server.cjs  ← bundled UI server
 *   packages/ui/dist/             ← pre-built static UI assets
 */
async function runUiCommand(opts: UiOptions, mode: UiMode): Promise<void> {
  const distDir = cliDistDir();
  const uiDistDir = path.join(packageRoot(), "packages", "ui", "dist");
  const serverBundle = path.resolve(distDir, "server.cjs");
  const projectRoot = process.cwd();

  // Foundry has to be here before we promise the user a sandbox — see
  // assertSandboxPrerequisites. No-op for live mode.
  assertSandboxPrerequisites(mode);

  // The native sandbox spins up its own anvil fork(s) on the same deterministic
  // ports an external harness tool (e.g. Shipyard) may already be managing for
  // this exact project — two independent fork-lifecycle owners racing the same
  // port. `.sail/sim-forks.json` is written only by that kind of external wrap
  // step, never by anything in this package, so its presence is an unambiguous
  // signal this project already has a fork story the sandbox would shadow
  // rather than replace. Refuse rather than add a second, confusing UI surface.
  if (mode === "sandbox" && !process.env.SAILOR_ALLOW_SANDBOX_WITH_WRAP) {
    const wrapMarker = path.join(projectRoot, ".sail", "sim-forks.json");
    if (fs.existsSync(wrapMarker)) {
      throw new Error(
        "This project is already wired to an externally-managed fork (.sail/sim-forks.json present). " +
          "Starting the native sandbox here would spin up a second, independent anvil fork manager " +
          "that can collide with the existing one and leave two overlapping dashboard UIs for the same " +
          "project. Use that tool's own dashboard/proxy command instead of `sailor sandbox start`. " +
          "If you really need the native sandbox anyway, set SAILOR_ALLOW_SANDBOX_WITH_WRAP=1.",
      );
    }
  }

  const sailDir = sailDirFor(projectRoot, mode);
  const label = labelFor(mode);
  const envPort = Number(process.env.PORT);
  const port = await findFreePort(Number.isInteger(envPort) && envPort > 0 && envPort <= 65535 ? envPort : projectPort(portSeedFor(projectRoot, mode)));

  if (!fs.existsSync(serverBundle)) {
    throw new Error(`Server bundle not found at ${serverBundle}. Re-run the sailor build.`);
  }
  if (!fs.existsSync(path.join(uiDistDir, "index.html"))) {
    throw new Error(`UI dist not found at ${uiDistDir}. Re-run the sailor build.`);
  }

  // F9 — opt-in tailnet HTTPS exposure (live dashboard only; not offered for
  // the sandbox command). Resolve the tailnet origin BEFORE the server starts
  // so it can be added to the server's allowed CORS origins.
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

  const existing = readState(projectRoot, mode);
  if (existing && isProcessAlive(existing.pid)) {
    console.log(`${label} is already running (pid ${existing.pid}) at http://localhost:${existing.port}`);
    if (opts.expose) {
      console.log("To expose it on the tailnet, stop it first: sailor ui stop && sailor ui start --expose tailscale");
    }
    await warnIfVersionSkew(existing.port);
    return;
  }

  // Capture the detached child's output to a log file so a real startup error
  // surfaces (with stdio:"ignore" it vanished, leaving only a misleading
  // "exited immediately" message).
  const runtimeDir = path.join(projectRoot, path.dirname(uiStateRelPath(mode)));
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
      ...(mode === "sandbox" ? { SAILOR_UI_MODE: "sandbox" } : {}),
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
    if (!isProcessAlive(child.pid!)) break;
    if (await waitForPort(port, 500)) { ready = true; break; }
  }
  if (!ready) {
    let tail = "";
    try { tail = fs.readFileSync(logFile, "utf-8").split("\n").filter(Boolean).slice(-15).join("\n"); } catch { /* no log */ }
    throw new Error(
      `${label} failed to start within ${READY_TIMEOUT_MS / 1000}s on port ${port}.` +
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
    path.join(projectRoot, uiStateRelPath(mode)),
    JSON.stringify({ pid: child.pid, port, startedAt: new Date().toISOString(), exposed }, null, 2),
  );

  console.log(`${label} started at http://localhost:${port}  (pid ${child.pid})`);
  if (exposed) console.log(`Exposed on your tailnet at ${tailnetUrl}/`);
  console.log(mode === "sandbox" ? "Stop it with: sailor sandbox stop" : "Stop it with: sailor ui stop");
}

function runUiStatus(mode: UiMode): Promise<void> {
  return (async () => {
    const projectRoot = process.cwd();
    const state = readState(projectRoot, mode);
    if (state && isProcessAlive(state.pid)) {
      console.log(`● running  http://localhost:${state.port}  (pid ${state.pid})`);
      await warnIfVersionSkew(state.port);
    } else {
      if (state) fs.rmSync(path.join(projectRoot, uiStateRelPath(mode)), { force: true });
      console.log(`○ ${labelFor(mode)} is not running`);
    }
  })();
}

function runUiStop(mode: UiMode): void {
  const projectRoot = process.cwd();
  const state = readState(projectRoot, mode);
  const label = labelFor(mode);
  if (!state) {
    console.log(`${label} is not running.`);
    return;
  }
  if (!isProcessAlive(state.pid)) {
    fs.rmSync(path.join(projectRoot, uiStateRelPath(mode)), { force: true });
    console.log(`${label} is not running (stale state file removed).`);
    return;
  }
  process.kill(state.pid, "SIGTERM");
  if (state.exposed) {
    tailscaleServeDown();
    console.log("Tailnet exposure removed.");
  }
  fs.rmSync(path.join(projectRoot, uiStateRelPath(mode)), { force: true });
  console.log(`Stopped ${label} (pid ${state.pid}).`);
}

// ── Live dashboard (`sailor ui ...`) ────────────────────────────────────────

export function uiCommand(opts: UiOptions = {}): Promise<void> {
  return runUiCommand(opts, "live");
}

export function uiStatus(): Promise<void> {
  return runUiStatus("live");
}

export function uiStop(): void {
  runUiStop("live");
}

// ── Sandbox dashboard (`sailor sandbox ...`) ────────────────────────────────
// Same server bundle, same spawn/readiness logic, pointed at
// `.shipyard/sandbox/` instead of `.sail/` and running on its own port — a
// second, independent process, never the live one with a flag flipped.

export function sandboxUiCommand(): Promise<void> {
  return runUiCommand({}, "sandbox");
}

export function sandboxUiStatus(): Promise<void> {
  return runUiStatus("sandbox");
}

export interface SandboxStopOptions {
  /** Leave the anvil forks running (previous default). Without it, stop dumps
   *  each fork's chain state and shuts the forks down too. */
  keepForks?: boolean;
}

/**
 * `sailor sandbox stop` — stops the dashboard server *and* (by default) the
 * sandbox's anvil forks, dumping each fork's chain state to disk first so the
 * next `sailor sandbox start` resumes the same world (deployed SMA, signed
 * mandates, balances) instead of forking fresh from upstream. Previously this
 * only killed the server: the forks lingered detached with their state held
 * in memory only, so any reboot or crash lost the whole session.
 */
export async function sandboxUiStop(opts: SandboxStopOptions = {}): Promise<void> {
  runUiStop("sandbox");
  if (opts.keepForks) return;

  const sandboxDir = sandboxDirFor(process.cwd());
  const forks = getSandboxForks(sandboxDir);
  if (!Object.keys(forks).length) return;

  console.log("Stopping sandbox forks (saving chain state)…");
  await resetSandbox(sandboxDir);
  console.log("Sandbox forks stopped. Chain state saved. `sailor sandbox start` will resume this session.");
}
