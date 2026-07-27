# Execution strategies — what the agent runs each tick

> **Not the same as the intent "strategy."** The [`sailor-strategy`](../../sailor-strategy/SKILL.md) skill captures *what you want financially* → `.sail/strategy.md`. **Execution strategies** (this doc) capture *how the agent runs*: which executable script runs on which SMA, across which chains. They live in `.sail/strategies/strategies.json` and are driven by `sailor run`.

## The model — four levels for execution flow

```
Executable        a runnable script:  src/strategy/<name>.ts  (exports an Agent)
  └─ Step         binds one executable → one SMA → one-or-more chains
       └─ Pipeline  an ordered list of steps + a type: sequential | parallel
            └─ Strategy   { name, description?, active, pipeline }
```

- **Executable** — `src/strategy/<name>.ts`, exporting `export const agent: Agent` with a `tick(ctx)` (same interface as the classic `src/agent.ts`). The default executable is **`agent`** (resolves `src/strategy/agent.ts`, falling back to the legacy `src/agent.ts`). Executable **names are unique** and **camelCase** (`agent`, `checkData`, `rebalance`). One executable can be reused by many steps/strategies.
- **Step** — `{ executable, sma, chains }`. Both the **SMA** and the **chains** are chosen per step; `chains` must be a subset of that SMA's deployed chains (≥1). Different steps in one strategy can target **different SMAs**.
- **Pipeline** — the strategy's steps plus `type`: `sequential` (steps run one after another) or `parallel` (steps run concurrently).
- **Strategy** — a named, optionally-described pipeline with an **`active`** flag. Active strategies run on every `sailor run` tick.

This is the file of strategies in a project (`.sail/strategies/strategies.json`, example):
```jsonc
{
  "version": 1,
  "strategies": [
    {
      "name": "Default",              // unique; "Default" is auto-seeded on onboarding
      "description": "…",             // optional, shown in the dashboard
      "active": true,                  // runs every tick when true
      "pipeline": {
        "type": "sequential",          // "sequential" | "parallel"
        "steps": [
          { "executable": "agent", "sma": "0xAbc…", "chains": [8453] }
        ]
      }
    }
  ]
}
```

## Environment execution

Per-chain configuration lives in `.sail/env/<chain-slug>.json` — one file per chain (`base.json`, `arbitrum.json`, …):
```json
{ "MORPHO_TOKEN_ADDR": "0x…", "USDC": "0x…" }
```

This configuration is **global per chain, per project**: it is loaded into **any** executable whose step is configured to run on that chain — regardless of which SMA or strategy the step belongs to. Read it inside the executable via `ctx.env` (e.g. `ctx.env.MORPHO_TOKEN_ADDR`); it never leaks into `process.env`.

Its purpose is **reusable executables per chain**: the same executable script runs on many chains unchanged — only the per-chain environment *value* differs. Write the logic once against `ctx.env.MORPHO_TOKEN_ADDR`, set that chain's address in each chain's env file, and a single step can list several chains without branching on chain id.

## How `sailor run` works now

- **Default** (`sailor run`): runs **every `active` strategy** each tick.
- **Filtered** (`sailor run --strategy <name>`): runs only that one strategy — the key lever for scheduling (below). This replaces the old behaviour where `run` always executed `src/agent.ts`.
- For each strategy, its pipeline runs its steps **sequential** or in **parallel**. Each step runs its executable against its SMA across each of `step.chains` **sequentially** (nonce safety), with `ctx.env` loaded from that chain's env file.
- **The chain comes only from the strategy.** `CHAIN_ID` / `config.json.chainId` are no longer read.
- `--once` runs a single tick; otherwise it loops at `SAILOR_INTERVAL` (default 60s).
- **Zero-config back-compat:** with no `strategies.json`, `run` uses the **Default** strategy — one `agent` step on the executable SMA's first deployed chain. A fresh SMA gets this Default seeded at onboarding, so `sailor run` "just works" exactly like before.

## Building a strategy from the CLI (worked example)

```bash
# 1. A new executable script (scaffolds src/strategy/checkYield.ts; camelCase name)
sailor strategy new-executable checkYield

# 2. A strategy with a description
sailor strategy create Yield --description "Rotate idle USDC into the best vault"

# 3. Steps: same executable, one SMA, multiple chains (multichain)
sailor strategy add-step Yield --executable checkYield --sma 0xAbc… --chains 8453,42161

#    A second step on a DIFFERENT SMA, and set the pipeline type
sailor strategy add-step Yield --executable checkYield --sma 0xDef… --chains 42161 --pipeline sequential

# 4. Per-chain env the executable reads via ctx.env
sailor strategy env set base MORPHO_TOKEN_ADDR=0x…
sailor strategy env set arbitrum MORPHO_TOKEN_ADDR=0x…

# 5. Activate + run
sailor strategy activate Yield
sailor run --once            # all active strategies
sailor run --strategy Yield  # just this one
```

Other commands: `sailor strategy list [--json]`, `deactivate <name>`, `remove-step <strategy> <index>`, `delete <name>`, `env show <chain>`.

## What you can express

- **Multiple strategies per project** — each an independent pipeline; any subset `active`.
- **A different executable per SMA** — steps bind executable→SMA independently, so one SMA can run `checkYield` while another runs `rebalance`, in the same or different strategies.
- **Multichain** — a step lists several chains; the executable runs on each, reading per-chain `ctx.env`.
- **Different execution ratios** — see below.

## Execution ratios via schedulers

The runner has **one interval** — all active strategies fire together each tick. To run strategies at **different cadences/ratios**, drive them from separate schedulers, each filtering with `--strategy`:

| Scheduler | Command | Cadence |
|---|---|---|
| GitHub Action A | `sailor run --once --strategy Yield` | every 5 min |
| GitHub Action B | `sailor run --once --strategy Rebalance` | hourly |

So the same project runs `Yield` 12× as often as `Rebalance`. See [`sailor-automation`](../../sailor-automation/SKILL.md) for wiring GitHub Actions / cron / Docker / a local daemon — each entry point just adds `--strategy <name>` to target one strategy at its own schedule.
