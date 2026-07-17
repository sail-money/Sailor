/**
 * Native anvil fork engine for Sailor's Sandbox onboarding path.
 *
 * Ported from Shipyard's `src/lib/sim.ts` (the external harness's fork
 * manager) so a real end user can spin up a local sandbox without installing
 * a separate tool. Two deliberate differences from the Shipyard original:
 *
 * - Every function is scoped to a `sandboxDir` the caller passes in (the
 *   project's `.shipyard/sandbox/` directory) rather than a shared workspace
 *   pool — one project's sandbox never touches another's.
 * - State snapshot/restore goes through viem's anvil test-client actions
 *   (`snapshot`/`revert`/`dumpState`/`loadState`) instead of shelling out to
 *   the `cast` binary — `anvil` itself is the only external tool required.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createTestClient, http, type Hex } from "viem";

export type Chain = "base-sepolia" | "base" | "arbitrum" | "unichain" | "ethereum" | "sepolia";

export const CHAIN_IDS: Record<Chain, number> = {
  "base-sepolia": 84532,
  base: 8453,
  arbitrum: 42161,
  unichain: 130,
  ethereum: 1,
  sepolia: 11155111,
};

// Deterministic, non-colliding default port per chain so up to MAX_SANDBOX_CHAINS
// forks can run at once for the same project.
export const CHAIN_PORTS: Record<Chain, number> = {
  "base-sepolia": 18545,
  base: 18546,
  arbitrum: 18547,
  unichain: 18548,
  ethereum: 18549,
  sepolia: 18550,
};

/** Hard cap on how many chains one sandbox session may fork at once — keeps
 *  resource usage (anvil processes, forked-RPC load) bounded and the
 *  onboarding chain picker simple. Enforced in `startSandboxForks`, not left
 *  to callers to remember. */
export const MAX_SANDBOX_CHAINS = 3;

export class TooManySandboxChainsError extends Error {
  constructor(requested: number) {
    super(`Sandbox mode supports at most ${MAX_SANDBOX_CHAINS} chains at once (got ${requested}).`);
    this.name = "TooManySandboxChainsError";
  }
}

export type ForkState = {
  chain: Chain;
  chainId: number;
  port: number;
  rpcUrl: string;
  pid?: number;
  stateFile?: string;
  logFile?: string;
  startedAt?: string;
  ready?: boolean;
  status?: "ready" | "spawning" | "failed" | "stopped";
  error?: string;
  /** True when this fork's port was already answering for the right chain at
   *  startup — we didn't spawn anything and don't own the process (so
   *  `stopFork` has nothing to kill; whoever started it owns its lifecycle). */
  adopted?: boolean;
};

function anvilLogPath(sandboxDir: string, chain: Chain): string {
  return join(sandboxDir, `anvil-${chain}.log`);
}

/** Exported so callers that stop/restart a fork after the fact (the sandbox
 *  UI's per-chain controls) can locate its dump-state file without having to
 *  thread it through the manifest. */
export function anvilStateFilePath(sandboxDir: string, chain: Chain): string {
  return join(sandboxDir, `anvil-state-${chain}.json`);
}

/**
 * Poll the RPC until it answers eth_chainId with the expected id, or timeout.
 * A cold fork routinely needs more than a fixed sleep to accept connections.
 * Uses raw fetch (no external binary) to keep the only outside dependency
 * being the `anvil` process itself.
 */
export async function waitForRpc(rpcUrl: string, expectedChainId: number, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      const j: any = await r.json();
      if (j?.result && parseInt(j.result, 16) === expectedChainId) return true;
    } catch {
      /* not accepting connections yet */
    }
    await sleep(300);
  }
  return false;
}

/**
 * Point the sandbox's own `.env.local` (under `sandboxDir`) at a fork's RPC —
 * the same generic `RPC_URL`/`CHAIN_ID` contract the rest of the Sailor stack
 * already reads, just rooted at the sandbox directory instead of `.sail/`.
 */
export function ensureLocalRpc(sandboxDir: string, chainId: number, rpcUrl: string): void {
  const envPath = join(sandboxDir, ".env.local");
  let content = "";
  if (existsSync(envPath)) content = readFileSync(envPath, "utf8");

  const lines = content.split("\n").filter((l) => l.trim());
  const withoutRpc = lines.filter((l) => !l.startsWith("RPC_URL="));
  const withoutChain = withoutRpc.filter((l) => !l.startsWith("CHAIN_ID="));
  const newContent = [`RPC_URL=${rpcUrl}`, `CHAIN_ID=${chainId}`, ...withoutChain].join("\n") + "\n";

  mkdirSync(sandboxDir, { recursive: true });
  writeFileSync(envPath, newContent);
}

