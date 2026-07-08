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
| `WithdrawPermission` | Withdrawals: receiver bound to the SMA |
| `TransferPermission` | ERC-20 transfers: token + recipient allowlists, per-transfer caps |
| `ApproveAndCallBatchPermission` | Atomic approve → call → reset-to-zero batches |

The contracts and their security reviews live in the
[protocol repo](https://github.com/sail-money/protocol); Sailor ships their addresses, typed
config encoders (`@sail.money/sdk/templates`), and the version-adaptive EIP-712 Configure signer.

## Skills: how templates get used

Each scaffolded project carries seventeen on-demand skills under `.agents/skills/`, spanning the
whole workflow: setting up (`sail-onboarding`, `sail-project-info`, `sail-servers`), defining the
mandate (one skill per shared template plus `sail-templates` for the catalog and `sail-mandates`
for authoring custom permissions), executing strategy (`sail-token-resolve`, `sail-swap-quote`,
`sail-transactions`), and running unattended (`sail-automation`, `sail-extend`). Template usage
is one part of that set, not the whole of it. A template skill encodes the safe
order of operations — register → configure → simulate → verify — along with the exact parameter
schemas and per-template footguns, so every agent follows the same vetted procedure
instead of re-deriving it. This is why template configuration is *driven through the skills*: the
CLI provides the primitives (`sailor mandate register` / `configure` / `simulate`), and the skill
is the checklist that sequences them correctly.

## Where everything lives (and why together)

**Skills are the instructions; `templates/default/examples/` is the teaching material those
instructions reference — and both are scaffolded together from `templates/default/`.**
When `sailor init` creates a project, the entire template tree is copied in, so the skill that
says "start from the scaffold" finds those exact files in the project: the `IPermission`
authoring workspace at `examples/custom-mandate/` (with a Foundry test, per Gate 4) and a
complete DCA agent at `examples/dca/`. Single source of truth in the repo; self-contained
teaching material in every scaffold.

This page is an overview with pointers — the skills themselves (in your scaffold, or in this
repo under `templates/default/.agents/skills/`) are the authoritative procedures, and they are
deliberately not restated here where they could drift.

## Custom permissions

When no shared template fits (perps, prediction markets, aggregators, anything bespoke), author
your own `IPermission` contract: the `sail-mandates` skill is the procedure, and
`examples/custom-mandate/` is the neutral scaffold to start from (each permission's header should
document what is enforced onchain vs left to the agent — see the skill's authoring-patterns
reference). Deploy, simulate, then register — as three separate
steps, never combined: `sailor mandate deploy --contract <Name>`, then `sailor mandate simulate`
to prove it accepts and rejects the right calls, then `sailor mandate register --address
<deployed>` to authorize it. You own what you deploy — nothing here is a supported or exhaustive
library.

---

Feedback: catalog out of date, or a pointer that doesn't resolve? [Open an issue](https://github.com/sail-money/Sailor/issues).
