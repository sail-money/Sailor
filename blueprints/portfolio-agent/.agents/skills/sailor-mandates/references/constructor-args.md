# Constructor args — per-shell quoting

`sailor mandate deploy` takes constructor arguments as a JSON array. The CLI validates the array length against the constructor's ABI and coerces each value to its ABI type: `uint*`/`int*` → bigint (pass numbers as strings to avoid precision loss), `bool` → boolean, arrays recursively.

## Bash / Git Bash / zsh

Single quotes around the whole array; inner double quotes survive:

```bash
sailor mandate deploy --contract <Name> --args '["0xToken","1000000"]' --sma <SMA>
```

Nested arrays work the same way:

```bash
sailor mandate deploy --contract <Name> --args '["0xSigner",["0xTargetA","0xTargetB"]]' --sma <SMA>
```

## PowerShell

Inline JSON is unreliable in PowerShell — quote stripping mangles the array even with escaped inner quotes. **Do not pass `--args` inline from PowerShell.** Use `--args-file`:

```powershell
sailor mandate deploy --contract <Name> --args-file args.json --sma <SMA>
```

(If you must inline, the escaped form is `--args '[\"0xToken\",\"1000000\"]'` — but prefer the file.)

## Any shell — `--args-file` (recommended whenever quoting bites)

Write the array to a file, no quoting rules at all:

```json
["0xToken", "1000000"]
```

```bash
sailor mandate deploy --contract <Name> --args-file args.json --sma <SMA>
```

## Errors you will see

- `Constructor takes no arguments but --args were provided` — drop `--args`.
- `Constructor expects N argument(s)` — pass exactly N elements, in declaration order.
- `--args must be a JSON array of N element(s)` — the JSON parsed but the length is wrong, or it is not an array (a shell ate your quotes).
