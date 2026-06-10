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
   * null  — could not determine: proxy pattern detected (EIP-1167, EIP-1967
   *         implementation, or EIP-1967 beacon), or calldata shorter than 4 bytes.
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
 * bytecode is identified as a proxy — in those cases the real routing happens in the
 * implementation contract and cannot be determined without following the proxy.
 *
 * Proxy detection:
 * - EIP-1167 minimal proxy (~45 bytes): caught by the length guard (< 100 hex chars).
 * - EIP-1967 UUPS / transparent proxy: detected by the implementation slot prefix
 *   `360894a1` (first 4 bytes of keccak256("eip1967.proxy.implementation") - 1).
 * - EIP-1967 beacon proxy: detected by the beacon slot prefix `a3f0ad74` (first 4
 *   bytes of keccak256("eip1967.proxy.beacon") - 1).
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

  // EIP-1967 implementation slot: first 4 bytes of keccak256("eip1967.proxy.implementation") - 1.
  // All UUPS and transparent proxies push this storage key to read their implementation.
  if (body.includes("360894a1")) {
    return { selector, routes: null, reason: "EIP-1967 proxy detected — routing is in the implementation contract" };
  }

  // EIP-1967 beacon slot: first 4 bytes of keccak256("eip1967.proxy.beacon") - 1.
  // Beacon proxies read the implementation address from a beacon contract stored at this slot.
  if (body.includes("a3f0ad74")) {
    return { selector, routes: null, reason: "EIP-1967 beacon proxy detected — routing is in the beacon implementation" };
  }

  return { selector, routes: body.includes(selector) };
}
