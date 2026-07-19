/**
 * Sandbox world backups — listing and reactivation.
 *
 * Every `resetSandboxProject` (and every activation here) archives the whole
 * sandbox world into `<sandboxDir>/_reset-backup-<stamp>/`: SMA record,
 * mandate, activity log, keystores, config, fork manifest, and each chain's
 * dumped anvil state. This module turns those folders from a passive safety
 * net into navigable worlds: list them with enough metadata to recognize
 * ("which one had the LP-mint SMA on Unichain?"), and activate one — the
 * current world is archived the same way first, the chosen backup's files
 * move back into place, and its forks restart loading their saved chain
 * state, so mandates, balances, and activity history all come back exactly
 * where that world left off.
 */

import { existsSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CHAIN_IDS, CHAIN_PORTS, anvilStateFilePath, type Chain } from "./fork.js";
import { manifestPath, readManifest, writeManifest, type ManifestEntry } from "./manifest.js";
import {
  archiveSandboxWorld,
  resetSandbox,
  resumeSandboxForks,
  type ResumeSandboxForksResult,
} from "./sandbox.js";

/** `_reset-backup-<UTC stamp>` with an optional `-N` disambiguator (two
 *  archives inside the same second). Also the path-traversal gate: activation
 *  only ever joins names matching this onto `sandboxDir`. */
const BACKUP_NAME_RE = /^_reset-backup-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z(?:-\d+)?$/;

const DUMP_FILE_RE = /^anvil-state-(.+)\.json$/;

export type SandboxBackupInfo = {
  /** Directory name under the sandbox dir — the id `activateSandboxBackup` takes. */
  name: string;
  /** ISO timestamp parsed from the name; null if the stamp is unparseable. */
  savedAt: string | null;
  /** From the backed-up account.json, when the world had an onboarded SMA. */
  smaName?: string;
  safe?: string;
  /** Chain names with saved state in this backup (manifest ∪ state dumps). */
  chains: string[];
  hasMandate: boolean;
  /** Events in the backed-up activity log (0 when none was captured). */
  activityEvents: number;
};

function chainsIn(backupDir: string): string[] {
  const chains = new Set<string>();
  for (const entry of Object.values(readManifest(backupDir))) {
    if (entry.chain) chains.add(entry.chain);
  }
  for (const file of readdirSync(backupDir)) {
    const m = file.match(DUMP_FILE_RE);
    if (m && m[1] in CHAIN_IDS) chains.add(m[1]);
  }
  return [...chains].sort();
}

