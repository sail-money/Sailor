# calls.json — batch schema for `sailor mandate simulate`

A non-empty JSON array. Each entry is one sample call probed against the permission's `evaluate()`:

```json
[
  {
    "target": "0xVenueContract",
    "calldata": "0x04e45aaf…",
    "value": "0",
    "expect": "pass",
    "label": "swap 100 USDC → WETH within bounds"
  },
  {
    "target": "0xVenueContract",
    "calldata": "0x04e45aaf…",
    "expect": "fail",
    "label": "swap exceeding MAX_AMOUNT_IN — must be rejected"
  }
]
```

| Field | Required | Meaning |
|---|---|---|
| `target` | yes | Call target address (the venue contract) |
| `calldata` | yes | 0x-prefixed hex calldata (`data` also accepted as the key) |
| `value` | no | ETH value in wei, integer or numeric string; default `0` |
| `expect` | no | `"pass"` or `"fail"`. Any mismatch with the actual result makes the command exit non-zero |
| `label` | no | Human-readable description shown per result; defaults to `call N` |

## What simulate reports per call

- `result`: `pass` (evaluate returned true) or `fail`, with `reverted`/`revertReason` when evaluate() reverted rather than returning false.
- `targetHasCode`: whether the target has contract code on this chain — `false` means a wrong or wrong-chain address; that call would fail on-chain regardless of the permission.
- `selectorRoutes`: whether the calldata's 4-byte selector is found in the target's bytecode (`null` for proxies, where the check is indeterminate). `false` strongly suggests a wrong selector.
- `match`: per-call expectation verdict; `mismatches` summarizes. JSON output (`--json`) carries all of the above plus `submitterIsStandIn` (no local manager key — a stand-in submitter was used) and `blockContextStale` (block fetch failed; time/block-gated permissions may show false negatives).

## Rules of use

- Derive samples from the user's stated strategy: every call the agent must make → `expect: "pass"`; boundary violations (too-large amount, wrong token, wrong recipient, wrong venue) → `expect: "fail"`.
- Do not authorize until every sample matches — zero mismatches.
- Batch permissions: simulate doesn't cover `evaluateBatch()` — see [approvals.md](approvals.md) (Model B).
