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

## Deriving cases from the strategy

**Must-pass:** one entry per distinct call the agent will make — the approve at its cap, the swap/supply with exact in-bounds parameters, and so on.

**Must-fail:** mutate each bound one at a time:

- wrong token, spender, or recipient
- amount over the cap
- slippage / minimum-out below the floor
- wrong target contract; wrong selector
- nonzero ETH `value` when not allowed

A permission simulated with no must-fail cases is untested — passing everything is exactly how a broken (too-permissive) permission behaves.

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
- Any `expect` mismatch → non-zero exit → do NOT attach. `--json` for automation.

## Limits

- Simulates the single-call `evaluate()` only — batch permissions need a direct `cast call` to their batch view; see `approvals.md`.
- Proves behavior, not intent: the contract still needs review and forge tests.