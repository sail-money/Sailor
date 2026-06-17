import {
  assertRegistrationFeeAffordable,
  describeRegistrationFee,
  totalRegistrationFee,
} from "@sail/sdk";

/** The pre-sign registration-fee gate for a mandate signing/attach operation. */
export type RegistrationGate = {
  /** Per-permission fee read live from SailGovernance (wei). */
  perPermissionFeeWei: bigint;
  /** Number of permissions this signing will register. */
  permissionCount: number;
  /** Total fee that will be paid on registration (wei) = fee × permissionCount. */
  totalFeeWei: bigint;
  /** One-line factual disclosure to show the user before they sign. */
  disclosure: string;
};

/**
 * Build the pre-sign registration gate for a mandate signing/attach operation.
 *
 * Computes the total fee and the disclosure line and — when `agentBalanceWei`
 * is provided — preflights the signer's balance, THROWING a clear error before
 * any signature is requested so an underfunded agent fails early instead of
 * hitting an on-chain revert.
 *
 * `perPermissionFeeWei` must be read live from governance by the caller (see
 * `readPermissionRegistrationFee`) — it is never hardcoded.
 */
export function registrationGate(args: {
  perPermissionFeeWei: bigint;
  permissionCount: number;
  agentBalanceWei?: bigint;
}): RegistrationGate {
  const { perPermissionFeeWei, permissionCount, agentBalanceWei } = args;
  if (agentBalanceWei !== undefined) {
    // Preflight FIRST: refuse to disclose-then-sign when the agent can't pay.
    assertRegistrationFeeAffordable(agentBalanceWei, perPermissionFeeWei, permissionCount);
  }
  return {
    perPermissionFeeWei,
    permissionCount,
    totalFeeWei: totalRegistrationFee(perPermissionFeeWei, permissionCount),
    disclosure: describeRegistrationFee(perPermissionFeeWei, permissionCount),
  };
}
