# Templates and skills

Two things make an agent safe to run: **onchain permission contracts** that bound what it can do,
and **procedures** that set those bounds up in the right order. In Sailor, the first are the
protocol's shared templates (plus anything you author yourself), and the second are the
scaffold's skills.

## The shared-template catalog

Sail Protocol deploys seven **shared permission templates** — multi-tenant, singleton contracts
at the same CREATE2 address on every supported chain. You don't deploy them; you **register**
one on your SMA and **configure** your own bounds. As bundled in the SDK's deployment registry
(`getSailDeployment(chainId).knownTemplates`):

| Template | Bounds |
|---|---|
| `SwapPermission` | DEX swaps: router + token allowlists, per-tx cap, mandatory oracle slippage band |
| `SwapPermissionNoOracle` | Swaps for tokens without an oracle: allowlists + cap + live-pool sanity band (not manipulation-resistant) |
| `BorrowPermission` | Borrowing: asset allowlist + caps |
| `DepositPermission` | Deposits into venues: target/asset bounds |
| `WithdrawPermission` | Vault / lending exits (ERC-4626 `withdraw`/`redeem`, Aave v2/v3 `withdraw`): target allowlist + cap, proceeds bound to the SMA |
| `TransferPermission` | ERC-20 transfers: token + recipient allowlists, per-transfer caps |
| `ApproveAndCallBatchPermission` | Atomic approve → call → reset-to-zero batches |

The contracts and their security reviews live in the
[protocol repo](https://github.com/sail-money/protocol); Sailor ships their addresses, typed
config encoders (`@sail.money/sdk/templates`), and the version-adaptive EIP-712 Configure signer.

## Skills: the five stations

Each scaffolded project carries 17 on-demand skills under `.agents/skills/`, organized around the
five-station journey the `sailor-navigator` skill lays out (each station names its owning skill, entry gate, and
exit check). The split between core and custom is recorded in `.agents/skill-registry.json`:

- **Core skills (14)** — the harness, identical across every agent. They ship in the npm package,
  are protected from blueprint pruning, and update via `sailor update`.
- **Custom skills (3)** — what makes *this* agent: `sailor-strategy` (the guided spec conversation),
  `sailor-agent-build` (the tick-loop skeleton), and `sailor-swap-quote` (live quotes). A
  ready-to-run Harbor agent swaps these for its own strategy-specific skills, updated through the
  Harbor registry.

1. **ARRIVE** — `sailor-onboarding`: project, keys, account, chain.
2. **STRATEGY** — `sailor-strategy`: the guided conversation that writes the concrete spec — one per strategy, to `.sail/strategies/<name>.md`.
3. **MANDATE** — `sailor-mandate-planner` routes each action of the spec to a shared template or bespoke authoring. `sailor-templates` is the catalog plus the register→configure reuse flow; each template's parameter schema and safe order of operations live in `sailor-templates/references/` (`swap.md`, `swap-no-oracle.md`, `transfer.md`, `withdraw.md`, `deposit.md`, `borrow.md`, `approve-batch.md`). `sailor-mandates` is the bespoke-`IPermission` lifecycle.
4. **AGENT** — `sailor-agent-build`: the tick loop (dispatch mechanics in `sailor-transactions`; the agent's own append-only, chain-reconciled memory in `sailor-memory`).
5. **SAIL** — `sailor-automation` (run unattended), `sailor-operate` (monitor, tune, pause, revoke, exit), `sailor-extend` (optional notifications/dashboards).

Plus anytime utilities, not tied to a station: `sailor-project-info` (read-only state), `sailor-servers` (local dashboard + signing server), `sailor-token-resolve` (token → address/decimals/liquidity), and `sailor-risk` (technical risk assessment before the user approves anything).

A template reference encodes the safe order of operations — register → configure → simulate → verify —
with the exact parameter schemas and per-template footguns, so every agent follows the same vetted
procedure instead of re-deriving it. This is why template configuration is *driven through the
skills*: the CLI provides the primitives (`sailor mandate register` / `configure` / `simulate`), and
the skill is the checklist that sequences them correctly.

## Where everything lives (and why together)

**Skills are the instructions, and the scaffold carries the workspaces they reference —
both scaffolded together from `scaffold/`.**
When `sailor init` creates a project, the entire template tree is copied in, so the skill that
says "start from the scaffold" finds those exact files in the project: the `IPermission`
authoring workspace at `contracts/` (with a Foundry test, per Gate 4). The canonical agent
loop is the typecheck-verified skeleton inside the `sailor-agent-build` skill, not a separate
examples directory. Single source of truth in the repo; self-contained teaching material in
every scaffold.

This page is an overview with pointers — the skills themselves (in your scaffold, or in this
repo under `scaffold/.agents/skills/`) are the authoritative procedures, and they are
deliberately not restated here where they could drift.

## Custom permissions

When no shared template fits (perps, prediction markets, aggregators, anything bespoke), author
your own `IPermission` contract: the `sailor-mandates` skill is the procedure, and
`contracts/` is the neutral scaffold to start from (each permission's header should
document what is enforced onchain vs left to the agent — see the skill's authoring-patterns
reference). Deploy, simulate, then register — as three separate
steps, never combined: `sailor mandate deploy --contract <Name>`, then `sailor mandate simulate`
to prove it accepts and rejects the right calls, then `sailor mandate register --address
<deployed>` to authorize it. You own what you deploy — nothing here is a supported or exhaustive
library.

---

Feedback: catalog out of date, or a pointer that doesn't resolve? [Open an issue](https://github.com/sail-money/Sailor/issues).
