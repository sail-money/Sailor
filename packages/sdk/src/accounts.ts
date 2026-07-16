// Single owner of the on-disk SMA state under `.sail/`.
//
// TWO files, kept in sync by this module and this module ONLY — no other code path
// should read or write them directly:
//   - `account.json`          the ACTIVE SMA (a full copy of one list entry)
//   - `state/accounts.json`   the master list of every known SMA
//
// `persistAccount` MERGES by `safe`, so a partial write can never drop a stored field
// (saltNonce / managers / deployedChains / txHash / name / addedAt); it mirrors the merged
// record into `account.json` too, so the active copy and its list entry stay identical.
//
// `sailDir` is optional everywhere and defaults to `<cwd>/.sail` — CLI callers (always in the
// project cwd) omit it; the UI server and signing daemon pass their own dir (they run against
// an explicit project directory, not necessarily the cwd).

import fs from "node:fs";
import path from "node:path";
import { getAddress } from "viem";

export type AccountRecord = {
  safe: string;
  owner: string;
  permissionSigner: string;
  /** The currently-active agent wallet address. */
  manager: string;
  /** Every agent wallet ever active for this SMA; the active one is `manager`. */
  managers?: string[];
  chainId: number;
  createdAtBlock: string;
  /** CREATE2 salt used to deploy this Safe — reproduces the address on other chains. */
  saltNonce?: string;
  /** Chain IDs this SMA is deployed on (primary `chainId` implicit). */
  deployedChains?: number[];
  /** Registration tx hash, when recorded. */
  txHash?: string;
  /** Display name for the dashboard switcher. */
  name: string;
  /** ISO-8601 timestamp first added to the list; null for a legacy backfill. */
  addedAt: string | null;
};

/** Input to `persistAccount`: any subset of fields; `safe` picks the target (defaults to active). */
export type AccountFields = Partial<AccountRecord> & { safe?: string };

/** The list entry shape, annotated with the derived `active` flag on read. */
export type ListedAccount = AccountRecord & { active: boolean };

/** `<cwd>/.sail` — the default project state directory. */
export function defaultSailDir(): string {
  return path.join(process.cwd(), ".sail");
}

const accountPath = (sailDir: string): string => path.join(sailDir, "account.json");
const listPath = (sailDir: string): string => path.join(sailDir, "state", "accounts.json");

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

const writeJson = (file: string, data: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};

const sameAddr = (a?: string | null, b?: string | null): boolean =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

// ── Union helpers — a merge must never SHRINK a stored list. ────────────────
function uniqNums(...sources: unknown[]): number[] {
  const out: number[] = [];
  for (const s of sources) {
    for (const v of Array.isArray(s) ? s : [s]) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
    }
  }
  return out;
}
function uniqAddrs(...sources: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    for (const v of Array.isArray(s) ? s : [s]) {
      if (!v || typeof v !== "string") continue;
      let a: string;
      try {
        a = getAddress(v);
      } catch {
        continue;
      }
      const l = a.toLowerCase();
      if (!seen.has(l)) {
        seen.add(l);
        out.push(a);
      }
    }
  }
  return out;
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** The active SMA (`account.json`), or null before one exists. */
export function readActiveAccount(sailDir: string = defaultSailDir()): AccountRecord | null {
  return readJson<AccountRecord>(accountPath(sailDir));
}

/** The active SMA's address, or null. */
export function readActiveSafe(sailDir: string = defaultSailDir()): string | null {
  return readActiveAccount(sailDir)?.safe ?? null;
}

/**
 * Every known SMA (`state/accounts.json`), each annotated with a derived `active` boolean
 * (the entry whose `safe` matches `account.json`). Falls back to the single active account
 * when no list exists yet, and to `[]` when there is nothing at all.
 */
export function listAccounts(sailDir: string = defaultSailDir()): ListedAccount[] {
  const active = readActiveSafe(sailDir);
  const list = readJson<AccountRecord[]>(listPath(sailDir));
  if (Array.isArray(list)) {
    return list.map((a) => ({ ...a, active: sameAddr(a.safe, active) }));
  }
  const single = readActiveAccount(sailDir);
  if (single?.safe) {
    return [{ ...single, name: single.name ?? "My SMA", addedAt: single.addedAt ?? null, active: true }];
  }
  return [];
}

