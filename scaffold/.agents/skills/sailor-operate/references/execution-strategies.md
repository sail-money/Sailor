# Execution strategies — how the agent runs each tick

> **Runtime side.** This doc is what `sailor run` *does* with the configured strategies. For the model, the `.sail/strategies/strategies.json` config, and how to **create** strategies (the CLI), see [`sailor-agent-build` → execution-strategy-config](../../sailor-agent-build/references/execution-strategy-config.md). (And note: neither is the intent strategy — that's [`sailor-strategy`](../../sailor-strategy/SKILL.md) → `.sail/strategy.md`.)

A **strategy** is one SMA + one executable (`src/strategy/<name>.ts`), with an optional `chains` list.
Active strategies run on every `sailor run` tick.

## Two run modes — set by whether `chains` is present

The strategy provides the **default execution params** (its SMA + a default chain). In **both** modes the executable can reach any chain the SMA is deployed on via `ctx.chain(id)`.

- **chainAgnostic** — `chains` is set. The runner **replays the executable once per chain** in `chains`; each run's default `ctx` is bound to that chain (`ctx.chainId`, `ctx.env`). Same code, every chain — the common case.
- **multichain** — `chains` is omitted. The runner invokes the executable **once**; the chain isn't constrained on execution — the default `ctx` is bound to the SMA's primary deployed chain, and the executable drives chains itself via `ctx.chain(id)`.

## Changing chain inside an executable — `ctx.chain(id)`

`ctx.chain(chainId)` returns a handle bound to this strategy's SMA on that chain:
`{ chainId, publicClient, client, env, read, dispatch }`. `dispatch(intent)` tags the intent with its
chain; the runner routes returned dispatches to the right chain. It throws if the SMA is not deployed
on `chainId`.

```ts
// A strategy with NO chains list (multichain): read on Base, act on Arbitrum — one flow.
async tick(ctx: AgentContext): Promise<Dispatch[]> {
  const base = ctx.chain(8453);
  const arb  = ctx.chain(42161);
  const bal = await base.read.balance(base.env.USDC as `0x${string}`);
  if (bal < MIN) return [];
  return [ arb.dispatch({ calls: [/* supply on Arbitrum */] }) ];
}
```

For a **chainAgnostic** strategy the same script just uses the top-level `ctx` (it's already bound to
the current replay chain) and returns `Dispatch[]`:

```ts
async tick(ctx: AgentContext): Promise<Dispatch[]> {
  const token = ctx.env.MORPHO_TOKEN_ADDR as `0x${string}`;  // this chain's value
  const bal = await ctx.read.balance(token);
  return bal > MIN ? [{ calls: [/* … on ctx.chainId */] }] : [];
}
```

## Environment at runtime

Per-chain values from `.sail/env/<chain-slug>.json` reach the executable via `ctx.env` (the **default
chain's** values) and `ctx.chain(id).env` (that chain's values). They never leak into `process.env`.
Setting these files is covered in the config doc linked above.

## How `sailor run` works

- **Default** (`sailor run`): runs **every `active` strategy** each tick.
- **Filtered** (`sailor run --strategy <name>`): runs only that one strategy — the key lever for scheduling (below).
- **Further filters**: `--sma <address>` runs only strategies for that SMA; `--chains <ids>` (comma-separated) narrows the chains a strategy runs on (intersected with its replay set, or its deployed set in multichain mode).
- **The chain comes only from the strategy.** `CHAIN_ID` / `config.json.chainId` are no longer read.
- Returned dispatches are grouped by their chain tag and executed per chain **sequentially** (nonce safety). A denied or reverted dispatch is logged and skipped — it never stops the loop.
- `--once` runs a single tick; otherwise it loops at `SAILOR_INTERVAL` (default 60s).
- **Zero-config back-compat:** with no `strategies.json`, `run` uses the **Default** strategy — the `agent` executable on the SMA's first deployed chain — seeded at onboarding, so `sailor run` "just works".

## Execution ratios via schedulers

The runner has **one interval** — all active strategies fire together each tick. To run strategies at
**different cadences/ratios**, drive them from separate schedulers, each filtering with `--strategy`:

| Scheduler | Command | Cadence |
|---|---|---|
| GitHub Action A | `sailor run --once --strategy Yield` | every 5 min |
| GitHub Action B | `sailor run --once --strategy Rebalance` | hourly |

So the same project runs `Yield` 12× as often as `Rebalance`. See [`sailor-automation`](../../sailor-automation/SKILL.md) for wiring GitHub Actions / cron / Docker / a local daemon — each entry point just adds `--strategy <name>` to target one strategy at its own schedule.
