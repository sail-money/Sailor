# Sailor — Agent Guide

This guide is for agents operating a scaffolded Sailor project. (Contributors to the Sailor codebase: see AGENTS.md at the monorepo root.)

> **This is a standalone project, not a clone of the Sailor repo.** `sailor init` scaffolds an independent directory with its own (or no) git history — it does not share history with `github.com/sail-money/Sailor`. Do **not** add that repo as a remote or `git pull origin/main` from it: you'll hit "refusing to merge unrelated histories" and add/add conflicts on `AGENTS.md`, `README.md`, `package.json`, `.gitignore`, and `docs/`. To update the tooling, bump the `@sail.money/sailor` dependency (`npm i @sail.money/sailor@latest`), not by pulling the source repo.

## What this is

Sail Protocol is a protocol for onchain separately managed accounts (SMAs). Capital is held in a self-custodial Safe the owner controls; a designated manager — typically an autonomous agent — executes transactions within a mandate enforced by smart contracts on every dispatch. The mandate is a set of permission contracts registered against the account: the manager's signature names one registered permission as the authorizer, the Sail kernel evaluates it on every single dispatch, and the transaction executes only if the permission allows it — fail-closed, revocable in a single block. Because permissions are arbitrary Solidity, any DeFi primitive can be expressed as a permission: the protocol covers, by construction, everything DeFi can do.

Sailor is the harness. Your job, working with the user, is to take them from a strategy in their head to a live agent operating inside those bounds. By the end they will have: a self-custodial SMA at one address across the supported chains, a strategy made concrete, a mandate the kernel enforces on every transaction, and an agent running it — with the power to revise, narrow, or revoke the mandate at any time.

What can be built here — any of these, any combination, or anything else on-chain (common shapes, not the boundary):

- **Trading** — spot, DCA, rebalancing
- **Yield** — lending, borrowing, liquidity providing, staking, looping
- **Payments & treasury** — transfers, scheduled moves, operational flows

…or anything else on-chain. Permissions are arbitrary Solidity: if it's on-chain, it can be bounded.

## The five stations

Work moves through five stations, in order. Each names its owning skill (read it on arrival), its entry gate (what must already be true — check it, and if it fails, go back to the station that satisfies it), and its exit verifier (pass it before moving on). The golden path is the cheapest path: skipped gates become expensive backtracking.

**1. ARRIVE — set up the project, keys, account, and chain.**
Skill: `.agents/skills/sailor-onboarding/SKILL.md` · Gate: none (entry point) · Exit verifier: `sailor doctor` green (RPC connected, chain-id matches, keys present, gas funded).

**2. STRATEGY — make the user's intent concrete.**
Skill: `.agents/skills/sailor-strategy/SKILL.md` · Gate: doctor green · Exit verifier: `.sail/strategy.md` exists and its completeness checklist is fully satisfied — chains, tokens, venues, amounts, caps, cadence, risk bounds, exit condition, all concrete, with every resolved address/pool/cap presented to the user for review AND persisted to the file, not just one or the other. Do not begin mandate work from a vague strategy.

**3. MANDATE — turn the strategy into enforced bounds.**
Skill: `.agents/skills/sailor-mandate-planner/SKILL.md` — it routes each action of the strategy to a shared template or to bespoke authoring; mixing both in one mandate is normal. Templates: start at `.agents/skills/sailor-templates/SKILL.md` (the registry + register→configure reuse flow), then the matching spoke — `.agents/skills/sailor-template-swap/SKILL.md`, `.agents/skills/sailor-template-swap-no-oracle/SKILL.md`, `.agents/skills/sailor-template-transfer/SKILL.md`, `.agents/skills/sailor-template-withdraw/SKILL.md`, `.agents/skills/sailor-template-deposit/SKILL.md`, `.agents/skills/sailor-template-borrow/SKILL.md`, `.agents/skills/sailor-template-approve-batch/SKILL.md`. Bespoke Solidity: `.agents/skills/sailor-mandates/SKILL.md`.
Gate: complete `.sail/strategy.md` · Exit verifier: every permission registered AND `sailor mandate simulate` passing on must-pass samples and correctly rejecting must-fail samples. Ordering: bespoke permissions are deploy → simulate → register; shared templates are register → configure → simulate (registering a singleton grants nothing by itself — an unconfigured template denies every call, fail-closed). Either way, the mandate is not complete until simulate passes its must-pass samples and correctly rejects its must-fail samples.

**4. AGENT — build the brain.**
Skill: `.agents/skills/sailor-agent-build/SKILL.md` (dispatch mechanics: `.agents/skills/sailor-transactions/SKILL.md`) · Gate: registered, simulated mandate · Exit verifier: `sailor run --once` completes cleanly against the live mandate.

**5. SAIL — launch, operate, and own the ending.**
Skills: `.agents/skills/sailor-automation/SKILL.md` (run unattended), `.agents/skills/sailor-operate/SKILL.md` (monitor, tune bounds, pause/resume, revoke, exit and withdraw), `.agents/skills/sailor-extend/SKILL.md` (notifications, custom dashboard — optional) · Gate: a clean `run --once`.

## Anytime utilities (not stations — load whenever needed)

- `.agents/skills/sailor-project-info/SKILL.md` — read-only answers about state, account, mandate, chains, keys.
- `.agents/skills/sailor-servers/SKILL.md` — the local dashboard and signing server.
- `.agents/skills/sailor-token-resolve/SKILL.md` — token symbol/address → on-chain address + decimals + where the liquidity lives. Run it before binding any token into a strategy or mandate.
- `.agents/skills/sailor-swap-quote/SKILL.md` — live swap quote + the slippage-adjusted amountOutMinimum floor.

## Invariants — never violate these

1. **Bespoke permissions: deploy → simulate → register.** Registration is authorization; nothing is authorized before its bounds are proven, including proven to reject what they must reject.
2. **Never widen a mandate without the user's explicit, informed approval.** Before any signature, state plainly what the change permits the agent to do.
3. **A denied dispatch is the system working, not an error.** Read the denial reason, adjust within bounds, or ask the user to change the bounds deliberately. Never route around the kernel.
4. **Registering permissions costs an onchain fee** — disclose it before asking for a registration signature (current rate: see `sailor-mandates`).
5. **Read `.sail/` before asking.** Project state lives on disk (`config.json`, `account.json`, `strategy.md`, `mandate.json`, `session.json`, `activity.jsonl`) — never make the user repeat what the harness already knows. `keys/` and `.env.local` hold secrets — never print or commit their contents.
