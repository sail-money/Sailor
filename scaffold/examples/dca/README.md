# DCA reference example

**Reference only — not your strategy.** This shows a complete worked implementation of a dollar-cost-averaging agent (USDC → WETH via Uniswap V3 on Base). Consult it for patterns when authoring your own strategy in `src/`.

## What it shows

| File | Purpose |
|---|---|
| `mandate.ts` | Token addresses, swap parameters, and contract addresses for Base mainnet |
| `agent.ts` | Full tick loop: check balance → approve if needed → quote → swap with slippage protection |

## How to use it

In Stage 2 (strategy), when you describe what you want, your assistant will adapt these patterns for your protocol, chain, and parameters — not copy them as-is.

The on-chain permission contract that authorizes these dispatches must be authored separately (Stage 3). The agent code here is only the intent-building side; the mandate enforces the on-chain bounds.
