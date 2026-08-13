# Strategy spec — `<name>` (one strategy per file)

> Copy this template into `.sail/strategies/<name>.md` for **one** strategy. The filename is the
> strategy's **camelCase name** (e.g. `dcaDaily.md`) — it must match the name you register with
> `sailor strategy create <name>`, and it is the `--strategy` selector. One strategy per file, never
> mix strategies in one spec. The `sailor-strategy` skill (Station 2) fills this in through its three
> acts, following the completeness gate that lives there; this file is the durable intent artifact.
> From it, Station 2 derives the execution config (`.sail/strategies/strategies.json` via
> `sailor strategy create` and the per-chain env files via `sailor strategy env set`).

## Identity

| Field | Value |
|---|---|
| **name** | `<camelCase, e.g. dcaDaily>` — the spec filename and `--strategy` selector |
| **SMA** | `<safe address this strategy operates>` |
| **executable** | `agent` (default: `src/agent.ts`); a custom name only when this strategy needs its own `src/strategy/<executable>.ts` |
| **description** | `<one line for the dashboard>` |
| **chain(s) / mode** | `<chain ids, comma-separated>` → **per-chain** (the executable is replayed once per listed chain). Omitted → **cross-chain** (the executable drives chains itself via `ctx.chain(id)`) |

## Intent

One paragraph, in the user's own financial words. What the strategy does, accumulate vs. deploy,
and why.

## Completeness gate

Every dimension of the core completeness gate must be concrete before this spec is confirmed:
chains, tokens (resolved addresses + decimals), venues/protocols, route, amounts & caps, cadence,
risk bounds, exit condition, exit path, provenance. The gate table lives in the `sailor-strategy`
skill; any category-specific extension rows (from a core or project recipe) apply too.

## Actions

| id | kind | chain | route | tokenIn → tokenOut | venue / pool | caps | risk bounds | exit path |
|---|---|---|---|---|---|---|---|---|
| `swap-base` | swap | 8453 | template: SwapPermission | USDC → WETH | Uniswap V3 / pool + fee tier | 25 USDC per tx | max slippage | agent-managed → `swap-base-out` |

One row per action with every resolved concrete value — addresses, decimals, pool + fee tier, caps in
both base units and human terms. This table is the same data as the JSON below; never let the two
drift.

## JSON (machine form — later stations read this)

```json
{
  "name": "<camelCase name>",
  "category": "trading | yield | payments | custom",
  "archetype": "<archetype id or 'custom'>",
  "sma": "<safe address>",
  "executable": "agent",
  "chains": [<chainId>, ...],
  "env": {
    "<chain-slug>": { "KEY": "<value>" }
  },
  "actions": [
    {
      "id": "<short id, e.g. 'swap-base'>",
      "kind": "swap | deposit | borrow | transfer | withdraw | custom",
      "chain": <chainId>,
      "route": { "type": "template | bespoke", "name": "<TemplateSkill, or null if bespoke>" },
      "tokenIn": { "symbol": "", "address": "0x…", "decimals": 0 },
      "tokenOut": { "symbol": "", "address": "0x…", "decimals": 0 },
      "venue": { "name": "", "address": "0x…" },
      "pool": { "address": "0x…", "feeTier": 0, "observedLiquidityUsd": 0 },
      "recipients": ["0x…"],
      "caps": {
        "perTx": { "baseUnits": "", "human": "<e.g. '25 USDC'>" }
      },
      "riskBounds": { "maxSlippageBps": 0 },
      "exitPath": { "managedBy": "agent | owner | none-declined", "actionIds": [] }
    }
  ],
  "cadence": "<schedule or 'no cadence'>",
  "exitCondition": "<when it stops accumulating>",
  "provenance": {
    "resolvedAt": "<ISO 8601 UTC>",
    "chains": { "<chainId>": { "rpc": "<rpc label>" } }
  },
  "confirmedByUser": true,
  "version": 3
}
```

Key notes:

- **`name`** must equal the spec filename and the `sailor strategy create <name>` argument.
- **`executable`** defaults to `agent`; include a custom name only when the strategy runs a
  `src/strategy/<custom>.ts`.
- **`chains`** present → **per-chain** mode; **absent** → **cross-chain** (executable-driven).
- **`env`** holds the per-chain `ctx.env` values the executable reads, keyed by chain slug; the
  `sailor-strategy` skill runs `sailor strategy env set <chain> KEY=value` to write these to
  `.sail/env/<chain-slug>.json` (one file per chain, **shared across every strategy** — never drop
  another strategy's keys when setting yours).
- Position-opening actions carry `exitPath` (agent/owner/none-declined); exit-leg actions (withdraw,
  transfer, repay) do not. Omit keys that don't apply — never emit an empty placeholder.
- Fields are kind-shaped: `tokenOut` and `pool` only on swaps; `venue` on swaps/deposits/withdrawals/borrows;
  `recipients` only on transfers; a `withdraw` carries NO `recipients` (proceeds are pinned to the SMA).
  `exitPath.actionIds` is populated only when `managedBy: "agent"` — it names the paired exit action ids.
- `version: 3` is the current resolved-artifact schema; `confirmedByUser` must be `true` for Station 3
  to accept the spec.