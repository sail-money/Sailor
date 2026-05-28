/**
 * sailor station — manage the persistent signing daemon.
 *
 * The signing station is a local HTTP + WebSocket server bridging the agent
 * (CLI) and the browser signing UI. Running it once as a daemon (rather than
 * letting each command spawn its own) lets an agent start it, have the owner
 * connect their wallet once, then drive a whole sequence of commands that push
 * signing events to the same open browser tab.
 *
 *   sailor station start    # start the daemon (blocks; run in the background)
 *   sailor station status   # is a daemon running for this project?
 *   sailor station stop     # stop the running daemon
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { emit } from "../lib/output.js";
import { ProjectContext } from "../lib/project.js";
import { discoverDaemon } from "../signing/client.js";
import { SigningServer } from "../signing/server.js";

const RUNTIME_SERVER_FILE = join(".sail", "runtime", "server.json");

type RuntimeServerState = { url?: string; port?: number; pid?: number; startedAt?: string };

function readState(projectRoot: string): RuntimeServerState | null {
  const file = join(projectRoot, RUNTIME_SERVER_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as RuntimeServerState;
  } catch {
    return null;
  }
}

export async function stationStart(options: { json?: boolean }): Promise<void> {
  const projectRoot = process.cwd();
  if (!ProjectContext.exists()) {
    emit(options.json, () => console.log('No Sailor project found. Run "sailor init" first.'), {
      status: "error",
      error: "no-project",
    });
    process.exit(1);
  }

  // Idempotent: if a reachable daemon already exists, report and exit 0.
  const existing = await discoverDaemon(projectRoot);
  if (existing) {
    const state = readState(projectRoot);
    emit(
      options.json,
      () => {
        console.log("A signing station is already running for this project.");
        console.log(`  ${existing.url}`);
      },
      { status: "already-running", url: existing.url, ...state },
    );
    return;
  }

  const server = new SigningServer({ projectRoot });
  await server.start();

  emit(
    options.json,
    () => {
      console.log("✓ Signing station started");
      console.log("→ Open in your browser and connect your wallet:");
      console.log(`  ${server.url}`);
      console.log("\nLeave this running. Other `sailor` commands will use it.");
      console.log("Stop it with: sailor station stop");
    },
    { status: "running", url: server.url, pid: process.pid },
  );

  // The listening socket keeps the process alive; SigningServer installs
  // SIGINT/SIGTERM handlers that stop it and clean up .sail/runtime/server.json.
}

export async function stationStatus(options: { json?: boolean }): Promise<void> {
  const projectRoot = process.cwd();
  const daemon = await discoverDaemon(projectRoot);
  const state = readState(projectRoot);

  if (daemon) {
    emit(
      options.json,
      () => {
        console.log("● running", daemon.url);
        if (state?.pid) console.log(`  pid ${state.pid}`);
      },
      { status: "running", url: daemon.url, ...state },
    );
  } else {
    emit(options.json, () => console.log("○ no signing station running for this project"), {
      status: "stopped",
    });
  }
}

export async function stationStop(options: { json?: boolean }): Promise<void> {
  const projectRoot = process.cwd();
  const state = readState(projectRoot);
  if (!state?.pid) {
    emit(options.json, () => console.log("No signing station appears to be running."), {
      status: "stopped",
    });
    return;
  }

  // Verify the daemon is actually reachable at the recorded URL before
  // sending SIGTERM — prevents sending signals to unrelated processes if
  // server.json is stale or was corrupted.
  const daemon = await discoverDaemon(projectRoot);
  if (!daemon) {
    const file = join(projectRoot, RUNTIME_SERVER_FILE);
    try {
      if (existsSync(file)) rmSync(file);
    } catch {
      /* ignore */
    }
    emit(options.json, () => console.log("Station process not found; cleared stale state."), {
      status: "stopped",
      note: "process-not-found",
    });
    return;
  }

  try {
    process.kill(state.pid, "SIGTERM");
    emit(options.json, () => console.log(`✓ Stopped signing station (pid ${state.pid})`), {
      status: "stopped",
      pid: state.pid,
    });
  } catch {
    const file = join(projectRoot, RUNTIME_SERVER_FILE);
    try {
      if (existsSync(file)) rmSync(file);
    } catch {
      /* ignore */
    }
    emit(options.json, () => console.log("Station process not found; cleared stale state."), {
      status: "stopped",
      note: "process-not-found",
    });
  }
}
