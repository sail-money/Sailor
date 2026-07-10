import { type Address, type PublicClient, formatEther } from "viem";
import { SailGovernanceAbi } from "./abis/SailGovernance.js";

/**
 * Read the live FLAT per-permission registration fee (wei) from governance —
 * `permissionRegistrationFee()`, the single scalar the kernel's
 * `_calcPermissionFee()` returns for EVERY charging path (registerPermission,
 * replacePermission, and the batch / deployAndAttach variants — the on-chain
 * function is named `deployAndAttach`; in Sailor and protocol vocabulary this
 * operation is permission registration).
 *
 * This is THE single source of truth for the registration fee. The kernel
 * charges `fee × N` for N permissions, bounded by MAX_PERMISSION_FEE_WEI
 * (0.01 ETH — the constitutional cap in SailGovernance) and refunding any excess; there is NO bytecode/size-based
 * component in the live contracts (that "variable" formula existed only in
 * stale protocol docs describing an abandoned design). Underpaying reverts with
 * InsufficientFee(required, provided).
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

/** The flat fee a single permission is charged on registration. */
export type PermissionFee = {
  permission: Address;
  feeWei: bigint;
};

/** The total registration fee for a mandate, with the per-permission breakdown. */
export type MandateFeeEstimate = {
  /** Total wei the kernel will require = flat fee × number of permissions. */
  totalWei: bigint;
  /** The flat fee attributed to each permission (uniform), in the order given. */
  perPermission: PermissionFee[];
};

/**
 * The TOTAL registration fee for a mandate of `permissions`: the flat
 * `permissionRegistrationFee` read ONCE and applied per permission (`fee × N`) —
 * exactly what the kernel charges (it requires `msg.value >= fee × n` for a
 * batch, flat per permission; excess is refunded).
 *
 * Single source of truth: disclosure, preflight, the tx `value`, and the
 * activity record all derive from this, so they are provably the same number
 * and provably the number the kernel will require.
 */
export async function estimateMandateRegistrationFee(
  publicClient: PublicClient,
  governance: Address,
  permissions: Address[],
): Promise<MandateFeeEstimate> {
  const flatFeeWei = await readPermissionRegistrationFee(publicClient, governance);
  const perPermission = permissions.map((permission) => ({ permission, feeWei: flatFeeWei }));
  const totalWei = flatFeeWei * BigInt(permissions.length);
  return { totalWei, perPermission };
}

/**
 * Plain-language disclosure of a mandate's flat registration fee, e.g.
 * `"Registration fee: 0.00003 ETH (3 permissions × 0.00001 ETH)"`.
 *
 * Factual cost statement only — no price/value framing. `symbol` is the
 * chain's native gas token (defaults to "ETH") — callers on a chain with its
 * own gas token (BSC → BNB, HyperEVM → HYPE) MUST pass the correct symbol;
 * the fee is always denominated in the chain's native token, never literally ETH.
 */
export function describeMandateFee(estimate: MandateFeeEstimate, symbol = "ETH"): string {
  const count = estimate.perPermission.length;
  if (count === 0) return `Registration fee: 0 ${symbol} (no new permissions to register)`;
  const noun = count === 1 ? "permission" : "permissions";
  const perFeeWei = estimate.perPermission[0].feeWei; // flat — identical for every permission
  return `Registration fee: ${formatEther(estimate.totalWei)} ${symbol} (${count} ${noun} × ${formatEther(perFeeWei)} ${symbol})`;
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
 * Throw a {@link RegistrationFeeError} when `balanceWei` cannot cover what the
 * registration will actually cost the signer: the fee PLUS `gasBudgetWei`, the
 * gas the registration transaction will burn. A wallet holding exactly the fee
 * clears a fee-only check, the owner signs, and the tx then fails on gas —
 * wasting the signature. Passing the gas budget closes that gap.
 *
 * Call this BEFORE prompting the owner to sign so an underfunded signer fails
 * early rather than after a wasted signature or an on-chain revert. `symbol` is
 * the chain's native gas token (defaults to "ETH"). `gasBudgetWei` defaults to
 * 0 (fee-only) for callers that genuinely only care about the fee; the register
 * paths pass a real estimate so `requiredWei` is fee + gas.
 */
export function assertFeeAffordable(
  balanceWei: bigint,
  totalFeeWei: bigint,
  symbol = "ETH",
  gasBudgetWei = 0n,
): void {
  const requiredWei = totalFeeWei + gasBudgetWei;
  if (balanceWei < requiredWei) {
    const gasPart =
      gasBudgetWei > 0n
        ? ` plus ~${formatEther(gasBudgetWei)} ${symbol} for gas (~${formatEther(requiredWei)} ${symbol} total)`
        : "";
    throw new RegistrationFeeError(
      `Insufficient ${symbol}: registration needs ${formatEther(totalFeeWei)} ${symbol} for the fee${gasPart}; ` +
        `agent wallet holds ${formatEther(balanceWei)} ${symbol}. ` +
        `Fund it with at least ${formatEther(requiredWei)} ${symbol}.`,
      requiredWei,
      balanceWei,
    );
  }
}
