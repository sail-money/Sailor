/**
 * Kernel revert decoding.
 *
 * The deployed SailKernel reverts with custom errors (4-byte selectors). viem
 * cannot name them unless the error fragments are present in the ABI it was
 * given, so by default a dispatch failure surfaces as an opaque selector like
 * `0xeb6942f1`. This module ships the full set of kernel error fragments (the
 * UNION of the currently-deployed and latest-source versions) plus a decoder
 * that turns a raw revert into a named, human-readable diagnosis with a hint at
 * the likely cause and fix.
 */

import { type Abi, type Hex, parseAbi } from "viem";

/**
 * Human-readable signatures for every custom error the SailKernel can revert
 * with, across deployed and latest-source versions. Used purely for decoding —
 * unknown selectors simply fail to match and fall through to `null`.
 */
export const KERNEL_ERROR_SIGNATURES = [
  "error AccountAlreadyRegistered(address account)",
  "error AccountNotRegistered(address account)",
  "error AccountSelfTarget()",
  "error ArrayLengthMismatch()",
  "error BatchPermissionDenied()",
  "error BatchSubcallFailed(uint256 index, address target)",
  "error BatchTooLong(uint256 length)",
  "error BatchZeroTarget(uint256 index)",
  "error DeadlineExpired(uint256 deadline, uint256 current)",
  "error DistributorBpsTooLarge(uint256 bps)",
  "error EmptyBatch()",
  "error FeePolicyNotSet()",
  "error FeeTokenMismatch(address provided, address expected)",
  "error FeeTooLarge(uint256 requested, uint256 maxAllowed)",
  "error FeeTransferFailed()",
  "error InsufficientFee(uint256 required, uint256 provided)",
  "error InvalidInitializer()",
  "error InvalidManagerSignature()",
  "error InvalidSignerSignature()",
  "error KernelSelfTarget(uint256 index)",
  "error ModuleNotEnabled()",
  // Present in the deployed conjunctive kernel; dropped in the latest source.
  "error NoPermissionsRegistered(address account)",
  "error NotAContract(address addr)",
  "error NotGovernance()",
  "error NotManager(address caller, address expected)",
  "error NotPermissionSigner()",
  "error NotTimelock()",
  "error PermissionAlreadyRegistered(address permission)",
  "error PermissionDenied(address permission)",
  "error PermissionNotBatchAware(address permission)",
  "error PermissionNotRegistered(address permission)",
  "error ProtocolPaused()",
  "error SafeExecutionFailed()",
  "error SessionInactive(address account)",
  "error TooManyPermissions(address account, uint256 limit)",
  "error UntrustedFactory(address factory)",
  "error UntrustedFeePolicy(address policy)",
  "error UntrustedModuleSetup(address setup)",
  "error UntrustedProxyCodehash(bytes32 codehash)",
  "error UntrustedSingleton(address singleton)",
  "error ZeroAddress()",
  "error ZeroFee()",
] as const;

/** The kernel error fragments as a viem ABI, ready for `decodeErrorResult`. */
export const KERNEL_ERROR_ABI: Abi = parseAbi(KERNEL_ERROR_SIGNATURES);

/**
 * Operator-facing hints for the errors most likely to be hit at dispatch time.
 * Keyed by error name. These translate a raw revert into "what went wrong and
 * what to do about it" — the bulk of the value of this module.
 */
