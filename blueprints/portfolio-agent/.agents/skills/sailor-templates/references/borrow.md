# BorrowPermission — bounded lending borrow via the shared singleton

You typically arrive here from the mandate plan (`sailor-mandate-planner`) with a complete strategy spec — this spoke covers the bounded-borrow permission of that plan (the collateral-supply leg is a separate `sailor-templates` (deposit) permission).

Reuse the shared **`BorrowPermission`** singleton. Family overview + flow:
`sailor-templates`.

## What it enforces (per account, from source)

Selectors (any other ⇒ `false`): Aave `borrow(address,uint256,uint256,uint16,address)`
(**variable-rate only** — a stable-rate borrow, `rateMode != 2`, is rejected), Morpho
**Optimizer/Morpho-Aave** `borrow(address,uint256,address,address)` (**NOT Morpho Blue** — its
ABI differs and simply won't match this selector, i.e. fails closed; target a Blue-specific
permission instead), Compound `borrow(uint256)` (the call target is the **cToken**; the template
resolves `cToken.underlying()` and keys the allowlist/cap/LTV on the underlying — a target with
no `underlying()`, e.g. cETH, is denied). Invariants: `target ∈ protocols`; `asset ∈ assets`
(Aave/Morpho decode the asset; Compound resolves it via `underlying()`); `amount ≤
maxAmountPerTx`; `onBehalfOf`/`receiver == SMA`; **`_ltvCheck` passes** — the projected debt
value (via `borrowOracle`) against collateral value (via `collateralOracle`) must stay within
`maxLtvBps`, when oracles are configured (see ORACLE MODES below).

> **Oracle modes:** configure **zero** oracles for amount-cap-only borrowing (no LTV ceiling is
> applied at all, despite `maxLtvBps` being stored) or **both** — exactly one oracle reverts
> `OracleConfigInconsistent` at configure (a single feed can't price a ratio). When both are set,
> the check still depends on their honesty/freshness — see staleness via `maxPriceAgeSec`.
>
> **⚠️ Neither oracle is a plain token-pair price feed — and the only adapter this harness ships
> doesn't implement either role.** `collateralOracle` is called as `getPrice(account,
> address(0))` — `base` is the **SMA address itself**, not a token, and the adapter must return
> the account's **aggregate portfolio value** in a common numeraire. `borrowOracle` is called as
> `getPrice(asset, address(0))` — the numeraire quote side is `address(0)`, not a real token.
> Full contract: `Protocol/docs/oracle-adapters.md` (workspace-only reference — not shipped into
> a scaffolded project; ask the harness if you need it read out).
> The one adapter that ships in this repo, [`UniV3TwapOracle`](../oracles/UniV3TwapOracle.sol),
> only serves the **swap-oracle** role — its `getPrice` reverts `UnsupportedPair` unless both
> `base` and `quote` are its pool's actual `token0`/`token1`, which `address(0)` (and an account
> address) never is. **Wiring `UniV3TwapOracle` in as `collateralOracle`/`borrowOracle` does not
> silently misbehave — it reverts every borrow, fully fail-closed** — but it means oracle-gated
> LTV mode has no ready-made adapter today: authoring one (an account-level portfolio-value feed,
> and a numeraire-denominated asset-price feed, sharing the same numeraire — see the doc above)
> is a bespoke prerequisite, not a config choice, before choosing "both oracles" over "zero
> oracles" here.

## ⚠️ Approve coverage — what this permission does and doesn't need

`borrow()` pulls no ERC-20 from the SMA — the lending pool pushes the borrowed asset *to*
`onBehalfOf`/`receiver == SMA` — so `BorrowPermission` alone needs **no** approve coverage. Two
adjacent legs of the same strategy do, and this permission covers neither:

- **The collateral-supply leg is a separate `sailor-templates` (deposit) permission** (`deposit`/`supply` on the collateral asset) — that call pulls via allowance and needs its own approve coverage exactly as documented in deposit's "Approve coverage" section. Configure it alongside `BorrowPermission`, not instead of it.
- **The unwind leg (`repay`) pulls the debt asset from the SMA via allowance** and needs approve coverage too — but there is **no shared `RepayPermission` template**; it's bespoke via `sailor-mandates`. See [`sailor-mandates/references/approvals.md`](../../sailor-mandates/references/approvals.md) for the rule and [references/yield.md](../../sailor-strategy/references/yield.md)'s "Unwind path" dimension before assuming a borrow strategy is complete once `BorrowPermission` simulates clean.

## Config blob (authoritative — `config-schemas.md`)

```
abi.encode(address[] protocols, address[] assets, uint256 maxAmountPerTx,
           uint256 maxLtvBps, address collateralOracle, address borrowOracle,
           uint256 maxPriceAgeSec)
