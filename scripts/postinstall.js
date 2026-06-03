// @ts-check
/**
 * Post-install script for the Sailor package.
 *
 * Runs automatically after `npm install` / `pnpm add`.  Orchestrates:
 *   1. sailor init      — scaffold the .sail/ workspace (skipped if already done)
 *   2. sailor station   — start the signing daemon in background
 *   3. sailor ui        — start the dashboard server in background
 *   4. browser launch   — open the dashboard so the user hits the onboarding flow
 *
 * Every step is logged in a structured way so an automated agent can parse the
 * output and know exactly which services are up, which failed, and where to send
 * the user next.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const os = require("node:os");
const { execFileSync, spawn } = require("node:child_process");

// Directory where the user ran `npm install` / `pnpm add`
const initCwd = process.env.INIT_CWD || process.cwd();
const TAG = "[sailor]";

// ── Skip conditions ──────────────────────────────────────────────────────────

// Never run inside the Sailor monorepo itself
if (fs.existsSync(path.join(initCwd, "pnpm-workspace.yaml"))) process.exit(0);

// Opt-out env var
if (process.env.SAILOR_SKIP_INIT === "1") process.exit(0);

const cliBundle = path.join(__dirname, "..", "packages", "cli", "dist", "index.cjs");

if (!fs.existsSync(cliBundle)) {
  console.warn(`${TAG} CLI bundle not found — skipping postinstall.`);
  process.exit(0);
}

// ── Logging helpers ──────────────────────────────────────────────────────────

function log(msg) { console.log(`${TAG} ${msg}`); }
function ok(msg)  { console.log(`${TAG} ✓ ${msg}`); }
function fail(msg){ console.error(`${TAG} ✗ ${msg}`); }
function sep(label) {
  console.log(`${TAG} ${"─".repeat(52)}`);
  if (label) console.log(`${TAG}  ${label}`);
}

// ── Utilities ────────────────────────────────────────────────────────────────

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Repeatedly calls fn() until it returns a non-null value or the timeout expires. */
function poll(fn, { timeout = 12_000, interval = 600 } = {}) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeout;
    function attempt() {
      Promise.resolve(fn()).then((result) => {
        if (result != null) { resolve(result); return; }
        if (Date.now() >= deadline) { resolve(null); return; }
        setTimeout(attempt, interval);
      });
    }
    attempt();
  });
}

