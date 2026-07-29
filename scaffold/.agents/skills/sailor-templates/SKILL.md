---
name: sailor-templates
description: Registry + reuse guide for Sail's shared permission templates (Protocol/contracts/templates). Load this to gate my agent / set a spending cap / reuse a permission — to know which permission primitives are available as reusable templates and bound an SMA's mandate by REUSING a configurable singleton — deploy once, then register + configure per SMA (no per-SMA deploy). Covers swap (oracle-gated and no-oracle), borrow, transfer, deposit, withdraw, and approve-and-call-batch. All seven are deployed today, at the SAME address on every supported chain (CREATE2); addresses live in deployed.json.
compatibility: Node 18+; a Sailor project (`@sail.money/sailor/sdk`, `sailor` CLI); read access to the workspace `Protocol/contracts/templates/` (or set SAIL_PROTOCOL_DIR).
metadata:
  workspace: sailor-harness
  classification: generic
  status: draft
  origin: Protocol/contracts/templates source contracts
---

# sailor-templates — registry & reuse

`Protocol/contracts/templates/` holds seven **shared permission templates** — reusable
`IPermission` patterns covering the most common DeFi primitives. Each extends
`ConfigurablePermission`, which means it is a **configurable singleton**:

> Deploy the contract **once per chain**. Every SMA then reuses that single address via
> **register + configure** — its own routers / tokens / caps live in the singleton's
> `mapping(address => …)`. **No per-SMA deploy, no per-SMA audit, minimal gas.**

> **Deployment status (2026-07-01, by `0xB01dCE…815B6`):** **all seven** templates are live on
> every chain Sailor bundles — Ethereum, Base, Arbitrum, Optimism, Unichain, BSC, World Chain,
> HyperEVM, MegaETH, Robinhood, Base Sepolia, and Eth Sepolia (12 chains) — all bound to the current
> CREATE2 kernel `0x38b508756c976e876EFF05a29E731A4d348BA6ED`. This is a CREATE2 deploy with a
> global salt, so the kernel and every template address are **identical on every chain**. Live
> addresses are in [`deployed.json`](deployed.json) (keyed by chainId → contract name, though
> the value is the same for all 12 keys). This supersedes the prior 2026-06-09 deploy (kernel
> `0x02ABC18B65A328de2e749F56ba79ACF2718a6659`) — those addresses are dead.

> ⚠️ **Audit scope.** These are marked *"UNAUDITED EXAMPLE — NOT PART OF THE TRUSTED CORE"* in
> source. The kernel runs them safely (staticcall + gas cap + fail-closed) but does not verify
> their internal logic. Always `sailor mandate simulate` against your SMA before authorizing.

> ⚠️ **CRITICAL — "register" ≠ "configure" in the shipped CLI.** A shared template is useless
> until it is both **registered** on the kernel AND **configured** per-account. `sailor mandate
> register` does **only the register** half (it submits `RegisterPermission` and nothing more). A
> registered-but-unconfigured singleton has `isConfigured == false` and the kernel **denies every
> call**. Run `sailor mandate configure` as the separate second step (see the reuse flow below).

## The seven templates

| Primitive | Contract | Deployed? | Skill |
|---|---|---|---|
| DEX swap (oracle band) | `SwapPermission` | ✅ 12 chains | [`sailor-template-swap`](../sailor-template-swap/SKILL.md) |
| DEX swap (no oracle) | `SwapPermissionNoOracle` | ✅ 12 chains | [`sailor-template-swap-no-oracle`](../sailor-template-swap-no-oracle/SKILL.md) |
| Lending borrow | `BorrowPermission` | ✅ 12 chains | [`sailor-template-borrow`](../sailor-template-borrow/SKILL.md) |
| Transfer (allowlist) | `TransferPermission` | ✅ 12 chains | [`sailor-template-transfer`](../sailor-template-transfer/SKILL.md) |
| Vault/lending deposit | `DepositPermission` | ✅ 12 chains | [`sailor-template-deposit`](../sailor-template-deposit/SKILL.md) |
| Vault/lending exit (to the SMA) | `WithdrawPermission` | ✅ 12 chains | [`sailor-template-withdraw`](../sailor-template-withdraw/SKILL.md) |
| Approve+call batch | `ApproveAndCallBatchPermission` | ✅ 12 chains | [`sailor-template-approve-batch`](../sailor-template-approve-batch/SKILL.md) |

Authoritative config tuples + enforced invariants (from source):
[references/config-schemas.md](references/config-schemas.md).

### One source of truth per concern

This hub is canonical for everything shared; each spoke skill carries only what's unique to its
primitive (selectors, invariants, config blob, probe cases) and defers the rest here. When
something changes, edit it in ONE place:

| Concern | Lives in | Spokes do |
|---|---|---|
| Which templates exist | source contracts, auto-detected by [`catalog.mjs`](catalog.mjs) | — |
| Deployed addresses (per chain) | [`deployed.json`](deployed.json) | link here |
| Register → configure → simulate flow | [references/reuse-flow.md](references/reuse-flow.md) | link here, don't restate |
| Lean safety probes (generated from the config blob) | [`scripts/probe-mandate.mjs`](../../../scripts/probe-mandate.mjs) — `node scripts/probe-mandate.mjs --template <Name> --params <blob> --sma <SMA> --address <ADDR>` | link here |
| Config tuples + invariants | [references/config-schemas.md](references/config-schemas.md) | quote only their own tuple |

