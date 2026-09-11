# Changelog

All notable changes to Sailor are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 2.3.0 — 2026-09-11

### Fixed

- Correlate portfolio outcomes by dispatch ID, consume hash-less failures once, and reject outcomes older than their intent.
- Keep retries within the configured slippage maximum; pause on missing prices and serialize settle runs.
- Verify registry artifacts before publishing; handle first releases and serialize release numbering.
- Add portfolio runtime and permission regressions to continuous integration.

### Added

- **Harbor**, a library of ready-to-run money agents. `sailor harbor list` searches the registry,
  `sailor harbor create <slug>` downloads a blueprint, verifies and imports it, installs
  dependencies, typechecks, and begins guided onboarding, `sailor harbor update` re-imports the
  latest release in place, and `sailor harbor publish` packages a project into a blueprint and
  opens a review PR into the registry (`--release` releases directly; `--local` writes a
  `.tar.gz`). Blueprints are published as GitHub releases in the `sail-money/harbor` registry.
- **Blueprint artifact contract** (`@sail/sdk/blueprint`, `sailor blueprint verify|inspect|import|start`):
  a manifest with per-file SHA-256 and a canonical-JSON self-digest; import refuses undeclared
  files, hash mismatches, unsafe paths, auto-running `package.json` scripts, and package-manager or
  agent configuration files (`.npmrc`, `.claude/`, `.vscode/`, …) in the payload, and shows a full
  write plan before touching disk. Verification is integrity, not authenticity.
- The first **ready-to-run blueprint** (`blueprints/portfolio-agent/`): a portfolio agent that deposits
  USDC into a weighted token basket across named chains, invests every deposit, rebalances toward
  target weights, and bridges USDC across chains via CCTP, with Across routes for chains CCTP does
  not reach (Robinhood Chain, in USDG). Ships with bespoke Foundry-tested permission contracts, a
  local read-only dashboard, and a three-state Telegram report.
- **Skills reorganized to a 17-skill registry** (14 core + 3 custom), recorded in
  `scaffold/.agents/skill-registry.json`. The seven per-template spokes (`sailor-template-swap`,
  `-swap-no-oracle`, `-transfer`, `-withdraw`, `-deposit`, `-borrow`, `-approve-batch`) are no
  longer skills; their procedures moved into `sailor-templates/references/`. Core skills are
  protected and update via `sailor update`; custom skills update through the Harbor registry.
- **`sailor-risk` skill** — technical risk assessment (pool depth, manipulation, approval hygiene,
  oracle trust, venue, MEV) surfaced before the user approves a strategy or mandate.
- **Token resolver** (`scaffold/scripts/resolve-token.mjs`): offline liquidity map of ~700 assets
  across eight chains, identity disambiguation for name collisions, size-aware liquidity screening,
  two-hop routing through curated via-assets, and a staleness warning with on-chain re-verification.
- `sailor mandate forget --address <addrOrName>` drops a deploy record that was never registered.

### Changed

- Dispatch gas is estimated with `eth_estimateGas` plus a 30% margin instead of a fixed 2M pin
  (the pin remains the fallback when estimation fails), so agent wallets no longer need to hold
  roughly 13× the real cost of a dispatch.

### Removed

- The Sail Intelligence API integration (`SailIntelligence`, `SAIL_INTELLIGENCE_*`, the generated
  types and the `prebuild` generator) is gone from the SDK and from `sailor capabilities`.
  **Breaking** for `@sail.money/sdk` consumers that imported it.

### Fixed

