/**
 * LiFi aggregator helpers for the swap recipe (`client.strategy.swap`).
 *
 * The protocol's swap permissions (e.g. LifiDiamondSwapPermission) restrict
 * manager swaps to the official LiFi Diamond. We fetch an executable quote from
 * the LiFi API and hand its calldata to the kernel dispatch path.
 */

import { type Address, encodeFunctionData, type Hex, parseAbi } from "viem";

/** LiFi quote endpoint. */
export const LIFI_QUOTE_URL = "https://li.quest/v1/quote";

/**
 * Canonical LiFi Diamond router per chain. LiFi deploys the diamond at the same
 * address across most mainnets; callers can override via `SwapParams.router`.
 */
export const LIFI_ROUTERS: Record<number, Address> = {
  8453: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", // Base
  42161: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", // Arbitrum
};

/**
 * Default slippage (3%). LiFi's own 0.5% default reverts with
 * CumulativeSlippageTooHigh on small trades against live price moves.
 */
export const DEFAULT_SLIPPAGE = 0.03;

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

/** ABI for reading an ERC-20 allowance. */
export const ERC20_ALLOWANCE_ABI = ERC20_ABI;

/** Encode an ERC-20 `approve(spender, amount)` calldata. */
export function encodeApprove(spender: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender, amount] });
}

/** The pieces of a LiFi quote the dispatch path needs. */
export type LifiSwapQuote = {
  /** Call target — the router that executes the swap. */
  target: Address;
  /** Swap calldata. */
  data: Hex;
  /** msg.value for the call (non-zero only for native-token inputs). */
  value: bigint;
  /** Expected output amount in `to`-token base units. */
  toAmount: bigint;
  /** Aggregator sub-route / tool name. */
  tool?: string;
};

export type FetchLifiQuoteParams = {
  chainId: number;
  fromToken: Address;
  toToken: Address;
  /** Input amount in `fromToken` base units. */
  fromAmount: bigint;
  /** The account funding and (by default) receiving the swap. */
  fromAddress: Address;
  toAddress: Address;
  /** Slippage as a fraction (0.03 = 3%). */
  slippage: number;
  /** Optional fetch implementation (defaults to global fetch). */
  fetchFn?: typeof fetch;
};

/**
 * Fetch an executable LiFi quote for a same-chain swap. Throws with the API's
 * error body when the quote is unavailable or malformed.
 */
export async function fetchLifiQuote(params: FetchLifiQuoteParams): Promise<LifiSwapQuote> {
  const doFetch = params.fetchFn ?? fetch;
  const url = new URL(LIFI_QUOTE_URL);
  url.searchParams.set("fromChain", String(params.chainId));
  url.searchParams.set("toChain", String(params.chainId));
  url.searchParams.set("fromToken", params.fromToken);
  url.searchParams.set("toToken", params.toToken);
  url.searchParams.set("fromAmount", params.fromAmount.toString());
  url.searchParams.set("fromAddress", params.fromAddress);
  url.searchParams.set("toAddress", params.toAddress);
  url.searchParams.set("slippage", String(params.slippage));

  const res = await doFetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LiFi quote failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const quote = (await res.json()) as {
    transactionRequest?: { to?: string; data?: string; value?: string };
    estimate?: { toAmount?: string };
    tool?: string;
  };
  const tx = quote.transactionRequest;
  if (!tx?.to || !tx?.data) {
    throw new Error(
      "LiFi quote returned no usable transactionRequest: " +
        JSON.stringify(quote).slice(0, 400),
    );
  }
  return {
    target: tx.to as Address,
    data: tx.data as Hex,
    value: BigInt(tx.value ?? "0"),
    toAmount: BigInt(quote.estimate?.toAmount ?? "0"),
    tool: quote.tool,
  };
}
