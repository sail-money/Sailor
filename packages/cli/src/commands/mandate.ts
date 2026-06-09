import { SailKernelAbi } from "@sail/sdk";
import { http, type Address, createPublicClient } from "viem";
import { getChainById, getRpcUrl } from "../lib/chain.js";
import { confirm, readJsonFile, sailPath, writeJsonFile } from "../lib/io.js";
import { MandateStore } from "../lib/mandates.js";
import { type PermissionExplanation, explainPermission } from "../lib/permission-explainer.js";
import { ProjectContext } from "../lib/project.js";
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
  /**
   * True when the local store records an attachment but the kernel's
   * getPermissions() no longer lists this address — i.e. it was revoked
   * on-chain after the local record was written.
   */
  revokedOnChain?: boolean;
};

/** The simple draft the UI reads to display the SMA's permission set. */
type MandateDraft = {
  account: string;
  chainId: number;
  permissions: Array<{ address: string; label: string; explanation?: PermissionExplanation }>;
  createdAt: string;
};

/**
 * Query the kernel's live permission set for `account.safe`.
 * Returns a lowercased Set of registered permission addresses, or `null` when
 * the RPC or project context is unavailable (callers fall back to local state).
 */
async function fetchOnChainPermissions(account: StoredAccount): Promise<Set<string> | null> {
  try {
    const project = new ProjectContext();
    const rpcUrl =
      getRpcUrl(project.chainId) ?? getChainById(project.chainId).rpcUrls.default.http[0];
    const pc = createPublicClient({
      chain: getChainById(project.chainId),
      transport: http(rpcUrl),
    });
    const onChain = (await pc.readContract({
      address: project.contracts.kernel,
      abi: SailKernelAbi,
      functionName: "getPermissions",
      args: [account.safe as Address],
    })) as Address[];
    return new Set(onChain.map((a) => a.toLowerCase()));
  } catch {
    // RPC unavailable or project not initialised — fall back to local state only.
    return null;
  }
}

/**
 * Permissions tracked for the account's chain, annotated with whether the store
 * shows them registered on this specific SMA and whether the on-chain kernel
 * still lists them (reconciliation against live state).
 */
async function trackedPermissionsFor(account: StoredAccount): Promise<TrackedPermission[]> {
  const store = new MandateStore();
  const local: TrackedPermission[] = store
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

  // Reconcile with live on-chain state: a locally-attached permission may have
  // been revoked on-chain (via `sailor mandate revoke` or externally).
  // mandates.json is kept as a historical record; revokedOnChain flags the delta.
  const onChain = await fetchOnChainPermissions(account);
  if (onChain !== null) {
    for (const p of local) {
      if (p.registeredOnSma && !onChain.has(p.address.toLowerCase())) {
        p.revokedOnChain = true;
      }
    }
  }

  return local;
}

/** Guidance printed when no permissions have been authored/deployed yet. */
function printNoPermissionsGuidance(): void {
  console.log(
    "\nNo permissions registered yet.\n" +
      "  1. Write your permission contract in mandates/ (start from BoundedCallPermission.sol)\n" +
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

  const permissions = await trackedPermissionsFor(account);
  if (permissions.length === 0) {
    printNoPermissionsGuidance();
    return;
  }

  console.log(`\n${permissions.length} permission(s) tracked for SMA ${account.safe}:\n`);
  for (const p of permissions) {
    const status = p.revokedOnChain
      ? "revoked on-chain (local record is stale)"
      : p.registeredOnSma
        ? `registered on this SMA${p.attachedAt ? ` (${p.attachedAt})` : ""}`
        : "not yet registered on this SMA";
    console.log(`• ${p.label}`);
    console.log(`    ${p.address}`);
    console.log(`    ${status}`);
  }

  const store = new MandateStore();
  const draft: MandateDraft = {
    account: account.safe,
    chainId: account.chainId,
    permissions: permissions
      .filter((p) => !p.revokedOnChain)
      .map((p) => {
        const mandate = store.find(p.address);
        const explanation = explainPermission(p.label, mandate?.sourcePath) ?? undefined;
        return { address: p.address, label: p.label, explanation };
      }),
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
export async function mandateSign(opts: { yes?: boolean } = {}): Promise<void> {
  const account = readJsonFile<StoredAccount>(sailPath("account.json"));
  if (!account) {
    throw new Error('No account found at .sail/account.json.\nRun "sailor account create" first.');
  }

  const permissions = await trackedPermissionsFor(account);
  if (permissions.length === 0) {
    printNoPermissionsGuidance();
    return;
  }

  console.log(`\nPermissions tracked for SMA ${account.safe}:\n`);
  for (const p of permissions) {
    console.log(`• ${p.label}  (${p.address})`);
    console.log(
      `    ${
        p.revokedOnChain
          ? "revoked on-chain (local record is stale)"
          : p.registeredOnSma
            ? "registered on-chain"
            : "NOT yet registered on this SMA"
      }`,
    );
  }
  console.log(
    "\nNote: `sailor mandate sign` reviews and confirms the permissions attached to your SMA.\n" +
      "On-chain registration happens via `sailor mandate attach` (or `sailor mandate deploy --attach`).",
  );

  // Exclude revoked-on-chain entries from the confirmation: they are no longer
  // active regardless of what the local store says.
  const activePermissions = permissions.filter((p) => !p.revokedOnChain);
  const proceed = opts.yes || await confirm(
    `Confirm these ${activePermissions.length} permission(s) are authorized for your SMA?`,
  );
  if (!proceed) {
    console.log("No permissions confirmed.");
    return;
  }

  const unregistered = activePermissions.filter((p) => !p.registeredOnSma);
  if (unregistered.length === 0) {
    console.log(`\n✓ Confirmed ${activePermissions.length} permission(s) for ${account.safe}.`);
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
    // Only include permissions that are currently active on-chain.
    permissions: activePermissions.map((p) => ({ template: p.label, params: {} })),
  };
  writeJsonFile(sailPath("mandate.json"), storedMandate);
  console.log(`\n✓ Saved to .sail/mandate.json — agent is ready to run.`);
}