/** Returns true if any HTTP response arrives from url (any status = server is up). */
function httpPing(url) {
  return new Promise((resolve) => {
    try {
      const req = http.get(url, { timeout: 2500 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
    } catch { resolve(false); }
  });
}

/** Open the user's default browser (best-effort, non-fatal). */
function openBrowser(url) {
  try {
    const platform = os.platform();
    if (platform === "darwin") {
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    } else if (platform === "win32") {
      // `start ""` avoids treating the URL as a window title
      spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
    } else {
      spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
    }
  } catch { /* best-effort */ }
}

// ── Shared status object (machine-readable summary at the end) ───────────────

const status = {
  init:    { state: "skipped",     detail: "" },
  station: { state: "not-started", detail: "" },
  ui:      { state: "not-started", detail: "" },
  uiUrl:   /** @type {string|null} */ (null),
  errors:  /** @type {string[]} */ ([]),
};

// ── Step 1: init ─────────────────────────────────────────────────────────────

async function step1Init() {
  sep("Step 1 — init");

  const configExists = fs.existsSync(path.join(initCwd, ".sail", "config.json"));

  if (configExists) {
    ok("Project already initialized — skipping init.");
    status.init = { state: "already-initialized", detail: path.join(initCwd, ".sail", "config.json") };
    return true;
  }

  log("Running sailor init…");
  try {
    execFileSync(process.execPath, [cliBundle, "init"], {
      cwd: initCwd,
      stdio: "inherit",
    });
    ok("Init complete.");
    status.init = { state: "ok", detail: "" };
    return true;
  } catch (err) {
    fail("sailor init exited with an error. Run `sailor init` manually to complete setup.");
    const msg = err instanceof Error ? err.message : String(err);
    status.init = { state: "error", detail: msg };
    status.errors.push(`init: ${msg}`);
    return false;
  }
}

// ── Step 2: signing station ───────────────────────────────────────────────────

async function step2Station() {
  sep("Step 2 — signing station");

  const stateFile = path.join(initCwd, ".sail", "runtime", "server.json");
  const existing = readJson(stateFile);

  // Already running?
  if (existing && existing.pid && isAlive(existing.pid)) {
    ok(`Station already running at ${existing.url}  (pid ${existing.pid})`);
    status.station = { state: "already-running", detail: existing.url };
    return;
  }

  // Remove stale state file if present
  if (existing) {
    try { fs.rmSync(stateFile, { force: true }); } catch { /* ignore */ }
  }

  log("Starting signing station in background…");

  // station start blocks (keeps the process alive), so we must spawn it detached.
  const child = spawn(process.execPath, [cliBundle, "station", "start"], {
    cwd: initCwd,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // Poll until the state file appears and /config responds
  const state = await poll(async () => {
    const s = readJson(stateFile);
    if (!s || !s.url || !s.pid) return null;
    if (!isAlive(s.pid)) return null;
    const up = await httpPing(`${s.url}/config`);
    return up ? s : null;
  }, { timeout: 15_000 });

  if (state) {
    ok(`Station running at ${state.url}  (pid ${state.pid})`);
    status.station = { state: "running", detail: state.url };
  } else {
    fail("Station did not come up within 15 s.");
    fail("Start it manually with: sailor station start");
    status.station = { state: "error", detail: "timed out" };
    status.errors.push("station: timed out waiting for /config to respond");
  }
}

// ── Step 3: dashboard UI ──────────────────────────────────────────────────────

async function step3Ui() {
  sep("Step 3 — dashboard UI");

  const stateFile = path.join(initCwd, ".sail", "runtime", "ui.json");
  const existing = readJson(stateFile);

  // Already running?
  if (existing && existing.pid && isAlive(existing.pid)) {
    const url = `http://localhost:${existing.port}`;
    ok(`UI already running at ${url}  (pid ${existing.pid})`);
    status.ui = { state: "already-running", detail: url };
    status.uiUrl = url;
    return;
  }

  // Remove stale state file if present
  if (existing) {
    try { fs.rmSync(stateFile, { force: true }); } catch { /* ignore */ }
  }

  log("Starting Sailor UI in background…");

  // uiCommand() spawns the server process itself and returns quickly (~300 ms).
  try {
    execFileSync(process.execPath, [cliBundle, "ui"], {
      cwd: initCwd,
      stdio: "pipe", // suppress duplicate "Sailor UI started" output; we log our own
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`UI start failed: ${msg}`);
    status.ui = { state: "error", detail: msg };
    status.errors.push(`ui: ${msg}`);
    return;
  }

  // uiCommand writes the state file before returning; read it immediately.
  const state = readJson(stateFile);
  if (!state || !state.port) {
    fail("UI state file missing after start. Run `sailor ui` manually.");
    status.ui = { state: "error", detail: "state file missing" };
    status.errors.push("ui: .sail/runtime/ui.json not written after start");
    return;
  }

  const url = `http://localhost:${state.port}`;

  // Wait until the server is actually serving (it may need a moment to bind).
  const up = await poll(() => httpPing(url), { timeout: 10_000, interval: 500 });

  if (up) {
    ok(`UI running at ${url}  (pid ${state.pid})`);
    status.ui = { state: "running", detail: url };
    status.uiUrl = url;
  } else {
    fail(`UI process started (pid ${state.pid}) but not responding at ${url}.`);
    fail("Run `sailor ui status` to check.");
    status.ui = { state: "degraded", detail: url };
    status.uiUrl = url; // still try to open the browser — maybe it comes up in time
    status.errors.push(`ui: process alive but HTTP not responding at ${url}`);
  }
}

// ── Step 4: open browser ──────────────────────────────────────────────────────

async function step4Browser() {
  if (!status.uiUrl) return;
  sep("Step 4 — opening browser");
  log(`Opening ${status.uiUrl} …`);
  openBrowser(status.uiUrl);
}

// ── Final summary ─────────────────────────────────────────────────────────────

function printSummary() {
  const icon = (s) =>
    ({ ok: "✓", "already-initialized": "✓", "already-running": "✓", running: "✓",
       skipped: "–", error: "✗", degraded: "⚠", "not-started": "–" })[s] ?? "?";

  sep("SAILOR SETUP — STATUS SUMMARY");
  log(`  init:    ${icon(status.init.state)}  ${status.init.state}${status.init.detail ? "  (" + status.init.detail + ")" : ""}`);
  log(`  station: ${icon(status.station.state)}  ${status.station.detail || status.station.state}`);
  log(`  ui:      ${icon(status.ui.state)}  ${status.ui.detail || status.ui.state}`);

  if (status.errors.length) {
    log("");
    log("  Errors encountered:");
    status.errors.forEach((e) => log(`    • ${e}`));
  }

  sep();

  if (status.uiUrl) {
    log(`  → Onboarding: ${status.uiUrl}`);
    log(`    Open the URL above to connect your wallet and complete setup.`);
  } else {
    log(`  → Run \`sailor ui\` to start the dashboard.`);
    log(`  → Run \`sailor station start\` to start the signing daemon.`);
    log(`  → Then open the dashboard URL to complete onboarding.`);
  }

  sep();
  printAgentInstructions();
}

function printAgentInstructions() {
  const uiUrl = status.uiUrl ?? "<sailor ui URL — run `sailor ui` to get it>";
  const L = (msg = "") => console.log(`${TAG} ${msg}`);

  L("╔══════════════════════════════════════════════════════╗");
  L("║              IF YOU ARE AN AI AGENT                 ║");
  L("╚══════════════════════════════════════════════════════╝");
  L();
  L("  Sailor has been installed and its services are running.");
  L("  Your job now is to guide the USER through onboarding.");
  L();
  L("  ── Step 1: ask the user these questions ────────────────");
  L();
  L("  1. Which network do you want to deploy your SMA on?");
  L("     (e.g. Base, Arbitrum One, Ethereum mainnet, …)");
  L();
  L("  2. Do you have an RPC URL for that network?");
  L("     If not, suggest a free provider: Alchemy, Infura, Ankr.");
  L("     Once they have it: write it to .sail/.env.local as RPC_URL=<url>");
  L();
  L("  3. Do you have a funded wallet (MetaMask or similar)?");
  L("     They will need gas on the chosen network to deploy the SMA.");
  L();
  L("  ── Step 2: send the user to the browser ────────────────");
  L();
  L(`  Dashboard: ${uiUrl}`);
  L();
  L("  Tell them to open the URL and complete these 3 browser steps:");
  L("    a. Connect their wallet");
  L("    b. Deploy their SMA  (requires gas on the chosen network)");
  L("    c. Create the agent wallet");
  L();
  L("  The signing station is running — browser requests will be");
  L("  routed through it automatically.");
  L();
  L("  ── Step 3: once browser steps are done ─────────────────");
  L();
  L("  Ask the user to describe their strategy (what the agent");
  L("  should do, with what limits). Then:");
  L("    • Build the mandate contract:  sailor mandate deploy …");
  L("    • Verify everything is healthy: sailor doctor");
  L("    • Set up automation (local or GitHub Actions)");
  L();
  L("  Run `sailor capabilities` for a full list of what this");
  L("  kernel version supports (no wallet, no gas needed).");
  L();
  L("══════════════════════════════════════════════════════════");
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  await step1Init();

  // Start station and UI concurrently — they are independent of each other.
  // Station is discovered by the UI at runtime via .sail/runtime/server.json.
  // We attempt both even if init failed, in case the project was partially set up.
  await Promise.all([step2Station(), step3Ui()]);

  await step4Browser();
  printSummary();
})();
