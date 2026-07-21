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

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import {
  CHAIN_IDS,
  MAX_SANDBOX_CHAINS,
  SANDBOX_CHAINS_CEILING,
  TooManySandboxChainsError,
  anvilStateFilePath,
  clampSandboxChainCap,
  dumpForkState,
  ensureLocalRpc,
  ensurePerChainRpc,
  isPidAlive,
  loadForkStateFile,
  probePort,
  readLocalRpcChainId,
  startFork,
  stopFork,
  waitForRpc,
  type Chain,
  type ForkState,
} from "./fork.js";
import { manifestPath, readManifest, writeManifest, type ManifestEntry } from "./manifest.js";

export { MAX_SANDBOX_CHAINS, SANDBOX_CHAINS_CEILING, TooManySandboxChainsError, CHAIN_IDS, clampSandboxChainCap };
export type { Chain, ManifestEntry };

export function sandboxDirFor(projectRoot: string): string {
  return join(projectRoot, ".shipyard", "sandbox");
}

/**
 * Serialize manifest read-modify-write sections per sandbox directory.
 *
 * `forks.json` is mutated by several code paths that the sandbox server runs
 * concurrently in one process: `startSandboxForks` (add a chain), the every-few-
 * seconds `refreshSandboxForks` behind `GET /api/sandbox/forks`, per-chain
 * stop/restart, the periodic dump, resume. Each did a bare read → mutate →
 * write. With no ordering, a refresh that read the manifest *before* a start
 * wrote a new fork, then wrote its stale snapshot *after*, silently dropped that
 * fork — the entry would appear, then vanish a second later, and the UI (whose
 * wagmi config was built from it) would lose the chain. This lock makes each
 * critical section run to completion before the next starts.
 *
 * Callers MUST keep the critical section synchronous and short: read the
 * manifest fresh inside `fn`, mutate, write, return — do NOT await slow work
 * (forking, RPC probes) while holding it, or concurrent reads stall. Spawn/probe
 * first, then take the lock only to merge the result in.
 */
const manifestLocks = new Map<string, Promise<unknown>>();
export function withManifestLock<T>(sandboxDir: string, fn: () => T): Promise<T> {
  const prev = manifestLocks.get(sandboxDir) ?? Promise.resolve();
  // Run fn whether or not the previous holder resolved or rejected — one failed
  // section must never wedge the queue for this sandbox.
  const next = prev.then(fn, fn);
  // Swallow rejections on the stored tail so an unhandled rejection can't crash
  // the process; the real result/rejection still propagates to this caller.
  manifestLocks.set(sandboxDir, next.then(() => {}, () => {}));
  return next;
}

/**
 * Ensure exactly one manifest entry is flagged `primary` — the chain the
 * sandbox's generic RPC_URL points at. Earlier code set the flag per-call
 * without clearing a previous primary, so `forks.json` could end up with two
 * `primary: true` entries; this normalises any manifest back to a single one.
 *
 * Priority for which chain wins: an explicit `preferred` chainId (the caller
 * just made it primary) → the chain `.env.local` currently points at (the
 * authoritative active RPC) → the sole already-flagged entry → the first entry.
 * Mutates and returns the same manifest object.
 */
