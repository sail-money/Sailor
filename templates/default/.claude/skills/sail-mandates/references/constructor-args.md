# Constructor args — shell quoting

`sailor mandate deploy` takes constructor args as a JSON array. Quoting rules differ by shell.

Bash / zsh / Git Bash:

```bash
sailor mandate deploy --contract <Name> --args '["0xToken","1000000"]' --sma <SMA>
```

PowerShell — escaped inner quotes inside single quotes:

```powershell
sailor mandate deploy --contract <Name> --args '[\"0xToken\",\"1000000\"]' --sma <SMA>
```

Any shell — `--args-file` avoids quoting entirely (preferred from PowerShell):

```json
["0xToken", "1000000"]
```

```bash
sailor mandate deploy --contract <Name> --args-file args.json --sma <SMA>
```

Notes:

- Nested arrays are fine: `'[["0xTarget1","0xTarget2"], [], 0]'` for `(address[], bytes4[], uint256)` — pass `[]` for an empty array.
- Pass uint256 values as decimal strings to avoid precision loss.
