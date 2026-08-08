---
name: sailor-agent-build
description: Station 4 — build the agent's brain, the tick loop in src/agent.ts, from the strategy spec and the registered mandate. Use when the user says "build my agent", "write the agent code", "agent logic", "tick loop", "src/agent.ts", or "make it trade automatically" — and structurally once the mandate is registered and simulate-verified and .sail/strategy.md is complete.
---

# sailor-agent-build — build the brain (Station 4)

You typically arrive here from the mandate plan with a registered, simulate-verified, **signed** mandate. This station turns the strategy spec into the agent's tick loop in `src/agent.ts`. Dispatch mechanics (the selective model, signing, permission resolution) live in [`sailor-transactions`](../sailor-transactions/SKILL.md); the agent's own memory of what it's done — the append-only, chain-reconciled ledger the skeleton reads and writes every tick — is owned by [`sailor-memory`](../sailor-memory/SKILL.md). This skill is about the decision logic that sits on top of both. Once the loop is written, wire it to run — register the executable as a **strategy** (SMA + optional chains) in `.sail/strategies/strategies.json`: see [`sailor-strategy` → references/execution-config.md](../sailor-strategy/references/execution-config.md) for the model, the config file, and the `sailor strategy` CLI. How the runner then executes it each tick — the two run modes and per-chain env — is covered in "Run modes and per-chain env" below; running strategies at different cadences lives in [`sailor-automation`](../sailor-automation/SKILL.md).

## Gate (fail-closed)