So a change to the CLI flow is a single edit to
`reuse-flow.md`, not seven spoke edits. The deliberately-fuller [`sailor-template-swap`](../sailor-template-swap/SKILL.md)
is the worked-example exemplar; the other spokes stay thin.

## Step 1 — see what exists / deployment status

The list is auto-detected from source; deployment status comes from `deployed.json`:

```bash
node .agents/skills/sailor-templates/catalog.mjs              # all templates
node .agents/skills/sailor-templates/catalog.mjs --chain 8453 # status on one chain
node .agents/skills/sailor-templates/catalog.mjs --json       # machine-readable
```

(The catalog warns if a new source contract appears with no curated metadata — a signal to
add it here and write a skill.)

## Step 2 — the reuse flow (per template)

> The on-chain **intended** design is one signed call (`MandateFactory.attach`) that registers
> the address on the kernel and writes the per-account config together. (The on-chain function
> is named `attach`; in Sailor and protocol vocabulary this operation is permission
> registration — the kernel's own functions are registerPermission/registerPermissions.) The
> **shipped** CLI does not implement that combined call yet, so today these are two separate
> steps: `sailor mandate register` followed by `sailor mandate configure`. The flow below
> describes what actually works now.

1. **Deploy once** (one-time, Protocol team / `DeploySharedTemplates`, CREATE2 — same address on
   every chain) → record the address in `deployed.json`. (Already done for all seven.)
2. **Build the config blob** for your SMA (per-primitive skill gives the exact params).
3. **Register** the singleton address on the SMA's kernel (this does NOT configure it):
   ```bash
   sailor mandate register --address <DEPLOYED_ADDRESS> --sma <SMA> --label "<primitive>"
   ```
   A comma-separated `--address` list registers several in one signature (`registerBatch`).
4. **Configure** the per-account bounds — this is the step that makes the permission actually
   allow calls:
   ```bash
   sailor mandate configure --address <DEPLOYED_ADDRESS> --sma <SMA> --params <0x-encoded-blob>
   ```
   This drives `configureDirect(account, <config blob>)` as an owner transaction (the owner is
   the `permissionSigner`), pre-flighted with an `eth_call` before any signing or gas. The signing
   card's "what you're signing" explanation auto-resolves from `--address` for any of the seven
   shared templates — no `--template`/`--label` needed just for that. Only `SwapPermission` has a
   CLI-side `--template`/`--args-file` encoder today; every other template's blob must be built
   yourself (`cast abi-encode` / `encodeAbiParameters`) and passed via `--params`. See
   [references/reuse-flow.md](references/reuse-flow.md) for the exact encoding gotcha and the
   signing-station path.
5. **Simulate** off-chain (no gas) — prove allowed calls pass and bad ones fail:
   ```bash
   sailor mandate simulate --address <DEPLOYED_ADDRESS> --sma <SMA> --calls ./probe.json
   ```
6. **Reconfigure** later (new caps / allowlists) via `configure`/`configureDirect` on the same
   singleton — same address, no re-register. (On-chain `MandateFactory.reconfigure` is the
   intended batch path for this.)

Full mechanics (EIP-712 sigs, `configure`/`configureDirect`, `registerBatch`, `replace`,
`detach`, and the register-vs-configure split): [references/reuse-flow.md](references/reuse-flow.md).

## Beyond the templates — authoring bespoke

The seven templates cover the bounded swap, transfer, withdraw, deposit, borrow, and
approve-and-call-batch primitives. A strategy that needs any other venue or bound — perps
(GMX, Gains, Synthetix), prediction markets (Azuro, Limitless), the LI.FI aggregator, **`repay`
to unwind a borrow position (no shared template — `BorrowPermission` covers `borrow()` only)**,
or anything else on-chain — is authored as a bespoke `IPermission` via
[`sailor-mandates`](../sailor-mandates/SKILL.md), starting from the `contracts/`
scaffold: full expressiveness, same kernel guarantees.

Any bespoke permission that gates a call pulling an ERC-20 from the SMA via allowance (repay,
an unlisted vault's `deposit`, an LP `mint`, …) needs the same approve-coverage treatment as the
templates above — `sailor-mandates`' Gate 2 (enumerate approvals, pick per-call vs. atomic
batch) applies to bespoke authoring exactly as it does here; a bespoke permission is not exempt
just because it has no pre-built spoke skill to remind you.

## Notes

- The kernel and every template address are identical on every chain (CREATE2 global salt) —
  but that pairing is generation-specific: a template address from one deploy generation (e.g.
  the superseded 2026-06-09 deploy) is never valid against a different generation's kernel.
  Always resolve both from the same `deployed.json` entry / SDK deployment.
- Caps/amounts are in **base units**. Size them with `sailor-swap-quote`.
- The config encoder must match each contract's `_applyConfig` decode exactly — encode with
  `abi.encode(...)` (viem's `encodeAbiParameters`) following the tuples in `config-schemas.md`,
  the source of truth.
- **CLI gap:** `sailor mandate register` and `sailor mandate configure` are
  still separate commands — no combined one-step call ships yet. Always run both.

## Next

Chose a template? Open its matching spoke skill (`sailor-template-*`) and follow its steps.
Authoring bespoke? [`sailor-mandates`](../sailor-mandates/SKILL.md). Either way, return to the
mandate plan ([`sailor-mandate-planner`](../sailor-mandate-planner/SKILL.md)) — the mandate is
complete only when every permission in the plan is registered, configured, and
simulate-verified.
