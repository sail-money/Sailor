// Shapes of the JSON files Sailor persists under .sail/.
// Addresses are stored checksummed; bigints are stored as decimal strings.

import { persistAccount } from "@sail/sdk/accounts";
import { sailDir } from "./io.js";

export type StoredAccount = {
  safe: string;
  owner: string;
  permissionSigner: string;
  /** The currently active agent wallet address. */
  manager: string;
  /**
   * All known agent wallet addresses for this SMA. The active one is `manager`.
   * Populated on create (onboard) and extended on each successful rotation.
   */
  managers?: string[];
  chainId: number;
  createdAtBlock: string;
  /** CREATE2 salt used to deploy this Safe. Stored so `sailor account predict` can reproduce the address. */
  saltNonce?: string;
  /**
   * Chain IDs on which this SMA is confirmed deployed. Populated by `sailor account deploy-chain`.
   * The primary chain (chainId) is implicitly deployed even if absent from this list.
   */
  deployedChains?: number[];
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
 * via the CLI (onboard) shows up in the dashboard switcher —
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
 * `baseSailDir` defaults to the current project's `.sail/`. The signing-server
 * daemon passes its own `projectRoot/.sail` so a browser-created SMA lands in
 * the right project even when the daemon runs from a different cwd.
 */
export function upsertAccountInList(
  account: StoredAccount,
  name?: string,
  baseSailDir: string = sailDir(),
): void {
  // Delegates to the SDK's single account-state writer, which merges by `safe` into
  // state/accounts.json AND mirrors the merged record into account.json (both files stay
  // in sync). Callers no longer write account.json separately.
  persistAccount(name != null ? { ...account, name } : account, baseSailDir);
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
  // Optional legacy field. Registration authority is on-chain (via mandateRegister),
  // not a local EIP-712 signature — new writes omit it. Retained as optional so
  // older mandate.json files that carry it still parse.
  signature?: string;
  registeredOnChain: boolean;
  permissions: StoredMandatePermission[];
};

export type StoredSession = {
  safe: string;
  active: boolean;
  updatedAt: string;
};
