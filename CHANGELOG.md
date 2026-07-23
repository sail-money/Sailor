# Changelog

All notable changes to Sailor are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.1] - 2026-07-23

### Added

- Robinhood Chain (4663) registered end-to-end: SDK chain/deployment registries, CLI viem chain
  map and mainnet lists, dashboard wagmi config and SMA-discovery, docs (`deployed.json`, README,
  AGENTS, scaffold skills) now count 12 chains, and a dashboard/onboarding chain glyph with the
  traced feather mark (`#ccff00`).
- A centralized chain-presentation layer (`packages/ui/src/lib/chains.js`,
  `chainPresentation.js`) so the dashboard, onboarding wizard, and RPC section read chain
  metadata from the SDK registry instead of duplicated per-component chain lists.
- `classifyPermissionFailure()` gives plain-language headlines for two kernel reverts that read
  alike but need opposite advice: a stale-nonce signature collision vs.
  `PermissionAlreadyRegistered`. The raw revert message still shows below it.

### Fixed

- `sailor mandate deploy-clone`: the signing deadline is now checked for staleness right before
  broadcast (`assertSignatureFresh`), and a reverted `deployAndAttach` decodes the actual revert
  reason instead of reporting a bare "reverted (tx ...)".
- Mandate tracking now re-syncs attach/registration state from on-chain data at mine-time instead
  of trusting local state alone.
- Dashboard dispatch rows are valued from their decoded call amount; previously every dispatch
  showed $0.00 regardless of the actual transferred value.
- Dashboard RPC config: added the Alchemy RPC host for Robinhood Chain.

## [2.0.0] - 2026-07-03

### Fixed

- Permission probing, `sailor mandate simulate`, and `sailor run` single-call dispatch now encode
  the current 9-field `Context` (protocol #59, `configEpoch`) and read the live registration
  epoch per permission. Previously the probe hit a stale ABI selector, so simulate falsely
  reported reverts and the agent runner silently skipped dispatches against live deployments.
  Scaffold-generated and example interfaces carry the corrected struct. (#189)
- Stale references inside the scaffolded skills: links to skills that don't exist
  (`sail-lifi-swap`, `sail-pendle`) now route to `sail-mandates`; a worked-example filename
  mismatch and a dangling `AGENT_PLAYBOOK.md` pointer were corrected.
- Repository metadata: SDK `repository`/`bugs` URLs point at the `sail-money` org; protocol-repo
  links standardized to <https://github.com/sail-money/protocol>; stale fee-cap comment corrected
  (the governance cap is 0.01 ETH).

### Changed

- The worked example permissions (`permissions/`, `custom-mandate/`) moved into the scaffold
  template (`templates/default/examples/`). `sailor init` output is unchanged — every project
  still receives them at `examples/` — but the template tree is now the single source of truth
  for scaffold content.
- npm package slimmed: dev-only check scripts and repo-facing docs are no longer shipped in the
  tarball.

### Removed

- The unmaintained LLM onboarding-eval harness (`evals/`), the redundant repo-root copy of the
  permission-model doc (the scaffold's copy ships with the template), and the reference-only LiFi
  clone-permission sources (deployed addresses remain in the SDK deployment registry).

### Added

- Community and contribution files: `CONTRIBUTING.md`, `SECURITY.md`, issue and pull-request
  templates, this changelog.
- Repo-facing documentation set under `docs/`: getting started, CLI reference, SDK usage, Docker
  guide, templates & skills overview, and architecture.

## [1.2.0] - 2026-06-15

Baseline release prior to this changelog. See the git history for earlier changes.
