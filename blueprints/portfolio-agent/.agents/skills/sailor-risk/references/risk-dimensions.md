# sailor-risk — the six dimensions in full

Progressive-disclosure payload for the SKILL.md. Load this when you actually need to assess a
specific action, not on every call.

## 1. Liquidity (pool depth)

**What to check:** the venue's live pool depth and 24h volume, from `sailor-token-resolve`'s
`venues[]` (each carries `liquidityUsd` and `volume24hUsd`). Read them fresh, per chain, at
assessment time.

**What "risky" looks like:**

- `liquidityUsd` is a small multiple of the intended position size (a position of $10k in a $50k
  pool will move the price on both entry and exit).
- `volume24hUsd` is far below `liquidityUsd` — a big pool nobody trades is inflated or stale.
- The only routable pool is on a DEX `sailRoutable: false` (Sushiswap, PancakeSwap, Aerodrome,
  Uniswap V2) — Sail's fast path cannot route it, so the position depends on a venue outside the
  standard path.

**Consequence to state:** how much extra the user can expect to lose to slippage on entry and
exit, and whether a thin pool makes the position hard to unwind.

## 2. Price manipulation

**What to check:** whether the price the action depends on can be moved cheaply.

- Pool concentration: does one or a few positions hold most of the pool? (Look at the pool's
  distribution, not just its depth.)
- Oracle type: is the price a spot read (manipulable with a single large swap) or time-weighted
  / multi-source (harder to move)?

**What "risky" looks like:** a spot-price oracle on a thin pool, or a pool whose top holders
could move the price by more than the action's slippage bound.

**Consequence to state:** whether someone else can move the price against the user, and by how
much, before the trade lands.

## 3. Approval hygiene

**What to check:** every ERC-20 approval the action grants, and the permission contract's own
approval pattern.

- To whom is the approval granted (the exact spender address)?
- Is it bounded (exact amount) or unbounded (`type(uint256).max`)?
- Can it be revoked, and does the mandate's design ever revoke it?

**What "risky" looks like:** an unbounded approval to a contract the user cannot audit, or an
approval that the strategy leaves open after the position closes. See
`sailor-mandates`/`references/approvals.md` for which actions need approve coverage.

**Consequence to state:** what a compromised spender could do with the approval, and whether
closing the position also closes the approval.

## 4. Oracle trust

**What to check:** the price source each action and each permission reads.

- Single spot source, or time-weighted / multi-source?
- Who can write to it, and can it go stale without the permission noticing?

**What "risky" looks like:** a permission that trusts a spot price with no staleness guard, or a
price feed a single party can influence.

**Consequence to state:** the failure mode if the price is wrong — what the permission would
allow that the user did not intend.

## 5. Venue risk

**What to check:** the protocol or contract the action routes through.

- Admin controls and upgrade keys: who can change the contract under the user?
- Fork drift: is the deployed contract the same generation the SDK/ABI assumes (`sailor-strategy`
  Act 3 already flags this for bespoke permissions)?
- Migration risk: can the venue deprecate the pool the position sits in?

**What "risky" looks like:** an upgradeable venue with an active admin key, a forked venue whose
interface drifted from the ABI, or a venue that has migrated versions before.

**Consequence to state:** what changes if the venue upgrades or migrates out from under the
position.

## 6. MEV and slippage

**What to check:** what the action exposes between intent and execution.

- Is the trade public-mempool (sandwichable) or protected?
- What is the slippage bound versus the pool's typical depth?

**What "risky" looks like:** a large single-swap action on a public mempool with a tight
slippage bound, where a sandwich can extract the bound itself.

**Consequence to state:** the worst-case price between what the user agreed to and what actually
executes.

## Cross-cutting

- **Concentration.** How much of the SMA sits in one token, one venue, or one chain? A single
  position that is 80% of the SMA in one pool is a concentration risk even when every individual
  dimension is fine.
- **Exit path.** Can the position actually be unwound when the user wants out? `sailor-strategy`
  records this per action as `exitPath`; a position with no exit leg is risk that only appears
  when the user tries to leave.

## Writing the note

For each risk that crosses a bound the user set, write one line in the spec or mandate:

> `<risk>` — `<what would have to happen>` → `<concrete consequence for the user>`.

Keep it in the user's financial terms. If you cannot write the consequence, you have not
finished assessing the risk.
