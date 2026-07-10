---
name: sailor-agent-build
description: Station 4 — build the agent's brain, the tick loop in src/agent.ts, from the strategy spec and the registered mandate. Use when the user says "build my agent", "write the agent code", "agent logic", "tick loop", "src/agent.ts", or "make it trade automatically" — and structurally once the mandate is registered and simulate-verified and .sail/strategy.md is complete.
---

# sailor-agent-build — build the brain (Station 4)

You typically arrive here from the mandate plan with a registered, simulate-verified mandate. This station turns the strategy spec into the agent's tick loop in `src/agent.ts`. Dispatch mechanics (the selective model, signing, permission resolution) live in [`sailor-transactions`](../sailor-transactions/SKILL.md) — this skill is about the decision logic that sits on top of them.

## Gate (fail-closed)

Station 4 requires a **registered, configured, simulate-verified mandate** (AGENTS.md station 4 gate). If the mandate is not in that state, go back to [`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md) — do not write agent code against permissions that don't exist yet.

Read `.sail/strategy.md`'s JSON block and the current mandate state first. **The agent is built FROM the spec** — its tokens, venues, caps, cadence, risk bounds, and exit condition are already decided and confirmed there. Never re-ask the user for values the spec already carries.

## The translation method

Walk the spec's actions into the loop, one at a time:

1. **For each action** in the strategy JSON (`swap`, `deposit`, `borrow`, `transfer`, `withdraw`, …) → **which registered permission authorizes it** (the mandate plan already mapped this). You do not name the permission in code — the runner probes registered permissions and routes each dispatch to the first that accepts (see `sailor-transactions`).
2. **What the dispatch must look like** — the per-permission dispatch shape (target, selector, argument bounds, recipient = SMA) is documented in that action's spoke skill (`sailor-template-*`), in its "Agent config" / dispatch section. Point to it; don't re-derive the calldata from memory.
3. **Where it sits in the tick loop** — a precondition check, a read, a decision, and the act. The skeleton below is the canonical arrangement.

## The defensive checklist

Verify the agent code against these — every one is a real failure mode the loop must survive:

- **Fail closed on zero or reverted reads.** A quote of `0`, or a read that reverts, is a **no**, not a maybe — return `[]` (skip the tick), never fall through to acting on a missing number.
- **Check allowances before acting.** Emit an approve only when the on-chain allowance is short. Which approve model to use (per-call vs atomic batch) is owned by [`sailor-mandates/references/approvals.md`](../sailor-mandates/references/approvals.md) — follow the one the mandate plan chose.
- **Respect caps client-side.** The kernel enforces the mandate's caps on-chain, but check them in code first so the agent doesn't burn gas on a dispatch that is certain to be denied.
- **A denied dispatch is information, not an error.** The runner logs the denial reason to `.sail/activity.jsonl`; read it, adjust within bounds, and never blind-retry the identical call — the next scheduled tick re-evaluates.
- **Cadence guard.** Never double-fire a period. The runner ticks on its own interval (`SAILOR_INTERVAL`); the agent must track its own last-action time (the persistent `ctx.data` slot) and skip until the period has elapsed.
- **Bounded retries with backoff.** If you retry a transient failure, cap the attempts and space them out (track a counter/next-attempt time in `ctx.data`) — do not hammer a dead RPC or a reverting venue every tick.
- **Log every decision and its inputs.** Call `ctx.log(msg)` at each branch. The runner appends it to `.sail/activity.jsonl` as a `log` entry and emits its own structured events around your dispatches (schema: [`sailor-operate`](../sailor-operate/SKILL.md)). Your job is `ctx.log`; the structured events are the runner's — you do not write the file yourself.

## The canonical skeleton

A complete `tick()` in the **read → decide → act** shape, derived from the DCA reference. Every value marked `FROM SPEC` comes from `.sail/strategy.md`; the placeholder addresses are `0x0…0` — replace them with the spec's resolved addresses. Adapt it into `src/agent.ts`.

```ts
// @sailor-skeleton
// Canonical Sailor agent loop — the read → decide → act shape.
// Adapt into src/agent.ts. Every value marked FROM SPEC comes from .sail/strategy.md;
// do not re-ask the user for it. Replace the 0x0…0 placeholders with the spec's addresses.

import type { Agent, AgentContext, Address, Call, Dispatch } from "@sail.money/sailor/sdk";
import { encodeFunctionData } from "viem";

// ── Strategy constants (FROM SPEC — .sail/strategy.md) ──────────────────────
const TOKEN_IN: Address = "0x0000000000000000000000000000000000000000"; // FROM SPEC: sell-side token (resolved address)
const TOKEN_OUT: Address = "0x0000000000000000000000000000000000000000"; // FROM SPEC: buy-side token
const ROUTER: Address = "0x0000000000000000000000000000000000000000"; // FROM SPEC: venue router (must be in the mandate's allowlist)
const QUOTER: Address = "0x0000000000000000000000000000000000000000"; // the venue's off-chain quoter (see sailor-swap-quote)
const AMOUNT_IN = 25_000_000n; // FROM SPEC: per-tick spend, base units (<= the mandate's maxAmountPerTx)
const MIN_BALANCE = 25_000_000n; // FROM SPEC: don't act below this SMA balance
const FEE_TIER = 3000; // FROM SPEC: pool fee tier (from sailor-token-resolve)
const SLIPPAGE_BPS = 100; // FROM SPEC: slippage limit (<= the mandate's maxSlippageBps)
const PERIOD_SEC = 86_400; // FROM SPEC: cadence — minimum seconds between actions

// ── ABI fragments (only what the loop calls) ────────────────────────────────
const ERC20_ABI = [
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

const QUOTER_ABI = [
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

const ROUTER_ABI = [
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

// One call becomes one dispatch; the runner submits it against a matching permission.
const intent = (call: Call): Dispatch => ({ txHash: "0x", calls: [call], success: false, gasUsed: 0n });

export const agent: Agent = {
  name: "my-agent",
  description: "Describe your strategy here.",

  async tick(ctx: AgentContext): Promise<Dispatch[]> {
    ctx.log(`tick — block ${ctx.blockNumber}, sma ${ctx.safe}`);

    // Cadence guard — never double-fire a period. ctx.data persists across ticks.
    const lastActed = Number(ctx.data.lastActedSec ?? 0);
    if (ctx.timestamp - lastActed < PERIOD_SEC) {
      ctx.log(`within cadence window (${ctx.timestamp - lastActed}s < ${PERIOD_SEC}s) — skipping`);
      return [];
    }

    // Precondition — enough balance to act. Skipping spends no gas.
    const balance = await ctx.read.balance(TOKEN_IN);
    if (balance < MIN_BALANCE) {
      ctx.log(`balance ${balance} < min ${MIN_BALANCE} — skipping`);
      return [];
    }

    // Allowance gap — per-call approve model (see sailor-mandates/references/approvals.md).
    // Emit the approve as its own dispatch; the swap fires on a later tick once it is set.
    // (Under the atomic-batch model you'd instead return one Dispatch whose `calls` are
    // [approve, swap, approve-to-zero], authorized by a single IBatchPermission.)
    const allowance = await ctx.read.allowance(TOKEN_IN, ctx.safe, ROUTER);
    if (allowance < AMOUNT_IN) {
      ctx.log(`allowance ${allowance} < ${AMOUNT_IN} — approving`);
      return [
        intent({
          target: TOKEN_IN,
          value: 0n,
          data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [ROUTER, AMOUNT_IN] }),
        }),
      ];
    }

    // Read — quote the swap. FAIL CLOSED: a revert or a 0 result is a "no", not a "maybe".
    let expectedOut: bigint;
    try {
      const q = await ctx.publicClient.simulateContract({
        address: QUOTER,
        abi: QUOTER_ABI,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: AMOUNT_IN, fee: FEE_TIER, sqrtPriceLimitX96: 0n }],
      });
      expectedOut = (q.result as readonly [bigint, bigint, number, bigint])[0];
    } catch (e) {
      ctx.log(`quote unavailable: ${(e as Error).message.slice(0, 120)} — skipping`);
      return [];
    }
    if (expectedOut === 0n) {
      ctx.log("quote returned 0 — skipping");
      return [];
    }

    // Decide — the slippage floor. The mandate's maxSlippageBps enforces this on-chain regardless.
    const minOut = (expectedOut * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n;

    // Act — one dispatch. Advance the cadence marker; a stricter agent advances it only after
    // seeing dispatch_executed in activity.jsonl, so a denied tick can retry (see the checklist).
    ctx.data.lastActedSec = ctx.timestamp;
    ctx.log(`swapping ${AMOUNT_IN} for >= ${minOut} (floor ${SLIPPAGE_BPS} bps)`);
    return [
      intent({
        target: ROUTER,
        value: 0n,
        data: encodeFunctionData({
          abi: ROUTER_ABI,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: TOKEN_IN,
              tokenOut: TOKEN_OUT,
              fee: FEE_TIER,
              recipient: ctx.safe,
              amountIn: AMOUNT_IN,
              amountOutMinimum: minOut,
              sqrtPriceLimitX96: 0n,
            },
          ],
        }),
      }),
    ];
  },
};
```

**One skeleton per loop shape.** This is the **read → decide → act** shape (swap/DCA/rebalance, single-asset). A position-management shape (multi-asset state, health monitoring, unwind) is a different arrangement and will be added on eval-trace evidence — do not force a health-factor loop into this template; adapt the method (translate spec → permission → dispatch → loop slot) instead.

For where decision data comes from (prices, yields, RPC upgrades), see [references/data-sources.md](references/data-sources.md).

## Next

Run `sailor run --once` and confirm it completes cleanly against the live mandate (a clean tick, or a deliberate `[]` skip — not a crash). That is Station 4's exit verifier. Then proceed to Station 5: [`sailor-automation`](../sailor-automation/SKILL.md) to launch it unattended, and the sailor-operate skill to monitor, tune, pause/resume, revoke, and exit.