/**
 * Record a fork's RPC under its own `RPC_URL_<chainId>` key — the per-chain
 * convention the dashboard's RPCs page (and `/api/onboard/state`) actually
 * reads. Called for *every* forked chain, not just the primary: unlike
 * `ensureLocalRpc` (one generic RPC_URL/CHAIN_ID pair, so it can only ever
 * describe one "active" chain), this is additive across chains, so a
 * multi-chain sandbox session shows every fork as connected, not just
 * whichever chain happened to be primary.
 */
export function ensurePerChainRpc(sandboxDir: string, chainId: number, rpcUrl: string): void {
  const envPath = join(sandboxDir, ".env.local");
  let content = "";
  if (existsSync(envPath)) content = readFileSync(envPath, "utf8");

  const key = `RPC_URL_${chainId}=`;
  const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith(key));
  lines.push(`${key}${rpcUrl}`);

  mkdirSync(sandboxDir, { recursive: true });
  writeFileSync(envPath, lines.join("\n") + "\n");
}

/**
 * Single-shot check for whether something is already answering on a port —
 * used before spawning so a fork that's already up (started by an earlier
 * onboarding step, or another tool sharing the same deterministic port) gets
 * adopted instead of racing a second `anvil` against the same port. Returns
 * the chain id it reports, or null if nothing answered in time.
 *
 * Exported so callers can re-check an *adopted* fork's liveness later — an
 * adopted entry has no pid of ours to poll, so this RPC probe is the only
 * way to tell "still shared with something else" apart from "that something
 * else is gone now, safe to take over."
 */
export async function probePort(rpcUrl: string, timeoutMs = 800): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const r = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const j: any = await r.json();
    return j?.result ? parseInt(j.result, 16) : null;
  } catch {
    return null;
  }
}

const UPSTREAM_ENV_CANDIDATES: Record<Chain, string[]> = {
  "base-sepolia": ["BASE_SEPOLIA_RPC_URL"],
  base: ["BASE_RPC_URL", "BASE_MAINNET_RPC_URL"],
  arbitrum: ["ARBITRUM_RPC_URL", "ARBITRUM_MAINNET_RPC_URL"],
  unichain: ["UNICHAIN_RPC_URL", "UNICHAIN_MAINNET_RPC_URL"],
  ethereum: ["ETHEREUM_RPC_URL", "ETH_MAINNET_RPC_URL", "ETH_RPC_URL"],
  sepolia: ["SEPOLIA_RPC_URL"],
};

const PUBLIC_UPSTREAM_FALLBACKS: Record<Chain, string> = {
  "base-sepolia": "https://sepolia.base.org",
  base: "https://mainnet.base.org",
  arbitrum: "https://arb1.arbitrum.io/rpc",
  unichain: "https://mainnet.unichain.org",
  ethereum: "https://eth-mainnet.public.blastapi.io",
  sepolia: "https://eth-sepolia.public.blastapi.io",
};

function resolveUpstreamRpc(chain: Chain): { url: string; warning?: string } {
  const names = UPSTREAM_ENV_CANDIDATES[chain];
  const matched = names.find((n) => process.env[n]);
  if (matched) return { url: process.env[matched]! };
  return {
    url: PUBLIC_UPSTREAM_FALLBACKS[chain],
    warning:
      `No ${names.join(" / ")} set — forking ${chain} against a public, rate-limited RPC. ` +
      `Set one of those env vars for a faster, more reliable sandbox.`,
  };
}

/**
 * Start an anvil fork for one chain, detached so it survives this process.
 */
