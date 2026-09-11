---
name: sailor-agent-build
description: Build the agent's executable (the tick loop in src/agent.ts) from a complete strategy spec and registered mandate. Use when asked to build my agent or make it trade automatically, once the mandate is registered and simulate-verified.
station: agent
---

# sailor-agent-build — build the brain (Station 4)

## What this owns

Turn the strategy spec into the agent's tick loop in `src/agent.ts` (or the strategy's custom
`src/strategy/<name>.ts`). Dispatch mechanics (the selective model, signing, permission resolution)
live in `sailor-transactions`; the agent's memory of what it has done (the append-only,
chain-reconciled ledger) is owned by `sailor-memory`. This skill is the decision logic that sits on
top of both.

## When to use

- The mandate is registered, simulate-verified, and signed, and the user wants the agent built:
  "build my agent", "write the agent code", "make it trade automatically".
- Station 4 of the five-station flow, after `sailor-mandate-planner` hands off.

## Gate (fail-closed)

Station 4 requires a **registered, configured, simulate-verified, and signed mandate** —
`.sail/mandate.json` exists. If it doesn't, `sailor run --once` refuses with "Run `sailor mandate sign`
first" — go back to `sailor-mandate-planner`, not to writing code against permissions that aren't
runnable yet.

Read the strategy's spec (`.sail/strategies/<name>.md`, its JSON block) and the current mandate state
first. **The agent is built FROM the spec** — tokens, venues, caps, cadence, risk bounds, and exit
condition are already decided and confirmed there. Never re-ask the user for values the spec carries.

## Steps — translate the spec into the loop

Walk the spec's actions into the loop, one at a time:

1. **For each action** (`swap`, `deposit`, `borrow`, `transfer`, `withdraw`, …) → **which registered
   permission authorizes it** (the mandate plan already mapped this). You do not name the permission in
   code — the runner probes registered permissions and routes each dispatch to the first that accepts
   (`sailor-transactions`).
2. **What the dispatch must look like** — the per-permission dispatch shape (target, selector, argument
   bounds, recipient = SMA) is in that permission's reference under `sailor-templates`, its "Agent
   config" / dispatch section. Point to it; don't re-derive calldata from memory.
3. **Where it sits in the tick loop** — a precondition check, a read, a decision, and the act. The
   canonical arrangement is in [references/canonical-skeleton.md](references/canonical-skeleton.md).

## The defensive checklist

Every one is a real failure mode the loop must survive:

- **Fail closed on zero or reverted reads.** A quote of `0`, or a reverting read, is a **no** — return
  `[]`, never fall through to acting on a missing number.
- **Match the allowance check to the approve model the mandate registered.** Default (agent-granted): a
  bounded-approve permission is registered, so the agent MAY dispatch its own `approve()` when short,
  then swap next tick. Opt-out (owner-set standing): no permission covers a standalone approve, so the
  agent must never self-approve — stall until the owner tops up. Wrong in either direction breaks:
  self-approving with no covering permission is denied; stalling with one wastes the capability. Which
  model per action is owned by [`sailor-mandates/references/approvals.md`](../sailor-mandates/references/approvals.md).
- **Respect caps client-side.** The kernel enforces caps on-chain, but check them in code first so the
  agent doesn't burn gas on a dispatch certain to be denied.
- **A denied dispatch is information, not an error.** Read the denial reason; adjust within bounds; never
  blind-retry the identical call.
- **Cadence guard from the memory ledger, not `ctx.data`.** `ctx.data` resets on every fresh process (the
  shipped GitHub Actions / Docker hosts start one per tick), so a cadence guard sourced from it is no
  guard. Read last-acted time from the ledger (`sailor-memory`).
- **Bounded retries with backoff.** Cap attempts, space them out; a lost retry counter after a restart is
  harmless, so `ctx.data` is fine for this one.
- **Log every decision and its inputs** with `ctx.log(msg)`. The runner appends it to `.sail/activity.jsonl`
  and emits structured events around your dispatches; you do not write the file yourself.

## Run modes and per-chain env

How the runner executes your executable each tick is set by whether its strategy carries a `chains` list
([`sailor-strategy` → execution-config](../sailor-strategy/references/execution-config.md)):

- **per-chain** — `chains` is set. The runner **replays the executable once per chain**; each replay's
  top-level `ctx` is bound to that chain. Same code, every chain. Write against the top-level `ctx`.
- **cross-chain** — `chains` omitted. The runner invokes the executable **once**; the default `ctx` is
  bound to the primary chain, and the executable drives chains itself via `ctx.chain(id)`.

In both modes the executable can reach any chain the SMA is deployed on via `ctx.chain(id)`; the `chains`
list only sets the default replay behavior.

**Per-chain env.** `ctx.env` values come from `.sail/env/<chain-slug>.json`, shared across strategies,
loaded for the running chain. Read them via `ctx.env` / `ctx.chain(id).env`, never `process.env`.
`references/canonical-skeleton.md` shows both modes in code.

## The canonical skeleton

The full read → decide → act `tick()` — strategy constants, ABI fragments, chain reconciliation, the
cadence guard, the allowance check, the quote + slippage floor, and the dispatch — lives in
**[references/canonical-skeleton.md](references/canonical-skeleton.md)**. Adapt it into `src/agent.ts`,
replacing the `0x0…0` placeholders with the spec's resolved values.

**One skeleton per loop shape.** The canonical skeleton is the **read → decide → act** shape
(swap/DCA/rebalance, single-asset). A position-management shape (multi-asset state, health monitoring,
unwind) is a different arrangement — do not force a health-factor loop into this template; adapt the
method instead. For where decision data comes from (prices, yields, RPC upgrades), see
[references/data-sources.md](references/data-sources.md).

## Next

Run `sailor run --once` and confirm it completes cleanly (a clean tick or a deliberate `[]` skip, not a
crash) — Station 4's exit verifier. A first `--once` run only ever produces a `skipped` ledger entry
(there is nothing yet to reconcile); the first `acted` entry lands once a later tick reconciles a
confirmed dispatch.

**Fund the SMA with trading capital — the step Station 1 deliberately skipped.** Station 1 funded gas,
never the token the agent trades, because the strategy didn't exist yet. It does now: read the spec's
`actions[]` for each action's `tokenIn`, and tell the user plainly, by name: "Your agent trades from
`<SMA address>` on `<chain>` — send it the `<tokenIn.symbol>` you want it to manage." Show the current
balance (`sailor ui start` surfaces it). Funded, the loop acts within the mandate; unfunded, it skips
every tick with `balance <n> < min <n>` — expected, not a bug.

Then Station 5: `sailor-automation` to launch it unattended, and `sailor-operate` to monitor, tune,
pause, revoke, and exit.

## Pitfalls

- **Never re-ask the user for a value the spec already carries.** Tokens, venues, caps, cadence are fixed
  in the spec; the code is derived from it.
- **The cadence guard must come from the ledger, not `ctx.data`.** `ctx.data` resets every process; a
  cadence guard sourced from it double-fires on every fresh tick.
- **Don't self-approve in the owner-set model.** If the mandate didn't register a bounded-approve
  permission, an `approve()` dispatch is denied on-chain — stall, don't push it.
