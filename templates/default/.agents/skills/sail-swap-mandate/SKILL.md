---
name: sail-swap-mandate
description: Build a bounded DEX-swap mandate by REUSING the shared SwapPermission singleton — register on the kernel, then configure per-account bounds (router + token allowlists, per-tx cap, slippage floor, recipient pinned to the SMA). The fast path for a DCA / portfolio swap strategy: no Solidity, no per-SMA deploy. Composes sail-token-resolve + sail-swap-quote + the `sailor mandate attach`/`configure`/`simulate` commands.
---

# sail-swap-mandate — bounded swap via the shared SwapPermission singleton

Reuse the **shared `SwapPermission`** singleton instead of authoring and
deploying your own swap contract. One address is deployed per chain; your SMA
gets its own private config inside it. No Foundry, no per-SMA deploy, no audit
surface you author — just register, configure your bounds, and simulate.

This is the **default path** for a bounded swap or DCA mandate. Authoring custom
Solidity (the [`sail-mandates`](../sail-mandates/SKILL.md) flow) is the escape
hatch for venues/contracts this template can't express.

## Prerequisites

Run these first — their outputs feed every step below:
1. [`sail-token-resolve`](../sail-token-resolve/SKILL.md) — for tokenIn and each
   tokenOut. Confirms `swapReady: true` + gives `address`, `decimals`, `feeTier`.
2. [`sail-swap-quote`](../sail-swap-quote/SKILL.md) — per leg. Gives the current
   `amountOut` and the `amountOutMinimum` floor + a slippage-bps recommendation.

Stop if any token is not swap-ready on the active chain (see resolve-token's
"two outcomes"). A swap mandate for a token with no pool fails-closed forever.

## What the configured bounds enforce (per account)

`SwapPermission.evaluate()` accepts only Uniswap V3/V3-02/V2 `exactInputSingle` /
`swapExactTokensForTokens` calls, and only when ALL hold:

| Bound | Enforced | Protects against |
|---|---|---|
| `recipient == SMA` | the swap's `recipient`/`to` field must equal the SMA | funds leaving the account |
| `tokenIn ∈ tokensIn` | the sell token is on the allowlist | swapping an unapproved token |
| `tokenOut ∈ tokensOut` | the buy token is on the allowlist | agent buying arbitrary junk |
| `target ∈ routers` | only the allowlisted router may be called | routing via an unknown DEX |
| `amountIn ≤ maxAmountPerTx` | per-swap cap, base units | draining the account in one swap |
| `amountOutMin ≥ floor` (oracle mode) | when `priceOracle` is set | slippage/MEV extraction |

> **V2 intermediate hops are NOT checked** — only `path[0]`/`path[last]`. Restrict
> to V3, or ensure any plausible intermediate token is acceptable.

## ⚠️ Register ≠ configure (read this once)

The shipped CLI splits the shared-template flow into **two steps**:

- `sailor mandate attach` only **registers** the singleton address on the kernel
  (`RegisterPermission`). After this step the address is in `getPermissions(SMA)`
  but `isConfigured == false` → the kernel **denies every call**.
- `sailor mandate configure` writes the **per-account bounds** (the config blob).
  Only after this does `isConfigured == true` and swaps become allowed.

You must do both. Stopping at `attach` is the single most common trap.

## The flow

### 1. Resolve the singleton address for your chain

```bash
node scripts/shared-template-addr.mjs SwapPermission
# → 0xb4111e5247afE602F63d0b5db24B19b5f96535B1   (on unichain)
```

Addresses are in `.agents/skills/sail-templates/deployed.json`, keyed by chainId
→ contract name. `SwapPermission` is live on Base, Arbitrum, Unichain, Sepolia,
Base Sepolia (not Ethereum mainnet). If the resolver says "not deployed", stop.

### 2. Build the config (a JSON file)

Create a config file from the resolve + quote outputs:

```json
{
  "routers":      ["0x73855d06DE49d0fe4A9c42636Ba96c62da12FF9C"],
  "tokensIn":     ["0x078D782b760474a361dDA0AF3839290b0EF57AD6"],
  "tokensOut":    ["0x4200000000000000000000000000000000000006"],
  "maxAmountPerTx": "25000000",
  "maxSlippageBps": 100,
  "priceOracle":  "0x0000000000000000000000000000000000000000",
  "maxPriceAgeSec": 0
}
```

