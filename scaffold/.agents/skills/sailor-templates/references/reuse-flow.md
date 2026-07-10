# Reuse-first flow — register + configure a shared template

The whole point of a **shared** template: the logic is already deployed, so you skip the
deploy entirely. You give one SMA its own private config inside the singleton's
`mapping(address => …)` and register it on the kernel.

> **Two steps, not one (today).** The on-chain **intended** design is a single signed call —
> `MandateFactory.attach(account, template, params, configureDeadline, configureSig, kernelSig)`
> — that registers the template on the kernel AND writes its per-account config together. (The
> on-chain function is named `attach`; in Sailor and protocol vocabulary this operation is
> permission registration — the kernel's own functions are registerPermission/registerPermissions.)
> **The shipped `sailor` CLI does not implement that combined call yet.** `sailor mandate
> register` performs **only the kernel registration** (`RegisterPermission` / the batch
> `registerPermissions`); it never calls `configure`/`configureDirect`, carries no `--params`,
> and builds no `Configure` EIP-712 signature. The SDK's `client.mandate.register(...)` is a
> `notImplemented()` stub.
>
> A registered-but-unconfigured singleton has `isConfigured == false`, so the kernel's
> `evaluate()` **denies every call** — a registered-but-dead permission. You MUST configure
> separately, with `sailor mandate configure` (step 4 below). The flow below describes what
> actually works now.

## On-chain mechanics (`MandateFactory` + `ConfigurablePermission`)

These are the **on-chain** entry points — the contract truth for what the combined/intended
flow does. The shipped CLI uses a subset of them today (registration only); the configure
half is driven directly for now.

Registration (kernel side — what `sailor mandate register` does today):

| Function | Use |
|---|---|
| kernel `registerPermission(account, permission, deadline, sig)` | Register one template address on an SMA |
| kernel `registerPermissions(account, permissions[], deadline, sig)` | Register several in one signature (the `--address a,b,c` batch path) |
| kernel `revokePermissions(account, permissions[], deadline, sig)` | Remove (`sailor mandate revoke`) |

Configuration (singleton side — the half the CLI does NOT do today):

| Function | Use |
|---|---|
| `configure(account, params, deadline, sig)` | Set per-account config, gated by an EIP-712 `Configure(account, paramsHash, nonce, deadline, epoch)` signature from the account's `permissionSigner` (ECDSA or ERC-1271). |
| `configureDirect(account, params)` | Set per-account config, gated by `msg.sender == permissionSigner`. The working path when the owner IS the permissionSigner — a plain owner tx, no signature. |
| `reconfigure(...)` | Intended batch re-config path (`MandateFactory.reconfigure`); functionally `configure` again with a new blob. |

The intended combined call (`MandateFactory.attach`) and its batch/replace/detach siblings are
defined on the factory contract; they are the target state for a future one-step CLI command,
not something the current CLI drives.

The kernel evaluates a registered permission via `staticcall` with a per-permission gas cap;
a revert or over-gas is treated as `false` (fail-closed), never a kernel revert.

## The steps (as they work today)

### 1. Discover the address
```bash
node .agents/skills/sailor-templates/catalog.mjs --chain <id>
```
The address comes from [`deployed.json`](../deployed.json). **If the template isn't deployed on
your chain yet** (e.g. `SwapPermissionNoOracle` is not deployed anywhere), that's the
prerequisite: deploy the singleton once (Protocol team / `DeploySharedTemplates`) and record
its address there. A template address is only meaningful paired with that chain's kernel.

### 2. Build the config blob
Encode the config tuple **exactly as the contract's `_applyConfig` decodes it** — the
authoritative tuples are in [config-schemas.md](config-schemas.md). Use `abi.encode(...)` in
that order, or the typed builder under `@sail/sdk/templates` **only after** verifying its param
tuple equals the source tuple (the SDK builders track a previously-deployed set and may differ
from these source contracts):
```ts
import { boundedSwapTemplate } from "@sail/sdk/templates"; // verify params vs config-schemas.md first

const params = { routers, tokensIn, tokensOut, maxAmountPerTx, maxSlippageBps,
                 priceOracle, maxPriceAgeSec };
const blob = boundedSwapTemplate.encoder.encode(params);

// Always surface the human-readable summary + warnings to the user first:
const explanation = boundedSwapTemplate.explainer.explain(params);
```

> ⚠️ **Encoding gotcha (fails closed).** Templates do NOT all encode the same way.
> `TransferPermission` / `WithdrawPermission` / `DepositPermission` decode **flat top-level
> params** (`abi.encode(address[], address[], uint256)`). `ApproveAndCallBatchPermission`
> decodes a **single wrapped struct** (`abi.encode(Config{…})`) — its blob starts with a `0x20`
> tuple-offset word. Wrapping a flat-params blob (or vice-versa) reverts at configure. **Always
> round-trip-decode the blob and `cast call`-simulate `configureDirect` before sending.**

### 3. Register the singleton on the kernel (does NOT configure)
```bash
sailor mandate register --address <SHARED_ADDRESS> --sma <SMA> --label "<primitive>"
```
This builds and submits the kernel `RegisterPermission` (or `registerPermissions` for a
comma-separated `--address` list). It does NOT call `configure`. After this step the address is
in `getPermissions(<SMA>)` but `isConfigured(<SMA>) == false`, so every dispatch is still
denied. Proceed to step 4.

### 4. Configure the per-account bounds (the half that makes it live)
When the owner IS the SMA's `permissionSigner` (the default Sailor onboarding), drive
`configureDirect(account, <config blob>)` as a plain owner transaction — `msg.sender ==
permissionSigner` holds and no EIP-712 signature is needed — via the shipped command:
```bash
# --template + --args-file only works when the CLI has a wired-in encoder for that template —
# today that's SwapPermission only (packages/cli/src/commands/mandate-configure.ts's
# TEMPLATE_REGISTRY). For every other shared template (Withdraw/Deposit/Borrow/Transfer/
# ApproveAndCallBatch) there is no CLI encoder: build the blob yourself (step 2, `cast abi-encode`
# or `encodeAbiParameters`) and pass it pre-encoded:
sailor mandate configure --address <SHARED_ADDRESS> --sma <SMA> --params <0x-blob>
# only for templates the CLI knows how to encode (currently SwapPermission):
sailor mandate configure --address <SHARED_ADDRESS> --sma <SMA> \
  --template <TemplateName> --args-file ./config.json
```
Either way, `--address` is checked against the chain's known-shared-template registry
(`@sail/sdk`'s `getSailDeployment(chainId).knownTemplates`) and the signing card's "what you're
signing" explanation renders automatically for any of the seven shared templates — `--template`/
`--label` are only needed to override the auto-detected name, not to get the explanation.

It does, in order:
1. **Pre-flight (no gas):** an `eth_call` simulation of `configureDirect` from `permissionSigner`. A revert here means the config is invalid before any gas is spent — fix the blob (see the encoding gotcha) and retry. Pass `--simulate-only` to stop here.
2. **Send it:** pushes the `configureDirect` call to the owner wallet as an `arbitrary-tx` request through the signing page; the owner approves in the browser and the owner wallet sends the transaction.
3. **Verify:** reads `isConfigured(<SMA>)` on the singleton and errors if it isn't `true`.

If the owner is **not** the `permissionSigner` (e.g. a separate mandate-signer / multisig), use
`configure(account, params, deadline, sig)` instead: construct the EIP-712 `Configure` digest
(bound to the kernel's current `registrationEpoch`), have the `permissionSigner` sign it, and
submit. `sailor mandate configure` does not build this signature for you — that path is still
manual.

### 5. Verify off-chain (no gas) — the ONE mandatory safety gate, run ONCE
This is the safety verification: prove the configured bounds REJECT what they must reject and
ACCEPT a representative good call. Run it exactly once, here — after configure, before the agent
goes live. (The `eth_call` pre-flight inside step 4 is only an encoding check that
`configureDirect` decodes; it is NOT this gate — don't count it as a second simulation.)

Don't hand-write the probes. Generate the lean set mechanically from the SAME config blob you
configured with — it derives the cap / allowlist / recipient / floor rejections and picks the
correct swap selector for your router:
```bash
node scripts/probe-mandate.mjs --template <TemplateName> --params <0x-config-blob> \
  --sma <SMA> --address <SHARED_ADDRESS>
# → writes mandate-probes.<Template>.json and prints the exact command to run:
sailor mandate simulate --address <SHARED_ADDRESS> --sma <SMA> --calls mandate-probes.<Template>.json --json
```
Covers **all seven** shared templates. Two carry an extra wrinkle the script handles:
- `BorrowPermission` needs `--protocol <aave|morpho|compound>` (the borrow calldata shape is
  per-family, not in the blob). Its LTV probe is config-honest: a both-oracle config gets a
  must-fail LTV proof, a zero-oracle config gets none (no LTV ceiling applies).
- `ApproveAndCallBatchPermission` is enforced by `evaluateBatch()`, so its probes are BATCH arrays —
  the script emits them and prints the direct `evaluateBatch` staticcall mechanism (single-call
  `sailor mandate simulate` can't exercise a batch).

### 6. Reconfigure when bounds change
New cap or allowlist? Re-encode the blob and repeat step 4 (`sailor mandate configure --force`,
or the manual `configure` signature path) — the address stays registered, no re-register. (On-chain
`MandateFactory.reconfigure` is the intended batch path for this.)

## Gotchas

- **Unconfigured = deny.** A freshly-registered shared template with no `configure()` has
  `isConfigured == false` and denies everything. Register AND configure — don't stop at
  `sailor mandate register`.
- **`sailor mandate register` is register-only.** It does not configure. This is the single most
  common trap; see steps 3 and 4.
- **Caps are in base units** of the relevant token (e.g. `25_000_000` = 25 USDC).
- **permissionSigner is the trust anchor** for config. In production use a multisig / timelock
  — whoever holds it can widen allowlists and caps on every account they signed for.
- The shared singletons are **unaudited examples**. Simulate (Step 5) is not optional.
