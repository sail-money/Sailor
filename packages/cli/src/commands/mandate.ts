import {
  type MandateFeeEstimate,
  SailKernelAbi,
  describeMandateFee,
  estimateMandateRegistrationFee,
  getSailDeployment,
} from "@sail/sdk";
import { http, type Address, createPublicClient, formatEther } from "viem";
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

/**
 * The registration fee disclosed at sign time, read live at prepare time from
 * the SAME flat charge the kernel applies (permissionRegistrationFee × N).
 * Covers only the not-yet-registered permissions — the ones that will actually
 * be charged on sign. Optional: omitted when the fee can't be read (no RPC) or
 * when there is nothing new to register.
 */
type DraftRegistrationFee = {
  /** Flat per-permission fee (wei); the kernel charges this for each permission. */
  perPermissionWei?: string;
  /** Flat per-permission fee in ETH. */
  perPermissionEth?: string;
  /** Total fee (wei) for this mandate = sum of the per-permission charges. */
  totalWei: string;
  /** Total fee formatted in ETH. */
  totalEth: string;
  /** Number of not-yet-registered permissions the fee covers. */
  permissionCount: number;
  /** One-line factual cost disclosure for the UI. */
  disclosure: string;
};

/**
 * The permissions a sign/attach will actually be CHARGED for: tracked, not
 * revoked on-chain, and not yet registered on this SMA. `mandate prepare` and
 * `mandate sign` MUST use this same selection so their disclosed fee counts
 * agree (re-preparing a mandate with some permissions already registered must
 * not overstate the total).
 */
export function chargeablePermissions<T extends { revokedOnChain?: boolean; registeredOnSma: boolean }>(
  tracked: T[],
): T[] {
  return tracked.filter((p) => !p.revokedOnChain && !p.registeredOnSma);
}

/** The simple draft the UI reads to display the SMA's permission set. */
type MandateDraft = {
  account: string;
  chainId: number;
  permissions: Array<{ address: string; label: string; explanation?: PermissionExplanation }>;
  createdAt: string;
  registrationFee?: DraftRegistrationFee;
};

/**
 * Read the live mandate registration fee for `permissionAddresses` on `chainId`
 * — the flat permissionRegistrationFee × N, the same value sent as the tx value.
 * Returns null when it can't be read (no RPC) so callers degrade gracefully
 * instead of breaking. Pass only the not-yet-registered permissions, since those
 * are the ones actually charged.
 */
async function liveMandateFee(
  chainId: number,
  permissionAddresses: string[],
): Promise<MandateFeeEstimate | null> {
  if (permissionAddresses.length === 0) return { totalWei: 0n, perPermission: [] };
  try {
    const deployment = getSailDeployment(chainId);
    const rpcUrl = getRpcUrl(chainId) ?? getChainById(chainId).rpcUrls.default.http[0];
    const pc = createPublicClient({ chain: getChainById(chainId), transport: http(rpcUrl) });
    return await estimateMandateRegistrationFee(
      pc,
      deployment.governance,
      permissionAddresses as Address[],
    );
  } catch {
    return null;
  }
}

/** Build the draft fee block from a flat estimate. Every permission is charged
 *  the same flat fee, so the per-permission rate is always included. */
function draftFeeFromEstimate(estimate: MandateFeeEstimate): DraftRegistrationFee {
  const perFeeWei = estimate.perPermission[0]?.feeWei ?? 0n;
  return {
    perPermissionWei: perFeeWei.toString(),
    perPermissionEth: formatEther(perFeeWei),
    totalWei: estimate.totalWei.toString(),
    totalEth: formatEther(estimate.totalWei),
    permissionCount: estimate.perPermission.length,
    disclosure: describeMandateFee(estimate),
  };
}

/**
 * The chain a mandate operation targets. A multi-chain SMA has the same address
 * on every chain but an independent permission set per chain, so reconciliation,
 * the local-store filter, and the written snapshot must all key off the SAME
 * chain — the active one from ProjectContext (env CHAIN_ID / config), not the
 * SMA's primary `account.chainId`. Falls back to account.chainId when there's no
 * project context (then on-chain reconciliation is skipped).
 */
function resolveActiveChain(account: StoredAccount): { chainId: number; kernel: Address | null } {
  try {
    const project = new ProjectContext();
    return { chainId: project.chainId, kernel: project.contracts.kernel };
  } catch {
    return { chainId: account.chainId, kernel: null };
  }
}

/**
 * Query the kernel's live permission set for `safe` on `chainId`.
 * Returns a lowercased Set of registered permission addresses, or `null` when
 * the RPC or kernel is unavailable (callers fall back to local state).
 */
async function fetchOnChainPermissions(
  safe: Address,
  chainId: number,
  kernel: Address,
): Promise<Set<string> | null> {
  try {
    const rpcUrl = getRpcUrl(chainId) ?? getChainById(chainId).rpcUrls.default.http[0];
    const pc = createPublicClient({ chain: getChainById(chainId), transport: http(rpcUrl) });
    const onChain = (await pc.readContract({
      address: kernel,
      abi: SailKernelAbi,
      functionName: "getPermissions",
      args: [safe],
    })) as Address[];
    return new Set(onChain.map((a) => a.toLowerCase()));
  } catch {
    // RPC unavailable or kernel not reachable — fall back to local state only.
    return null;
  }
}

