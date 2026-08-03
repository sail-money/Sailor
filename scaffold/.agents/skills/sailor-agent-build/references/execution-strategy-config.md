# Execution strategies — creating them & the `strategies.json` config

> **Not the intent strategy.** [`sailor-strategy`](../../sailor-strategy/SKILL.md) captures *what you want financially* → `.sail/strategy.md`. This doc is the **execution** side: how you register an executable as a **strategy**, and the `.sail/strategies/strategies.json` config that wires it to run. For how the runner *executes* these each tick, see [`sailor-operate` → execution-strategies](../../sailor-operate/references/execution-strategies.md).

## The model

```
Executable   a runnable script:  src/strategy/<name>.ts  (exports an Agent with tick(ctx))
Strategy     { name, description?, active, sma, executable, chains? }  — one SMA, one executable
```

- **Executable** — `src/strategy/<name>.ts`, exporting `export const agent: Agent` with a `tick(ctx)` (same interface as the classic `src/agent.ts`). The default executable is **`agent`** (resolves `src/strategy/agent.ts`, falling back to the legacy `src/agent.ts`). Names are unique and **camelCase** (`agent`, `checkData`, `rebalance`). An executable is **SMA- and chain-agnostic** — it never hardcodes an SMA or chain, so one script is reusable across many strategies and SMAs.
- **Strategy** — binds **one executable** to **one SMA**, with an **`active`** flag. An SMA can have many strategies; each strategy has exactly one executable. There are **no steps and no pipeline** — a strategy is one executable that runs.
- **`chains?`** — an optional replay set. Its presence picks the run mode (below).

## The config file — `.sail/strategies/strategies.json`

```jsonc
{
  "version": 2,
  "strategies": [
    {
      "name": "Default",           // unique; "Default" is auto-seeded on onboarding
      "description": "…",          // optional, shown in the dashboard
      "active": true,               // runs every tick when true
      "sma": "0xAbc…",             // the SMA this strategy operates
      "executable": "agent",       // src/strategy/agent.ts (or legacy src/agent.ts)
      "chains": [8453]              // OPTIONAL — omit for executable-driven (multichain)
    }
  ]
}
```

The CLI and dashboard write this file; you rarely edit it by hand. A file written under the old
`version: 1` (a `pipeline` of `steps`) is **migrated to this flat shape automatically on first load** —
each step becomes its own flat strategy.

## Two modes — chosen when you create the strategy

The strategy provides the **default execution params** (its SMA + a default chain). Whether you give it
a `chains` list decides the mode (the runtime behavior of each is in the execution doc):

- **chainAgnostic** — provide `chains`. The same executable runs on each listed chain (a subset of the
  SMA's deployed set). The common case: identical logic, per-chain `ctx.env` values.
- **multichain** — omit `chains`. The executable runs once and drives chains itself via `ctx.chain(id)`
  (for a flow that reads on one chain and acts on another). See the execution doc for `ctx.chain`.

In **both** modes the executable can reach any chain the SMA is deployed on via `ctx.chain(id)` — the
`chains` list only sets the default replay behavior.

## Per-chain configuration — `.sail/env/<chain-slug>.json`

Chain-specific values live one file per chain (`base.json`, `arbitrum.json`, …):

```json
{ "MORPHO_TOKEN_ADDR": "0x…", "USDC": "0x…" }
```

This is **global per chain, per project**: it loads into **any** executable running on that chain,
regardless of SMA or strategy, and reaches the executable via `ctx.env` (never `process.env`). Purpose:
**reusable executables** — write the logic once against `ctx.env.MORPHO_TOKEN_ADDR`, set each chain's
address in that chain's env file, and the same script runs on every chain unchanged.

## Creating a strategy from the CLI (worked example)

```bash
# 1. A new executable script (scaffolds src/strategy/checkYield.ts; camelCase name)
sailor strategy new-executable checkYield

# 2a. A chainAgnostic strategy: one SMA, one executable, replayed on each listed chain
sailor strategy create Yield --sma 0xAbc… --executable checkYield --chains 8453,42161 \
  --description "Rotate idle USDC into the best vault"

# 2b. …or a multichain strategy (omit --chains → the executable drives chains via ctx.chain(id))
sailor strategy create Cross --sma 0xAbc… --executable rebalance

# 3. Per-chain env the executable reads via ctx.env / ctx.chain(id).env
sailor strategy env set base MORPHO_TOKEN_ADDR=0x…
sailor strategy env set arbitrum MORPHO_TOKEN_ADDR=0x…

# 4. Activate (active strategies run on every `sailor run` tick)
sailor strategy activate Yield

# Change the chain mode later
sailor strategy set-chains Yield --chains 8453      # replay on Base only
sailor strategy set-chains Yield --clear            # → multichain (executable-driven)
```

Other commands: `sailor strategy list [--json]`, `deactivate <name>`, `delete <name>`,
`env show <chain>`. Running them (`sailor run`, filters, cadence) is the execution doc's job.

## What you can express

- **Multiple strategies per SMA** — each an independent executable+chain config; any subset `active`.
- **A different executable per SMA** — strategies bind executable→SMA independently.
- **chainAgnostic** — list chains; the same script runs on each, reading per-chain `ctx.env`.
- **multichain** — omit chains; one script coordinates across chains via `ctx.chain(id)`.

→ For how these run each tick (run modes at runtime, `ctx.chain(id)`, `sailor run` filters, scheduling
different cadences), see [`sailor-operate` → execution-strategies](../../sailor-operate/references/execution-strategies.md).
