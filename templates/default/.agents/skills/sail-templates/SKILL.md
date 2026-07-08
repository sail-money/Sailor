---
name: sail-templates
description: Registry + reuse guide for Sail's shared permission templates (Protocol/contracts/templates). Load this when you need to know which permission primitives are available as reusable templates and want to gate an SMA's mandate by REUSING a configurable singleton — deploy once, then register + configure per SMA (no per-SMA deploy). Covers swap (oracle-gated and no-oracle), borrow, transfer, deposit, withdraw, and approve-and-call-batch. All seven are deployed today, at the SAME address on every supported chain (CREATE2); addresses live in deployed.json.
compatibility: Node 18+; a Sailor project (`@sail/sdk`, `sailor` CLI); read access to the workspace `Protocol/contracts/templates/` (or set SAIL_PROTOCOL_DIR).
metadata:
  workspace: sailor-harness
  classification: generic
  status: draft
  origin: Protocol/contracts/templates source contracts
---

# Sail shared permission templates — registry & reuse

`Protocol/contracts/templates/` holds seven **shared permission templates** — reusable
`IPermission` patterns covering the most common DeFi primitives. Each extends
`ConfigurablePermission`, which means it is a **configurable singleton**:

> Deploy the contract **once per chain**. Every SMA then reuses that single address via
> **register + configure** — its own routers / tokens / caps live in the singleton's
> `mapping(address => …)`. **No per-SMA deploy, no per-SMA audit, minimal gas.**

> **Deployment status (2026-07-01, by `0xB01dCE…815B6`):** **all seven** templates are live on
> every chain Sailor bundles — Ethereum, Base, Arbitrum, Optimism, Unichain, BSC, World Chain,
> HyperEVM, MegaETH, Base Sepolia, and Eth Sepolia (11 chains) — all bound to the current
> CREATE2 kernel `0x38b508756c976e876EFF05a29E731A4d348BA6ED`. This is a CREATE2 deploy with a
> global salt, so the kernel and every template address are **identical on every chain**. Live
> addresses are in [`deployed.json`](deployed.json) (keyed by chainId → contract name, though
> the value is the same for all 11 keys). This supersedes the prior 2026-06-09 deploy (kernel
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
| DEX swap (oracle band) | `SwapPermission` | ✅ 11 chains | [`sail-template-swap`](../sail-template-swap/SKILL.md) |
| DEX swap (no oracle) | `SwapPermissionNoOracle` | ✅ 11 chains | [`sail-template-swap-no-oracle`](../sail-template-swap-no-oracle/SKILL.md) |
| Lending borrow | `BorrowPermission` | ✅ 11 chains | [`sail-template-borrow`](../sail-template-borrow/SKILL.md) |
| Transfer (allowlist) | `TransferPermission` | ✅ 11 chains | [`sail-template-transfer`](../sail-template-transfer/SKILL.md) |
| Vault/lending deposit | `DepositPermission` | ✅ 11 chains | [`sail-template-deposit`](../sail-template-deposit/SKILL.md) |
| Withdraw to fixed addr | `WithdrawPermission` | ✅ 11 chains | [`sail-template-withdraw`](../sail-template-withdraw/SKILL.md) |
| Approve+call batch | `ApproveAndCallBatchPermission` | ✅ 11 chains | [`sail-template-approve-batch`](../sail-template-approve-batch/SKILL.md) |

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
| Config tuples + invariants | [references/config-schemas.md](references/config-schemas.md) | quote only their own tuple |

So a change to the CLI flow is a single edit to
`reuse-flow.md`, not seven spoke edits. The deliberately-fuller [`sail-template-swap`](../sail-template-swap/SKILL.md)
is the worked-example exemplar; the other spokes stay thin.

## Step 1 — see what exists / deployment status

The list is auto-detected from source; deployment status comes from `deployed.json`:

```bash
node .agents/skills/sail-templates/catalog.mjs              # all templates
node .agents/skills/sail-templates/catalog.mjs --chain 8453 # status on one chain
node .agents/skills/sail-templates/catalog.mjs --json       # machine-readable
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
   sailor mandate configure --address <DEPLOYED_ADDRESS> --sma <SMA> \
     --template <TemplateName> --args-file ./config.json
   ```
   This drives `configureDirect(account, <config blob>)` as an owner transaction (the owner is
   the `permissionSigner`), pre-flighted with an `eth_call` before any signing or gas. See
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
(GMX, Gains, Synthetix), prediction markets (Azuro, Limitless), the LI.FI aggregator, or
anything else on-chain — is authored as a bespoke `IPermission` via
[`sail-mandates`](../sail-mandates/SKILL.md), starting from the `examples/custom-mandate/`
scaffold: full expressiveness, same kernel guarantees.

## Notes

- The kernel and every template address are identical on every chain (CREATE2 global salt) —
  but that pairing is generation-specific: a template address from one deploy generation (e.g.
  the superseded 2026-06-09 deploy) is never valid against a different generation's kernel.
  Always resolve both from the same `deployed.json` entry / SDK deployment.
- Caps/amounts are in **base units**. Size them with `sail-swap-quote`.
- The config encoder must match each contract's `_applyConfig` decode exactly — use the SDK
  builder under `@sail/sdk/templates` **only after** verifying its param tuple equals the
  source blob in `config-schemas.md` (the SDK builders track a previously-deployed set and may
  differ from these source contracts).
- **CLI gap:** `sailor mandate register` and `sailor mandate configure` are
  still separate commands — no combined one-step call ships yet. Always run both.

## Next

Chose a template? Open its matching spoke skill (`sail-template-*`) and follow its steps.
Authoring bespoke? [`sail-mandates`](../sail-mandates/SKILL.md). Either way, return to the
mandate plan ([`sail-mandate-planner`](../sail-mandate-planner/SKILL.md)) — the mandate is
complete only when every permission in the plan is registered, configured, and
simulate-verified.
