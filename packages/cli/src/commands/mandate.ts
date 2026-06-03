import { confirm, readJsonFile, sailPath, writeJsonFile } from "../lib/io.js";
import { MandateStore } from "../lib/mandates.js";
import type { StoredAccount, StoredMandate } from "../lib/state.js";
import { mandateAttach } from "./mandate-contracts.js";

/**
 * A permission contract tracked for the active SMA, derived from the
 * MandateStore (`.sail/state/mandates.json`) — the source of truth for the
 * permissions this project has deployed and attached.
 */
type TrackedPermission = {
  address: string;
  label: string;
  /** True when the store records an attachment of this permission to this SMA. */
  registeredOnSma: boolean;
  /** ISO timestamp the permission was registered on this SMA, if known. */
  attachedAt?: string;
};

/** The simple draft the UI reads to display the SMA's permission set. */
type MandateDraft = {
  account: string;
  chainId: number;
  permissions: Array<{ address: string; label: string }>;
  createdAt: string;
};

/**
 * Permissions tracked for the account's chain, annotated with whether the store
 * shows them registered on this specific SMA.
 */
function trackedPermissionsFor(account: StoredAccount): TrackedPermission[] {
  const store = new MandateStore();
  return store
    .list()
    .filter((m) => m.chainId === account.chainId)
    .map((m) => {
      const attachment = m.attachments?.find(
        (a) => a.sma.toLowerCase() === account.safe.toLowerCase(),
      );
      return {
        address: m.address,
        label: m.name,
        registeredOnSma: !!attachment,
        attachedAt: attachment?.at,
      };
    });
}

/** Guidance printed when no permissions have been authored/deployed yet. */
function printNoPermissionsGuidance(): void {
  console.log(
    "\nNo permissions registered yet.\n" +
      "  1. Write your permission contract in mandates/ (start from AllowlistTargetMandate.sol)\n" +
      "  2. forge build\n" +
      "  3. sailor mandate deploy --contract <Name> --attach --sma <yourSMA>",
  );
}

/**
 * `sailor mandate prepare` — lists the permission contracts attached to the
 * active SMA (from the MandateStore) and writes a simple
 * `.sail/mandate-draft.json` the UI can display. Sailor does not ship a blessed
 * library of permission templates: users author, deploy, and register their own
 * IPermission contracts (see templates/custom-mandate/).
 */
export async function mandatePrepare(): Promise<void> {
  const account = readJsonFile<StoredAccount>(sailPath("account.json"));
  if (!account) {
    throw new Error('No account found at .sail/account.json.\nRun "sailor account create" first.');
  }

  const permissions = trackedPermissionsFor(account);
  if (permissions.length === 0) {
    printNoPermissionsGuidance();
    return;
  }

  console.log(`\n${permissions.length} permission(s) tracked for SMA ${account.safe}:\n`);
  for (const p of permissions) {
    const status = p.registeredOnSma
      ? `registered on this SMA${p.attachedAt ? ` (${p.attachedAt})` : ""}`
      : "not yet registered on this SMA";
    console.log(`• ${p.label}`);
    console.log(`    ${p.address}`);
    console.log(`    ${status}`);
  }

  const draft: MandateDraft = {
    account: account.safe,
    chainId: account.chainId,
    permissions: permissions.map((p) => ({ address: p.address, label: p.label })),
    createdAt: new Date().toISOString(),
  };
  writeJsonFile(sailPath("mandate-draft.json"), draft);
  console.log("\nDraft written to .sail/mandate-draft.json for the UI to display.");
}

/**
 * `sailor mandate sign` — reviews and confirms the permission contracts attached
 * to the active SMA. On-chain registration happens via `sailor mandate attach`;
 * for any tracked permission not yet registered on this SMA, this re-uses that
 * same RegisterPermission signing flow (see mandate-contracts.ts / onboard.ts).
 */
export async function mandateSign(): Promise<void> {
  const account = readJsonFile<StoredAccount>(sailPath("account.json"));
  if (!account) {
    throw new Error('No account found at .sail/account.json.\nRun "sailor account create" first.');
  }

  const permissions = trackedPermissionsFor(account);
  if (permissions.length === 0) {
    printNoPermissionsGuidance();
    return;
  }

  console.log(`\nPermissions tracked for SMA ${account.safe}:\n`);
  for (const p of permissions) {
    console.log(`• ${p.label}  (${p.address})`);
    console.log(`    ${p.registeredOnSma ? "registered on-chain" : "NOT yet registered on this SMA"}`);
  }
  console.log(
    "\nNote: `sailor mandate sign` reviews and confirms the permissions attached to your SMA.\n" +
      "On-chain registration happens via `sailor mandate attach` (or `sailor mandate deploy --attach`).",
  );

  const proceed = await confirm(
    `Confirm these ${permissions.length} permission(s) are authorized for your SMA?`,
  );
  if (!proceed) {
    console.log("No permissions confirmed.");
    return;
  }

  const unregistered = permissions.filter((p) => !p.registeredOnSma);
  if (unregistered.length === 0) {
    console.log(`\n✓ Confirmed ${permissions.length} permission(s) for ${account.safe}.`);
  } else {
    console.log(
      `\n${unregistered.length} permission(s) are not yet registered on this SMA. Initiating registration…`,
    );
    for (const p of unregistered) {
      await mandateAttach({ address: p.address, sma: account.safe, label: p.label });
    }
  }

  // Write .sail/mandate.json so `sailor run` can proceed.
  // Schema: StoredMandate — runner only gate-checks existence; actual permissions
  // are read from on-chain via readClient.mandate.list().
  // signature is empty here because registration is done via mandateAttach, not
  // a single EIP-712 signing step.
  const storedMandate: StoredMandate = {
    safe: account.safe,
    chainId: account.chainId,
    signedAt: new Date().toISOString(),
    signature: "",
    registeredOnChain: true,
    permissions: permissions.map((p) => ({ template: p.label, params: {} })),
  };
  writeJsonFile(sailPath("mandate.json"), storedMandate);
  console.log(`\n✓ Saved to .sail/mandate.json — agent is ready to run.`);
}
