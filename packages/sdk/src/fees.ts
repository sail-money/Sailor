import type { Address, PublicClient } from "viem";
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
