# Diagnosing a dark revert — the dispatch failed and told you nothing

A dispatch (or a live venue call inside one) can revert with **zero return data** — no reason
string, no decodable custom-error selector, nothing `cast`/viem can turn into a message. This is
common at the boundary between a bespoke permission and an exotic or multi-generation venue (a
V4-style router, a fork with its own struct layout, …), and it looks identical whether the cause is
a permission-side denial, an ABI-shape mismatch, or a genuine venue-side rejection. Work the ladder
below in order — don't guess.

## The ladder

1. **Re-run `sailor mandate simulate` against the real venue.** This catches the two things a
   mocked unit test can't: a permission that denies the call outright, and an ABI-shape mismatch
   between what you encoded and what the deployed target actually decodes (the exact class of bug
   in the flagship principle below). See [simulate-calls.md](simulate-calls.md).
2. **If simulate passes but the live dispatch still bare-reverts, the failure is almost certainly
   inside the venue call itself, not the permission.** `evaluate()` already returned true — the
   next thing to fail is the venue's own contract. Don't keep tweaking the permission; move on.
3. **Trace it.** `debug_traceCall` (pre-flight, no gas — replays a call that hasn't been sent) or
   `debug_traceTransaction` (post-mined) shows every internal call and exactly which one reverted
   and where — the specific frame with no return data, in minutes instead of hours of guessing.
4. **Free-tier RPCs often gate trace methods** (and cap `getLogs` ranges) — a paid Alchemy/Infura
   tier is the common way to get `debug_traceCall`, but it's not the only way: some free, public
   endpoints allow it too. A field session traced a Base revert for free via `base.drpc.org` after
   the project's own (paid-gated) RPC returned "the method does not exist/is not available."
   Trying a tracing-enabled public endpoint costs nothing — worth reaching for before assuming
   tracing requires a paid plan. (General RPC setup — the reliable endpoint you use for everything
   else — is a separate concern; see `sailor-token-resolve`. This is specifically about the trace
   method.)
5. **Read WHERE the trace reverts.** Before the venue's core call is ever reached → almost always
   a struct/encoding shape mismatch (the flagship principle below). Inside the venue's own logic →
   a genuine venue-side rejection (an allowance, a pool-state check, a deadline) — go read that
   contract's requirements, not the permission's.

## The flagship principle: pin against the deployed contract, never the SDK

**A venue's official SDK can be newer than what's actually deployed.** A field session hit exactly
this: encoding a Uniswap V4 swap through the current `v4-sdk`, byte-for-byte "canonical," produced
a bare revert with no data — before the pool was ever touched. The deployed Base Universal Router
(`v2.1.1`) still required a `sqrtPriceLimitX96` field in the swap struct that the current SDK had
since dropped. Matching the SDK's types exactly was itself the bug, because the SDK no longer
matched what was on-chain. The "obviously correct, comes straight from the vendor" reference was
the wrong reference.

**Before encoding a call against any venue you haven't bound before, verify the struct/ABI shape
against the deployed contract itself** — the verified source on the chain's explorer, or the ABI
read directly off that address — never the SDK's current types, and never last month's notes. This
is the same lesson as [authoring-patterns.md](authoring-patterns.md)'s "Venue ABIs drift across
versions" gotcha, one layer up: there it's a selector; here it's a whole struct shape, and the
drift is between the SDK and the chain rather than between two router versions. Forks and venue
upgrades ship generations — pin against the one you're actually calling, not the one the docs
describe.

## Not covered here

Venue-specific fixes (V4 `PoolKey` construction, settle-first call ordering, the exact viem tuple
shapes for a given router version) are cookbook material, not this reference's — this is the
general diagnostic method, not a per-venue recipe book. See
[venue-cookbook.md](venue-cookbook.md) for those field-derived patterns.