- `sailor service install` emitted `run --chain <id>`, which `run` does not accept, so every
  generated launchd, systemd, and Windows unit failed at start; units now emit `--chains`. (#225)
- `sailor keys show` (and any command that loads the keyring directly) ignored `SAIL_PASSPHRASE`
  in `.sail/.env.local`; the shared loader now injects it. (#226)
- `sailor mandate simulate` reported a false selector miss on short proxy contracts because it
  scanned the proxy's bytecode; a missing selector on short bytecode is now reported as "likely a
  proxy". (#227)
- **Portfolio blueprint runtime** (`blueprints/portfolio-agent/src/agent.ts`), from a live
  multi-chain rebalance: in-flight CCTP USDC is counted in `totalValue`; a `bought`/`sold` entry is
  written only after the runner confirms the swap, a reverted swap becomes `tradeFailed` and is
  retried with a widened slippage floor; buys are partial and sized against a shared per-chain
  budget so one tick never over-dispatches; bridges are pooled per (source → destination) and sized
  to what the source holds; a CCTP mint is recorded only when the destination `MessageTransmitter`
  reports the burn's nonce as used; Iris's `PENDING` attestation is treated as not ready; Base
  single-hop swaps use SwapRouter02 `exactInputSingle`; allowances are granted once as
  `MAX_UINT256`; an unpriceable holding (quoter failure) is now skipped for the tick instead of
  being valued at zero and re-bought.
- **Portfolio blueprint swap permission** (`ExactInputSwapPermission`): `exactInput` calldata is now
  required to use canonical ABI offsets and exact length, closing a bypass where a decoy tuple at
  the checked positions could pass while the router executed a second tuple with a different
  recipient, token, and amount. Redeploy and re-register any live instance.
- **Portfolio blueprint automation**: `scripts/run-until-settled.sh` + `scripts/settled.mjs`
  (`npm run settle`) keep ticking until nothing is in flight, understand Across fills and refunds,
  and refuse to overlap a running settle. The dashboard reads live token amounts, records its pid,
  and fails loudly on a taken port (`dashboard:start|stop|status`).
- **Portfolio Telegram report** is a three-state account (deposit, withdrawal, normal) driven by a
  flow decomposition via the `costBasis + idleUsdc` invariant, so a deposit never reads as a gain.
- `sailor share` and `sailor harbor publish` no longer pack the `.shipyard/` sandbox directory
  (keystore, identity addresses, chain-state dumps).
- `sailor harbor update` records the release tag it imported and reports "already on the latest
  release" instead of re-importing every run.
- `sailor harbor create` runs the TypeScript compiler directly for the pre-onboarding typecheck
  instead of executing the blueprint's own `typecheck` script.
- `sailor harbor publish --release --json` and `sailor harbor update --json` emit only JSON.
- Signing links use the port the dashboard actually bound, read from `runtime/ui.json`.

## [2.2.1] - 2026-08-18

### Added

- `sailor strategy` command group configures execution strategies — each binds **one executable to
  one SMA**, optionally pinned to a set of chains. Subcommands: `list`, `create` (`--sma`,
  `--executable`, optional `--chains` / `--description` / `--inactive`), `activate`/`deactivate`,
  `set-chains` (`--chains` or `--clear`), `delete`, `new-executable` (scaffolds
  `src/strategy/<name>.ts`), and `env show` / `env set` for per-chain values in
  `.sail/env/<slug>.json`. A strategy with a `chains` list replays its executable once per chain
  (**per-chain** mode); without one it runs once and the executable drives chains at runtime via
  `ctx.chain(id)` (**cross-chain** mode). Strategies are **active by default** (`--inactive` to opt
  out). An SMA can have many strategies. Stored in `.sail/strategies/strategies.json`
  (`version: 2`). The `sailor-strategy` skill owns strategy creation (intent +
  execution config); documented in `sailor-strategy/references/execution-config.md` (creation +
  config), `sailor-agent-build/SKILL.md` (run modes + per-chain `ctx.env`), and
  `sailor-automation/SKILL.md` (per-strategy scheduling).
- `AgentContext.chain(chainId)` — a per-chain handle (`{ chainId, publicClient, client, env, read,
  dispatch }`) bound to the strategy's SMA, available in every executable. Lets one `tick` read and act
  across any chain the SMA is deployed on; `dispatch(intent)` tags the intent so the runner routes it to
  that chain.
- `sailor run` falls back to a built-in public RPC from the chain registry (`getDefaultRpcUrl`)
  when no `RPC_URL` or per-chain RPC is configured, so a first run works without RPC setup.
  Explicitly configured endpoints still win, and the SSRF guard (`assertSafeRpcUrl`) applies to the
  default and configured URLs alike.

### Changed

- `sailor run` is now strategy-driven rather than `CHAIN_ID`-driven. The chain(s) come solely from
  the active strategy (its `chains` list, or the SMA's deployed set in cross-chain mode); the
  `--chain` flag and all `CHAIN_ID` / `.env.local` / `config.json` chain-id resolution were removed.
  New flags `--strategy <name>`, `--sma <address>`, and `--chains <ids>` filter which active
  strategies run. No `Default` strategy is auto-seeded: a project has zero strategies until one is
  created (via the `sailor-strategy` flow or `sailor strategy create`), and `sailor run` with none
  active reports that instead of synthesizing one.
- Scaffold skills, docs, and CI were realigned to the strategy model and no longer direct users to
  set `CHAIN_ID` for run selection: the `sailor-transactions` skill (previously showed a
  non-existent `run --chain`), `.env.example`, the `agent-tick.yml` workflow, the `docker-vm.md`
  reference, and the legacy `src/config.ts` helper. `CHAIN_ID` survives only as a default for
  helper scripts, not the runner.
- AGENTS.md is managed by the user. The onboarding process is handled from a specific skill sailor-navigator.

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
