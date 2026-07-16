---
name: sailor-memory
description: Owns the agent's memory model — the append-only, chain-reconciled ledger at .sail/memory/ledger.jsonl that records every tick, acted or skipped, so a fresh process recovers its own trading history. Use when building or reviewing the tick loop's memory behavior, when the cadence guard needs a source of truth, when asked "what has my agent actually done", "why did it skip", "does it remember its last trade", or "where does my agent's history live".
---

# sailor-memory — the agent's own history (Station 4 foundation)

## Why this exists

The shipped automation hosts (GitHub Actions cron, the Docker loop) start a **fresh process every tick** — `ctx.data` resets each time, so an agent that only kept state in memory is amnesiac by construction: it cannot see its own last trade, let alone reason about its history. The mandate (per-tx cap, price floor, allowlists, checked by the kernel on every dispatch) is the safety floor and sits below this — nothing here makes the agent safe, that's the protocol's job. This ledger is for **usefulness and legibility**: giving the agent (and eventually the owner, via a future dashboard) a durable, honest record to read.

## The three rules

1. **Append-only.** Like a bank statement — one line per event, never rewritten, never summarized over. `.sail/memory/ledger.jsonl`, JSON-lines: one JSON object per line.
2. **Chain-reconciled, never intention.** An entry is written from receipt + on-chain balance truth, not from what the agent meant to do. This is terrain-over-map applied to the agent's own record: even if a tick's decision logic is wrong or the process crashes mid-flight, the ledger can't drift into fiction, because nothing is written until it's confirmed (or definitively reverted, or genuinely unverifiable).
3. **Records the decision not to act, too.** A `skipped` entry (timestamp + reason) is as valuable as a trade — "considered, chose to skip, why" is exactly what an owner or a future reasoning pass needs to tell a quiet agent from a broken one.

## File layout

```
.sail/memory/ledger.jsonl
```

Lives alongside `.sail/activity.jsonl` (the runner's own dispatch-mechanics log — permission resolution, denials, reverts) but is a different thing: `activity.jsonl` is the **runner's** account of what it did with a dispatch; `ledger.jsonl` is the **agent's** account of its own trading history, written by the tick loop itself and scoped to what the strategy actually cares about (tokens, amounts, resulting balances).

## Entry schema

Every entry carries `ts` (unix seconds), `block`, `chainId`, and `kind`.

**`kind: "acted"`** — a dispatch this tick's loop actually submitted, reconciled once confirmed:

```json
{
  "ts": 1752400000, "block": 21894213, "chainId": 8453,
  "kind": "acted", "action": "swap", "permission": "0xSwapPermission…",
  "outcome": "confirmed",
  "txHash": "0x…", "gasUsed": "142013",
  "tokenIn": "0xTokenIn…", "tokenOut": "0xTokenOut…",
  "amountIn":  { "baseUnits": "25000000", "human": "25.0 USDC" },
  "amountOut": { "baseUnits": "9821340000000000", "human": "0.00982134 WETH" },
  "balancesAfter": { "0xTokenIn…": "475000000", "0xTokenOut…": "104213340000000000" }
}
```

`outcome` is one of **`confirmed` / `reverted` / `unverified`** — the same doctrine [`sailor-transactions`](../sailor-transactions/SKILL.md) already uses for the signing flow: `confirmed` (mined with a successful receipt), `reverted` (mined but the transaction reverted), `unverified` (submitted — there's a `txHash` — but the receipt couldn't be read; not a failure, just unobserved). A `reverted` or `unverified` entry still carries what's knowable (the submitted calldata's `amountIn`, the `txHash`, `gasUsed` if the receipt was readable) and leaves the rest `null` — never a fabricated success.

**`kind: "skipped"`** — the agent considered acting and chose not to, with why:

```json
{ "ts": 1752398000, "block": 21894100, "chainId": 8453, "kind": "skipped", "reason": "cadence: last acted 4h ago, interval 24h" }
```

Typical reasons: `"cadence: last acted <n>s ago, interval <n>s"`, `"balance <n> < min <n>"`, `"allowance <n> < <n> for <router> — owner top-up needed"`, `"quote unavailable: <message>"`, `"quote returned 0"`.

This schema is a contract — the state snapshot and journal stages read it. Keep it lean and don't add fields casually.

## How the tick loop maintains it

The mechanics live in the skeleton ([`sailor-agent-build`](../sailor-agent-build/SKILL.md)'s canonical `tick()`), not repeated here — the model is:

1. **At the top of every tick, reconcile first.** `sailor run` already appends `dispatch_executed` / `dispatch_reverted` to `.sail/activity.jsonl` only *after* awaiting the dispatch's receipt — so by the time any tick starts (same process or a fresh one), the previous tick's outcome is always already on disk. The loop scans for any not-yet-ledgered dispatch, pulls the receipt + the submitted calldata + fresh balance reads, and appends the `acted` entry from that — never from what it meant to do.
2. **Then read memory.** The cadence guard's "last acted" comes from the ledger's last `outcome: "confirmed"` `acted` entry, not `ctx.data`. This is the same fix Commit C's cadence work was reaching for, arrived at differently — see "Superseding ctx.data" below.
3. **Decide**, exactly as before.
4. **If skipping, append a `skipped` entry with the reason** at the point of return — one per early-return branch (cadence, balance, allowance, quote failure).
5. **If acting, just submit.** No ledger write happens on this tick for the dispatch just submitted — it hasn't confirmed yet. The `acted` entry for it appears on step 1 of a *later* tick, once reconciled. Don't try to write it optimistically; that's exactly the intention-not-truth failure mode this ledger exists to avoid.

## Superseding `ctx.data` for cadence

Before this, the cadence guard read `ctx.data.lastActedSec` — memory-only, reset on every fresh process, which is exactly why a "daily" strategy could fire on every automation tick regardless of the configured interval. That never shipped as a separate persisted-`agentData`-to-disk patch; this ledger is the fix instead, and it's the better one: cadence now derives from **on-chain-confirmed reality**, not a JSON blob seeded from `SAILOR_DATA`. If a future patch is tempted to add generic `ctx.data`-to-disk persistence, don't let cadence read from it in parallel with the ledger — the ledger's last confirmed `acted` entry is the one source of truth for "when did this agent last act." Other ephemeral `ctx.data` uses (a retry counter, a backoff timer) are unaffected — losing those on restart is harmless and out of scope here.

## Scope note

This is Stage 1 — the ledger only. It does not include a derived state snapshot (a compact cache so a tick doesn't rescan the whole ledger — a natural Stage 2) or a narrative journal built from these entries (Stage 4). Both would read this schema, not replace it.
