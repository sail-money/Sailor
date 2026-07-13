# Venue-integration cookbook — field-derived patterns for going beyond the shared templates

Nine reusable patterns from a real multi-venue bespoke build (a DCA basket spanning Uniswap V3, an
Aerodrome Slipstream fork, and Uniswap V4 — three venues, ~10 stacked issues, all solved, funds
never at risk because the fail-closed gates held). None of this is a fix to apply — it's the
knowledge that would otherwise cost the next author the same hours. Capability: these are the
moves that make exotic-venue integration tractable, not reasons to avoid it.

Each entry: **SYMPTOM → CAUSE → THE MOVE.** Two sibling references own adjacent ground and are
pointed to, never restated: [dark-reverts.md](dark-reverts.md) (the diagnostic ladder for a call
that reverts with no data, and the pin-against-deployed-contract principle) and
[`sailor-template-swap-no-oracle`](../../sailor-template-swap-no-oracle/SKILL.md)'s "⚠️ Tolerance
vs. pool fee" section (the band-tolerance rule). [authoring-patterns.md](authoring-patterns.md)
owns general permission-code gotchas; this file owns venue-*integration* technique specifically.

## 1. Verify the pool→factory→router chain on-chain, not from docs

**Symptom:** a router rejects, or silently misbehaves for, a pool that looks right.
**Cause:** forks ship generations — Aerodrome alone has run three Slipstream generations, each
with its own factory+router pair — and docs, memory, or a prior session's notes can point at the
wrong generation's router for the pool you're actually trading.
**The move:** bind the pairing on-chain before trusting it — require
`SwapRouter.factory() == pool.factory()` (a plain view-call check, cheap to make part of
`configure()` or the permission's own bound) before wiring a router to a pool. Never take the
pairing from documentation.

## 2. Match the deployed ABI exactly — fork field-counts differ, and a decode-revert inside a `try` is uncatchable

**Symptom:** every call through the permission hard-reverts, even though the external call sits
inside a `try`/`catch`.
**Cause:** the interface was declared from the wrong lineage. Uniswap V3's `slot0()` returns 7
fields; Slipstream's returns 6. Decoding a 6-word return against a 7-field interface overruns the
returned bytes and reverts — and a revert thrown while *decoding* the return data of an otherwise
successful external call, inside a `try`'s success arm, is **not** caught by that `try`'s `catch`
(the catch only catches the callee reverting, not the caller's own post-call decode). A unit test
mocked against the wrong interface passes anyway, because the mock returns exactly the field count
the wrong interface expects.
**The move:** pull the venue's real ABI from the verified deployed contract, not from the nearest
similar-looking interface. Then treat `sailor mandate simulate` against the *real* pool as the gate
that catches what a mock cannot — this is exactly why simulate runs against the live venue and
precedes register (Gate 6). Same family as [authoring-patterns.md](authoring-patterns.md)'s "Venue
ABIs drift across versions" gotcha, one layer more specific: there it's a selector; here it's a
field count silently corrupting a decode.

## 3. Recover a Uniswap V4 PoolKey without logs

**Symptom:** you have a `poolId` and need the decomposed `PoolKey` (the tokens, fee, tick spacing,
hooks address it hashes from), but `PoolManager` doesn't store the components — only the hash — and
free-tier RPCs cap `eth_getLogs` to narrow block windows, making the pool's `Initialize` event
unreachable at any real depth. Brute-forcing candidate keys fails the moment the pool has a
non-zero hooks address (one more unknown to guess).
**The move:** read the V4 `PositionManager`'s `poolKeys(bytes25)` mapping — a plain storage read
(the top 25 bytes of the `poolId`), no event log required at all.

## 4. Re-verify pool liquidity immediately before build/execution, not just at plan time

**Symptom:** a pool chosen and configured at plan time rejects the swap, or returns nothing, once
the agent actually tries to trade it.
**Cause:** pools drain. A pool that had real depth when the mandate was planned had its liquidity
go to zero by the time the permission went live and the agent tried to use it.
**The move:** probe liquidity (`getLiquidity()` on a V3-family pool, reserves on a V2-family pair)
immediately before committing the config, not only during planning. If the permission's checks are
pool-parameterized (the pool address is config, not hardcoded), rerouting to a deeper pool on the
same venue is a reconfigure, not a redeploy.

## 5. viem nested-tuple encoding needs named components and nested values

**Symptom:** `encodeAbiParameters` throws on a payload with nested structs (a `PoolKey`, a
multi-hop path struct) — or worse, doesn't throw but silently produces a wrong encoding (see
entry 6 for what that looks like in a loop).
**Cause:** in viem, a nested tuple component must carry a `name`, and the value you pass for it
must itself be a nested object matching that shape — spreading the inner fields flat into the outer
object compiles (JS doesn't complain) but encodes garbage.
**The move:** name every tuple component in the ABI fragment, and nest the corresponding value
object to match. Test-encode one representative payload in isolation — print the resulting hex,
sanity-check its length — before wiring the encoder into a loop over multiple legs.

## 6. Never let a per-leg `try`/`catch` swallow a leg — surface every failure

**Symptom:** the run reports "success," but some of the intended actions silently never happened.
**Cause:** a `try`/`catch` wrapped around a leg's encode/build step, written to keep one leg's
error from crashing the others, that just `continue`s on catch with no record. In the field this
silently dropped **all three** V4 legs of a five-leg basket — the loop kept going, logged nothing
distinguishing, and the run *looked* clean.
**The move:** a failed leg is an outcome, not noise. Record it the same way the runner already
records everything else — the ledger's `acted` (`confirmed`/`reverted`/`unverified`) and `skipped`
(with `reason`) doctrine exists precisely for this; see [`sailor-memory`](../../sailor-memory/SKILL.md)
rather than inventing a parallel logging scheme. And make the loop's own summary report attempted
vs. executed counts (`sailor-agent-build`'s skeleton already does this in its tick summary) so a
dropped leg is visible in the output the moment it happens, not discovered hours later by counting
balances.

## 7. Uniswap V4 Universal Router action order — read it off a live working transaction

**Symptom:** a V4 swap program that looks correctly encoded (right actions, right structs) still
reverts.
**Cause:** the "canonical" ordering — `SWAP` → `SETTLE_ALL` → `TAKE_ALL` — was not what the deployed
router on this chain actually accepted. It required settle-first: `SETTLE(payerIsUser=true)` →
`SWAP` → `TAKE`.
**The move:** when a program-style multi-action call reverts and the struct shapes are already
verified, don't keep guessing orderings — decode a **live, successfully-mined transaction** against
the same deployed router and match its action layout exactly. The deployed contract's accepted
shape is the spec, full stop; this is the same discipline as [dark-reverts.md](dark-reverts.md)'s
pin-against-deployed principle, applied to call *ordering* instead of struct *shape*.

## 8. Multi-hop struct drift — route as chained single-hops instead

**Symptom:** the multi-hop path struct (an `ExactInputParams`-style call spanning A→B→C in one
call) reverts where the single-hop version of the same route works fine.
**Cause:** multi-hop structs drift across periphery contract versions just as single-hop ones do —
one more shape to get wrong, on top of everything else.
**The move:** skip the multi-hop struct entirely. Route as chained single-hops through the same
program mechanism as entry 7: `SETTLE` → `SWAP(A→B)` → `SWAP(B→C, amountIn = OPEN_DELTA)` → `TAKE(C)`
— reusing the single-hop struct you already verified, twice, with the second leg's input wired to
the first leg's output via the router's own open-delta accounting instead of a separately-shaped
multi-hop call. Works through hooked, dynamic-fee pools that a rigid multi-hop struct may not
anticipate.

## 9. Nonces come from chain state, not a local counter

**Symptom:** after one transaction reverts, every subsequent transaction in the run fails —
"nonce too low," or a replacement-transaction error — cascading from that point on.
**Cause:** a hand-rolled send loop that tracks the next nonce locally and only advances it on
success. A **mined-but-reverted** transaction still consumes the sender's nonce on-chain (only a
transaction that never mines — rejected before entering a block — leaves it unconsumed); a tracker
that doesn't know this drifts one behind after the very first revert, and every following send
reuses an already-spent value.
**The move:** don't hand-roll the send loop. Return `Dispatch[]` from `tick()` and let the runner
execute it — Sailor's own dispatch path never tracks the EVM nonce locally at all; it derives it
fresh from chain state (`getTransactionCount(address, 'pending')`, via viem's default behavior) on
every single send, and the runner awaits each dispatch's receipt before submitting the next. If you
must send transactions yourself outside that path, match the same discipline: re-derive the nonce
from chain immediately before every send, and await each receipt before sending the next — never
carry a nonce forward across a revert.
