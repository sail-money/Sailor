/**
 * Anvil-only "god mode" funding for a sandbox fork: gas (native token) via
 * `anvil_setBalance`, and ERC-20 (USDC) via a storage-slot write. Ported from
 * the harness's `god.mjs` slot-scan approach — there is no faucet or whale
 * account to route through on a forked chain, so writing the balance mapping
 * slot directly is the only way to fund an arbitrary token on an arbitrary
 * holder without first finding (and impersonating) a real holder.
 *
 * Never call these against anything but a sandbox's own fork RPC — there is
 * no on-chain equivalent of `anvil_setBalance`/`setStorageAt`, so a live RPC
 * would simply reject the call, but the caller (the sandbox-mode-only routes
 * in the UI server) is what actually keeps this off real chains.
 */

import {
  createPublicClient,
  createTestClient,
  encodeAbiParameters,
  http,
  keccak256,
  pad,
  parseUnits,
  toHex,
  type Address,
  type Hex,
} from "viem";

/** Canonical native-USDC address per chain id. Deliberately not exhaustive —
 *  funding is refused (rather than guessed) on any chain not listed here. */
export const USDC_ADDRESSES: Record<number, Address> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // Ethereum
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Arbitrum
  130: "0x078D782b760474a361dDA0AF3839290b0EF57AD6", // Unichain
};

export function usdcAddressFor(chainId: number): Address | null {
  return USDC_ADDRESSES[chainId] ?? null;
}

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

/**
 * Set an address's native-token balance on a fork. Overwrites (not adds to)
 * whatever balance was already there, matching `anvil_setBalance` semantics.
 */
export async function fundNative(
  rpcUrl: string,
  address: Address,
  amountEth: number | string,
): Promise<{ balanceWei: string }> {
  const client = createTestClient({ mode: "anvil", transport: http(rpcUrl) });
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const value = parseUnits(String(amountEth), 18);
  await client.setBalance({ address, value });
  const balance = await publicClient.getBalance({ address });
  return { balanceWei: balance.toString() };
}

/**
 * Find the storage slot backing `balanceOf(holder)` by probing the two
 * common mapping layouts (Solidity: `keccak256(abi.encode(holder, base))`;
 * Vyper: `keccak256(abi.encode(base, holder))`) across base slots 0..40.
 * Writes a sentinel, reads it back through `balanceOf`, then restores the
 * original value regardless of outcome — this never leaves a fork's storage
 * mutated beyond the one slot the caller actually asked to set.
 */
async function findBalanceSlot(
  rpcUrl: string,
  token: Address,
  holder: Address,
): Promise<{ slot: Hex; base: number; layout: "solidity" | "vyper" } | null> {
  const client = createTestClient({ mode: "anvil", transport: http(rpcUrl) });
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const sentinel = 0x1234567890abcdefn;

  for (let base = 0; base <= 40; base++) {
    for (const layout of ["solidity", "vyper"] as const) {
      const slot =
        layout === "solidity"
          ? keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, BigInt(base)]))
          : keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [BigInt(base), holder]));

      const original = await publicClient.getStorageAt({ address: token, slot });
      await client.setStorageAt({ address: token, index: slot, value: pad(toHex(sentinel), { size: 32 }) });
      // A non-token address (no code, or a non-standard ABI) fails to decode
      // rather than matching — treat that the same as "wrong slot" so a bad
      // token address surfaces as "slot not found", not a raw decode error.
      let probed: bigint | null = null;
      try {
        probed = await publicClient.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [holder],
        });
      } catch {
        probed = null;
      }
      if (original !== undefined) {
        await client.setStorageAt({ address: token, index: slot, value: original as Hex });
      }
      if (probed === sentinel) return { slot, base, layout };
    }
  }
  return null;
}

/**
 * Fund an address with a human-readable amount of an ERC-20 token by writing
 * its `balanceOf` storage slot directly (see `findBalanceSlot`). Works for
 * any token deployed on the fork (the real contract's bytecode is there,
 * only its storage is being edited) — no whale account or bridge required.
 */
export async function fundErc20(
  rpcUrl: string,
  token: Address,
  to: Address,
  humanAmount: number | string,
): Promise<{ balanceWei: string; decimals: number }> {
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const client = createTestClient({ mode: "anvil", transport: http(rpcUrl) });

  let decimals = 18;
  try {
    decimals = await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" });
  } catch {
    // non-standard token — fall back to 18
  }

  const amount = parseUnits(String(humanAmount), decimals);

  const found = await findBalanceSlot(rpcUrl, token, to);
  if (!found) {
    throw new Error(
      `Could not locate the balanceOf storage slot for ${token} (scanned bases 0-40, solidity+vyper layouts).`,
    );
  }

  await client.setStorageAt({ address: token, index: found.slot, value: pad(toHex(amount), { size: 32 }) });

  const balance = await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [to],
  });
  if (balance !== amount) {
    throw new Error(`setStorageAt wrote but balanceOf now reads ${balance} (expected ${amount}).`);
  }

  return { balanceWei: balance.toString(), decimals };
}
