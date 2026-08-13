# The canonical skeleton — read → decide → act

## The canonical skeleton

A complete `tick()` in the **read → decide → act** shape, derived from the DCA reference. Every value marked `FROM SPEC` comes from the strategy's `.sail/strategies/<name>.md`; the placeholder addresses are `0x0…0` — replace them with the spec's resolved addresses. Adapt it into `src/agent.ts`.

```ts
// @sailor-skeleton
// Canonical Sailor agent loop — the read → decide → act shape.
// Adapt into src/agent.ts. Every value marked FROM SPEC comes from the strategy's .sail/strategies/<name>.md;
// do not re-ask the user for it. Replace the 0x0…0 placeholders with the spec's addresses.

import fs from "node:fs";
import path from "node:path";
import type { Agent, AgentContext, Address, Call, Dispatch } from "@sail.money/sailor/sdk";
import { decodeFunctionData, encodeFunctionData, formatUnits, parseEventLogs } from "viem";

// ── Strategy constants (FROM SPEC — .sail/strategies/<name>.md) ─────────────
const TOKEN_IN: Address = "0x0000000000000000000000000000000000000000"; // FROM SPEC: sell-side token (resolved address)
const TOKEN_IN_SYMBOL = "TOKEN_IN"; // FROM SPEC: sell-side token symbol — ledger "human" strings only
const TOKEN_OUT: Address = "0x0000000000000000000000000000000000000000"; // FROM SPEC: buy-side token
const TOKEN_OUT_SYMBOL = "TOKEN_OUT"; // FROM SPEC: buy-side token symbol — ledger "human" strings only
const ROUTER: Address = "0x0000000000000000000000000000000000000000"; // FROM SPEC: venue router (must be in the mandate's allowlist)
const QUOTER: Address = "0x0000000000000000000000000000000000000000"; // the venue's off-chain quoter (see sailor-swap-quote)
const AMOUNT_IN = 25_000_000n; // FROM SPEC: per-tick spend, base units (<= the mandate's maxAmountPerTx)
const MIN_BALANCE = 25_000_000n; // FROM SPEC: don't act below this SMA balance
const FEE_TIER = 3000; // FROM SPEC: pool fee tier (from sailor-token-resolve)
const SLIPPAGE_BPS = 100; // FROM SPEC: slippage limit (<= the mandate's maxSlippageBps)
const PERIOD_SEC = 86_400; // FROM SPEC: cadence — minimum seconds between actions

// ── ABI fragments (only what the loop calls) ────────────────────────────────
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

const ERC20_TRANSFER_ABI = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

const ERC20_APPROVE_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// Approve model (FROM SPEC — decided at mandate-build time, sailor-mandates/references/approvals.md):
//   true  = agent-granted (featured default): a bounded-approve IPermission is registered for
//           ROUTER (the BoundedErc20Approve worked example in
//           sailor-mandates/references/authoring-patterns.md) — the agent may dispatch its own
//           approve() when the allowance is short, gated by that permission, no owner involved.
//   false = owner-set standing: the owner approved ROUTER directly on the Safe, outside the
//           mandate — no permission covers a standalone approve(), so the agent must stall instead.
const AGENT_GRANTS_APPROVAL: boolean = true;

// ── Memory ledger (.sail/memory/ledger.jsonl) — see the sailor-memory skill ─
// Append-only, chain-reconciled record of every tick: what was actually
// confirmed on-chain (never the agent's stated intention), and every tick the
// agent chose not to act, with why. A fresh process recovers its own history
// by reading this file — readLastActedSec() below replaces ctx.data as the
// cadence guard's source of truth, because ctx.data resets on every process
// restart and the ledger doesn't.
const LEDGER_PATH = path.join(process.cwd(), ".sail", "memory", "ledger.jsonl");
const ACTIVITY_PATH = path.join(process.cwd(), ".sail", "activity.jsonl");

const readLines = (file: string): string[] => {
  try {
    return fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
};

const appendLedger = (entry: Record<string, unknown>): void => {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.appendFileSync(LEDGER_PATH, `${JSON.stringify(entry)}\n`);
};

// Last CONFIRMED "acted" entry's timestamp — the cadence guard's only input.
// Read fresh every tick, on purpose: a restart loses nothing, because "when did
// I last act" lives in the ledger, not in memory.
const readLastActedSec = (): number => {
  const lines = readLines(LEDGER_PATH);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.kind === "acted" && entry.outcome === "confirmed") return entry.ts;
    } catch {
      // a malformed line is skipped, never fatal to the loop
    }
  }
  return 0;
};

// txHashes already recorded, so reconciliation never double-ledgers a dispatch.
// Bounded scan: a dispatch is only ever pending for one tick, so the ledger's
// tail is enough — no need to keep a cursor across restarts.
const ledgeredTxHashes = (): Set<string> => {
  const set = new Set<string>();
  for (const line of readLines(LEDGER_PATH).slice(-50)) {
    try {
      const entry = JSON.parse(line);
      if (entry.kind === "acted" && typeof entry.txHash === "string") set.add(entry.txHash);
    } catch {
      // ignore a malformed line
    }
  }
  return set;
};

/**
 * Chain-reconcile every dispatch this agent submitted that the runner has
 * since confirmed or reverted. `sailor run` appends `dispatch_executed` /
 * `dispatch_reverted` to `.sail/activity.jsonl` only AFTER
 * `execClient.dispatch.single/batch` has already awaited the receipt — so by
 * the time this tick starts (whether it's the same process or a fresh one),
 * the outcome of the LAST tick's dispatch is always already sitting on disk.
 *
 * Every field below comes from the receipt, the submitted calldata, or a
 * fresh balance read — never from what the agent meant to do. If the receipt
 * can't be read, the entry is recorded `unverified`, never a fabricated
 * success (mirrors the signing flow's confirmed/reverted/unverified
 * doctrine — see sailor-transactions).
 */
async function reconcilePending(ctx: AgentContext): Promise<void> {
  const already = ledgeredTxHashes();
  const pending = readLines(ACTIVITY_PATH)
    .slice(-20) // a pending dispatch is always from the immediately preceding tick
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(
      (e): e is Record<string, unknown> =>
        !!e &&
        (e.type === "dispatch_executed" || e.type === "dispatch_reverted") &&
        typeof e.target === "string" &&
        e.target.toLowerCase() === ROUTER.toLowerCase() &&
        typeof e.txHash === "string" &&
        !already.has(e.txHash as string),
    );

  for (const event of pending) {
    const txHash = event.txHash as `0x${string}`;
    const permission = (event.permission as Address | undefined) ?? null;
    try {
      const [tx, receipt] = await Promise.all([
        ctx.publicClient.getTransaction({ hash: txHash }),
        ctx.publicClient.getTransactionReceipt({ hash: txHash }),
      ]);
      const { args } = decodeFunctionData({ abi: ROUTER_ABI, data: tx.input });
      const [params] = args;
      const outcome: "confirmed" | "reverted" = receipt.status === "success" ? "confirmed" : "reverted";

      // amountOut is only knowable once the swap actually ran — decode it from
      // the tokenOut Transfer landing on the SMA, never from the pre-trade
      // amountOutMinimum floor (that's a bound, not what was received).
      let amountOut: bigint | null = null;
      if (outcome === "confirmed") {
        const transfers = parseEventLogs({ abi: ERC20_TRANSFER_ABI, logs: receipt.logs, eventName: "Transfer" });
        const toSma = transfers.find(
          (t) =>
            t.address.toLowerCase() === params.tokenOut.toLowerCase() &&
            t.args.to.toLowerCase() === ctx.safe.toLowerCase(),
        );
        amountOut = toSma?.args.value ?? null;
      }

      const [balIn, balOut, decIn, decOut] = await Promise.all([
        ctx.read.balance(params.tokenIn),
        ctx.read.balance(params.tokenOut),
        ctx.read.decimals(params.tokenIn),
        ctx.read.decimals(params.tokenOut),
      ]);

      appendLedger({
        ts: ctx.timestamp,
        block: Number(receipt.blockNumber),
        chainId: ctx.chainId,
        kind: "acted",
        action: "swap",
        permission,
        outcome,
        txHash,
        gasUsed: receipt.gasUsed.toString(),
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: { baseUnits: params.amountIn.toString(), human: `${formatUnits(params.amountIn, decIn)} ${TOKEN_IN_SYMBOL}` },
        amountOut:
          amountOut === null
            ? null
            : { baseUnits: amountOut.toString(), human: `${formatUnits(amountOut, decOut)} ${TOKEN_OUT_SYMBOL}` },
        balancesAfter: { [params.tokenIn]: balIn.toString(), [params.tokenOut]: balOut.toString() },
      });
    } catch (e) {
      // Receipt or calldata unobservable (RPC hiccup, pruned node, timeout) —
      // the dispatch WAS submitted, so this is "unverified", never silently
      // dropped and never recorded as a success we didn't actually see.
      appendLedger({
        ts: ctx.timestamp,
        block: Number(ctx.blockNumber),
        chainId: ctx.chainId,
        kind: "acted",
        action: "swap",
        permission,
        outcome: "unverified",
        txHash,
        gasUsed: null,
        tokenIn: TOKEN_IN,
        tokenOut: TOKEN_OUT,
        amountIn: null,
        amountOut: null,
        balancesAfter: null,
        note: (e as Error).message.slice(0, 160),
      });
    }
  }
}

// One call becomes one dispatch; the runner submits it against a matching permission.
const intent = (call: Call): Dispatch => ({ txHash: "0x", calls: [call], success: false, gasUsed: 0n });

export const agent: Agent = {
  name: "my-agent",
  description: "Describe your strategy here.",

  async tick(ctx: AgentContext): Promise<Dispatch[]> {
    ctx.log(`tick — block ${ctx.blockNumber}, sma ${ctx.safe}`);

    // Reconcile first — before deciding anything, catch up the ledger on any
    // dispatch a PRIOR tick submitted that has since confirmed or reverted.
    // This also doubles as this tick's memory read: the cadence guard below
    // reads the ledger this just brought current, not ctx.data.
    await reconcilePending(ctx);

    // Cadence guard — never double-fire a period. Sourced from the ledger, not
    // ctx.data: ctx.data resets on every fresh process (the shipped GitHub
    // Actions / Docker hosts start one per tick), so it can't be trusted as a
    // cadence memory. The ledger's last CONFIRMED acted entry can.
    const lastActed = readLastActedSec();
    if (ctx.timestamp - lastActed < PERIOD_SEC) {
      const reason = `cadence: last acted ${ctx.timestamp - lastActed}s ago, interval ${PERIOD_SEC}s`;
      ctx.log(`${reason} — skipping`);
      appendLedger({ ts: ctx.timestamp, block: Number(ctx.blockNumber), chainId: ctx.chainId, kind: "skipped", reason });
      return [];
    }

    // Precondition — enough balance to act. Skipping spends no gas.
    const balance = await ctx.read.balance(TOKEN_IN);
    if (balance < MIN_BALANCE) {
      const reason = `balance ${balance} < min ${MIN_BALANCE}`;
      ctx.log(`${reason} — skipping`);
      appendLedger({ ts: ctx.timestamp, block: Number(ctx.blockNumber), chainId: ctx.chainId, kind: "skipped", reason });
      return [];
    }

    // Allowance check. Which branch fires must match what the mandate actually registered
    // (AGENT_GRANTS_APPROVAL above) — see `sailor-templates` (swap), the "Approve coverage" section.
    const allowance = await ctx.read.allowance(TOKEN_IN, ctx.safe, ROUTER);
    if (allowance < AMOUNT_IN) {
      if (AGENT_GRANTS_APPROVAL) {
        // Agent-granted: dispatch our own approve() this tick, gated by the registered
        // bounded-approve permission — no one else's signature needed. Skip the swap this
        // tick; the next tick's allowance read sees it satisfied and swaps.
        const approveAmount = AMOUNT_IN; // FROM SPEC: per-trade cap; use a standing max instead to re-approve less often
        const reason = `allowance ${allowance} < ${AMOUNT_IN} for ${ROUTER} — self-approving`;
        ctx.log(`${reason} — skipping swap this tick`);
        appendLedger({ ts: ctx.timestamp, block: Number(ctx.blockNumber), chainId: ctx.chainId, kind: "skipped", reason });
        return [
          intent({
            target: TOKEN_IN,
            value: 0n,
            data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [ROUTER, approveAmount] }),
          }),
        ];
      }
      // Owner-set standing: no permission authorizes a standalone approve() dispatch in this
      // model, so the agent must never self-approve — stall and wait for the owner to top up.
      const reason = `allowance ${allowance} < ${AMOUNT_IN} for ${ROUTER} — owner top-up needed`;
      ctx.log(`${reason} — skipping`);
      appendLedger({ ts: ctx.timestamp, block: Number(ctx.blockNumber), chainId: ctx.chainId, kind: "skipped", reason });
      return [];
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
      const reason = `quote unavailable: ${(e as Error).message.slice(0, 120)}`;
      ctx.log(`${reason} — skipping`);
      appendLedger({ ts: ctx.timestamp, block: Number(ctx.blockNumber), chainId: ctx.chainId, kind: "skipped", reason });
      return [];
    }
    if (expectedOut === 0n) {
      const reason = "quote returned 0";
      ctx.log(`${reason} — skipping`);
      appendLedger({ ts: ctx.timestamp, block: Number(ctx.blockNumber), chainId: ctx.chainId, kind: "skipped", reason });
      return [];
    }

    // Decide — the slippage floor. This dispatch is a single call under SwapPermission, which
    // decodes amountOutMinimum from the call and rejects anything below its oracle-implied
    // floor — genuinely enforced on-chain, not a courtesy the router alone honors.
    const minOut = (expectedOut * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n;

    // Act — one dispatch. No optimistic cadence update here: the ledger only advances once
    // reconcilePending() sees this confirmed on-chain, on a later tick — terrain over map.
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
