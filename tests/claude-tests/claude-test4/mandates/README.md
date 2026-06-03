# Mandates

Solidity mandate (permission) contracts for this Sailor project live here.

A mandate implements `@sail/interfaces/IPermission.sol` — `evaluate(txData, ctx)`
returns `true` to permit a manager-submitted dispatch, `false` to block it.

## Authoring + deploying

1. Write your contract in this folder (see `AllowlistTargetMandate.sol`).
   Configure all parameters in the **constructor** — the deploy flow expects a
   single creation transaction to fully set up the mandate.
2. Compile:
   ```bash
   forge build
   ```
3. Deploy it (the owner signs the creation tx in the browser signing UI):
   ```bash
   sailor mandate deploy --contract AllowlistTargetMandate \
     --args '["0xPermissionSigner", ["0xTarget1", "0xTarget2"]]'
   ```
4. Attach it to a Safe:
   ```bash
   sailor mandate attach --address 0xDeployed --sma 0xSafe
   ```
   (or pass `--attach --sma 0xSafe` to `deploy` to do both at once.)

Compiled artifacts are written to `out/` and the deployed address is tracked in
`.sail/state/mandates.json`.