const ERROR_HINTS: Record<string, string> = {
  InvalidManagerSignature:
    "The manager's EIP-712 Dispatch signature did not recover to the registered manager. " +
    "Most common cause: a stale manager nonce (the kernel's managerNonces advanced between " +
    "signing and submission — e.g. a load-balanced RPC returned a lagging value, or two " +
    "dispatches were signed against the same nonce). Re-read managerNonces and re-sign, or " +
    "track the nonce locally and increment it across sequential dispatches. Can also mean the " +
    "wrong EIP-712 Dispatch type was used for this kernel version — see detectKernelCapabilities.",
  PermissionDenied:
    "A registered permission's evaluate() returned false (or reverted / ran out of gas) for this call. " +
    "In a conjunctive kernel EVERY registered permission must approve EVERY call, so a permission " +
    "that does not pass through calls outside its own domain will block unrelated dispatches. " +
    "Check that each permission either matches this call or returns true for calls it doesn't govern.",
  NoPermissionsRegistered:
    "The account has zero registered permissions, so the kernel denies by default. Register at least " +
    "one permission (kernel.registerPermission / registerPermissions) before dispatching.",
  PermissionNotRegistered:
    "The named permission is not registered for this account. Register it first, or (on a conjunctive " +
    "kernel) drop the permission argument — that kernel checks all registered permissions automatically.",
  SessionInactive:
    "The manager's session is revoked. Re-activate it (session.activate) before dispatching.",
  DeadlineExpired:
    "The signature deadline is in the past. Use a deadline comfortably ahead of block.timestamp.",
  SafeExecutionFailed:
    "The underlying Safe module call reverted. The permission passed, but the target call itself failed " +
    "(e.g. slippage too tight, insufficient allowance/balance, or a failing swap route).",
  ModuleNotEnabled:
    "The Sail module is not enabled on the Safe. Complete account onboarding (enable the module) first.",
  ProtocolPaused: "The protocol is paused by governance. Dispatches are blocked until it is unpaused.",
  NotManager:
    "The submitting address is not the registered manager for this account.",
  TooManyPermissions:
    "Registering this permission would exceed the kernel's per-account permission cap. Revoke an unused " +
    "permission first.",
};

/** A decoded kernel custom error. */
export type KernelError = {
  /** Solidity error name, e.g. "InvalidManagerSignature". */
  name: string;
  /** Decoded arguments, in declaration order (empty for zero-arg errors). */
  args: readonly unknown[];
  /** The 4-byte selector that was matched, e.g. "0xeb6942f1". */
  selector: Hex;
  /** Operator-facing hint at the likely cause and fix, when one is known. */
  hint?: string;
  /** A one-line, log-friendly summary combining name, args, and hint. */
  message: string;
};

/** Lazily decode an error selector against the kernel error ABI. */
async function decode(data: Hex): Promise<KernelError | null> {
  // decodeErrorResult is imported lazily so this module has no eager viem cost
  // beyond parseAbi; it also keeps the import surface obvious.
  const { decodeErrorResult } = await import("viem");
  try {
    const decoded = decodeErrorResult({ abi: KERNEL_ERROR_ABI, data });
    const name = decoded.errorName;
    const args = (decoded.args ?? []) as readonly unknown[];
    const selector = data.slice(0, 10) as Hex;
    const hint = ERROR_HINTS[name];
    const argStr = args.length ? `(${args.map(String).join(", ")})` : "()";
    const message = hint ? `${name}${argStr} — ${hint}` : `${name}${argStr}`;
    return { name, args, selector, hint, message };
  } catch {
    return null;
  }
}

/**
 * Decode a raw revert data hex string (`0x` + selector + abi-encoded args) into
 * a named kernel error. Returns null if the data does not match any known kernel
 * error fragment.
 */
export function decodeKernelError(data: Hex): Promise<KernelError | null> {
  if (!data || data === "0x") return Promise.resolve(null);
  return decode(data);
}

/**
 * Walk a thrown viem error to find embedded revert data, then decode it as a
 * kernel error. Handles ContractFunctionExecutionError / ContractFunctionReverted
 * / RawContractError shapes by scanning `.cause` chains and common data fields.
 * Returns null when no kernel error can be recovered.
 */
export async function explainKernelRevert(err: unknown): Promise<KernelError | null> {
  const data = extractRevertData(err);
  if (!data) return null;
  return decodeKernelError(data);
}

/** Best-effort extraction of `0x…`-encoded revert data from an unknown thrown value. */
function extractRevertData(err: unknown): Hex | null {
  const seen = new Set<unknown>();
  let cursor: unknown = err;
  let depth = 0;
  while (cursor && typeof cursor === "object" && !seen.has(cursor) && depth < 12) {
    seen.add(cursor);
    depth++;
    const obj = cursor as Record<string, unknown>;

    // viem ContractFunctionRevertedError carries `.data` as a decoded object OR
    // the raw error may carry a `.data` hex string; RawContractError uses `.data`.
    const data = obj["data"];
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
      return data as Hex;
    }
    if (data && typeof data === "object") {
      const inner = (data as Record<string, unknown>)["data"];
      if (typeof inner === "string" && inner.startsWith("0x") && inner.length >= 10) {
        return inner as Hex;
      }
    }
    // Some shapes stash it on `.raw` or `.signature`.
    const raw = obj["raw"];
    if (typeof raw === "string" && raw.startsWith("0x") && raw.length >= 10) {
      return raw as Hex;
    }

    cursor = obj["cause"];
  }
  return null;
}
