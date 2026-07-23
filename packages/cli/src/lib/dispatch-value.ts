import { type Hex, decodeFunctionData, formatUnits, parseAbi } from "viem";

/**
 * Decode "how much moved" from a dispatch's calldata (S4).
 *
 * The dashboard activity feed showed $0.00 for every dispatch because it summed
 * a (usually empty) portfolio-positions snapshot instead of reading the amount
 * the dispatch actually moved. The agent HAS the calldata at dispatch time, so
 * it can decode the standard ERC-20 amount here and stamp it on the activity
 * event — no price oracle, no UI-side calldata decoding.
 *
 * Only the three standard ERC-20 movement selectors are decoded (approve /
 * transfer / transferFrom); an undecodable call (e.g. a router swap) returns
 * null and the UI shows no amount rather than a fabricated zero.
 */

const ERC20_MOVE_ABI = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function transfer(address to, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amount)",
]);

export type DecodedTokenMove = {
  /** Which ERC-20 selector matched. `approve` is an allowance, not a transfer. */
  fn: "approve" | "transfer" | "transferFrom";
  /** Raw token amount (base units). */
  amount: bigint;
};

/** Decode an ERC-20 approve/transfer/transferFrom amount from calldata, or null. */
export function decodeTokenMove(data: Hex | undefined): DecodedTokenMove | null {
  if (!data || data.length < 10) return null;
  try {
    const { functionName, args } = decodeFunctionData({ abi: ERC20_MOVE_ABI, data });
    if (functionName === "approve" || functionName === "transfer") {
      return { fn: functionName, amount: args[1] as bigint };
    }
    if (functionName === "transferFrom") {
      return { fn: functionName, amount: args[2] as bigint };
    }
    return null;
  } catch {
    return null;
  }
}

/** Human amount, trimmed of trailing zeros (e.g. 5000000 / 6dp → "5"). */
export function formatTokenAmount(amount: bigint, decimals: number): string {
  const s = formatUnits(amount, decimals);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/**
 * Is this an "unlimited" approval? Swap routers routinely `approve` the max
 * uint256 (or near it), which formatTokenAmount renders as a meaningless
 * ~78-digit number — a misleading figure of a different kind from the $0.00
 * this fix removed. Anything in the top half of the uint256 range (≥ 2^255) is
 * astronomically larger than any real token balance, so treat it as unlimited
 * and let the UI say "unlimited" instead of printing the digits.
 */
export function isUnlimitedAmount(amount: bigint): boolean {
  return amount >= 1n << 255n;
}
