// Reference example — not the user's strategy. Consult for patterns; author the user's own in src/.
// Shows: a complete DCA tick loop — USDC→WETH via Uniswap V3 on Base mainnet.
// To adapt: replace token addresses, protocol ABIs, and swap logic with your target strategy.

import type { Agent, AgentContext, Call, Dispatch } from "@sail/sdk";
import { encodeFunctionData, type PublicClient } from "viem";
import {
  ALLOWED_TOKENS,
  MIN_USDC_TO_SWAP,
  QUOTER_V2,
  SLIPPAGE_BPS,
  SWAP_AMOUNT_USDC,
  SWAP_FEE_TIER,
  SWAP_ROUTER,
} from "./mandate.js";

// ── ABI fragments ─────────────────────────────────────────────────────────────

const ERC20_ABI = [
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const QUOTER_V2_ABI = [
  {
    name: "quoteExactInputSingle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

const SWAP_ROUTER_ABI = [
  {
    name: "exactInputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

// ── Intent builder ────────────────────────────────────────────────────────────

function intent(call: Call): Dispatch {
  return { txHash: "0x", calls: [call], success: false, gasUsed: 0n };
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export const agent: Agent = {
  name: "dca-rebalancer",
  description: `DCA into WETH with USDC on Base via Uniswap V3. Slippage tolerance: ${SLIPPAGE_BPS / 100}%.`,

  async tick(ctx: AgentContext): Promise<Dispatch[]> {
    const { safe } = ctx;
    ctx.log(`tick — block ${ctx.blockNumber}, sma ${safe}`);

    const pc = ctx.data._publicClient as PublicClient | undefined;
    if (!pc) {
      ctx.log("no publicClient in ctx.data — skipping tick");
      return [];
    }

    const usdc = ALLOWED_TOKENS[0]!;
    const weth = ALLOWED_TOKENS[1]!;

    // Step 1: Check USDC balance
    const usdcBalance = await ctx.read.balance(usdc);
    ctx.log(`USDC balance: ${usdcBalance} (min to swap: ${MIN_USDC_TO_SWAP})`);
    if (usdcBalance < MIN_USDC_TO_SWAP) {
      ctx.log("USDC balance below minimum — skipping tick");
      return [];
    }

    // Step 2: Check allowance — approve first if needed
    const allowance = await pc.readContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [safe, SWAP_ROUTER],
    });
    if (allowance < SWAP_AMOUNT_USDC) {
      ctx.log(`allowance (${allowance}) < swap amount — submitting approve`);
      return [intent({
        target: usdc,
        value: 0n,
        data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [SWAP_ROUTER, 2n ** 256n - 1n] }),
      })];
    }

    // Step 3: Quote via QuoterV2 — fail closed on any error
    let expectedOut: bigint;
    try {
      const result = await pc.simulateContract({
        address: QUOTER_V2,
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: usdc, tokenOut: weth, amountIn: SWAP_AMOUNT_USDC, fee: SWAP_FEE_TIER, sqrtPriceLimitX96: 0n }],
      });
      expectedOut = (result.result as [bigint, bigint, number, bigint])[0];
    } catch (e) {
      ctx.log(`QuoterV2 unavailable: ${(e as Error).message.slice(0, 100)} — skipping`);
      return [];
    }
    if (expectedOut === 0n) {
      ctx.log("QuoterV2 returned 0 — skipping");
      return [];
    }

    // Step 4: Encode swap with slippage protection
    const minOut = (expectedOut * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n;
    ctx.log(`quote: ${expectedOut} wei WETH, minOut (${SLIPPAGE_BPS / 100}% slippage): ${minOut}`);
    return [intent({
      target: SWAP_ROUTER,
      value: 0n,
      data: encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [{ tokenIn: usdc, tokenOut: weth, fee: SWAP_FEE_TIER, recipient: safe, amountIn: SWAP_AMOUNT_USDC, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
      }),
    })];
  },
};
