// Single owner of the on-disk SMA state under `.sail/`.
//
// `state/accounts.json` (the master list of every known SMA) is the source of truth. Each entry
// carries a `selected` flag (the SMA the UI renders / operates on — exactly one, or none after a
// reset). Which SMA the agent RUNS is no longer a per-account flag: `sailor run` is driven entirely
// by execution strategies (`.sail/strategies/strategies.json`), where each step names its own SMA.
//
// TRANSITIONAL: `account.json` is still written as a verbatim mirror of the `selected` entry, so
// every existing reader keeps working unchanged. The one line that would delete it (flag-only
// cutover) is left commented in `commit()` with a TODO — flip it there when ready.
//
// `persistAccount` MERGES by `safe`, so a partial write can never drop a stored field
// (saltNonce / managers / deployedChains / txHash / name / addedAt / flags).
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
  /** The SMA the UI renders / operates on. Exactly one entry is `selected` (or none after a reset). */
  selected?: boolean;
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

// ── Load / commit — flags live on `state/accounts.json`; account.json mirrors `selected`. ─────

/**
 * Read the list with the `selected`/`executable` flags guaranteed. Pure — never writes.
 *
 * Migration is lazy: a list that predates the flags (no entry defines the key) has `selected`
 * derived from the legacy `account.json.safe` (else the first entry), and `executable` defaulted
 * to `selected`. A list where the key IS present but every value is false (a deliberate reset via
 * `clearActiveAccount`) is respected as-is — we do NOT re-derive a selection.
 */
function load(sailDir: string): AccountRecord[] {
  const list = readJson<AccountRecord[]>(listPath(sailDir));
  // Read account.json DIRECTLY (never via readActiveAccount, which calls back into load).
  const legacy = readJson<AccountRecord>(accountPath(sailDir));
  let accounts: AccountRecord[] = Array.isArray(list) ? list.slice() : [];
  if (accounts.length === 0 && legacy?.safe) {
    accounts = [{ ...legacy, name: legacy.name ?? "SMA 1", addedAt: legacy.addedAt ?? null }];
  }
  if (accounts.length === 0) return accounts;

  // selection migration — only when no entry defines the key yet. `selected` mirrors what
  // account.json used to mean: the pointed-at SMA is active; NO account.json ⇒ nothing selected
  // (a list entry alone never made an SMA active). An all-false list (a deliberate reset via
  // clearActiveAccount) also has the key present, so it is respected here, not re-derived.
  if (accounts.every((a) => a.selected === undefined)) {
    if (legacy?.safe) {
      let sel = accounts.findIndex((a) => sameAddr(a.safe, legacy.safe));
      if (sel === -1) {
        // account.json points at an SMA not in the list — old readActiveAccount returned it
        // regardless, so inject it as the selected entry rather than picking a list member.
        accounts.push({ ...legacy, name: legacy.name ?? "SMA 1", addedAt: legacy.addedAt ?? null });
        sel = accounts.length - 1;
      }
      accounts = accounts.map((a, i) => ({ ...a, selected: i === sel }));
    } else {
      accounts = accounts.map((a) => ({ ...a, selected: false }));
    }
  }
  return accounts;
}

/**
 * Write the list, then mirror the `selected` entry into `account.json` (transitional — see the
 * file header). `readActiveAccount` still resolves from the flag, so the mirror is purely for
 * back-compat with any external reader.
 */
function commit(accounts: AccountRecord[], sailDir: string): void {
  fs.mkdirSync(path.join(sailDir, "state"), { recursive: true });
  writeJson(listPath(sailDir), accounts);
  // TODO: flag-only cutover — once `selected` is the sole source of truth, stop mirroring
  // and delete account.json here instead of writing it:
  // fs.rmSync(accountPath(sailDir), { force: true });
  const selected = accounts.find((a) => a.selected);
  if (selected) writeJson(accountPath(sailDir), selected);
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** The SMA the UI renders / operates on (the `selected` entry), or null before one exists. */
export function readActiveAccount(sailDir: string = defaultSailDir()): AccountRecord | null {
  return load(sailDir).find((a) => a.selected) ?? null;
}

/** The active SMA's address, or null. */
export function readActiveSafe(sailDir: string = defaultSailDir()): string | null {
  return readActiveAccount(sailDir)?.safe ?? null;
}

/**
 * Every known SMA (`state/accounts.json`), each annotated with a derived `active` boolean
 * (= `selected`). The `selected` flag rides along on each entry. Returns `[]`
 * when there is nothing at all.
 */
export function listAccounts(sailDir: string = defaultSailDir()): ListedAccount[] {
  return load(sailDir).map((a) => ({ ...a, active: !!a.selected }));
}

// ── Writes (source of truth = the list; account.json mirrors the selected entry) ──────────────

/**
 * Merge-upsert an SMA by `safe` (defaults to the selected safe) into `state/accounts.json`.
 * Only defined values overwrite; unioned lists and stored fields survive. The merged SMA becomes
 * the `selected` one (mirrors the old "writes account.json"). This is the sole writer of new/updated
 * SMA state.
 */
export function persistAccount(fields: AccountFields, sailDir: string = defaultSailDir()): AccountRecord {
  const accounts = load(sailDir);
  const safe = fields.safe ?? accounts.find((a) => a.selected)?.safe;
  if (!safe) throw new Error("persistAccount: no target safe (none provided and no active account)");

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
  // The persisted SMA becomes the selected one; clear it elsewhere.
  for (const a of accounts) a.selected = a === record;
  commit(accounts, sailDir);
  return record;
}

/** Make a known SMA the UI-selected one. Returns it, or null. */
export function switchAccount(safe: string, sailDir: string = defaultSailDir()): AccountRecord | null {
  const accounts = load(sailDir);
  const target = accounts.find((a) => sameAddr(a.safe, safe));
  if (!target) return null;
  for (const a of accounts) a.selected = a === target;
  commit(accounts, sailDir);
  return target;
}

/** Rename an SMA in the list. */
export function renameAccount(safe: string, name: string, sailDir: string = defaultSailDir()): void {
  const accounts = load(sailDir);
  const idx = accounts.findIndex((a) => sameAddr(a.safe, safe));
  if (idx === -1) return;
  accounts[idx] = { ...accounts[idx], name };
  commit(accounts, sailDir);
}

/**
 * Clear the UI-selected pointer so the onboarding wizard shows again. Unsets `selected` on every
 * entry (persisted, so `load` won't re-derive one) while KEEPING the `executable` target, then
 * removes the legacy `account.json` mirror. The SMA list itself is left intact.
 */
export function clearActiveAccount(sailDir: string = defaultSailDir()): void {
  const accounts = load(sailDir).map((a) => ({ ...a, selected: false }));
  fs.mkdirSync(path.join(sailDir, "state"), { recursive: true });
  writeJson(listPath(sailDir), accounts);
  fs.rmSync(accountPath(sailDir), { force: true });
}