```
| Field | Notes |
|---|---|
| `protocols` | lending pools the agent may borrow from |
| `assets` | borrowable ERC-20 allowlist |
| `maxAmountPerTx` | per-borrow cap, base units |
| `maxLtvBps` | max loan-to-value, bps (e.g. `5000` = 50%) |
| `collateralOracle` / `borrowOracle` | price sources for the LTV check |
| `maxPriceAgeSec` | oracle freshness bound; `> 0` when oracles are set |

> `maxLtvBps` is a **per-transaction** projection, not a tracked lifetime LTV. For
> portfolio-level exposure, rely on the protocol's health factor or pair with a
> position-monitoring permission.

### Worked example — conservative USDC borrow with a 50% LTV ceiling (Unichain)

Borrow USDC from one lending market, capped per borrow, with the LTV check **on** — a
conservative 50% ceiling. USDC (the borrow asset) is the verified Unichain continuity address; the
**lending pool and both oracles vary per chain/market — verify each on-chain before configuring.**
The placeholders below are not real addresses.

> Zero-or-both oracles — see "Oracle modes" above. For a real leverage position, always configure both.

```json
{
  "protocols":        ["0xLENDING_POOL_verify_onchain"],
  "assets":           ["0x078D782b760474a361dDA0AF3839290b0EF57AD6"],
  "maxAmountPerTx":   "500000000",
  "maxLtvBps":        5000,
  "collateralOracle": "0xCOLLATERAL_ORACLE_verify_onchain",
  "borrowOracle":     "0xBORROW_ORACLE_verify_onchain",
  "maxPriceAgeSec":   3600
}
```

`maxAmountPerTx: "500000000"` = 500 USDC (6 decimals); `maxLtvBps: 5000` = 50%; `maxPriceAgeSec:
3600` bounds oracle staleness to 1h. Aave variable-rate only (`rateMode == 2`). Then register →
configure → simulate:

```bash
sailor mandate register --address <BORROW_PERMISSION> --sma <SMA> --label "usdc-borrow"

# BorrowPermission has no CLI --template encoder (only SwapPermission does today) — build the
# blob yourself and pass --params. --address is a known shared-template singleton, so the signing
# card's "what you're signing" explanation still renders automatically without --template/--label.
BLOB=$(cast abi-encode "f(address[],address[],uint256,uint256,address,address,uint256)" \
  "[0xLENDING_POOL_verify_onchain]" \
  "[0x078D782b760474a361dDA0AF3839290b0EF57AD6]" \
  500000000 5000 \
  0xCOLLATERAL_ORACLE_verify_onchain \
  0xBORROW_ORACLE_verify_onchain \
  3600)
sailor mandate configure --address <BORROW_PERMISSION> --sma <SMA> --params "$BLOB"

# ONE mandatory safety gate — generate the lean probes from the same $BLOB, then run simulate once.
# --protocol picks the borrow calldata shape (aave|morpho|compound); the LTV probe is config-honest
# (must-fail LTV proof only when both oracles are set). See reuse-flow.md step 5.
node scripts/probe-mandate.mjs --template BorrowPermission --params "$BLOB" --protocol <aave|morpho|compound> \
  --sma <SMA> --address <BORROW_PERMISSION>
```

## Steps

Register → configure → simulate → reconfigure mechanics (and the encoding gotcha) live in
[`sailor-templates` reuse-flow](reuse-flow.md) — follow it.
`sailor mandate register` registers only; `configureDirect` (owner tx) is the half that makes the
permission live. Template-specific bits:

- **Singleton:** `BorrowPermission` — `node .agents/skills/sailor-templates/catalog.mjs --chain <id>`.
- **Spec to confirm:** protocols, assets, cap, max LTV, oracles.
- **Blob:** `abi.encode(protocols[], assets[], maxAmountPerTx, maxLtvBps, collateralOracle,
  borrowOracle, maxPriceAgeSec)` — **flat params, no wrapper**. No CLI `--template` encoder for
  this template — build via `cast abi-encode` / `encodeAbiParameters` and pass `--params` (see
  worked example above).
- **Simulate (mandatory — unaudited example):** allowed borrow within LTV passes; over-cap,
  over-LTV, or wrong recipient is rejected.

## Next

Simulate passing → back to the mandate plan (`sailor-mandate-planner`) for the next permission.
