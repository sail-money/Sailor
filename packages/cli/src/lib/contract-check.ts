/**
 * Lean contract-existence check (eth_getCode).
 *
 * The ONLY question this answers is: "is there a contract deployed at this
 * address on this chain?" — nothing more. It does NOT check liquidity, pool
 * existence, ABI shape, or whether the contract is the RIGHT one. Those are the
 * user's responsibility; modelling protocol economics here would be over-reach.
 *
 * Its single job is to remove one specific "I had no way to know" failure mode:
 * a permission or sample call that targets an EOA, an empty address, or a
 * correct-looking address on the WRONG chain. Such a call reverts on-chain
 * regardless of what the permission's evaluate() returns — so catching it before
 * authorization saves real gas and a confusing on-chain failure.
 */

import type { Address, Hex, PublicClient } from "viem";

export type ContractCheck = {
  address: Address;
  /** True when the address has non-empty bytecode on the queried chain. */
  hasCode: boolean;
  /** Raw bytecode, present when hasCode is true. Used for selector routing checks. */
  bytecode?: Hex;
  /** Set when the eth_getCode call itself failed (RPC error) — result is unknown, not "no code". */
  error?: string;
};

export type SelectorCheck = {
  /** 4-byte selector that was checked, as a lowercase hex string without 0x. */
  selector: string;
  /**
   * True  — selector found in the contract's dispatch table.
   * False — selector NOT found; call would likely revert with "unknown selector".
   * null  — could not determine: proxy/delegate pattern detected (bytecode too short
   *         or contains DELEGATECALL), or calldata shorter than 4 bytes.
   */
  routes: boolean | null;
  /** Human-readable reason when routes is null. */
  reason?: string;
};

/**
 * Check whether `address` has contract bytecode on the chain `pc` is bound to.
 *
 * Returns `hasCode: false` for an EOA or an undeployed address. On an RPC error
 * the result is reported with `error` set and `hasCode: false` is NOT asserted
 * as fact — callers should treat an `error` as "could not verify", not "no code".
 */
export async function checkContractExists(
  pc: PublicClient,
  address: Address,
): Promise<ContractCheck> {
  try {
    const code = await pc.getCode({ address });
    // viem returns `undefined` (or "0x") when there is no contract at the address.
    const hasCode = !!code && code !== "0x";
    return { address, hasCode, bytecode: hasCode ? code : undefined };
  } catch (err) {
    return { address, hasCode: false, error: (err as Error).message.split("\n")[0] };
  }
}

/**
 * Check whether the 4-byte selector from `calldata` is likely routed by `bytecode`.
 *
 * Scans the raw bytecode hex for the 4-byte selector sequence. This catches the
 * standard Solidity/Vyper dispatch table pattern. Returns `routes: null` when the
 * bytecode exhibits proxy/delegatecall characteristics (< 100 hex chars or contains
 * the DELEGATECALL opcode 0xf4) — in those cases the real routing happens in the
 * implementation contract and cannot be determined without following the proxy.
 */
export function checkSelectorRoutes(calldata: Hex, bytecode: Hex): SelectorCheck {
  // Need at least 4 bytes (10 hex chars including "0x") for a selector.
  if (calldata.length < 10) {
    return { selector: "", routes: null, reason: "calldata shorter than 4 bytes — no selector" };
  }

  const selector = calldata.slice(2, 10).toLowerCase();

  // Bytecode shorter than 100 hex chars (~50 bytes) is almost certainly a proxy
  // (EIP-1167 minimal proxy is 45 bytes). Can't determine routing from it.
  const body = bytecode.slice(2).toLowerCase();
  if (body.length < 100) {
    return { selector, routes: null, reason: "proxy or minimal contract — routing not determinable from bytecode" };
  }

  // 0xf4 = DELEGATECALL opcode — presence strongly suggests a proxy pattern.
  if (body.includes("f4")) {
    return { selector, routes: null, reason: "DELEGATECALL detected — proxy pattern, routing not determinable" };
  }

  return { selector, routes: body.includes(selector) };
}
