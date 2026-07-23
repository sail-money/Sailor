import { explainKernelRevert } from "@sail/sdk";
import type { Address, Hex, PublicClient, TransactionReceipt } from "viem";

/**
 * Permission-registration deadline lifecycle (S5).
 *
 * The signed EIP-712 RegisterPermission message carries a `deadline`. Because the
 * owner signs in the browser, an arbitrary amount of wall-clock passes between
 * stamping the deadline and submitting the tx. The signing channel waits up to
 * 10 minutes (`requestSignature` default), so a deadline shorter than that is
 * guaranteed to lapse during a legitimately slow sign — the tx then reverts with
 * DeadlineExpired and the owner's gas-paying agent eats a wasted submit.
 *
 * Fixes:
 *  - `registrationDeadline()` stamps a window that comfortably exceeds the sign
 *    wait plus a submit buffer (was a flat 300s == the old sign wait, i.e. zero
 *    headroom).
 *  - `assertSignatureFresh()` is a submit-time guard: if the signed deadline has
 *    (nearly) lapsed by the time we're about to send, we refuse to submit a
 *    guaranteed-revert tx and tell the operator to re-sign — no gas spent.
 *  - `describeRegisterRevert()` decodes an actual on-chain revert so an expired
 *    deadline reads as "deadline expired", not a generic "reverted".
 */

/** Upper bound the browser signing channel waits for a signature (seconds). */
export const REGISTER_SIGN_WAIT_SEC = 600;
/** Headroom past the sign wait for submit + confirmation (seconds). */
export const REGISTER_SUBMIT_BUFFER_SEC = 180;
/** Below this remaining headroom at submit time, treat the signature as stale. */
export const REGISTER_MIN_SUBMIT_HEADROOM_SEC = 30;

/** Default total deadline window: sign wait + submit buffer. */
export const DEFAULT_REGISTER_DEADLINE_SEC = REGISTER_SIGN_WAIT_SEC + REGISTER_SUBMIT_BUFFER_SEC;

/**
 * Stamp a registration deadline (unix seconds) `windowSec` ahead of now.
 * Defaults to a window that outlasts the signing wait — override via a CLI flag
 * for unusually slow signing setups.
 */
export function registrationDeadline(windowSec: number = DEFAULT_REGISTER_DEADLINE_SEC): bigint {
  const w =
    Number.isFinite(windowSec) && windowSec > 0
      ? Math.floor(windowSec)
      : DEFAULT_REGISTER_DEADLINE_SEC;
  return BigInt(Math.floor(Date.now() / 1000) + w);
}

/**
 * Refuse to submit if the signed deadline has (nearly) passed. Throws a clear,
 * actionable error instead of sending a tx that is certain to revert. `retryHint`
 * names the exact command to re-run so the owner can re-sign with a fresh window.
 */
export function assertSignatureFresh(deadline: bigint, retryHint: string): void {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now + BigInt(REGISTER_MIN_SUBMIT_HEADROOM_SEC) >= deadline) {
    throw new Error(
      `Signature deadline expired before submission (deadline ${deadline}, now ${now}). ` +
        "The registration was NOT submitted — no gas was spent. " +
        "This happens when signing in the browser takes longer than the deadline window. " +
        retryHint,
    );
  }
}

/**
 * Best-effort human explanation for a reverted registration tx. Replays the call
 * at the mined block to recover the revert data, decodes it against the kernel
 * error ABI, and special-cases DeadlineExpired. Falls back to a generic message
 * (never throws — this runs on an already-failed path).
 */
export async function describeRegisterRevert(
  publicClient: PublicClient,
  tx: { to: Address; data: Hex; value?: bigint; account: Address },
  receipt: TransactionReceipt,
): Promise<string> {
  try {
    await publicClient.call({
      to: tx.to,
      data: tx.data,
      value: tx.value,
      account: tx.account,
      blockNumber: receipt.blockNumber,
    });
    // Replay succeeded (state moved on) — nothing to decode.
    return `reverted (tx ${receipt.transactionHash})`;
  } catch (err) {
    let decoded: Awaited<ReturnType<typeof explainKernelRevert>> = null;
    try {
      decoded = await explainKernelRevert(err);
    } catch {
      decoded = null;
    }
    if (decoded?.name === "DeadlineExpired") {
      return "deadline expired — the signature's deadline was already in the past when the tx executed. Re-run to sign again with a fresh deadline.";
    }
    if (decoded) return decoded.message;
    return `reverted (tx ${receipt.transactionHash})`;
  }
}
