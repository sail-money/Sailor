import { type Address, type PublicClient, formatEther } from "viem";
import { SailGovernanceAbi } from "./abis/SailGovernance.js";

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * Estimate the exact fee (in wei) the kernel charges to register a permission.
 *
 * The deployed Base / Base-Sepolia governance uses the LEGACY model:
 *
 *   fee = min(baseFee, cap) + min(byteLength * complexityRate, cap), capped at cap
 *
 * where byteLength is the deployed permission's runtime bytecode length and
 * cap = MAX_PERMISSION_FEE_WEI. Newer governance may instead expose a flat
 * permissionRegistrationFee(); if the legacy views are missing we fall back to
 * that. The fee must be sent exactly: underpaying reverts with InsufficientFee,
 * and overpaying (e.g. sending the cap) needlessly ties up the agent's balance.
 *
 * This is THE single source of truth for the registration fee: it is the value
 * sent as the on-chain tx `value`, and therefore the value that must be
 * disclosed, preflighted, and recorded. Because the legacy model varies with a
 * permission's bytecode length, the per-permission fee is NOT uniform in
 * general — a mandate's total is the SUM of this over each permission, not a
 * flat parameter × N (see estimateMandateRegistrationFee).
 */
export async function estimatePermissionFee(
  publicClient: PublicClient,
  governance: Address,
  permission: Address,
): Promise<bigint> {
  try {
    const [baseFee, complexityRate, cap, code] = await Promise.all([
      publicClient.readContract({
        address: governance,
        abi: SailGovernanceAbi,
        functionName: "baseFee",
      }) as Promise<bigint>,
      publicClient.readContract({
        address: governance,
        abi: SailGovernanceAbi,
        functionName: "complexityRate",
      }) as Promise<bigint>,
      publicClient.readContract({
        address: governance,
        abi: SailGovernanceAbi,
        functionName: "MAX_PERMISSION_FEE_WEI",
      }) as Promise<bigint>,
      publicClient.getBytecode({ address: permission }),
    ]);
    const byteLength = code ? BigInt((code.length - 2) / 2) : 0n;
    const fee = min(baseFee, cap) + min(byteLength * complexityRate, cap);
    return min(fee, cap);
  } catch {
    // Newer governance: flat fee.
    return publicClient.readContract({
      address: governance,
      abi: SailGovernanceAbi,
      functionName: "permissionRegistrationFee",
    }) as Promise<bigint>;
  }
}

/** The exact fee a single permission will be charged on registration. */
export type PermissionFee = {
  permission: Address;
  feeWei: bigint;
};

/** The total registration fee for a mandate, with the per-permission breakdown. */
export type MandateFeeEstimate = {
  /** Sum of the per-permission fees — the total wei the kernel will charge. */
  totalWei: bigint;
  /** The exact fee for each permission, in the order given. */
  perPermission: PermissionFee[];
};

/**
 * Estimate the TOTAL registration fee for a mandate of `permissions`, as the SUM
 * of the exact per-permission fee each one is charged (`estimatePermissionFee`,
 * the same value sent as the tx `value`).
 *
 * This is the single source of truth for disclosure, preflight, and the recorded
 * fee — they all derive from this so the disclosed, preflighted, charged, and
 * logged numbers are provably the same. The per-permission fee is read live and
 * is NOT assumed uniform (the legacy model varies with bytecode length).
 */
export async function estimateMandateRegistrationFee(
  publicClient: PublicClient,
  governance: Address,
  permissions: Address[],
): Promise<MandateFeeEstimate> {
  const perPermission = await Promise.all(
    permissions.map(async (permission) => ({
      permission,
      feeWei: await estimatePermissionFee(publicClient, governance, permission),
    })),
  );
  const totalWei = perPermission.reduce((sum, p) => sum + p.feeWei, 0n);
  return { totalWei, perPermission };
}

/**
 * Plain-language disclosure of a mandate's registration fee, derived from the
 * actual per-permission charges. Shows the "N × fee" breakdown only when every
 * permission is charged the same amount (the flat-governance case); otherwise it
 * states the true total for N permissions without a misleading uniform rate.
 *
 * Factual cost statement only — no price/value framing.
 */
export function describeMandateFee(estimate: MandateFeeEstimate): string {
  const count = estimate.perPermission.length;
  const noun = count === 1 ? "permission" : "permissions";
  if (count === 0) return "Registration fee: 0 ETH (no new permissions to register)";
  const fees = estimate.perPermission.map((p) => p.feeWei);
  const uniform = fees.every((f) => f === fees[0]);
  if (uniform) {
    return `Registration fee: ${formatEther(estimate.totalWei)} ETH (${count} ${noun} × ${formatEther(fees[0])} ETH)`;
  }
  return `Registration fee: ${formatEther(estimate.totalWei)} ETH for ${count} ${noun}`;
}

/** Thrown when a signer cannot cover the registration fee. A typed error so the
 *  preflight block can't be silently disabled by re-wording a message string. */
export class RegistrationFeeError extends Error {
  /** Total fee required (wei). */
  readonly requiredWei: bigint;
  /** Signer balance available (wei). */
  readonly balanceWei: bigint;
  constructor(message: string, requiredWei: bigint, balanceWei: bigint) {
    super(message);
    this.name = "RegistrationFeeError";
    this.requiredWei = requiredWei;
    this.balanceWei = balanceWei;
  }
}

/** Shortfall (wei) between `balanceWei` and the total fee, or `0n` if covered. */
export function feeShortfall(balanceWei: bigint, totalFeeWei: bigint): bigint {
  return balanceWei >= totalFeeWei ? 0n : totalFeeWei - balanceWei;
}

/**
 * Throw a {@link RegistrationFeeError} when `balanceWei` cannot cover the total
 * registration fee. Call this BEFORE prompting the owner to sign so an
 * underfunded signer fails early rather than after a wasted signature or an
 * on-chain revert. Scoped to the fee itself — gas is a separate concern.
 */
export function assertFeeAffordable(balanceWei: bigint, totalFeeWei: bigint): void {
  if (balanceWei < totalFeeWei) {
    throw new RegistrationFeeError(
      `Insufficient ETH for the ${formatEther(totalFeeWei)} ETH registration fee; ` +
        `signer balance is ${formatEther(balanceWei)} ETH.`,
      totalFeeWei,
      balanceWei,
    );
  }
}
