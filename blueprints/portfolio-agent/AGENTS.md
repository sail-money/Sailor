# Project Instructions

This is the **portfolio agent**: it holds a weighted basket of assets (tokens and tokenized stocks)
across the chains their liquidity needs, invests every deposit automatically, and rebalances toward
global target weights.

The operating guide for this agent is the **`sailor-portfolio`** skill
(`.agents/skills/sailor-portfolio/SKILL.md`). Load it first; it owns the onboarding: deliver the
welcome script (`references/welcome-script.md`) on first contact, then create the SMA and choose its
chains (Station 1, via `sailor-onboarding`) before collecting any basket or weights, resolve each
asset's liquidity and funding path, guide the user to deploy the SMA on any chain the basket needs,
configure the swap and bridge permissions, write `.sail/portfolio.json`, and hand off to the runtime.
The general five-station flow and the safety invariants live in **`sailor-navigator`**.

## Invariants

- The SMA comes first, always. Create the SMA and choose its chains before any basket question. The
  agent guides the user to deploy the SMA on an additional chain only when the basket's liquidity
  requires it, never before. No asset or weight is elicited until the SMA exists.
- The user names the basket (assets + weights). Never recommend an asset. An asset may be a token
  or a tokenized stock; both are resolved and held the same way.
- Tokenized stocks default to Base (USDC, Coinbase B20 tokens — NVDAc, AAPLc, METAc, GOOGLc).
  Robinhood (USDG) is an optional alternative, recommended only when a specific stock is not on Base
  or the user prefers it.
- Weights sum to 1.0 across the basket and are global, not per chain. There is no primary chain.
- The deposit asset is the settlement currency each chain uses (USDC for most chains, including Base
  where Coinbase tokenized stocks trade; USDG on Robinhood as an optional alternative for stocks;
  USDT on BNB). USDC is the only asset the bridge moves; USDG and USDT are funded direct.
- The agent never asks the user to pick a currency or a bridge path. It computes the minimum funding
  set and presents one consolidated instruction.
- The routing policy (prefer one chain, move an asset when its liquidity is too thin for the trade
  size) is fixed at onboarding; the decision of which chain holds a buy is made live each tick.
- A two-hop asset (no direct USDC pool, but a routable pool against the hub asset) is a normal,
  executable route — settlement → hub → token. Write its `via` field from the resolver's
  `twoHopRoute`; never leave a `feeTier: 0` placeholder. The runtime buys, values, and rebalances it
  like any other asset once `via` is set.
- Never mention a sandbox, simulation, or test environment. The agent works with the user's real,
  self-custodied account.

## Station 3 decisions — one defaulted confirmation, never a menu

When `sailor-mandate-planner` (Station 3) surfaces the approve model and the exit plan, offer the
safe default as a **single confirmation**, not two open questions:

> I'll use the safe defaults: you sign one approval at setup for about a year of trading (I'll
> compute the amount and tell you what to sign), and you unwind manually whenever you choose.
> Confirm, or tell me to change either.

Only expand into a menu if the user asks to change a default. The point of the product is that the
user gives a portfolio and the agent handles the plumbing; the user should never be bounced back a
low-level decision that has a sane default.

The approve default is **owner-set, sized to a year of trading** — never per-trade, never infinite.
At setup the agent computes the amount (see `sailor-portfolio` → approve sizing) and the user signs
one approval on the Safe; the agent trades inside it for a year, and the report warns before it runs
low so the user tops up with one signature, at a moment they chose, rather than the agent stalling.
