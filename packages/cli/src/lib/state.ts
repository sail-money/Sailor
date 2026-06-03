// Shapes of the JSON files Sailor persists under .sail/.
// Addresses are stored checksummed; bigints are stored as decimal strings.

import fs from "node:fs";
import path from "node:path";
import { nowIso, sailDir } from "./io.js";

export type StoredAccount = {
  safe: string;
  owner: string;
  permissionSigner: string;
  manager: string;
  chainId: number;
  createdAtBlock: string;
};

/**
 * One entry in `.sail/state/accounts.json` — the multi-SMA list the dashboard's
 * account switcher reads (GET /api/accounts in packages/ui/server.js). It is a
 * StoredAccount plus a display `name` and the time it was added to the list.
 */
export type AccountListEntry = StoredAccount & {
  name: string;
  addedAt: string | null;
};

/**
 * Upserts a stored account into `.sail/state/accounts.json` so an SMA created
 * via the CLI (onboard / account create) shows up in the dashboard switcher —
 * not just in `account.json`, which only ever holds the single active SMA.
 *
 * Mirrors the UI server's `POST /api/account` logic (packages/ui/server.js) so
 * the CLI and the browser signing flow maintain accounts.json identically:
 *   - If the list doesn't exist yet, backfill it from the *current* account.json
 *     (the SMA created before the list was seeded) so adding another SMA never
 *     silently drops the first.
 *   - Append the new record only if its safe isn't already present.
 *
 * Call this BEFORE overwriting account.json with the new active SMA — the
 * backfill reads the previously-active account.json, so overwriting first would
 * lose the prior SMA.
 *
 * `baseSailDir` defaults to the current project's `.sail/`. The signing-station
 * daemon passes its own `projectRoot/.sail` so a browser-created SMA lands in
 * the right project even when the daemon runs from a different cwd.
 */
export function upsertAccountInList(
  account: StoredAccount,
  name?: string,
  baseSailDir: string = sailDir(),
): void {
  const accountsPath = path.join(baseSailDir, "state", "accounts.json");
  let accounts: AccountListEntry[] = [];
  try {
    accounts = JSON.parse(fs.readFileSync(accountsPath, "utf-8")) as AccountListEntry[];
  } catch {
    // No list yet: this is the first time we're seeding it. Backfill from the
    // currently-active account.json so a pre-existing SMA isn't dropped.
    try {
      const prev = JSON.parse(
        fs.readFileSync(path.join(baseSailDir, "account.json"), "utf-8"),
      ) as StoredAccount;
      if (prev?.safe) accounts.push({ ...prev, name: "SMA 1", addedAt: null });
    } catch {
      /* truly the first SMA — nothing to backfill */
    }
  }

  if (!accounts.find((a) => a.safe.toLowerCase() === account.safe.toLowerCase())) {
    accounts.push({
      ...account,
      name: name ?? `SMA ${accounts.length + 1}`,
      addedAt: nowIso(),
    });
  }

  fs.mkdirSync(path.join(baseSailDir, "state"), { recursive: true });
  fs.writeFileSync(accountsPath, `${JSON.stringify(accounts, null, 2)}\n`);
}

// Schema for .sail/mandate.json — written by mandateSign (mandate.ts), read by runCommand (run.ts).
// run.ts only checks existence (non-null gate); actual permissions are read from on-chain via
// readClient.mandate.list(). Keep this in sync with the write in packages/cli/src/commands/mandate.ts.
export type StoredMandatePermission = {
  template: string; // permission contract name/label
  params: unknown;  // {} for open mandate model
};

export type StoredMandate = {
  safe: string;
  chainId: number;
  signedAt: string;
  signature: string;          // "" for open mandate model (no local EIP-712 signing)
  registeredOnChain: boolean;
  permissions: StoredMandatePermission[];
};

export type StoredSession = {
  safe: string;
  active: boolean;
  updatedAt: string;
};
