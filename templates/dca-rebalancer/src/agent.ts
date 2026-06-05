/**
 * DCA-rebalancer agent — Base mainnet, selective SailKernel.
 *
 * Strategy: on each tick, if the SMA holds enough USDC, swap a fixed amount
 * into WETH via Uniswap V3 SwapRouter02.
 *
 * Slippage protection: QuoterV2 is called off-chain before each swap.
 *   amountOutMinimum = expectedOut × (1 − SLIPPAGE_BPS / 10 000)
 * If QuoterV2 is unavailable or returns 0, the agent skips the tick entirely
 * (fail closed — never submits with amountOutMinimum = 0).
 *
 * Selective kernel: the runner supports dispatchBatch, but this agent returns at
 * most ONE dispatch per tick for simplicity:
 *   - An approve, if the router allowance is insufficient.
 *   - A swap, if allowance is sufficient and a valid quote is available.
 * Next tick handles the other step.
 *
 * The agent does NOT call dispatch.single() itself — it returns intent objects
 * ({calls, txHash:'0x', ...}) and the runner submits them.
 *
 * PERMISSION ROUTING (default — probe path):
 * This template returns plain Dispatch objects with no `permission` field. The
 * runner automatically probes each registered permission via off-chain evaluate()
 * and routes each call to the first permission that accepts it. This is the
 * recommended default: zero agent-side knowledge of permission addresses required.
 *
 * OPTIONAL OVERRIDE (skip probe for a known permission):
 * If the agent knows exactly which permission governs a call, it can set the
 * optional `permission` field on the returned Dispatch to skip the probe:
 *
 *   import type { Address } from "viem";
 *   const MY_SWAP_PERMISSION = "0x..." as Address;
 *   return [{ ...dispatch, permission: MY_SWAP_PERMISSION }];
 *
 * This is an optimisation only — the probe path is equally correct.
 */

import type { Agent, AgentContext, Call, Dispatch } from "@sail/sdk";
import { encodeFunctionData, type PublicClient } from "viem";
import {
  ALLOWED_TOKENS,
  MIN_USDC_TO_SWAP,
  QUOTER_V2,
  REBALANCE_THRESHOLD,
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

// Uniswap V3 QuoterV2 — quoteExactInputSingle (struct-params variant).
// Called via eth_call (publicClient.simulateContract) since the function
// is marked nonpayable but is safe to simulate as a read.
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

/** Wrap a single EVM call as a Dispatch intent (no txHash yet — runner submits). */
function intent(call: Call): Dispatch {
  return { txHash: "0x", calls: [call], success: false, gasUsed: 0n };
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export const agent: Agent = {
  name: "dca-rebalancer",
  description:
    `DCA into WETH with USDC on Base via Uniswap V3. ` +
    `Rebalances when allocation drift exceeds ${REBALANCE_THRESHOLD * 100}%. ` +
    `Slippage tolerance: ${SLIPPAGE_BPS / 100}%.`,

  async tick(ctx: AgentContext): Promise<Dispatch[]> {
    const { safe } = ctx;

    ctx.log(`tick — block ${ctx.blockNumber}, sma ${safe}`);

    // publicClient is injected by the runner via ctx.data._publicClient
    // so the agent can make arbitrary on-chain reads (allowance, QuoterV2).
    const pc = ctx.data._publicClient as PublicClient | undefined;
    if (!pc) {
      ctx.log("no publicClient in ctx.data — skipping tick");
      return [];
    }

    const usdc = ALLOWED_TOKENS[0]!;
    const weth = ALLOWED_TOKENS[1]!;

    // ── Step 1: Check USDC balance ────────────────────────────────────────────
    const usdcBalance = await ctx.read.balance(usdc);
    ctx.log(`USDC balance: ${usdcBalance} (min to swap: ${MIN_USDC_TO_SWAP})`);

    if (usdcBalance < MIN_USDC_TO_SWAP) {
      ctx.log("USDC balance below minimum — skipping tick");
      return [];
    }

    // ── Step 2: Check allowance — approve first if needed ─────────────────────
    const allowance = await pc.readContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [safe, SWAP_ROUTER],
    });

    if (allowance < SWAP_AMOUNT_USDC) {
      ctx.log(`allowance (${allowance}) < swap amount (${SWAP_AMOUNT_USDC}) — submitting approve`);
      // Approve max uint256 once so subsequent ticks skip this step.
      const approveCall: Call = {
        target: usdc,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [SWAP_ROUTER, 2n ** 256n - 1n],
        }),
      };
      return [intent(approveCall)];
    }

    // ── Step 3: Quote via QuoterV2 — fail closed ──────────────────────────────
    let expectedOut: bigint;
    try {
      const result = await pc.simulateContract({
        address: QUOTER_V2,
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactInputSingle",
        args: [
          {
            tokenIn: usdc,
            tokenOut: weth,
            amountIn: SWAP_AMOUNT_USDC,
            fee: SWAP_FEE_TIER,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });
      expectedOut = (result.result as [bigint, bigint, number, bigint])[0];
    } catch (e) {
      ctx.log(`QuoterV2 unavailable: ${(e as Error).message.slice(0, 100)} — skipping tick (fail closed)`);
      return [];
    }

    if (expectedOut === 0n) {
      ctx.log("QuoterV2 returned 0 expected output — skipping tick (fail closed)");
      return [];
    }

    // ── Step 4: Compute amountOutMinimum with slippage ────────────────────────
    const minOut = (expectedOut * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n;
    ctx.log(
      `quote: ${expectedOut} wei WETH, minOut (${SLIPPAGE_BPS / 100}% slippage): ${minOut}`,
    );

    // ── Step 5: Encode swap call ──────────────────────────────────────────────
    const swapCall: Call = {
      // Uniswap V3 SwapRouter02 on Base
      target: SWAP_ROUTER,
      value: 0n,
      data: encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn: usdc,
            tokenOut: weth,
            fee: SWAP_FEE_TIER,
            recipient: safe,      // output stays in the SMA
            amountIn: SWAP_AMOUNT_USDC,
            amountOutMinimum: minOut, // slippage-protected — never 0
            sqrtPriceLimitX96: 0n,
          },
        ],
      }),
    };

    ctx.log(`submitting swap: ${SWAP_AMOUNT_USDC} USDC → WETH, minOut=${minOut}`);
    return [intent(swapCall)];
  },
};
