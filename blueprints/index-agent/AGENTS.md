# Project Instructions

This is the **index agent**: it deposits USDC, holds a weighted token basket across the
chains you name, invests any idle USDC into that basket, and rebalances toward global target
weights.

The operating guide for this agent is the **`sailor-index`** skill
(`.agents/skills/sailor-index/SKILL.md`). Load it first; it owns the onboarding: deliver the
welcome script (`references/welcome-script.md`) on first contact, collect the basket, weights,
and chains, resolve them, deploy the SMA, configure the swap and bridge permissions, write
`.sail/index.json`, and hand off to the runtime. The general five-station flow and the safety
invariants live in **`sailor-navigator`**.

## Invariants

- The user names the basket (tokens + weights) and the chains. Never recommend a token.
- Weights sum to 1.0 across the basket and are global, not per chain. There is no primary chain.
- USDC is the deposit asset and the only asset the bridge moves.
- The routing policy (prefer one chain, move a token when its liquidity is too thin for the
  trade size) is fixed at onboarding; the decision of which chain holds a buy is made live each tick.