Station 4 requires a **registered, configured, simulate-verified, and signed mandate** — `.sail/mandate.json` exists (the sailor-navigator skill's Station 4 gate). If it doesn't, `sailor run --once` refuses with "Run `sailor mandate sign` first" — go back to [`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md) (its Handoff step signs the mandate) rather than writing agent code against permissions that aren't runnable yet.

Read `.sail/strategy.md`'s JSON block and the current mandate state first. **The agent is built FROM the spec** — its tokens, venues, caps, cadence, risk bounds, and exit condition are already decided and confirmed there. Never re-ask the user for values the spec already carries. `.sail/strategy.md` stays the fixed intent throughout — the memory ledger records what actually happened against it, and never the other way around.

## The translation method

Walk the spec's actions into the loop, one at a time:

1. **For each action** in the strategy JSON (`swap`, `deposit`, `borrow`, `transfer`, `withdraw`, …) → **which registered permission authorizes it** (the mandate plan already mapped this). You do not name the permission in code — the runner probes registered permissions and routes each dispatch to the first that accepts (see `sailor-transactions`).
2. **What the dispatch must look like** — the per-permission dispatch shape (target, selector, argument bounds, recipient = SMA) is documented in that action's spoke skill (`sailor-template-*`), in its "Agent config" / dispatch section. Point to it; don't re-derive the calldata from memory.
3. **Where it sits in the tick loop** — a precondition check, a read, a decision, and the act. The skeleton below is the canonical arrangement.

## The defensive checklist

Verify the agent code against these — every one is a real failure mode the loop must survive:

- **Fail closed on zero or reverted reads.** A quote of `0`, or a read that reverts, is a **no**, not a maybe — return `[]` (skip the tick), never fall through to acting on a missing number.
- **Check allowances before acting — match the check to which approve model the mandate actually registered.** Default (agent-granted): a bespoke bounded-approve permission is registered for the router, so the agent MAY dispatch its own `approve()` when the allowance is short — one single-call dispatch, gated by that permission, no one else's signature needed — then swap on a later tick once it clears. Opt-out (owner-set standing): the owner approved the router directly on the Safe instead, so no permission covers a standalone approve; the agent must never self-approve in that case — the same read instead makes it stall (log, skip) until the owner tops it up. Get this wrong in either direction and it breaks: self-approving with no covering permission is denied on-chain; stalling when a covering permission exists just means the agent never uses the capability it was given. For other actions, which approve model to use (per-call vs atomic batch) is owned by [`sailor-mandates/references/approvals.md`](../sailor-mandates/references/approvals.md) — follow the one the mandate plan chose.
- **Respect caps client-side.** The kernel enforces the mandate's caps on-chain, but check them in code first so the agent doesn't burn gas on a dispatch that is certain to be denied.
- **A denied dispatch is information, not an error.** The runner logs the denial reason to `.sail/activity.jsonl`; read it, adjust within bounds, and never blind-retry the identical call — the next scheduled tick re-evaluates.
- **Cadence guard.** Never double-fire a period. The runner ticks on its own interval (`SAILOR_INTERVAL`); the agent must track its own last-action time and skip until the period has elapsed. Read it from the memory ledger (`sailor-memory`), not `ctx.data` — `ctx.data` resets on every fresh process (exactly what the shipped GitHub Actions / Docker hosts start per tick), so a cadence guard sourced from it is not a guard at all.
- **Bounded retries with backoff.** If you retry a transient failure, cap the attempts and space them out (track a counter/next-attempt time in `ctx.data`) — do not hammer a dead RPC or a reverting venue every tick. Unlike cadence, a lost retry counter after a restart is harmless (worst case: one extra retry), so `ctx.data` is fine here.
- **Log every decision and its inputs.** Call `ctx.log(msg)` at each branch. The runner appends it to `.sail/activity.jsonl` as a `log` entry and emits its own structured events around your dispatches (schema: [`sailor-operate`](../sailor-operate/SKILL.md)). Your job is `ctx.log`; the structured events are the runner's — you do not write the file yourself. Separately, every acted-or-skipped decision the agent itself makes is recorded to the memory ledger — see [`sailor-memory`](../sailor-memory/SKILL.md).

## Run modes and per-chain env

How the runner executes your executable each tick is set by whether its strategy carries a `chains` list (the `strategies.json` wiring — [`sailor-strategy` → execution-config](../sailor-strategy/references/execution-config.md)). Two modes:

- **per-chain** — `chains` is set. The runner **replays the executable once per listed chain**, sequentially; each replay's top-level `ctx` is already bound to that chain (`ctx.chainId`, `ctx.env`). Same code, every chain — the common case. Write against the top-level `ctx`.
- **cross-chain** — `chains` is omitted. The runner invokes the executable **once**; the default `ctx` is bound to the SMA's primary chain, and the executable drives chains itself via `ctx.chain(id)`, which returns a handle `{ chainId, publicClient, client, env, read, dispatch }` bound to this SMA on that chain (it throws if the SMA isn't deployed there).

In **both** modes the executable can reach any chain the SMA is deployed on via `ctx.chain(id)`; the `chains` list only sets the default replay behavior.

**Per-chain env.** `ctx.env` values come from `.sail/env/<chain-slug>.json` — one file per chain (`base.json`, `arbitrum.json`, …), **shared across every strategy in the project**, loaded for whichever chain the executable is running on. They reach the executable via `ctx.env` (the current/default chain) and `ctx.chain(id).env` (that chain's values), and **never** via `process.env`. Write the logic once against `ctx.env.MORPHO_TOKEN_ADDR` and set each chain's address in that chain's env file. (Setting these files: `sailor strategy env set <chain> KEY=value` — see [`sailor-strategy` → execution-config](../sailor-strategy/references/execution-config.md).)

```ts
// cross-chain (no chains list): read on Base, act on Arbitrum — one flow.
async tick(ctx: AgentContext): Promise<Dispatch[]> {
  const base = ctx.chain(8453);
  const arb  = ctx.chain(42161);
  const bal = await base.read.balance(base.env.USDC as `0x${string}`);
  if (bal < MIN) return [];
  return [ arb.dispatch({ calls: [/* supply on Arbitrum */] }) ];
}
```

```ts
// per-chain (chains list): same script, replayed per chain — just use the top-level ctx.
async tick(ctx: AgentContext): Promise<Dispatch[]> {
  const token = ctx.env.MORPHO_TOKEN_ADDR as `0x${string}`;  // this chain's value
  const bal = await ctx.read.balance(token);
  return bal > MIN ? [{ calls: [/* … on ctx.chainId */] }] : [];
}
```

## The canonical skeleton

A complete `tick()` in the **read → decide → act** shape, derived from the DCA reference. Every value marked `FROM SPEC` comes from `.sail/strategy.md`; the placeholder addresses are `0x0…0` — replace them with the spec's resolved addresses. Adapt it into `src/agent.ts`.

```ts
// @sailor-skeleton
// Canonical Sailor agent loop — the read → decide → act shape.
// Adapt into src/agent.ts. Every value marked FROM SPEC comes from .sail/strategy.md;
// do not re-ask the user for it. Replace the 0x0…0 placeholders with the spec's addresses.

import fs from "node:fs";
import path from "node:path";
import type { Agent, AgentContext, Address, Call, Dispatch } from "@sail.money/sailor/sdk";
import { decodeFunctionData, encodeFunctionData, formatUnits, parseEventLogs } from "viem";

// ── Strategy constants (FROM SPEC — .sail/strategy.md) ──────────────────────
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
    // (AGENT_GRANTS_APPROVAL above) — see sailor-template-swap's "Approve coverage".
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

## Next

Run `sailor run --once` and confirm it completes cleanly against the live mandate (a clean tick, or a deliberate `[]` skip — not a crash). That is Station 4's exit verifier. A first `--once` run only ever produces a `skipped` ledger entry (there's nothing yet to reconcile) — that's expected, not a bug; the first `acted` entry lands once a later tick reconciles a confirmed dispatch. See [`sailor-memory`](../sailor-memory/SKILL.md) for the ledger this loop maintains.

**Fund the SMA with trading capital — the step Station 1 deliberately skipped.** Station 1 funded gas (the owner and agent wallets, so they can submit transactions) — never the token the agent actually trades with, because at that point the strategy didn't exist yet. It exists now: read `.sail/strategy.md`'s resolved `actions[]` for each action's `tokenIn` (symbol + address) — that's what the SMA needs to hold. Tell the user plainly, by name: "Your agent trades from `<SMA address>` on `<chain>` — send it the `<tokenIn.symbol>` you want it to manage" (the SMA is the same address on every supported chain, but only acts on the one it's configured for — name that one). Show the current balance if you can — `sailor ui start` opens the dashboard, which already surfaces it, or point to a block explorer for the SMA address — so the user sees what's there before deciding how much to add. Frame this as putting the agent to work, not a warning: funded, the tick loop's balance precondition passes and it acts within the mandate; unfunded, it runs cleanly and skips every tick, logging `balance <n> < min <n>` (see the skeleton's precondition check above) — expected, not a bug, and now the user knows why if they see it.

Then proceed to Station 5: [`sailor-automation`](../sailor-automation/SKILL.md) to launch it unattended, and the sailor-operate skill to monitor, tune, pause/resume, revoke, and exit.
