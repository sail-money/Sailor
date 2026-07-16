/**
 * Project-scoped orchestration: turn a chain-id selection from the onboarding
 * wizard into running forks + a manifest the UI can poll, all rooted at one
 * project's `.shipyard/sandbox/` directory.
 *
 * Deliberately does not depend on `@sail/sdk` — which chains are *offered* in
 * the picker (i.e. which have an actual Sail kernel deployment) is a product
 * concern the caller (the UI server) decides; this module only knows how to
 * fork whatever chain it's asked to, from the fixed set Shipyard's engine
 * already supports.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  CHAIN_IDS,
  MAX_SANDBOX_CHAINS,
  TooManySandboxChainsError,
  isPidAlive,
  startFork,
  stopFork,
  waitForRpc,
  type Chain,
  type ForkState,
} from "./fork.js";
import { readManifest, writeManifest, type ManifestEntry } from "./manifest.js";

export { MAX_SANDBOX_CHAINS, TooManySandboxChainsError, CHAIN_IDS };
export type { Chain, ManifestEntry };

export function sandboxDirFor(projectRoot: string): string {
  return join(projectRoot, ".shipyard", "sandbox");
}

const CHAIN_ID_TO_NAME = new Map<number, Chain>(
  (Object.keys(CHAIN_IDS) as Chain[]).map((name) => [CHAIN_IDS[name], name]),
);

/** Accepts either a chain name ("base") or a numeric chainId (8453). */
export function resolveChainName(input: number | string): Chain {
  if (typeof input === "number" || /^\d+$/.test(String(input))) {
    const chainId = Number(input);
    const name = CHAIN_ID_TO_NAME.get(chainId);
    if (!name) throw new Error(`Unsupported sandbox chain id: ${input}`);
    return name;
  }
  if (!(input in CHAIN_IDS)) throw new Error(`Unsupported sandbox chain: ${input}`);
  return input as Chain;
}

function manifestEntryToForkState(entry: ManifestEntry): ForkState | null {
  if (!entry.rpcUrl || !entry.port) return null;
  return {
    chain: entry.chain as Chain,
    chainId: entry.chainId,
    port: entry.port,
    rpcUrl: entry.rpcUrl,
    pid: entry.pid,
    startedAt: entry.startedAt,
    ready: entry.ready,
    status: entry.status,
  };
}

export type StartSandboxForksResult = {
  primary: Chain;
  forks: Record<string, ManifestEntry>;
};

/**
 * Bring up (or reuse, if already alive) a fork per requested chain, wire the
 * primary chain's RPC into the sandbox's own `.env.local`, and persist the
 * manifest. Rejects a selection over `MAX_SANDBOX_CHAINS` outright — no
 * silent truncation.
 */
export async function startSandboxForks(opts: {
  sandboxDir: string;
  chains: Array<number | string>;
  primary?: number | string;
}): Promise<StartSandboxForksResult> {
  if (!opts.chains.length) throw new Error("At least one chain is required.");
  if (opts.chains.length > MAX_SANDBOX_CHAINS) throw new TooManySandboxChainsError(opts.chains.length);

  const requested = Array.from(new Set(opts.chains.map(resolveChainName)));
  const primary = opts.primary ? resolveChainName(opts.primary) : requested[0];
  if (!requested.includes(primary)) {
    throw new Error("primary chain must be one of the requested chains");
  }

  const sandboxDir = opts.sandboxDir;
  mkdirSync(sandboxDir, { recursive: true });

  const manifest = readManifest(sandboxDir);

  for (const chain of requested) {
    const chainId = CHAIN_IDS[chain];
    const key = String(chainId);
    const tracked = manifest[key];

    if (tracked && isPidAlive(tracked.pid)) {
      // Already running from an earlier step in this onboarding session.
      continue;
    }

    try {
      const fork = await startFork({ sandboxDir, chain, repoint: chain === primary });
      manifest[key] = {
        chainId,
        chain,
        rpcUrl: fork.rpcUrl,
        port: fork.port,
        pid: fork.pid,
        startedAt: fork.startedAt,
        ready: Boolean(fork.ready),
        status: fork.status,
      };
    } catch (e: any) {
      manifest[key] = {
        chainId,
        chain,
        ready: false,
        status: "failed",
        error: e?.message || String(e),
        requestedAt: new Date().toISOString(),
      };
    }
  }

  writeManifest(sandboxDir, manifest);
  return { primary, forks: manifest };
}

/** Re-probe any fork the manifest lists as still "spawning" — covers the case
 *  where the wizard's first poll lands before `waitForRpc` inside
 *  `startFork` has resolved for a slow cold fork. */
export async function refreshSandboxForks(sandboxDir: string): Promise<Record<string, ManifestEntry>> {
  const manifest = readManifest(sandboxDir);

  for (const [key, entry] of Object.entries(manifest)) {
    if (entry.status === "ready" || !entry.rpcUrl) continue;
    const ready = await waitForRpc(entry.rpcUrl, entry.chainId, 1_000);
    if (ready) manifest[key] = { ...entry, ready: true, status: "ready" };
  }

  writeManifest(sandboxDir, manifest);
  return manifest;
}

export function getSandboxForks(sandboxDir: string): Record<string, ManifestEntry> {
  return readManifest(sandboxDir);
}

/** Stop every fork in this project's sandbox. `purgeState` also drops the
 *  manifest so a later `startSandboxForks` starts completely fresh instead of
 *  trying to resume dead pids. */
export async function resetSandbox(sandboxDir: string, opts: { purgeState?: boolean } = {}): Promise<void> {
  const manifest = readManifest(sandboxDir);

  for (const entry of Object.values(manifest)) {
    const fork = manifestEntryToForkState(entry);
    if (fork && isPidAlive(fork.pid)) await stopFork(fork);
  }

  writeManifest(sandboxDir, opts.purgeState ? {} : manifest);
}
