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

import type { Address, PublicClient } from "viem";

export type ContractCheck = {
  address: Address;
  /** True when the address has non-empty bytecode on the queried chain. */
  hasCode: boolean;
  /** Set when the eth_getCode call itself failed (RPC error) — result is unknown, not "no code". */
  error?: string;
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
    return { address, hasCode: !!code && code !== "0x" };
  } catch (err) {
    return { address, hasCode: false, error: (err as Error).message.split("\n")[0] };
  }
}
