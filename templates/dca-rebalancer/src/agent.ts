import type { Agent, AgentContext, Call, Dispatch } from "@sail/sdk";
import { ALLOWED_TOKENS, MAX_SLIPPAGE_BPS, MAX_SWAP_USD, REBALANCE_THRESHOLD } from "./mandate.js";

/**
 * DCA-rebalancer agent.
 *
 * Strategy:
 *   1. On each tick, compute the current token allocation vs. target allocation.
 *   2. If any token drifts beyond REBALANCE_THRESHOLD, generate a corrective swap.
 *   3. Preview the swap through the SailKernel before submitting.
 *   4. If the preview is approved, submit via dispatch.single.
 *
 * All SDK calls throw "not implemented" until the SailorClient is wired up.
 * This file illustrates the shape of a real agent implementation.
 */
export const agent: Agent = {
  name: "dca-rebalancer",
  description:
    "Dollar-cost-averages into a token basket and rebalances when allocation drift " +
    `exceeds ${REBALANCE_THRESHOLD * 100}%`,

  async tick(ctx: AgentContext): Promise<Dispatch[]> {
    const { client, safe, manager } = ctx;

    console.log(`[dca-rebalancer] tick — block ${ctx.blockNumber}, safe ${safe}`);

    // ── Step 1: Fetch on-chain balances ──────────────────────────────────────
    // In a real implementation:
    //   const balances = await Promise.all(ALLOWED_TOKENS.map(t => fetchBalance(t, safe)));
    //   const totalUsd = balances.reduce((s, b) => s + b.usd, 0n);
    //   const currentAllocations = balances.map(b => b.usd / totalUsd);
    //   const targetAllocation = 1 / ALLOWED_TOKENS.length; // equal-weight

    // ── Step 2: Identify tokens that need rebalancing ────────────────────────
    // const tokensToRebalance = currentAllocations.filter(
    //   (alloc, i) => Math.abs(alloc - targetAllocation) > REBALANCE_THRESHOLD,
    // );

    // ── Step 3: Build swap call ──────────────────────────────────────────────
    // Example: buy WETH with USDC up to MAX_SWAP_USD with MAX_SLIPPAGE_BPS slippage.
    // The exact calldata would be encoded via the Uniswap V3 SwapRouter02 ABI.
    const exampleSwapCall: Call = {
      // Uniswap V3 SwapRouter02 on Base
      target: "0x2626664c2603336E57B271c5C0b26F421741e481",
      value: 0n,
      // exactInputSingle({tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96})
      // Encoded calldata would go here — left as 0x until encoder is implemented.
      data: "0x",
    };

    // Void references to keep TypeScript happy in the skeleton
    void MAX_SWAP_USD;
    void MAX_SLIPPAGE_BPS;
    void ALLOWED_TOKENS;

    // ── Step 4: Preview ──────────────────────────────────────────────────────
    // The permission address "0x" is a placeholder; use the registered mandate address.
    const preview = await client.dispatch.preview(safe, "0x", [exampleSwapCall]);

    if (!preview.approved) {
      console.log("[dca-rebalancer] permission check rejected — skipping tick");
      return [];
    }

    if (preview.simulation) {
      console.log(`[dca-rebalancer] simulation gas: ${preview.simulation.gasUsed}`);
    }

    // ── Step 5: Submit ───────────────────────────────────────────────────────
    const dispatch = await client.dispatch.single(safe, "0x", exampleSwapCall, manager);

    console.log(`[dca-rebalancer] dispatched tx ${dispatch.txHash}`);
    return [dispatch];
  },
};
