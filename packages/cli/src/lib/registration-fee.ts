import {
  type MandateFeeEstimate,
  assertFeeAffordable,
  describeMandateFee,
  getNativeCurrencySymbol,
} from "@sail/sdk";

/** The pre-sign registration-fee gate for a mandate signing/attach operation. */
export type RegistrationGate = {
  /** Total fee the kernel will charge for this signing (wei) = sum per permission. */
  totalFeeWei: bigint;
  /** Number of permissions this signing will register. */
  permissionCount: number;
  /** One-line factual disclosure to show the user before they sign. */
  disclosure: string;
};

/**
 * Build the pre-sign registration gate from a mandate fee ESTIMATE — the flat
 * `permissionRegistrationFee × N` that is sent as the tx `value`, so the
 * disclosed/preflighted/charged/recorded numbers are provably identical.
 *
 * When `agentBalanceWei` is provided this preflights the signer's balance and
 * THROWS a typed `RegistrationFeeError` (from `assertFeeAffordable`) before any
 * signature is requested — re-wording a message can't silently disable it.
 */
export function registrationGate(args: {
  estimate: MandateFeeEstimate;
  agentBalanceWei?: bigint;
  /** The chain being registered on, used to label the fee with its native gas token. Defaults to ETH. */
  chainId?: number;
}): RegistrationGate {
  const { estimate, agentBalanceWei, chainId } = args;
  const symbol = chainId !== undefined ? getNativeCurrencySymbol(chainId) : "ETH";
  if (agentBalanceWei !== undefined) {
    // Preflight FIRST: refuse to disclose-then-sign when the agent can't pay.
    assertFeeAffordable(agentBalanceWei, estimate.totalWei, symbol);
  }
  return {
    totalFeeWei: estimate.totalWei,
    permissionCount: estimate.perPermission.length,
    disclosure: describeMandateFee(estimate, symbol),
  };
}
