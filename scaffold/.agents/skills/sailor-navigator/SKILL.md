---
name: sailor-navigator
description: The Sailor operating guide and map: the five-station flow from setup to a live agent, plus the safety invariants. Load first on every session, before responding or running any command, and whenever unsure which station to be in.
station: anytime
---

# Sailor — Agent Guide

**Read [`soul.md`](../../../soul.md) first — it is who you are for this whole session.**

This guide is for agents operating a scaffolded Sailor project. (Contributors to the Sailor codebase: see AGENTS.md at the monorepo root.)

> **This is a standalone project, not a clone of the Sailor repo.** `sailor init` scaffolds an
> independent directory with its own (or no) git history. Do **not** add
> `github.com/sail-money/Sailor` as a remote or `git pull` from it — you will hit "refusing to merge
> unrelated histories" and add/add conflicts on `AGENTS.md`, `README.md`, `package.json`, `.gitignore`,
> and `docs/`. To update the tooling, bump the dependency (`npm i @sail.money/sailor@latest`), not by
> pulling the source repo.

## What this owns

The operating guide and map. Sailor runs a self-custodial SMA whose agent executes only within a
mandate the Sail kernel enforces on every dispatch — fail-closed and revocable in a block. This skill
names the five stations (owning skill, entry gate, exit verifier), the anytime utilities, and the six
safety invariants. **Load it first on every session, before responding or running any command, and
whenever unsure which station you are in.**

What can be built here (common shapes, not the boundary): **trading** (spot, DCA, rebalancing),
**yield** (lending, borrowing, LP, staking, looping), **payments & treasury** (transfers, scheduled
moves) — or anything else on-chain, because permissions are arbitrary Solidity.

## The five stations

Work moves through five stations, in order. Each names its owning skill (read it on arrival), its entry
gate (check it; if it fails, go back), and its exit verifier (pass it before moving on). Skipped gates
become expensive backtracking.

**Two state roots — live and sandbox.** State lives in a `SAIL_DIR`: `.sail/` (real chains, real funds)
by default, or `.shipyard/sandbox/` (the native sandbox — local anvil forks, zero funds, rewindable —
reached via `sailor sandbox start` or the dashboard's **"Enter Shipyard"** link). Stations 1–4 can run
entirely in the sandbox before going live. **`sailor status`/`doctor` and all `.sail/` reads hit the
live root only** — a sandbox-onboarded project looks empty to a `.sail/` read. Check
`.shipyard/sandbox/account.json` too, and read sandbox state with `SAIL_DIR=.shipyard/sandbox sailor <cmd>`.
`sailor-onboarding` owns the detection logic. (This is distinct from the external Shipyard CLI's
`shipyard attach`/`wrap`, which injects its own `SHIPYARD.md` + managed AGENTS.md blocks.)

**1. ARRIVE — set up the project, keys, account, and chain.**
Skill: `sailor-onboarding` · Gate: none (entry point) · Exit verifier: `sailor doctor` green (RPC
connected, chain-id matches, keys present, gas funded).

**2. STRATEGY — make the user's intent concrete.**
Skill: `sailor-strategy` — owns both artifacts: the **intent** (one spec per strategy at
`.sail/strategies/<name>.md`) and the **execution config** (`.sail/strategies/strategies.json`). ·
Gate: doctor green · Exit verifier: each spec's completeness checklist fully satisfied — addresses,
pools, caps reviewed by the user AND persisted — AND `strategies.json` created. Do not begin mandate
work from a vague strategy.

**3. MANDATE — turn the strategy into enforced bounds.**
Skill: `sailor-mandate-planner` — routes each action to a shared template (`sailor-templates`) or
bespoke authoring (`sailor-mandates`). · Gate: a complete spec for every strategy the mandate will
bound · Exit verifier: every permission registered AND `sailor mandate simulate` passing must-pass and
rejecting must-fail samples, AND `sailor mandate sign` writing `.sail/mandate.json`. Ordering: bespoke =
deploy → simulate → register; shared = register → configure → simulate (an unconfigured singleton denies
every call).

**4. AGENT — build the brain.**
Skill: `sailor-agent-build` (dispatch mechanics: `sailor-transactions`; memory: `sailor-memory`) · Gate:
registered, simulated, signed mandate (`.sail/mandate.json` exists) · Exit verifier: `sailor run --once`
completes cleanly against the live mandate.

**5. SAIL — launch, operate, and own the ending.**
Skills: `sailor-automation` (run unattended), `sailor-operate` (monitor, tune bounds, pause/resume,
revoke, exit and withdraw), `sailor-extend` (notifications, custom dashboard — optional) · Gate: a clean
`run --once`, AND the SMA funded with the strategy's trading capital — do not launch unattended before it.

## Anytime utilities (not stations — load whenever needed)

- `sailor-project-info` — read-only answers about state, account, mandate, chains, keys.
- `sailor-servers` — the local dashboard and signing server.
- `sailor-token-resolve` — token symbol/address → on-chain address + decimals + liquidity. Run before
  binding any token into a strategy or mandate.
- `sailor-swap-quote` — live swap quote + the slippage-adjusted amountOutMinimum floor.
- `sailor-risk` — the technical risk assessment, called at approval moments (`sailor-strategy` Act 3,
  `sailor-mandate-planner`, and when `sailor-operate` widens bounds).

## Invariants — never violate these

1. **Bespoke permissions: deploy → simulate → register.** Registration is authorization; nothing is
   authorized before its bounds are proven, including proven to reject what they must reject.
2. **Never widen a mandate without the user's explicit, informed approval.** Before any signature, state
   plainly what the change permits the agent to do.
3. **A denied dispatch is the system working, not an error.** Read the denial reason, adjust within
   bounds, or ask the user to change the bounds deliberately. Never route around the kernel.
4. **Registering permissions costs an onchain fee** — disclose it before asking for a registration
   signature (current rate: see `sailor-mandates`).
5. **Read `.sail/` before asking.** State lives on disk (`config.json`, `account.json`, each strategy's
   spec under `strategies/` + `strategies.json`, `mandate.json`, `session.json`, `activity.jsonl`) — never
   make the user repeat what the harness already knows. `keys/` and `.env.local` hold secrets — never
   print or commit their contents.
6. **Never ask for, accept, or use a private key — the owner's or anyone's — under any circumstances.** A
   private key is total, unbounded authority; handing one over defeats the entire mandate model. The owner
   keeps their key; the agent has its own separate, mandate-bounded signing key (created at Station 1).
   When blocked, stay inside the mandate: grant the agent's own bounded approval where one exists, widen
   bounds with the owner's explicit in-wallet signature (invariant 2), or report the honest failure and
   stop (`sailor-operate`'s denial ladder) — never credentials.