// ── Writes (each keeps account.json and its list entry identical) ─────────────

/**
 * Merge-upsert an SMA by `safe` (defaults to the active safe) into `state/accounts.json`, then
 * mirror the merged record into `account.json`. Only defined values overwrite; unioned lists and
 * stored fields survive. This is the sole writer of new/updated SMA state.
 */
export function persistAccount(fields: AccountFields, sailDir: string = defaultSailDir()): AccountRecord {
  const safe = fields.safe ?? readActiveSafe(sailDir);
  if (!safe) throw new Error("persistAccount: no target safe (none provided and no active account)");

  fs.mkdirSync(path.join(sailDir, "state"), { recursive: true });
  // Load the list; if absent, backfill from the currently-active account.json so
  // registering a second SMA never silently drops the first.
  let accounts: AccountRecord[] = [];
  const existingList = readJson<AccountRecord[]>(listPath(sailDir));
  if (Array.isArray(existingList)) {
    accounts = existingList;
  } else {
    const prev = readActiveAccount(sailDir);
    if (prev?.safe) accounts.push({ ...prev, name: prev.name ?? "SMA 1", addedAt: prev.addedAt ?? null });
  }

  const idx = accounts.findIndex((a) => sameAddr(a.safe, safe));
  const existing = (idx === -1 ? {} : accounts[idx]) as Partial<AccountRecord>;
  // Only defined values overwrite; everything already on disk survives. Built as a loose
  // record so the presence checks below don't fight the required-field types.
  const defined = Object.fromEntries(
    Object.entries({ ...fields, safe }).filter(([, v]) => v != null),
  );
  const merged: Record<string, unknown> = { ...existing, ...defined };
  // Never shrink the confirmed-chain list or the manager history.
  merged.deployedChains = uniqNums(existing.deployedChains, fields.deployedChains, merged.chainId);
  merged.managers = uniqAddrs(existing.managers, existing.manager, fields.managers, merged.manager);
  // SMA-shape defaults, only when truly absent.
  merged.permissionSigner ??= merged.owner;
  merged.manager ??= merged.owner;
  merged.createdAtBlock ??= "0";
  merged.name ??= fields.name ?? `SMA ${accounts.length + 1}`;
  if (!("addedAt" in merged)) merged.addedAt = fields.addedAt ?? new Date().toISOString();

  const record = merged as AccountRecord;
  if (idx === -1) accounts.push(record);
  else accounts[idx] = record;
  writeJson(listPath(sailDir), accounts);
  writeJson(accountPath(sailDir), record);
  return record;
}

/** Make a known SMA the active one: copy its list entry → account.json. Returns it, or null. */
export function switchAccount(safe: string, sailDir: string = defaultSailDir()): AccountRecord | null {
  const list = readJson<AccountRecord[]>(listPath(sailDir));
  const target = Array.isArray(list) ? list.find((a) => sameAddr(a.safe, safe)) : null;
  if (!target) return null;
  writeJson(accountPath(sailDir), target);
  return target;
}

/** Rename an SMA in the list; keep `account.json` in step when it is the active one. */
export function renameAccount(safe: string, name: string, sailDir: string = defaultSailDir()): void {
  const list = readJson<AccountRecord[]>(listPath(sailDir));
  if (!Array.isArray(list)) return;
  const idx = list.findIndex((a) => sameAddr(a.safe, safe));
  if (idx === -1) return;
  list[idx] = { ...list[idx], name };
  writeJson(listPath(sailDir), list);
  if (sameAddr(readActiveSafe(sailDir), safe)) writeJson(accountPath(sailDir), list[idx]);
}

/** Clear the active pointer (remove account.json). The list is left intact. */
export function clearActiveAccount(sailDir: string = defaultSailDir()): void {
  fs.rmSync(accountPath(sailDir), { force: true });
}