function stampToIso(name: string): string | null {
  const m = name.match(BACKUP_NAME_RE);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

/** All backup worlds under this sandbox, newest first. Unreadable or
 *  non-matching entries are simply omitted — listing never throws over one
 *  corrupt folder. */
export function listSandboxBackups(sandboxDir: string): SandboxBackupInfo[] {
  let names: string[];
  try {
    names = readdirSync(sandboxDir).filter((n) => BACKUP_NAME_RE.test(n));
  } catch {
    return [];
  }

  const backups: SandboxBackupInfo[] = [];
  for (const name of names.sort().reverse()) {
    const dir = join(sandboxDir, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
      let smaName: string | undefined;
      let safe: string | undefined;
      try {
        const account = JSON.parse(readFileSync(join(dir, "account.json"), "utf8"));
        smaName = typeof account?.name === "string" ? account.name : undefined;
        safe = typeof account?.safe === "string" ? account.safe : undefined;
      } catch {
        /* world was never onboarded (or account.json is unreadable) */
      }
      let activityEvents = 0;
      try {
        activityEvents = readFileSync(join(dir, "activity.jsonl"), "utf8")
          .split("\n")
          .filter((l) => l.trim()).length;
      } catch {
        /* no activity captured */
      }
      backups.push({
        name,
        savedAt: stampToIso(name),
        smaName,
        safe,
        chains: chainsIn(dir),
        hasMandate: existsSync(join(dir, "mandate.json")),
        activityEvents,
      });
    } catch {
      /* skip unreadable entry */
    }
  }
  return backups;
}

/** The restored world's active chain, from its config.json — used to pick
 *  which synthesized manifest entry is primary for legacy backups that
 *  predate the manifest being captured. */
function configChainId(sandboxDir: string): number | null {
  try {
    const chainId = Number(JSON.parse(readFileSync(join(sandboxDir, "config.json"), "utf8"))?.chainId);
    return Number.isInteger(chainId) ? chainId : null;
  } catch {
    return null;
  }
}

/**
 * Make the just-restored manifest honest before resuming: every pid in it
 * belonged to the machine state of whenever this world was archived, so
 * entries settle to `stopped` with pids cleared (a stale pid can collide
 * with a live unrelated process and read as "already running"). A legacy
 * backup captured before the manifest was archived at all gets one
 * synthesized from its state-dump files instead — deterministic ports,
 * primary chosen by the restored config.json's chainId (first dump
 * otherwise) — so those worlds are just as resumable as new ones.
 */
function rebuildRestoredManifest(sandboxDir: string): Record<string, ManifestEntry> {
  const restored = readManifest(sandboxDir);
  const rebuilt: Record<string, ManifestEntry> = {};

  if (Object.keys(restored).length > 0) {
    for (const [key, entry] of Object.entries(restored)) {
      const dump = entry.chain && entry.chain in CHAIN_IDS ? anvilStateFilePath(sandboxDir, entry.chain as Chain) : undefined;
      rebuilt[key] = {
        ...entry,
        pid: undefined,
        ready: false,
        status: "stopped",
        adopted: false,
        stateFile: dump ?? entry.stateFile,
      };
    }
  } else {
    const primaryChainId = configChainId(sandboxDir);
    for (const chain of Object.keys(CHAIN_IDS) as Chain[]) {
      const dump = anvilStateFilePath(sandboxDir, chain);
      if (!existsSync(dump)) continue;
      const chainId = CHAIN_IDS[chain];
      rebuilt[String(chainId)] = {
        chainId,
        chain,
        rpcUrl: `http://127.0.0.1:${CHAIN_PORTS[chain]}`,
        port: CHAIN_PORTS[chain],
        stateFile: dump,
        ready: false,
        status: "stopped",
        primary: chainId === primaryChainId,
      };
    }
    const entries = Object.values(rebuilt);
    if (entries.length > 0 && !entries.some((e) => e.primary)) entries[0].primary = true;
  }

  writeManifest(sandboxDir, rebuilt);
  return rebuilt;
}

export type ActivateSandboxBackupResult = {
  /** Where the world that was current before this call was archived (null if
   *  the sandbox was blank — fresh after a reset, nothing to save). */
  archivedTo: string | null;
  /** The backup that is now the live world. */
  activated: string;
  forks: Record<string, ManifestEntry>;
  /** Per-chain fork resume outcome; null when opts.resume === false. */
  resume: ResumeSandboxForksResult | null;
};

/**
 * Make a backed-up world the live sandbox world.
 *
 * Order matters for safety: the current world is stopped (forks dumped) and
 * archived into its own new backup *before* anything moves, so at every
 * point each world's files live in exactly one place and nothing is ever
 * overwritten or deleted — switching is symmetric and always reversible.
 * Then the chosen backup's contents move back into the sandbox dir (its
 * `.env.local` snapshot, when it has one, replaces the live file; a legacy
 * backup without one keeps the live file, whose passphrase its keystores
 * need), the manifest is rebuilt with stale pids cleared, and the world's
 * forks restart loading their saved chain state.
 *
 * Fork resume failures are per-chain and reported in the result, not thrown
 * — the file switch has already happened, and the settings UI / banner shows
 * any chain that didn't come back. Pass `resume: false` to skip fork startup
 * entirely (callers orchestrating their own resume).
 */
export async function activateSandboxBackup(
  sandboxDir: string,
  name: string,
  opts: { resume?: boolean } = {},
): Promise<ActivateSandboxBackupResult> {
  if (!BACKUP_NAME_RE.test(name)) {
    throw new Error(`Not a sandbox backup name: ${name}`);
  }
  const backupDir = join(sandboxDir, name);
  if (!existsSync(backupDir) || !statSync(backupDir).isDirectory()) {
    throw new Error(`No sandbox backup named ${name}.`);
  }

  await resetSandbox(sandboxDir);
  const archivedTo = archiveSandboxWorld(sandboxDir);

  // Restore by rename: the archive step above cleared every world entry out
  // of sandboxDir, so the only possible collision is `.env.local` (copied,
  // not moved — see archiveSandboxWorld), which POSIX rename replaces
  // atomically. Anything else in the backup (legacy variations included)
  // moves straight into place.
  for (const entry of readdirSync(backupDir)) {
    renameSync(join(backupDir, entry), join(sandboxDir, entry));
  }
  try {
    rmdirSync(backupDir);
  } catch {
    /* leftovers stay visible rather than silently deleted */
  }

  rebuildRestoredManifest(sandboxDir);
  const resume = opts.resume === false ? null : await resumeSandboxForks(sandboxDir);

  return { archivedTo, activated: name, forks: readManifest(sandboxDir), resume };
}
