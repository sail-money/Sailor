/**
 * Your agent — implement your strategy here.
 *
 * The runner calls tick() on every interval. Return an array of Dispatch intents;
 * the runner submits each one through the kernel against a matching registered permission.
 * Return [] to skip this tick (no gas spent).
 *
 * The runner resolves which permission authorizes each call automatically — you
 * express what you want to do; you do not name permissions per call.
 *
 * For a worked end-to-end example (DCA / Uniswap V3 / Base):
 *   see examples/dca/agent.ts and examples/dca/mandate.ts
 */

import type { Agent, AgentContext, Dispatch } from "@sail.money/sailor/sdk";

export const agent: Agent = {
  name: "my-agent",
  description: "Describe your strategy here.",

  async tick(ctx: AgentContext): Promise<Dispatch[]> {
    ctx.log(`tick — block ${ctx.blockNumber}, sma ${ctx.safe}`);

    // TODO: implement your strategy.
    // Read on-chain state, decide what to do, return intent dispatches.
    // ctx.read.balance(tokenAddress) — read token balance of the SMA
    // ctx.publicClient — viem PublicClient for arbitrary on-chain reads
    // ctx.log(msg) — append a message to the activity log
    //
    // Example (from examples/dca/agent.ts):
    //   const balance = await ctx.read.balance(USDC_ADDRESS);
    //   if (balance < MIN_AMOUNT) return [];
    //   return [{ txHash: "0x", calls: [{ target: ROUTER, value: 0n, data: swapCalldata }], success: false, gasUsed: 0n }];

    return [];
  },
};