export async function startFork(opts: {
  sandboxDir: string;
  chain: Chain;
  port?: number;
  forkBlock?: number;
  loadStateFile?: string;
  /** Point the sandbox's own `.env.local` at this fork. Default true; pass
   *  false for secondary chains so only the primary chain becomes "active". */
  repoint?: boolean;
}): Promise<ForkState> {
  const { sandboxDir, chain, loadStateFile } = opts;
  const chainId = CHAIN_IDS[chain];
  const port = opts.port ?? CHAIN_PORTS[chain];
  const rpcUrl = `http://127.0.0.1:${port}`;

  // Someone (an earlier onboarding step, or another tool sharing this
  // deterministic port) may already be listening. Adopt a matching chain
  // instead of racing a second anvil against the same port — a losing race
  // there would previously have recorded the loser's (immediately-dead) pid
  // as if it owned a "ready" fork.
  const existingChainId = await probePort(rpcUrl);
  if (existingChainId != null) {
    if (existingChainId !== chainId) {
      throw new Error(
        `Port ${port} is already serving chain ${existingChainId}, not ${chain} (${chainId}). ` +
          `Free the port or pick a different chain — refusing to guess.`,
      );
    }
    const forkState: ForkState = {
      chain,
      chainId,
      port,
      rpcUrl,
      startedAt: new Date().toISOString(),
      ready: true,
      status: "ready",
      adopted: true,
    };
    if (opts.repoint !== false) ensureLocalRpc(sandboxDir, chainId, rpcUrl);
    ensurePerChainRpc(sandboxDir, chainId, rpcUrl);
    return forkState;
  }

  const upstream = resolveUpstreamRpc(chain);
  if (upstream.warning) console.warn(`⚠ ${upstream.warning}`);

  mkdirSync(sandboxDir, { recursive: true });
  const stateFile = loadStateFile || anvilStateFilePath(sandboxDir, chain);

  const args = [
    "--fork-url",
    upstream.url,
    "--port",
    String(port),
    "--chain-id",
    String(chainId),
    "--block-time",
    "1",
    "--host",
    "0.0.0.0",
    "--no-rate-limit",
  ];

  // Deliberately not `--load-state <file>`: that flag expects anvil's own
  // JSON state-file shape, not the raw hex string `dumpState()`/
  // `anvil_dumpState` returns (what `stopFork` actually writes here) — anvil
  // rejects it at boot ("expected struct SerializableState"), so the process
  // never comes up and every restart silently timed out. Loaded over RPC
  // instead, once the process is actually listening, via the same
  // `anvil_loadState` method `dumpState`/`loadState` are paired with.
  if (!loadStateFile && opts.forkBlock) {
    args.push("--fork-block-number", String(opts.forkBlock));
  }

  const logPath = anvilLogPath(sandboxDir, chain);
  const logFd = openSync(logPath, "a");
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn("anvil", args, { stdio: ["ignore", logFd, logFd], detached: true });
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      throw new Error(
        "anvil was not found on PATH. Sandbox mode requires Foundry (https://getfoundry.sh) — install it and try again.",
      );
    }
    throw e;
  }
  child.unref();

  const ready = await waitForRpc(rpcUrl, chainId, 25_000);

  if (ready && loadStateFile && existsSync(loadStateFile)) {
    try {
      const client = createTestClient({ mode: "anvil", transport: http(rpcUrl) });
      await client.loadState({ state: readFileSync(loadStateFile, "utf8") as Hex });
    } catch (e: any) {
      // Best-effort — the chain still comes up fresh from the fork-url; it
      // just won't have whatever local-only state (e.g. a deployed contract)
      // the dump held.
      console.warn(`⚠ Failed to load previous state for ${chain} from ${loadStateFile}: ${e?.message ?? e}`);
    }
  }

  const forkState: ForkState = {
    chain,
    chainId,
    port,
    rpcUrl,
    pid: child.pid,
    stateFile: existsSync(stateFile) ? stateFile : undefined,
    logFile: logPath,
    startedAt: new Date().toISOString(),
    ready,
    status: ready ? "ready" : "spawning",
    adopted: false,
  };

  if (opts.repoint !== false) ensureLocalRpc(sandboxDir, chainId, rpcUrl);
  ensurePerChainRpc(sandboxDir, chainId, rpcUrl);

  return forkState;
}

/** Stop a fork's anvil process, dumping its state first (via viem, not `cast`)
 *  so a later `startFork({ loadStateFile })` can resume the same world. */
export async function stopFork(fork: ForkState): Promise<void> {
  if (!fork.pid) return;

  if (fork.stateFile) {
    try {
      const client = createTestClient({ mode: "anvil", transport: http(fork.rpcUrl) });
      const state = await client.dumpState();
      writeFileSync(fork.stateFile, state);
    } catch {
      // non-fatal — resume just won't have durable state to load
    }
  }

  try {
    process.kill(fork.pid, "SIGTERM");
  } catch {
    // already dead
  }

  await sleep(300);
}

/** Is a process still running? The classic signal-0 liveness probe. */
export function isPidAlive(pid?: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Is the fork's anvil process actually still running? */
export function isForkAlive(fork: ForkState): boolean {
  return isPidAlive(fork.pid);
}

/** Fast in-process rewind point (viem `snapshot`/`revert` — anvil's evm_snapshot
 *  family). Not durable across a stop; pair with `stopFork`'s dumpState for that. */
export async function snapshotFork(fork: ForkState): Promise<Hex> {
  const client = createTestClient({ mode: "anvil", transport: http(fork.rpcUrl) });
  return client.snapshot();
}

/** Revert to a snapshot id. `evm_revert` consumes the id (and anything taken
 *  after it), so this immediately re-snapshots and returns the new id —
 *  callers should persist the returned id, not the one they passed in. */
export async function revertFork(fork: ForkState, snapshotId: Hex): Promise<Hex | null> {
  const client = createTestClient({ mode: "anvil", transport: http(fork.rpcUrl) });
  try {
    await client.revert({ id: snapshotId });
  } catch {
    return null;
  }
  try {
    return await client.snapshot();
  } catch {
    return snapshotId;
  }
}
