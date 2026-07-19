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

import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import {
  CHAIN_IDS,
  MAX_SANDBOX_CHAINS,
  TooManySandboxChainsError,
  anvilStateFilePath,
  dumpForkState,
  ensurePerChainRpc,
  isPidAlive,
  probePort,
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

/**
 * `stateFile` is only populated in the manifest by `startFork`'s own write —
 * an entry created before that field existed, or one that was always
 * "already tracked & alive" (so `startSandboxForks` never called `startFork`
 * for it — see the `continue` below), can reach here with it unset. Falling
 * back to the deterministic default path (rather than leaving it undefined)
 * matters because `stopFork` only dumps state when `stateFile` is truthy —
 * without this fallback, stopping a legacy-tracked fork silently skips the
 * dump and a later restart loads nothing, discarding that chain's state
 * (including anything deployed on it) with no error or warning.
 */
function manifestEntryToForkState(entry: ManifestEntry, sandboxDir: string): ForkState | null {
  if (!entry.rpcUrl || !entry.port) return null;
  return {
    chain: entry.chain as Chain,
    chainId: entry.chainId,
    port: entry.port,
    rpcUrl: entry.rpcUrl,
    pid: entry.pid,
    stateFile: entry.stateFile ?? anvilStateFilePath(sandboxDir, entry.chain as Chain),
    startedAt: entry.startedAt,
    ready: entry.ready,
    status: entry.status,
    adopted: entry.adopted,
  };
}

/**
 * Is this entry's fork actually still there? The RPC probe is authoritative
 * whenever we know the fork's URL: a pid-only check (signal 0) reports true
 * for a *zombie* — an anvil we spawned that crashed or was SIGKILLed but
 * hasn't been reaped by its parent (this very process, typically) — leaving
 * a dead fork treated as running, so it's never resumed and its callers hang
 * on a port nothing listens on. A dead pid is still checked first as a cheap
 * definite "gone" (skips the probe timeout); a live-looking pid must also
 * answer for the right chain to count. Adopted entries have no pid of ours
 * at all, so for them the probe was always the only signal — and it's also
 * how a fork adopted from a since-dead process avoids being stuck forever
 * behind a permanent `adopted` block.
 */
async function isEntryAlive(entry: ManifestEntry): Promise<boolean> {
  if (!entry.rpcUrl) return isPidAlive(entry.pid);
  if (entry.pid && !isPidAlive(entry.pid)) return false;
  return (await probePort(entry.rpcUrl, 800)) === entry.chainId;
}

/** Whichever chain currently owns the sandbox's generic `RPC_URL`/`CHAIN_ID`
 *  pair (as opposed to its `RPC_URL_<chainId>` entry, which every chain
 *  gets) — read straight from disk since the manifest doesn't always know
 *  (older entries predate the `primary` field). */
function currentPrimaryChainId(sandboxDir: string): number | null {
  const envPath = join(sandboxDir, ".env.local");
  if (!existsSync(envPath)) return null;
  const match = readFileSync(envPath, "utf8").match(/^CHAIN_ID=(\d+)$/m);
  return match ? Number(match[1]) : null;
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

    // "Already running" must mean *answering*, not just pid-alive: a crashed
    // fork we spawned lingers as a zombie (pid checks pass) until reaped, and
    // treating it as running would return a "ready" manifest for a port with
    // nothing behind it. A fork still mid-spawn hasn't bound its port yet,
    // though, so for those the pid is the only honest signal — probing would
    // misread "not listening yet" as dead and race a duplicate anvil.
    const trackedAlive =
      tracked && (tracked.status === "ready" ? await isEntryAlive(tracked) : isPidAlive(tracked.pid));

    if (tracked && trackedAlive) {
      // Already running from an earlier step in this onboarding session — no
      // need to re-spawn, but still make sure this chain's own RPC_URL_<id>
      // is on record (a fresh manifest, or one written before this per-chain
      // key existed, would otherwise leave an already-running chain invisible
      // to anything reading the per-chain env convention).
      if (tracked.rpcUrl) ensurePerChainRpc(sandboxDir, chainId, tracked.rpcUrl);
      continue;
    }

    try {
      // Resume, don't rewind: if this chain ran before (tracked entry whose
      // process has since died or was stopped) and left a dumped state file,
      // load it — otherwise a re-run of the wizard after a stop or reboot
      // would silently fork fresh from upstream and discard everything the
      // previous session deployed. Same deterministic port as before so
      // anything still holding the old RPC URL keeps working.
      const stateFile = tracked?.stateFile ?? anvilStateFilePath(sandboxDir, chain);
      const fork = await startFork({
        sandboxDir,
        chain,
        port: tracked?.port,
        repoint: chain === primary,
        loadStateFile: existsSync(stateFile) ? stateFile : undefined,
      });
      manifest[key] = {
        chainId,
        chain,
        rpcUrl: fork.rpcUrl,
        port: fork.port,
        pid: fork.pid,
        stateFile: fork.stateFile,
        startedAt: fork.startedAt,
        ready: Boolean(fork.ready),
        status: fork.status,
        adopted: fork.adopted,
        primary: chain === primary,
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

/**
 * Re-probe every fork that isn't deliberately "stopped": a "spawning" one
 * for whether `waitForRpc` inside `startFork` has now resolved (the wizard's
 * first poll routinely lands before a slow cold fork is ready), and a
 * "ready" one for whether it's still actually there — an owned fork's
 * process can die on its own (crash, machine sleep, `pool down` out from
 * under an adopted one), and without this re-check the UI would keep
 * reporting it as ready indefinitely.
 */
export async function refreshSandboxForks(sandboxDir: string): Promise<Record<string, ManifestEntry>> {
  const manifest = readManifest(sandboxDir);

  for (const [key, entry] of Object.entries(manifest)) {
    if (entry.status === "stopped" || !entry.rpcUrl) continue;

    if (entry.status === "ready") {
      if (!(await isEntryAlive(entry))) {
        manifest[key] = { ...entry, ready: false, status: "failed", pid: undefined, error: "Fork is no longer responding." };
      }
      continue;
    }

    const ready = await waitForRpc(entry.rpcUrl, entry.chainId, 1_000);
    if (ready) {
      manifest[key] = { ...entry, ready: true, status: "ready" };
      ensurePerChainRpc(sandboxDir, entry.chainId, entry.rpcUrl);
    }
  }

  writeManifest(sandboxDir, manifest);
  return manifest;
}

export function getSandboxForks(sandboxDir: string): Record<string, ManifestEntry> {
  return readManifest(sandboxDir);
}

/** Stop every fork in this project's sandbox, dumping each owned fork's state
 *  first (see `stopFork`) so a later start resumes the same world. `purgeState`
 *  also drops the manifest so a later `startSandboxForks` starts completely
 *  fresh instead of trying to resume dead pids.
 *
 *  Without `purgeState`, the surviving manifest reflects what actually
 *  happened: every entry we stopped (or found already dead) settles into
 *  `status: "stopped"` with its pid cleared and its dump target recorded —
 *  previously entries kept claiming `ready` with a dead pid, so nothing
 *  downstream could tell "deliberately shut down, resumable" from "running".
 *  An adopted fork that's still alive is left untouched (not ours to stop). */
export async function resetSandbox(sandboxDir: string, opts: { purgeState?: boolean } = {}): Promise<void> {
  const manifest = readManifest(sandboxDir);

  for (const [key, entry] of Object.entries(manifest)) {
    const fork = manifestEntryToForkState(entry, sandboxDir);
    if (entry.adopted && (await isEntryAlive(entry))) continue;
    if (fork && isPidAlive(fork.pid)) await stopFork(fork);
    manifest[key] = { ...entry, pid: undefined, ready: false, status: "stopped", stateFile: fork?.stateFile ?? entry.stateFile, adopted: false };
  }

  writeManifest(sandboxDir, opts.purgeState ? {} : manifest);
}

/** Files/dirs that constitute "this sandbox's project state" — everything
 *  `resetSandboxProject` backs up. Named relative to `sandboxDir`. */
const PROJECT_STATE_ENTRIES = ["account.json", "mandate.json", "activity.jsonl", "state", "keys"];

function backupStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export type ResetSandboxProjectResult = { backupDir: string | null };

/**
 * "Reset the project" for a sandbox: stops every fork and purges the fork
 * manifest (same as `resetSandbox({ purgeState: true })`), retires each
 * chain's dumped anvil state file so a later start forks clean from live
 * chain state rather than silently resuming the old (now-orphaned) world,
 * and moves every piece of project-level state — the SMA record, mandate,
 * activity log, account list, and agent-wallet keystores — into a
 * timestamped backup directory instead of deleting it outright. Nothing is
 * destroyed: an operator who resets by mistake can recover everything from
 * `_reset-backup-<timestamp>/`.
 */
export async function resetSandboxProject(sandboxDir: string): Promise<ResetSandboxProjectResult> {
  await resetSandbox(sandboxDir, { purgeState: true });

  const present = PROJECT_STATE_ENTRIES.filter((name) => existsSync(join(sandboxDir, name)));
  const dumps = (Object.keys(CHAIN_IDS) as Chain[])
    .map((chain) => anvilStateFilePath(sandboxDir, chain))
    .filter((f) => existsSync(f));

  if (present.length === 0 && dumps.length === 0) return { backupDir: null };

  const backupDir = join(sandboxDir, `_reset-backup-${backupStamp(new Date())}`);
  mkdirSync(backupDir, { recursive: true });

  for (const name of present) renameSync(join(sandboxDir, name), join(backupDir, name));
  for (const dump of dumps) renameSync(dump, join(backupDir, basename(dump)));

  return { backupDir };
}

export type DumpSandboxStateResult = {
  /** Chain ids whose state was written to their dump file. */
  dumped: number[];
  /** Chain ids skipped because the fork isn't currently up (nothing to dump). */
  skipped: number[];
  /** Chain id → error message for forks that answered but failed to dump. */
  failed: Record<number, string>;
};

/**
 * Dump every live fork's chain state to its on-disk state file — the durable
 * half of session persistence. `stopFork` only dumps on a *graceful* stop, so
 * without periodic calls to this, a crash, reboot, or `kill -9` loses every
 * mandate deployed since the sandbox came up. The sandbox server calls this
 * on an interval; it's also safe to call ad hoc ("save now").
 *
 * Dumping is a read-only RPC (`anvil_dumpState`), so adopted forks are
 * included — no ownership needed to make their world durable.
 */
export async function dumpSandboxState(sandboxDir: string): Promise<DumpSandboxStateResult> {
  const manifest = readManifest(sandboxDir);
  const result: DumpSandboxStateResult = { dumped: [], skipped: [], failed: {} };
  let manifestChanged = false;

  for (const [key, entry] of Object.entries(manifest)) {
    const fork = manifestEntryToForkState(entry, sandboxDir);
    if (!fork || entry.status !== "ready" || !(await isEntryAlive(entry))) {
      result.skipped.push(entry.chainId);
      continue;
    }
    try {
      await dumpForkState(fork);
      result.dumped.push(entry.chainId);
      if (entry.stateFile !== fork.stateFile) {
        manifest[key] = { ...entry, stateFile: fork.stateFile };
        manifestChanged = true;
      }
    } catch (e: any) {
      result.failed[entry.chainId] = e?.message || String(e);
    }
  }

  if (manifestChanged) writeManifest(sandboxDir, manifest);
  return result;
}

export type ResumeSandboxForksResult = {
  /** Chain ids brought back up (loading their dumped state where one existed). */
  resumed: number[];
  /** Chain ids left alone because their fork is already answering. */
  skipped: number[];
  /** Chain id → error message for forks that failed to come back. */
  failed: Record<number, string>;
};

/**
 * Bring back every tracked fork that isn't currently up, resuming each from
 * its dumped state file when one exists — the "restart" half of session
 * persistence. Called by the sandbox server at boot so `sailor sandbox start`
 * after a stop (or a reboot) puts the previous session's world — deployed
 * SMAs, signed mandates, funded balances — back on the same ports, without
 * anyone having to re-run the wizard or click per-chain Restart buttons.
 *
 * Forks that are already alive (including adopted ones) are skipped, so this
 * is idempotent and safe to call on every server start. Failures are
 * per-chain and reported, never thrown — one unreachable upstream RPC
 * shouldn't stop the rest of the sandbox from coming back.
 */
export async function resumeSandboxForks(sandboxDir: string): Promise<ResumeSandboxForksResult> {
  const manifest = readManifest(sandboxDir);
  const result: ResumeSandboxForksResult = { resumed: [], skipped: [], failed: {} };

  for (const entry of Object.values(manifest)) {
    if (await isEntryAlive(entry)) {
      result.skipped.push(entry.chainId);
      continue;
    }
    try {
      await restartSandboxFork(sandboxDir, entry.chainId);
      result.resumed.push(entry.chainId);
    } catch (e: any) {
      result.failed[entry.chainId] = e?.message || String(e);
    }
  }

  return result;
}

/**
 * Stop a single chain's fork (dumping its state first, so a later restart
 * resumes the same world). Refuses on an adopted fork *that's still actually
 * alive* — we never spawned it, so we don't own its lifecycle and killing it
 * could take out a process some other tool or project is relying on. An
 * adopted fork whose process has since died has nothing left to protect, so
 * this clears the stale `adopted` flag and proceeds (there's nothing to
 * dump or kill, but the manifest still needs to settle into "stopped").
 */
export async function stopSandboxFork(sandboxDir: string, chainId: number): Promise<ManifestEntry> {
  const manifest = readManifest(sandboxDir);
  const key = String(chainId);
  const entry = manifest[key];
  if (!entry) throw new Error(`No sandbox fork tracked for chain ${chainId}.`);
  if (entry.adopted && (await isEntryAlive(entry))) {
    throw new Error(
      `Chain ${chainId}'s fork is still running and wasn't started by this sandbox (it adopted an already-running process) — refusing to stop a process this sandbox doesn't own.`,
    );
  }

  const fork = manifestEntryToForkState(entry, sandboxDir);
  if (fork && isPidAlive(fork.pid)) await stopFork(fork);

  manifest[key] = { ...entry, pid: undefined, ready: false, status: "stopped", stateFile: fork?.stateFile, adopted: false };
  writeManifest(sandboxDir, manifest);
  return manifest[key];
}

/**
 * Restart a single chain's fork: stop it (if running), then start it fresh
 * on the same deterministic port, resuming from its last dumped state when
 * one exists so the chain doesn't silently rewind to genesis. Repoints the
 * sandbox's generic RPC_URL/CHAIN_ID only if this chain already owned that
 * pair, so restarting a non-primary chain doesn't accidentally promote it.
 *
 * Refuses on an adopted fork *that's still actually alive*, same as
 * `stopSandboxFork` — see there for why `adopted` alone isn't a safe,
 * permanent gate. A dead adopted fork instead gets a fresh spawn here (there
 * was never a dump of its state for us to load — that process was never
 * ours to snapshot before it died).
 */
export async function restartSandboxFork(sandboxDir: string, chainId: number): Promise<ManifestEntry> {
  const manifest = readManifest(sandboxDir);
  const key = String(chainId);
  const entry = manifest[key];
  if (!entry) throw new Error(`No sandbox fork tracked for chain ${chainId}.`);

  if (entry.adopted && (await isEntryAlive(entry))) {
    throw new Error(
      `Chain ${chainId}'s fork is still running and wasn't started by this sandbox (it adopted an already-running process) — refusing to restart a process this sandbox doesn't own.`,
    );
  }

  const chain = resolveChainName(chainId);
  const existingFork = manifestEntryToForkState(entry, sandboxDir);
  if (existingFork && isPidAlive(existingFork.pid)) {
    await stopFork(existingFork);
  }

  const repoint = entry.primary ?? currentPrimaryChainId(sandboxDir) === chainId;
  const stateFile = existingFork?.stateFile ?? anvilStateFilePath(sandboxDir, chain);

  const fork = await startFork({
    sandboxDir,
    chain,
    port: entry.port,
    repoint,
    loadStateFile: existsSync(stateFile) ? stateFile : undefined,
  });

  manifest[key] = {
    chainId,
    chain,
    rpcUrl: fork.rpcUrl,
    port: fork.port,
    pid: fork.pid,
    stateFile: fork.stateFile,
    startedAt: fork.startedAt,
    ready: Boolean(fork.ready),
    status: fork.status,
    adopted: fork.adopted,
    primary: repoint,
  };
  writeManifest(sandboxDir, manifest);
  return manifest[key];
}
