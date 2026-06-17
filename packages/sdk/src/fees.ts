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

/**
 * Read the live per-permission registration fee (wei) directly from
 * SailGovernance's `permissionRegistrationFee()`.
 *
 * This is a PUBLIC protocol parameter — always read it on-chain, never hardcode
 * it. It is 0.00001 ETH on test deployments and a higher value in production,
 * and the SAME code must surface whichever value the connected chain returns.
 * Unlike {@link estimatePermissionFee} (which models the legacy
 * baseFee + complexity-per-bytecode formula and is what the kernel actually
 * charges per tx), this returns the flat governance parameter used to disclose
 * the cost of registering a mandate before the owner signs.
 */
export async function readPermissionRegistrationFee(
  publicClient: PublicClient,
  governance: Address,
): Promise<bigint> {
  return publicClient.readContract({
    address: governance,
    abi: SailGovernanceAbi,
    functionName: "permissionRegistrationFee",
  }) as Promise<bigint>;
}

/**
 * Total registration fee (wei) for a mandate of `permissionCount` permissions.
 *
 * A mandate is a SET of permissions, and each one is charged the per-permission
 * fee on registration, so the total cost is `perPermissionFee × permissionCount`.
 */
export function totalRegistrationFee(perPermissionFee: bigint, permissionCount: number): bigint {
  if (!Number.isInteger(permissionCount) || permissionCount < 0) {
    throw new Error(`permissionCount must be a non-negative integer, got ${permissionCount}`);
  }
  return perPermissionFee * BigInt(permissionCount);
}

/**
 * Plain-language disclosure of what registering `permissionCount` permissions
 * will cost, e.g. `"Registration fee: 0.00003 ETH (3 permissions × 0.00001 ETH)"`.
 *
 * Factual cost statement only — no price/value framing.
 */
export function describeRegistrationFee(perPermissionFee: bigint, permissionCount: number): string {
  const total = totalRegistrationFee(perPermissionFee, permissionCount);
  const noun = permissionCount === 1 ? "permission" : "permissions";
  return `Registration fee: ${formatEther(total)} ETH (${permissionCount} ${noun} × ${formatEther(perPermissionFee)} ETH)`;
}

/**
 * Shortfall (wei) between `balanceWei` and the total registration fee, or `0n`
 * when the balance covers it. Lets callers preflight before signing instead of
 * letting an underfunded registration hit an on-chain revert.
 */
export function registrationFeeShortfall(
  balanceWei: bigint,
  perPermissionFee: bigint,
  permissionCount: number,
): bigint {
  const total = totalRegistrationFee(perPermissionFee, permissionCount);
  return balanceWei >= total ? 0n : total - balanceWei;
}

/**
 * Throws a clear, user-facing error when `balanceWei` cannot cover the total
 * registration fee. Call this BEFORE prompting the owner to sign so an
 * underfunded signer fails early rather than after a wasted signature or an
 * on-chain revert.
 */
export function assertRegistrationFeeAffordable(
  balanceWei: bigint,
  perPermissionFee: bigint,
  permissionCount: number,
): void {
  const total = totalRegistrationFee(perPermissionFee, permissionCount);
  if (balanceWei < total) {
    throw new Error(
      `Insufficient ETH for the ${formatEther(total)} ETH registration fee ` +
        `(${permissionCount} × ${formatEther(perPermissionFee)} ETH); ` +
        `signer balance is ${formatEther(balanceWei)} ETH.`,
    );
  }
}