function normalizeManifestPrimary(
  sandboxDir: string,
  manifest: Record<string, ManifestEntry>,
  preferred?: number,
): Record<string, ManifestEntry> {
  const keys = Object.keys(manifest);
  if (keys.length === 0) return manifest;
  const localCid = readLocalRpcChainId(sandboxDir);
  const flagged = keys.filter((k) => manifest[k].primary);
  const pick =
    (preferred != null && manifest[String(preferred)] ? String(preferred) : null) ??
    (localCid != null && manifest[String(localCid)] ? String(localCid) : null) ??
    (flagged.length === 1 ? flagged[0] : null) ??
    keys[0];
  for (const k of keys) {
    const isPrimary = k === pick;
    if (manifest[k].primary !== isPrimary) manifest[k] = { ...manifest[k], primary: isPrimary };
  }
  return manifest;
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
    // Must travel with the fork: it's what blocks dumpForkState/stopFork from
    // overwriting a state file whose world was never actually loaded.
    pendingStateLoad: entry.pendingStateLoad,
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

/**
 * Try to pay off an entry's saved-state load debt against its (now
 * answering) fork. Returns the new value for `pendingStateLoad`: undefined
 * once the load succeeds (or the file is gone — nothing left to load),
 * or the debt unchanged after a failed attempt, so dumps stay blocked and
 * the next refresh retries. Never throws.
 */
async function settleStateLoad(entry: ManifestEntry): Promise<string | undefined> {
  const pending = entry.pendingStateLoad;
  if (!pending || !entry.rpcUrl) return undefined;
  if (!existsSync(pending)) return undefined;
  try {
    await loadForkStateFile(entry.rpcUrl, pending);
    return undefined;
  } catch (e: any) {
    const message = String(e?.shortMessage ?? e?.message ?? e).slice(0, 300);
    console.warn(`⚠ Failed to load pending state for chain ${entry.chainId} from ${pending}: ${message} — will retry; dumps stay paused for this fork.`);
    return pending;
  }
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
 * manifest. Rejects a selection over the effective cap outright — no silent
 * truncation. The cap defaults to `MAX_SANDBOX_CHAINS` but the caller (the UI
 * server) passes the project-configured `maxChains` so a user who raised the
 * limit in Sandbox settings can fork that many at once.
 */
export async function startSandboxForks(opts: {
  sandboxDir: string;
  chains: Array<number | string>;
  primary?: number | string;
  maxChains?: number;
}): Promise<StartSandboxForksResult> {
  if (!opts.chains.length) throw new Error("At least one chain is required.");
  const cap = clampSandboxChainCap(opts.maxChains ?? MAX_SANDBOX_CHAINS);
  if (opts.chains.length > cap) throw new TooManySandboxChainsError(opts.chains.length, cap);

  const requested = Array.from(new Set(opts.chains.map(resolveChainName)));
  const primary = opts.primary ? resolveChainName(opts.primary) : requested[0];
  if (!requested.includes(primary)) {
    throw new Error("primary chain must be one of the requested chains");
  }

  const sandboxDir = opts.sandboxDir;
  mkdirSync(sandboxDir, { recursive: true });

  // Short helper: merge one chain's entry into a freshly-read manifest under the
  // lock, so a concurrent refresh/start can't clobber it (and we never write a
  // stale whole-manifest snapshot). See withManifestLock.
  const putEntry = (key: string, entry: ManifestEntry) =>
    withManifestLock(sandboxDir, () => {
      const m = readManifest(sandboxDir);
      m[key] = entry;
      writeManifest(sandboxDir, m);
    });

  for (const chain of requested) {
    const chainId = CHAIN_IDS[chain];
    const key = String(chainId);
    // Read fresh per chain: forking the previous chain took real time, during
    // which a concurrent refresh may have updated the manifest.
    const tracked = readManifest(sandboxDir)[key];

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
      if (tracked.rpcUrl) {
        ensurePerChainRpc(sandboxDir, chainId, tracked.rpcUrl);
        // If this already-alive chain is now the primary, point the sandbox's
        // generic RPC_URL/CHAIN_ID at it too. startFork's own repoint only runs
        // when we actually (re)spawn a fork — a chain forked earlier as a
        // secondary that's being promoted to primary here would otherwise never
        // become the active RPC.
        if (chain === primary) ensureLocalRpc(sandboxDir, chainId, tracked.rpcUrl);
      }
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
      // Spawn OUTSIDE the lock (slow); persist the result in a short locked write.
      const fork = await startFork({
        sandboxDir,
        chain,
        port: tracked?.port,
        repoint: chain === primary,
        loadStateFile: existsSync(stateFile) ? stateFile : undefined,
      });
      await putEntry(key, {
        chainId,
        chain,
        rpcUrl: fork.rpcUrl,
        port: fork.port,
        pid: fork.pid,
        stateFile: fork.stateFile,
        startedAt: fork.startedAt,
        ready: Boolean(fork.ready),
        status: fork.status,
        error: fork.error,
        adopted: fork.adopted,
        primary: chain === primary,
        pendingStateLoad: fork.pendingStateLoad,
      });
    } catch (e: any) {
      await putEntry(key, {
        chainId,
        chain,
        ready: false,
        status: "failed",
        error: e?.message || String(e),
        requestedAt: new Date().toISOString(),
      });
    }
  }

  // Exactly one chain is the active/primary one. Re-running with a different
  // primary (adding a network, or an add-SMA flow on another chain) used to
  // leave the earlier primary's flag set too — the already-alive branch
  // `continue`s without touching it — so forks.json could show two
  // `primary: true` entries. Normalise to the one we just resolved.
  const forks = await withManifestLock(sandboxDir, () => {
    const m = readManifest(sandboxDir);
    normalizeManifestPrimary(sandboxDir, m, CHAIN_IDS[primary]);
    writeManifest(sandboxDir, m);
    return m;
  });
  return { primary, forks };
}

/**
 * Re-probe every fork that isn't deliberately "stopped": a "spawning" one
 * for whether `waitForRpc` inside `startFork` has now resolved (the wizard's
 * first poll routinely lands before a slow cold fork is ready), and a
 * "ready" one for whether it's still actually there — an owned fork's
 * process can die on its own (crash, machine sleep, `pool down` out from
 * under an adopted one), and without this re-check the UI would keep
 * reporting it as ready indefinitely.
 *
 * Two settlements happen here beyond the ready flip. A "spawning" entry
 * whose process has died settles to "failed" — spawning was previously a
 * one-way wait, so a fork that crashed during boot showed "Starting…"
 * forever with no error and no way forward. And a fork that turns ready
 * with a `pendingStateLoad` gets that saved state loaded now — `startFork`
 * couldn't load it into a process that wasn't answering yet, and skipping
 * it would mean a slow boot silently discards the world it was restoring.
 */
export async function refreshSandboxForks(sandboxDir: string): Promise<Record<string, ManifestEntry>> {
  // Phase 1 (no lock): probe every fork off a snapshot, collecting a per-entry
  // patch. All the slow work — RPC probes, pending-state loads — happens here,
  // so we never hold the manifest lock while awaiting the network.
  const snapshot = readManifest(sandboxDir);
  const patches: Record<string, Partial<ManifestEntry>> = {};

  for (const [key, entry] of Object.entries(snapshot)) {
    if (entry.status === "stopped" || !entry.rpcUrl) continue;

    if (entry.status === "ready") {
      if (!(await isEntryAlive(entry))) {
        patches[key] = { ready: false, status: "failed", pid: undefined, error: "Fork is no longer responding." };
      } else if (entry.pendingStateLoad) {
        patches[key] = { pendingStateLoad: await settleStateLoad(entry) };
      }
      continue;
    }

    const ready = await waitForRpc(entry.rpcUrl, entry.chainId, 1_000);
    if (ready) {
      patches[key] = { ready: true, status: "ready", error: undefined, pendingStateLoad: await settleStateLoad(entry) };
      ensurePerChainRpc(sandboxDir, entry.chainId, entry.rpcUrl);
    } else if (entry.status === "spawning" && entry.pid && !isPidAlive(entry.pid)) {
      patches[key] = {
        ready: false,
        status: "failed",
        pid: undefined,
        error: "anvil exited during startup — its log has the details; Restart the fork to try again.",
      };
    }
  }

  // Phase 2 (locked, synchronous): re-read the manifest and MERGE the patches.
  // Merging into a fresh read — rather than writing back the phase-1 snapshot —
  // is what keeps a fork another operation added while we were probing from
  // being clobbered. A patch for a key that has since disappeared is dropped.
  return withManifestLock(sandboxDir, () => {
    const manifest = readManifest(sandboxDir);
    for (const [key, patch] of Object.entries(patches)) {
      if (manifest[key]) manifest[key] = { ...manifest[key], ...patch };
    }
    writeManifest(sandboxDir, manifest);
    return manifest;
  });
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
  // Phase 1 (no lock): stop every fork, collecting the "stopped" settlement per
  // key. stopFork dumps state and can take a moment, so it stays out of the lock.
  const snapshot = readManifest(sandboxDir);
  const patches: Record<string, Partial<ManifestEntry>> = {};

  for (const [key, entry] of Object.entries(snapshot)) {
    const fork = manifestEntryToForkState(entry, sandboxDir);
    if (entry.adopted && (await isEntryAlive(entry))) continue;
    if (fork && isPidAlive(fork.pid)) await stopFork(fork);
    // An unsettled pendingStateLoad is dropped here, deliberately: stopFork
    // skipped dumping over the never-loaded state file, so it still holds
    // that world — and the next start loads from stateFile anyway.
    patches[key] = { pid: undefined, ready: false, status: "stopped", stateFile: fork?.stateFile ?? entry.stateFile, adopted: false, pendingStateLoad: undefined };
  }

  // Phase 2 (locked): purge wipes the manifest outright; otherwise merge the
  // settlements into a fresh read so a concurrent op's changes aren't clobbered.
  await withManifestLock(sandboxDir, () => {
    if (opts.purgeState) { writeManifest(sandboxDir, {}); return; }
    const manifest = readManifest(sandboxDir);
    for (const [key, patch] of Object.entries(patches)) {
      if (manifest[key]) manifest[key] = { ...manifest[key], ...patch };
    }
    writeManifest(sandboxDir, manifest);
  });
}

/** Files/dirs that constitute "this sandbox's project state" — everything
 *  `archiveSandboxWorld` moves into a backup. Named relative to `sandboxDir`.
 *  `config.json` is included so a restored world resumes on its own active
 *  chain, not whatever chain the sandbox happened to be on when it came back. */
const PROJECT_STATE_ENTRIES = ["account.json", "mandate.json", "activity.jsonl", "state", "keys", "config.json"];

function backupStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Next unused `_reset-backup-<stamp>` path — a numeric suffix disambiguates
 *  two archives inside the same second (e.g. reset immediately followed by a
 *  backup activation) instead of merging them into one folder. */
function nextBackupDir(sandboxDir: string): string {
  const base = join(sandboxDir, `_reset-backup-${backupStamp(new Date())}`);
  if (!existsSync(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!existsSync(candidate)) return candidate;
  }
}

/**
 * Move the current sandbox world — SMA record, mandate, activity log, agent
 * keystores, active-chain config, fork manifest, and each chain's dumped
 * anvil state — into a new timestamped `_reset-backup-<stamp>/` directory,
 * and return its path (null when there was no world to archive). `.env.local`
 * is *copied*, not moved: it carries the keystore passphrase alongside RPC
 * wiring, and older backups were taken before it was captured at all — a
 * live copy has to stay behind so restoring one of those doesn't strand its
 * keystores without the passphrase that unlocks them.
 *
 * Callers are expected to have stopped the forks first (`resetSandbox`), so
 * the dumps and manifest being archived reflect the world's final state.
 * Shared by `resetSandboxProject` (archive, then start blank) and
 * `activateSandboxBackup` (archive, then restore a previous world).
 */
export function archiveSandboxWorld(sandboxDir: string): string | null {
  const present = PROJECT_STATE_ENTRIES.filter((name) => existsSync(join(sandboxDir, name)));
  const dumps = (Object.keys(CHAIN_IDS) as Chain[])
    .map((chain) => anvilStateFilePath(sandboxDir, chain))
    .filter((f) => existsSync(f));
  const manifestFile = manifestPath(sandboxDir);
  const hasManifest = existsSync(manifestFile);

  if (present.length === 0 && dumps.length === 0 && !hasManifest) return null;

  const backupDir = nextBackupDir(sandboxDir);
  mkdirSync(backupDir, { recursive: true });

  for (const name of present) renameSync(join(sandboxDir, name), join(backupDir, name));
  for (const dump of dumps) renameSync(dump, join(backupDir, basename(dump)));
  if (hasManifest) renameSync(manifestFile, join(backupDir, basename(manifestFile)));

  const envFile = join(sandboxDir, ".env.local");
  if (existsSync(envFile)) copyFileSync(envFile, join(backupDir, ".env.local"));

  return backupDir;
}

export type ResetSandboxProjectResult = { backupDir: string | null };

/**
 * "Reset the project" for a sandbox: stops every fork (dumping each chain's
 * state first) and moves the entire world — SMA record, mandate, activity
 * log, keystores, config, fork manifest, and the state dumps — into a
 * timestamped backup directory instead of deleting it outright. Nothing is
 * destroyed: an operator who resets by mistake can recover everything from
 * `_reset-backup-<timestamp>/`, and `activateSandboxBackup` can bring the
 * whole world (forks included) back online from it.
 */
export async function resetSandboxProject(sandboxDir: string): Promise<ResetSandboxProjectResult> {
  await resetSandbox(sandboxDir);
  return { backupDir: archiveSandboxWorld(sandboxDir) };
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
  // Phase 1 (no lock): dump every live fork (read-only RPC), collecting any
  // stateFile corrections to merge afterward.
  const snapshot = readManifest(sandboxDir);
  const result: DumpSandboxStateResult = { dumped: [], skipped: [], failed: {} };
  const stateFilePatches: Record<string, string> = {};

  for (const [key, entry] of Object.entries(snapshot)) {
    const fork = manifestEntryToForkState(entry, sandboxDir);
    // pendingStateLoad: this fork's state file holds a world that was never
    // loaded into it — dumping the live fork over that file would destroy
    // the only copy. refreshSandboxForks settles the debt; skip until then.
    if (!fork || entry.status !== "ready" || entry.pendingStateLoad || !(await isEntryAlive(entry))) {
      result.skipped.push(entry.chainId);
      continue;
    }
    try {
      await dumpForkState(fork);
      result.dumped.push(entry.chainId);
      if (entry.stateFile !== fork.stateFile && fork.stateFile) stateFilePatches[key] = fork.stateFile;
    } catch (e: any) {
      result.failed[entry.chainId] = e?.message || String(e);
    }
  }

  // Phase 2 (locked): merge stateFile corrections into a fresh read.
  if (Object.keys(stateFilePatches).length > 0) {
    await withManifestLock(sandboxDir, () => {
      const manifest = readManifest(sandboxDir);
      for (const [key, stateFile] of Object.entries(stateFilePatches)) {
        if (manifest[key]) manifest[key] = { ...manifest[key], stateFile };
      }
      writeManifest(sandboxDir, manifest);
    });
  }
  return result;
}

export type ResumeSandboxForksResult = {
  /** Chain ids brought back up (loading their dumped state where one existed). */
  resumed: number[];
  /** Chain ids left alone because their fork is already answering. */
  skipped: number[];
  /** Chain ids deliberately NOT brought back because the tracked set exceeded
   *  the cap — parked into `status: "stopped"`, resumable later from the UI. */
  parked: number[];
  /** Chain id → error message for forks that failed to come back. */
  failed: Record<number, string>;
};

/** Order tracked forks by how much they deserve a scarce slot: the primary
 *  first (the chain that owns the sandbox's active RPC — losing it would strand
 *  the wallet), then most-recently-started before older ones. Used by both the
 *  resume budget and the cap-enforcement reducer so "which forks survive the
 *  cap" is decided one way everywhere. Does not mutate its input. */
function forkKeepPriority(entries: ManifestEntry[]): ManifestEntry[] {
  return [...entries].sort((a, b) => {
    if (Boolean(a.primary) !== Boolean(b.primary)) return a.primary ? -1 : 1;
    const ta = Date.parse(a.startedAt ?? "") || 0;
    const tb = Date.parse(b.startedAt ?? "") || 0;
    return tb - ta;
  });
}

/**
 * Bring back tracked forks that aren't currently up, resuming each from its
 * dumped state file when one exists — the "restart" half of session
 * persistence. Called by the sandbox server at boot so `sailor sandbox start`
 * after a stop (or a reboot) puts the previous session's world — deployed
 * SMAs, signed mandates, funded balances — back on the same ports, without
 * anyone having to re-run the wizard or click per-chain Restart buttons.
 *
 * Respects the chain cap. Older builds resumed *every* tracked fork regardless
 * of `maxChains`, so a session that had forked more chains than the cap (or one
 * whose cap was later lowered) would come back over the limit on every boot.
 * Now resume only revives up to the cap: forks already alive (including adopted
 * ones) hold their slots, the remaining budget goes to the highest-priority
 * dead forks (primary first, then most recent — see `forkKeepPriority`), and
 * any dead forks past the budget are *parked* into `status: "stopped"` rather
 * than revived. Parked forks keep their dumped state and can be brought back
 * from the UI once a slot frees up (or the cap is raised); nothing is deleted.
 * Never kills an already-alive fork — reducing a live over-cap set is an
 * explicit user action (`enforceSandboxChainCap`), not a silent boot effect.
 *
 * Idempotent and safe to call on every server start. Failures are per-chain and
 * reported, never thrown — one unreachable upstream RPC shouldn't stop the rest
 * of the sandbox from coming back.
 */
export async function resumeSandboxForks(
  sandboxDir: string,
  opts: { maxChains?: number } = {},
): Promise<ResumeSandboxForksResult> {
  const manifest = readManifest(sandboxDir);
  const cap = clampSandboxChainCap(opts.maxChains ?? MAX_SANDBOX_CHAINS);
  const result: ResumeSandboxForksResult = { resumed: [], skipped: [], parked: [], failed: {} };

  const dead: ManifestEntry[] = [];
  let aliveCount = 0;
  for (const entry of Object.values(manifest)) {
    if (await isEntryAlive(entry)) {
      aliveCount++;
      result.skipped.push(entry.chainId);
    } else {
      dead.push(entry);
    }
  }

  // Alive forks already occupy slots; only the leftover budget can be revived.
  const budget = Math.max(0, cap - aliveCount);
  const ranked = forkKeepPriority(dead);
  const toResume = ranked.slice(0, budget);
  const toPark = ranked.slice(budget);

  for (const entry of toResume) {
    try {
      await restartSandboxFork(sandboxDir, entry.chainId);
      result.resumed.push(entry.chainId);
    } catch (e: any) {
      result.failed[entry.chainId] = e?.message || String(e);
    }
  }

  // Park the over-budget dead forks + self-heal the primary flag, under the lock
  // so the per-fork restarts above (and any concurrent refresh) can't be lost.
  // Re-read fresh: the restarts rewrote the manifest. Settle each parked entry
  // into "stopped" so the UI shows them deliberately-parked-and-resumable, not
  // falsely "ready" with a dead pid.
  await withManifestLock(sandboxDir, () => {
    const healed = readManifest(sandboxDir);
    for (const entry of toPark) {
      const key = String(entry.chainId);
      if (!healed[key]) continue;
      healed[key] = { ...healed[key], pid: undefined, ready: false, status: "stopped" };
      result.parked.push(entry.chainId);
    }
    // Collapse to a single primary, keyed off whatever .env.local's RPC points
    // at — without this a double-primary manifest from older builds survives
    // every restart untouched, since resume takes no primary.
    normalizeManifestPrimary(sandboxDir, healed);
    writeManifest(sandboxDir, healed);
  });

  return result;
}

export type EnforceSandboxChainCapResult = {
  /** Chain ids stopped to bring the live set down to the cap. */
  stopped: number[];
  /** Chain ids left running (the highest-priority `cap` forks). */
  kept: number[];
};

/**
 * Bring the currently-*alive* fork set down to `maxChains` by stopping the
 * lowest-priority live forks — the explicit "reduce now" a user triggers after
 * lowering the cap in Sandbox settings (resume never kills a live fork on its
 * own). Keeps the highest-priority forks (primary first, then most recent — see
 * `forkKeepPriority`) and stops the rest via `stopSandboxFork`, so each stopped
 * fork's state is dumped first and it stays resumable. No-op when the live set
 * is already within the cap. An adopted fork that's still alive can't be
 * stopped (we don't own it); such a fork is left running and reported in
 * `kept`, so the live set may remain above the cap if adopted forks alone
 * exceed it — that's surfaced to the caller rather than force-killed.
 */
export async function enforceSandboxChainCap(
  sandboxDir: string,
  maxChains?: number,
): Promise<EnforceSandboxChainCapResult> {
  const cap = clampSandboxChainCap(maxChains ?? MAX_SANDBOX_CHAINS);
  const manifest = readManifest(sandboxDir);
  const result: EnforceSandboxChainCapResult = { stopped: [], kept: [] };

  const alive: ManifestEntry[] = [];
  for (const entry of Object.values(manifest)) {
    if (await isEntryAlive(entry)) alive.push(entry);
  }

  const ranked = forkKeepPriority(alive);
  const keep = ranked.slice(0, cap);
  const drop = ranked.slice(cap);
  result.kept = keep.map((e) => e.chainId);

  for (const entry of drop) {
    try {
      await stopSandboxFork(sandboxDir, entry.chainId);
      result.stopped.push(entry.chainId);
    } catch {
      // An adopted-but-alive fork refuses to stop (not ours to kill) — leave it
      // running and count it as kept; the caller decides how to surface that.
      result.kept.push(entry.chainId);
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

  // Locked read-merge-write: don't clobber a concurrent refresh/start.
  return withManifestLock(sandboxDir, () => {
    const m = readManifest(sandboxDir);
    m[key] = { ...(m[key] ?? entry), pid: undefined, ready: false, status: "stopped", stateFile: fork?.stateFile, adopted: false };
    writeManifest(sandboxDir, m);
    return m[key];
  });
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

  // Locked read-merge-write: the spawn above took real time, during which a
  // concurrent refresh may have rewritten the manifest — merge into a fresh read
  // rather than write back our stale snapshot.
  return withManifestLock(sandboxDir, () => {
    const m = readManifest(sandboxDir);
    m[key] = {
      chainId,
      chain,
      rpcUrl: fork.rpcUrl,
      port: fork.port,
      pid: fork.pid,
      stateFile: fork.stateFile,
      startedAt: fork.startedAt,
      ready: Boolean(fork.ready),
      status: fork.status,
      error: fork.error,
      adopted: fork.adopted,
      primary: repoint,
      pendingStateLoad: fork.pendingStateLoad,
    };
    writeManifest(sandboxDir, m);
    return m[key];
  });
}