/**
 * Permissions tracked for the active chain, annotated with whether the store
 * shows them registered on this specific SMA and whether the on-chain kernel
 * still lists them (reconciliation against live state). Both the local-store
 * filter and the reconciliation key off the SAME `chainId`.
 */
async function trackedPermissionsFor(
  account: StoredAccount,
  chainId: number,
  kernel: Address | null,
): Promise<TrackedPermission[]> {
  const store = new MandateStore();
  const local: TrackedPermission[] = store
    .list()
    .filter((m) => m.chainId === chainId)
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
  const onChain = kernel ? await fetchOnChainPermissions(account.safe as Address, chainId, kernel) : null;
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
 * IPermission contracts (see examples/custom-mandate/).
 */
export async function mandatePrepare(): Promise<void> {
  const account = readJsonFile<StoredAccount>(sailPath("account.json"));
  if (!account) {
    throw new Error('No account found at .sail/account.json.\nRun "sailor onboard --new-sma" first.');
  }

  const { chainId, kernel } = resolveActiveChain(account);
  const permissions = await trackedPermissionsFor(account, chainId, kernel);
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
  // Only permissions not already registered on this SMA belong in the signing
  // draft — re-registering an already-registered permission reverts on-chain.
  const chargeable = chargeablePermissions(permissions);
  const draftPermissions = chargeable.map((p) => {
    const mandate = store.find(p.address);
    const explanation = explainPermission(p.label, mandate?.sourcePath) ?? undefined;
    return { address: p.address, label: p.label, explanation };
  });

  // Estimate the registration fee LIVE for the permissions that will actually be
  // charged on sign — the chargeable ones — so the count matches `sailor mandate
  // sign` and the browser screen never overstates the total when re-preparing a
  // mandate with some permissions already registered. Best-effort: if it can't be
  // estimated the draft still writes, just without the fee block. Skipped
  // entirely when nothing new is to be registered (no "0 permissions").
  let registrationFee: DraftRegistrationFee | undefined;
  const unregisteredAddresses = chargeable.map((p) => p.address);
  if (unregisteredAddresses.length > 0) {
    const estimate = await liveMandateFee(chainId, unregisteredAddresses);
    if (estimate !== null) registrationFee = draftFeeFromEstimate(estimate);
  }

  const draft: MandateDraft = {
    account: account.safe,
    chainId,
    permissions: draftPermissions,
    createdAt: new Date().toISOString(),
    ...(registrationFee ? { registrationFee } : {}),
  };
  writeJsonFile(sailPath("mandate-draft.json"), draft);
  if (registrationFee) console.log(`\n${registrationFee.disclosure}`);
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
    throw new Error('No account found at .sail/account.json.\nRun "sailor onboard --new-sma" first.');
  }

  const { chainId, kernel } = resolveActiveChain(account);
  const permissions = await trackedPermissionsFor(account, chainId, kernel);
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
  // active regardless of what the local store says. The chargeable subset (the
  // not-yet-registered ones) is the SAME selection `mandate prepare` uses, so
  // the disclosed fee counts agree.
  const activePermissions = permissions.filter((p) => !p.revokedOnChain);
  const unregistered = chargeablePermissions(permissions);

  // Disclose the registration fee BEFORE the user confirms. Only the
  // not-yet-registered permissions incur a fee now (already-registered ones were
  // paid for when they were first registered) — the same set and the same flat
  // per-permission charge (permissionRegistrationFee) the attach tx will send.
  // Best-effort, so a missing fee never blocks confirmation.
  if (unregistered.length > 0) {
    const estimate = await liveMandateFee(chainId, unregistered.map((p) => p.address));
    if (estimate !== null) {
      console.log(`\n${describeMandateFee(estimate)}`);
      console.log("  Paid by the agent wallet on registration, per permission.");
    }
  }

  const proceed = opts.yes || await confirm(
    `Confirm these ${activePermissions.length} permission(s) are authorized for your SMA?`,
  );
  if (!proceed) {
    console.log("No permissions confirmed.");
    return;
  }

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
  // No `signature` field: registration authority is on-chain (via mandateAttach),
  // not a single local EIP-712 signing step. Emitting an empty string here falsely
  // implied a missing/invalid signature, so it is omitted entirely.
  const storedMandate: StoredMandate = {
    safe: account.safe,
    chainId,
    signedAt: new Date().toISOString(),
    registeredOnChain: true,
    // Only include permissions that are currently active on-chain.
    permissions: activePermissions.map((p) => ({ template: p.label, params: {} })),
  };
  const existingRaw = readJsonFile<StoredMandate | StoredMandate[]>(sailPath("mandate.json"));
  const existing: StoredMandate[] = existingRaw
    ? Array.isArray(existingRaw) ? existingRaw : [existingRaw]
    : [];
  // mandate.json is chain-scoped: one entry per (safe, chainId). Replace the
  // entry for this SMA on this chain rather than appending, so re-signing
  // doesn't leave stale duplicates and other chains' entries are preserved.
  const deduped = existing.filter(
    (m) => !(m.safe?.toLowerCase() === account.safe.toLowerCase() && m.chainId === chainId),
  );
  writeJsonFile(sailPath("mandate.json"), [...deduped, storedMandate]);
  console.log(`\n✓ Saved to .sail/mandate.json — agent is ready to run.`);
}
