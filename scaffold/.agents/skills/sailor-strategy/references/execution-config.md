# Execution config — registering an executable as a strategy & the `strategies.json` file

> **Two artifacts, one skill.** [`sailor-strategy`](../SKILL.md) owns both, and both are created together at Station 2. `.sail/strategies/<name>.md` (one per strategy) is the **intent** — *what you want financially* (the three acts of the skill). This doc is the **execution** side: how you register a runnable executable as a **strategy**, and the `.sail/strategies/strategies.json` config that wires it to run. For how the runner *executes* these each tick — the two run modes and per-chain `ctx.env` — see [`sailor-agent-build`](../../sailor-agent-build/SKILL.md); for running strategies at different cadences, see [`sailor-automation`](../../sailor-automation/SKILL.md).

## The model

```
Executable   a runnable script:  src/strategy/<name>.ts  (exports an Agent with tick(ctx))
Strategy     { name, description?, active, sma, executable, chains? }  — one SMA, one executable
```

- **Executable** — `src/agent.ts` for the default `agent`, or `src/strategy/<name>.ts` for a named one, each exporting `export const agent: Agent` with a `tick(ctx)`. The default executable is **`agent`** — the classic path **`src/agent.ts`**, unchanged, so existing projects run as-is. Only custom executables (`checkData`, `rebalance`) live at `src/strategy/<name>.ts`. Names are unique and **camelCase**. An executable **never hardcodes an SMA or a chain** — so one script is reusable across many strategies and SMAs.
- **Strategy** — binds **one executable** to **one SMA**, with an **`active`** flag. An SMA can have many strategies; each strategy has exactly one executable — a strategy is one executable that runs.
- **`chains?`** — an optional replay set. Its presence picks the run mode (below).

## The config file — `.sail/strategies/strategies.json`

```jsonc
{
  "version": 2,
  "strategies": [
    {
      "name": "DcaBase",           // unique; the name you passed to `sailor strategy create`
      "description": "…",          // optional, shown in the dashboard
      "active": true,               // runs every tick when true — `create` sets this true by default
      "sma": "0xAbc…",             // the SMA this strategy operates
      "executable": "agent",       // default: src/agent.ts; a custom name → src/strategy/<name>.ts
      "chains": [8453]              // OPTIONAL — omit for executable-driven (cross-chain)
    }
  ]
}
```

The CLI and dashboard write this file; you rarely edit it by hand. **A project starts with zero
strategies** — nothing is auto-seeded, so `sailor run` has nothing to run until you create one; with no
active strategy it fails closed with a message telling you to create one.

## Two modes — chosen when you create the strategy

The strategy provides the **default execution params** (its SMA + a default chain). Whether you give it
a `chains` list decides the mode (the runtime behavior of each is in the execution doc):

- **per-chain** — provide `chains`. The same executable is replayed once per listed chain (a subset of
  the SMA's deployed set), sequentially. The common case: identical logic, per-chain `ctx.env` values.
- **cross-chain** — omit `chains`. The executable runs once and drives chains itself via `ctx.chain(id)`
  (for a flow that reads on one chain and acts on another). See the execution doc for `ctx.chain`.

In **both** modes the executable can reach any chain the SMA is deployed on via `ctx.chain(id)` — the
`chains` list only sets the default replay behavior.

## Per-chain configuration — `.sail/env/<chain-slug>.json`

Chain-specific values live one file per chain (`base.json`, `arbitrum.json`, …):

```json
{ "MORPHO_TOKEN_ADDR": "0x…", "USDC": "0x…" }
```

This is **global per chain, per project** — **shared across every strategy** in the project: it loads
into **any** executable running on that chain, regardless of SMA or strategy, and reaches the executable
via `ctx.env` (never `process.env`). Purpose: **reusable executables** — write the logic once against
`ctx.env.MORPHO_TOKEN_ADDR`, set each chain's address in that chain's env file, and the same script runs
on every chain unchanged.

## Creating a strategy from the CLI (worked example)

**Gather these before running `sailor strategy create`:** a 2–3 word **name** · the **SMA** address · the
**executable** (default `agent`) · a **description** · the **chain(s)** if per-chain mode applies · and
**all per-chain environment variables** the executable reads. The `env set` step below **creates** the env
file `.sail/env/<chain-slug>.json` (shared across every strategy in the project) — set every key the
executable reads via `ctx.env` before the first run, or it starts against missing values.


```bash
# 1. A new executable script (scaffolds src/strategy/checkYield.ts; camelCase name)
sailor strategy new-executable checkYield

# 2a. A per-chain strategy: one SMA, one executable, replayed on each listed chain
sailor strategy create Yield --sma 0xAbc… --executable checkYield --chains 8453,42161 \
  --description "Rotate idle USDC into the best vault"

# 2b. …or a cross-chain strategy (omit --chains → the executable drives chains via ctx.chain(id))
sailor strategy create Cross --sma 0xAbc… --executable rebalance

# 3. Per-chain env the executable reads via ctx.env / ctx.chain(id).env
sailor strategy env set base MORPHO_TOKEN_ADDR=0x…
sailor strategy env set arbitrum MORPHO_TOKEN_ADDR=0x…

# Strategies are ACTIVE the moment they're created — `sailor run` picks them up on the next tick.
# Pass --inactive to create one paused, then toggle later with activate/deactivate.
sailor strategy create Draft --sma 0xAbc… --executable checkYield --inactive
sailor strategy activate Draft       # …when you're ready for it to run
sailor strategy deactivate Yield     # pause without deleting

# Change the chain mode later
sailor strategy set-chains Yield --chains 8453      # replay on Base only
sailor strategy set-chains Yield --clear            # → cross-chain (executable-driven)
```

Other commands: `sailor strategy list [--json]`, `delete <name>`, `env show <chain>`. Running them
(`sailor run`, filters, cadence) is the execution doc's job.

## What you can express

- **Multiple strategies per SMA** — each an independent executable+chain config; any subset `active`.
- **A different executable per SMA** — strategies bind executable→SMA independently.
- **per-chain** — list chains; the same script runs on each, reading per-chain `ctx.env`.
- **cross-chain** — omit chains; one script coordinates across chains via `ctx.chain(id)`.

→ For how these run each tick (the run modes at runtime, `ctx.chain(id)`, and per-chain `ctx.env`), see
[`sailor-agent-build`](../../sailor-agent-build/SKILL.md); for running strategies at different cadences,
see [`sailor-automation`](../../sailor-automation/SKILL.md).
