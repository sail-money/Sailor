# Changelog

All notable changes to Sailor are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-08-11

### Added

- **Shipyard**, a simulation sandbox. `sailor sandbox start` (alias `sailor shipyard`) forks the
  real chains locally with anvil and serves a second dashboard, on its own port and rooted at
  `.shipyard/sandbox/`, entirely separate from live `.sail/` state. The Sail contracts and chain
  state are the real ones, carried in by the fork; only the money is fake, so an agent can be
  taken through deploy, register, configure, and run without spending anything. Requires Foundry.
  Chain state is saved on stop and resumes on the next start. Documented in
  [docs/shipyard.md](docs/shipyard.md).
- `sailor sandbox stop --keep-forks` stops the dashboard but leaves the forks running.
- `sailor doctor` reports whether `anvil` is on `PATH`. Shipyard is optional, so its absence is
  informational and does not affect the overall health verdict.

### Changed

- `sailor sandbox start` now checks for Foundry before starting anything, instead of reporting
  success in the terminal and failing later in the browser when the first fork is provisioned.
- The Shipyard invitation moved from the onboarding welcome screen to the dashboard's mandates
  page, where there is a mandate worth rehearsing. New users are no longer steered into a
  simulation before they have set anything up.

### Fixed

- `.shipyard/` is git-ignored. The sandbox writes an SMA record, `.env.local`, keys, and
  multi-megabyte chain-state dumps there, none of which should ever be committed.
- Robinhood Chain can be forked. The network picker is built from the SDK chain registry, which
  had gained Robinhood, while the fork engine's own chain table had not: selecting it failed with
  `Unsupported sandbox chain id: 4663` at fork time. A test now pins the two lists together in
  both directions, so a chain offered to users that cannot be forked (or the reverse) fails CI
  instead of a first run.

## [2.1.3] - 2026-07-31

### Fixed

- The dashboard no longer ships a placeholder WalletConnect project id
  (`sailor-local-dev`). WalletConnect needs a *registered* Reown project id — the
  relay answers 403 to anything else and then can never produce a pairing URI, so
  choosing "WalletConnect" in the connect modal highlighted the row and then did
  nothing (no QR, no error). When no valid id is configured, WalletConnect is now
  omitted and the modal offers injected browser wallets plus `safeWallet` (which
  speaks the Safe Apps SDK over the iframe and needs no relay) instead of a dead
  row. The id is read at runtime from `.sail/.env.local` (injected as
  `window.__SAILOR_CONFIG__`, since the published `dist` freezes build-time env
  vars) and shape-checked as 32 hex characters. (#216)

### Added

- A WalletConnect setup step in the onboarding wizard (`WalletConnectSetup`), with
  `GET`/`POST /api/wallet-config` endpoints that persist `WALLETCONNECT_PROJECT_ID`
  to `.sail/.env.local` and surface the server's validation message on a
  mis-pasted id. `scaffold/.env.example` documents the (optional, public,
  non-secret) variable. (#216)

## [2.1.2] - 2026-07-30

### Changed

- Sailor now targets `WithdrawPermission` **v2** at
  `0xB8A6CC40466c0C33a230f87a1EBC368568B96269`, deployed on all 12 supported chains, replacing
  the v1 template at `0xF5eF5dda450a130e3020d54f565E830e4a7531f8`. The SDK deployment registry
  and the scaffolded `deployed.json` both carry the new address.
- The gated selectors changed from ERC-20 transfers to protocol exits. v1 gated
  `transfer`/`transferFrom` to a single pinned `allowedRecipient`; v2 gates ERC-4626
  `withdraw(uint256,address,address)` and `redeem(uint256,address,address)` plus Aave v2/v3
  `withdraw(address,uint256,address)`. Proceeds are pinned to the account itself — on the
  ERC-4626 paths both `receiver` and `owner`, on the Aave path `to` — so the template exits a
  position rather than paying an external address. Moving funds out to a fixed recipient is now
  `TransferPermission` with a one-entry recipient allowlist.
- The config tuple changed from `(address[] tokens, address allowedRecipient, uint256
  maxAmountPerTx)` to `(address[] targets, address[] tokens, uint256 maxAmountPerTx)`. The token
  allowlist is consulted on the Aave path only, where the asset appears in calldata; ERC-4626
  vaults are constrained by the target allowlist alone.
- The per-transaction cap is denominated per path: assets on ERC-4626 `withdraw` and on Aave,
  and **shares** on ERC-4626 `redeem`, whose underlying value floats with the share price.
- Withdraw probes, the configure signing card, the withdraw skill, and the strategy routing
  tables were rewritten for the new contract. Routing prose that previously sent vault exits to a
  bespoke permission, or sent single-recipient payouts to the withdraw template, was inverted and
  is now corrected.

### Removed

- v1 `WithdrawPermission` support. No user ever deployed or configured v1, so it is removed
  outright with no compatibility path, no deprecated registry entry, and no v1 config layout.

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
