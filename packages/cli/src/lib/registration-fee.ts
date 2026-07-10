import {
  type MandateFeeEstimate,
  assertFeeAffordable,
  describeMandateFee,
  getNativeCurrencySymbol,
} from "@sail/sdk";
import type { PublicClient } from "viem";

/** The pre-sign registration-fee gate for a mandate signing/register operation. */
export type RegistrationGate = {
  /** Total fee the kernel will charge for this signing (wei) = sum per permission. */
  totalFeeWei: bigint;
  /** Number of permissions this signing will register. */
  permissionCount: number;
  /** One-line factual disclosure to show the user before they sign. */
  disclosure: string;
};

// The gate runs BEFORE the owner signs, so the real registration calldata (which
// embeds that signature) isn't available to `estimateGas` yet — a pre-sign
// estimate would revert on signature verification. Instead price a
// conservatively-generous fixed gas ceiling at the live gas price: enough that a
// wallet clearing the gate can actually pay gas, without needing the signature
// first. Registration is a bounded kernel write (one ECDSA verify + per-permission
// storage writes); these ceilings comfortably exceed its real cost, and native gas
// on Sail's L2s is cheap, so the padding does not falsely reject a funded wallet.
const REGISTRATION_GAS_BASE = 250_000n;
const REGISTRATION_GAS_PER_PERMISSION = 200_000n;

/**
 * Estimate (wei) the gas the registration transaction will cost the agent
 * wallet: a padded gas ceiling scaled by permission count × the live gas price.
 * Fed into {@link registrationGate} so the affordability check covers fee + gas,
 * not the fee alone.
 */
export async function estimateRegistrationGasBudgetWei(
  publicClient: Pick<PublicClient, "getGasPrice">,
  permissionCount: number,
): Promise<bigint> {
  const gasPrice = await publicClient.getGasPrice();
  const n = BigInt(Math.max(1, permissionCount));
  const gasUnits = REGISTRATION_GAS_BASE + REGISTRATION_GAS_PER_PERMISSION * n;
  return gasUnits * gasPrice;
}

/**
 * Build the pre-sign registration gate from a mandate fee ESTIMATE — the flat
 * `permissionRegistrationFee × N` that is sent as the tx `value`, so the
 * disclosed/preflighted/charged/recorded numbers are provably identical.
 *
 * When `agentBalanceWei` is provided this preflights the signer's balance and
 * THROWS a typed `RegistrationFeeError` (from `assertFeeAffordable`) before any
 * signature is requested — re-wording a message can't silently disable it. Pass
 * `gasBudgetWei` (see {@link estimateRegistrationGasBudgetWei}) so the check
 * covers fee + gas; without it a wallet holding exactly the fee would clear the
 * gate and then fail on gas, wasting the owner's signature.
 */
export function registrationGate(args: {
  estimate: MandateFeeEstimate;
  agentBalanceWei?: bigint;
  /** The chain being registered on, used to label the fee with its native gas token. Defaults to ETH. */
  chainId?: number;
  /** Gas the registration tx will cost (wei); added to the fee in the affordability check. */
  gasBudgetWei?: bigint;
}): RegistrationGate {
  const { estimate, agentBalanceWei, chainId, gasBudgetWei = 0n } = args;
  const symbol = chainId !== undefined ? getNativeCurrencySymbol(chainId) : "ETH";
  if (agentBalanceWei !== undefined) {
    // Preflight FIRST: refuse to disclose-then-sign when the agent can't cover
    // fee + gas (gasBudgetWei is 0 only for callers that pass no estimate).
    assertFeeAffordable(agentBalanceWei, estimate.totalWei, symbol, gasBudgetWei);
  }
  return {
    totalFeeWei: estimate.totalWei,
    permissionCount: estimate.perPermission.length,
    disclosure: describeMandateFee(estimate, symbol),
  };
}
