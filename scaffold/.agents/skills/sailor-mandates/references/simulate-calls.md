# Designing simulate cases (calls.json)

## Schema

`calls.json` is an array of sample calls. Full field reference: [calls-schema.md](calls-schema.md).

```json
[
  {
    "label": "approve USDC to router at cap",
    "target": "0xA0b8...USDC",
    "calldata": "0x095ea7b3...",
    "expect": "pass"
  },
  {
    "label": "approve over the cap",
    "target": "0xA0b8...USDC",
    "calldata": "0x095ea7b3...",
    "expect": "fail"
  }
]
```

Fields: `target`, `calldata`, optional `value`, `expect` (`"pass"` or `"fail"`), `label`.

## The probe pattern — one bound, one must-fail, one must-pass

This is the bespoke mirror of the parametric script shared templates use (`scripts/probe-mandate.mjs`): that script derives probes mechanically from a config blob because it knows the template's bounds in advance. A bespoke permission has no such schema — but YOU just wrote it, so you know its bounds exactly the same way. Turn that knowledge into probes mechanically, the same derivation, done by hand:

1. **List every bound the contract actually encodes** — read it straight off your own `evaluate()`/`_applyConfig`: allowlists (venue, token, selector), amount caps, pinned recipients, slippage/min-out floors, whatever else it checks. This is not a re-guess — it's reading the `if (...) return false;` lines you just wrote.
2. **For each bound, one must-fail probe that violates ONLY that bound** — mutate the value just past it, everything else left in-bounds: an off-allowlist address, cap + 1, the wrong recipient, min-out at zero. A must-fail probe that also breaks a second bound doesn't prove the first one works — it proves nothing.
3. **One representative must-pass** — every value inside every bound simultaneously. You don't need one must-pass per bound; the must-fail probes already isolate each bound individually, so a single in-bounds call is enough to prove the accept path isn't itself broken.

**Worked example.** A bespoke permission gating deposits into ONE allowlisted lending pool, capped per-tx, with the position pinned to the account — bounds read straight off its `evaluate()`:

| # | Bound (from `evaluate()`) | Must-fail probe |
|---|---|---|
| 1 | `ctx.target == pool` (single allowlisted venue) | call a different pool address |
| 2 | `asset ∈ allowedAssets` | supply an asset not on the allowlist |
| 3 | `amount ≤ maxAmountPerTx` | amount = cap + 1 |
| 4 | `onBehalfOf == ctx.account` (recipient pinned) | `onBehalfOf` = an address that isn't the account |

Plus **one must-pass**: `target = pool`, `asset` allowlisted, `amount = cap`, `onBehalfOf = account`. That's the whole `calls.json` — 4 must-fail rows + 1 must-pass row, one row per bound plus the single accept case.

**The standard: a must-fail probe PROVEN TO REJECT is what "passed" means — for a bespoke permission exactly as much as a template.** A run with only the must-pass case is not a passed simulation; it's an untested permission that happens not to have been asked a hard question yet. You are both the author of the permission and the author of its adversarial probes — no one else will write these for you, and skipping them is how a too-permissive contract makes it to registration undetected.

**Honest cost note.** Deriving these by hand costs reasoning — there is no script to do it for you, because there is no schema to read it from. That cost is inherent to expressiveness, not a defect in the process: the same freedom that lets you gate any venue Sail doesn't have a template for is the reason its probes aren't free. Budget for it; don't skip it to save the tokens.

## Running

```bash
# batch
sailor mandate simulate --address <PermissionOrName> --sma <SMA> --calls calls.json

# one call inline
sailor mandate simulate --address <PermissionOrName> --sma <SMA> \
  --target <addr> --calldata <hex> --expect pass
```

- Off-chain `eth_call` — no gas, no signing, uses the same evaluation context as the runner.
- Flags any target with no contract code (wrong or wrong-chain address).
- Any `expect` mismatch → non-zero exit → do NOT register. `--json` for automation.

## Limits

- Simulates the single-call `evaluate()` only — batch permissions need a direct `cast call` to their batch view; see `approvals.md`.
- Proves behavior, not intent: the contract still needs review and forge tests.