| Field | From | Notes |
|---|---|---|
| `routers` | SwapRouter02 for the chain (see resolve-token's chain table) | V3 router address; the agent will call `exactInputSingle` on it |
| `tokensIn` | resolve-token | sell-side allowlist (usually just USDC) |
| `tokensOut` | resolve-token | buy-side allowlist; multiple ⇒ portfolio DCA |
| `maxAmountPerTx` | user's per-swap size, **base units** (string) | e.g. `"25000000"` = 25 USDC (6 dec) |
| `maxSlippageBps` | quote-swap's recommendation | `100` = 1%. `0` disables the on-chain slippage check (testing only) |
| `priceOracle` | `0x0` to disable, or a Pyth/Chainlink feed address | when set, `maxPriceAgeSec` must be `> 0` |
| `maxPriceAgeSec` | seconds | staleness bound for the oracle; `0` when oracle is disabled |

> **Caps are base units.** A decimals mismatch (USDC is 6, most tokens 18) silently
> mis-sizes every bound. resolve-token verified decimals on-chain — use that value.

### 3. Register the singleton on the SMA (does NOT configure)

```bash
sailor mandate attach --address <SWAP_PERMISSION> --sma <SMA> --label "bounded-swap"
```

Owner signs `RegisterPermission` (EIP-712) in the browser; the agent submits and
pays gas + any registration fee. After this the address is in `getPermissions`
but `isConfigured == false` — proceed to step 4.

### 4. Configure the per-account bounds (makes it live)

```bash
sailor mandate configure \
  --address <SWAP_PERMISSION> --sma <SMA> \
  --args-file swap-config.json --template SwapPermission \
  --label "bounded-swap USDC->WETH"
```

This command:
1. Encodes the blob via the SDK `boundedSwapTemplate` encoder (flat params).
2. **Pre-flights** with an off-chain `eth_call` of `configureDirect` from the
   `permissionSigner` — aborts on revert before any gas (catches the encoding
   gotcha). Add `--simulate-only` to stop here and review without signing.
3. Routes the `configureDirect` transaction through the signing station (the owner
   signs in the browser; since the owner IS the `permissionSigner`, no EIP-712
   `Configure` signature is needed).
4. Verifies `isConfigured(<SMA>) == true`.

`--params <0x-hex>` is an alternative to `--args-file` for any template not in the
encoder map. `--force` re-configures when `isConfigured` is already true.

### 5. Simulate — prove the bounds before trusting them

```bash
sailor mandate simulate --address <SWAP_PERMISSION> --sma <SMA> --calls swap-probe.json
```

Build a `swap-probe.json` with a **must-pass** (valid swap, recipient=SMA, in-cap)
and **must-fail** set (wrong recipient, over-cap, disallowed tokenOut). **Zero
mismatches required** before the mandate is trustworthy. The probe is off-chain
`eth_call` — no gas, no signing. See [`sail-mandates`](../sail-mandates/SKILL.md)
Gate 6 for the calls.json schema.

### 6. Reconfigure later (new cap / extra output token)

```bash
# edit swap-config.json, then:
sailor mandate configure --address <SWAP_PERMISSION> --sma <SMA> \
  --args-file swap-config.json --template SwapPermission --force
```

Same address, no re-register. The singleton stores per-account config in a
`mapping(address => …)`; re-running `configure` overwrites it.

## Agent config (off-chain, within the on-chain bounds)

The mandate bounds what the agent MAY do; the agent's own code decides what it
WILL do and when. Wire from the resolve + quote outputs:

```typescript
export const DCA_LEGS = [
  {
    tokenIn: "<USDC_ADDR>", tokenOut: "<WETH_ADDR>",
    tokenInDecimals: 6, tokenOutDecimals: 18,
    feeTier: 3000, amountPerSwap: 25_000_000n,   // base units, ≤ maxAmountPerTx
    slippageBps: 100,
  },
] as const;
```

The agent must re-quote via `sail-swap-quote` close to dispatch time and embed the
floor `amountOutMinimum` in the swap calldata — the on-chain `maxSlippageBps`
bound enforces it regardless.

## When NOT to use this

- **The token has no oracle and you need manipulation resistance** → this template's
  oracle-disabled mode only catches *honest mistakes*, not MEV/flash-loan attacks.
  Prefer a bespoke permission or the (not-yet-deployed) `SwapPermissionNoOracle`
  hallucination guard once it ships.
- **You need an aggregator (LI.FI) or opaque calldata** → the mandate can't inspect
  the route. Use [`sail-mandates`](../sail-mandates/SKILL.md) to author a bespoke
  permission.
- **`SwapPermission` is not deployed on your chain** (e.g. Ethereum mainnet) →
  author and deploy your own swap permission via `sail-mandates`.

## Notes

- The shared singletons are **unaudited examples** (fail-closed under the kernel,
  but their internal logic is your responsibility). Simulate (step 5) is mandatory.
- `maxSlippageBps = 0` removes slippage protection — testing only.
- `recipient = SMA` is non-negotiable and enforced in the contract, not just config.
