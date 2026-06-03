# mvp-fixes — Change Summary for Team Review

This branch prepares Sailor for MVP testing. All changes are in the Sailor repo only —
the deployed protocol contracts on Base and Arbitrum are untouched and immutable.

10 commits since base (`cb21c06`). Test on Base mainnet — see testing notes at the bottom.

---

## Commits at a glance

| Hash | What |
|---|---|
| `718111b` | fix: correct dispatchModel labels (on-chain verification) |
| `99f473d` | feat: runnable DCA agent (tsx loader, conjunctive dispatch, slippage) |
| `91c29c0` | fix: mandate-signer verification (security fix) |
| `811d224` | feat: BoundedCallPermission + general permission-authoring methodology |
| `285689a` | feat: protocol-specific permission examples library |
| `bc77cf5` | fix: UX fixes (network confirm, strategy questions, doctor summary, passphrase) |
| `1a35054` | fix: UI terminology, gas warning, post-signing success, Arbitrum event bug |

---

## 1. Dispatch model — on-chain verified (`718111b`)

**Problem:** The SDK marked Base (8453) and Base Sepolia (84532) as `dispatchModel: "selective"`
in static config. On-chain verification via `DISPATCH_TYPEHASH` confirmed:
- Base 8453: conjunctive (0x7510c80e...)
- Base Sepolia 84532: conjunctive (0x7510c80e...)
- Arbitrum 42161: selective (0xbe50c539...)

The mismatch caused every dispatch to use the wrong EIP-712 type string, reverting with
`InvalidManagerSignature`. This was the root cause of "not working."

**Fix:** Static labels corrected to match on-chain reality. `detectKernelCapabilities` reads
on-chain first and always overrides the static label — the static value is a fallback only.
PENDING post-Octane redeployed addresses are commented in both files (do NOT activate until
timelock allowlists are confirmed populated — `createAccount()` will revert).

`eip712.ts`: `buildRegisterPermissionTypedData` now branches on `hasDeadline` from kernel
capabilities — conjunctive kernels get the no-deadline variant, selective get the with-deadline
variant. The `onboard.ts` registration path calls `detectKernelCapabilities` before building
typed data.

---

## 2. Runnable DCA agent (`99f473d`)

Four blockers found during end-to-end testing on Base mainnet:

**Blocker 1 — TypeScript loading:** `sailor run` couldn't import `.ts` agent files. Node 22's
native TS support doesn't resolve `.js` → `.ts`. Fix: added `tsx^4.22.4` as a CLI dependency;
`loadAgent()` now uses `tsImport()`.

**Blocker 2 — Conjunctive kernel has no batch/preview:** `dispatch.batch()` and
`dispatch.preview()` throw on Base/Base Sepolia. Fix: `run.ts` detects `isConjunctive` at
startup via `readClient.capabilities()` and skips preview. Agent returns intent Dispatch objects
from `tick()` — the runner submits, the agent does not call `dispatch.single()` directly.

**Blocker 3 — Wrong SDK surface:** The DCA template imported `@sail/sdk/templates` (removed)
and called `dispatch.single()` directly. Fix: rewrote `agent.ts` and `mandate.ts` to use the
correct `@sail/sdk` and `@sail/framework` exports. `mandate.ts` now exports constants only.

**Blocker 4 — mandate.json not written:** `sailor run` gate-checks `.sail/mandate.json` but
`mandateSign` never wrote it. Fix: `mandateSign` now writes the file with schema:
`{safe, chainId, signedAt, signature, registeredOnChain, permissions}`.

**Slippage protection:** `amountOutMinimum = 0` exposed every swap to sandwich attacks. Fix:
agent calls Uniswap V3 QuoterV2 on Base, computes `minOut = expectedOut × (10000 - SLIPPAGE_BPS)
/ 10000` (default 1%), and fails closed (returns `[]`) if quote fails or returns 0.

**Verified:** `sailor run --once` on Base mainnet with zero USDC → agent loaded, read chain,
detected insufficient balance, exited cleanly without submitting any transaction.

---

## 3. Security — mandate-signer verification (`91c29c0`)

**Problem:** `sailor mandate attach` routed `RegisterPermission` EIP-712 signing to the browser
station correctly, but there was no guard verifying the signing wallet is actually the on-chain
`permissionSigner`. In test setups where owner and agent wallet were the same EOA, connecting the
wrong wallet produced a valid registration silently — no error, no warning.

**Fix:**
- Before pushing the signing request, prints:
  `"The mandate signer (<addr>) must sign in the browser — not the agent wallet."`
- After receiving the browser signature, calls `recoverTypedDataAddress()` and checks
  recovered === on-chain `permissionSigner`. Mismatch throws:
  `"Security: RegisterPermission was signed by <agent>, not the mandate signer <owner>."`
- Same guard applied to `runRevoke()` for `RevokePermissions`.
- `loadManagerSigner()` (agent wallet keystore) is called only after verification, exclusively
  for `sendTransaction` (gas payment). Never called on `signTyped()` for registration/revocation.
- Dispatch signing (agent wallet signs Dispatch in `run.ts`) is entirely unchanged.

---

## 4. Philosophy A — fully-bounded permissions (`811d224`, `285689a`)

**Decision:** Sailor helps users build permission contracts that enforce every meaningful
financial bound on-chain — not in TypeScript. The kernel checks `evaluate()` on every dispatch.
TypeScript can be updated without a signature; the permission contract cannot.

**On-chain:** allowed targets, selectors, ETH value, decoded calldata bounds (amount caps,
recipient allowlists, slippage floors, approve caps).
**Agent code only:** frequency/cadence. The chain enforces WHAT, the agent decides WHEN.

**`BoundedCallPermission.sol`** replaces `AllowlistTargetMandate.sol` as the reference primitive.
Protocol-agnostic: enforces allowed targets, allowed selectors, and max ETH value. For
calldata-parameter bounds, users write a protocol-specific permission (see `examples/permissions/`).

**`AGENTS.md` Stages 2–4** rewritten as a general permission-authoring methodology for ANY
protocol:
- Stage 2: elicit all strategy parameters (6 required questions) and protocol details before
  writing any code.
- Stage 3: three-tier authoring — (1) exact example exists, adapt it; (2) same-category
  different-protocol, re-derive the calldata decode; (3) no example, author custom from
  `IPermission` interface. All tiers require the verification gate.
- Stage 4: mandatory verification gate — decode sample calls, show pass/block table in plain
  English, get explicit confirmation before any `forge build` or deploy.

**`examples/permissions/`** — 6 protocol-specific examples across DeFi categories and chains.
Explicitly framed as Sailor recommendations, not protocol endorsements, not a closed menu.

| File | Protocol | Chain | What it enforces |
|---|---|---|---|
| BoundedSwap_UniswapV3_Base.sol | Uniswap V3 SwapRouter02 | Base | tokenIn, tokenOut allowlist, amountIn cap, slippage floor, capped approve |
| BoundedSwap_UniswapV4_Unichain.sol | Uniswap V4 Universal Router | Unichain | V4_SWAP command, currencies, amountIn cap, slippage floor (hookData not inspected) |
| BoundedBorrow_AaveV3_Arbitrum.sol | Aave V3 Pool | Arbitrum | asset allowlist, borrow cap, onBehalfOf==SMA, interestRateMode allowlist |
| BoundedTransfer_ERC20_Ethereum.sol | ERC-20 standard | Ethereum | token allowlist, recipient allowlist, amount cap |
| BoundedPerp_GMXv2_Arbitrum.sol | GMX V2 ExchangeRouter | Arbitrum | market allowlist, collateral cap, sizeDelta cap, long/short allowlist |
| BoundedBet_Limitless_Base.sol | Limitless | Base | conditionId allowlist, max stake, outcomeIndex allowlist (ABI flagged for verification) |

The `examples/permissions/README.md` opens with: *"A permission is only as strong as the
protocol is on-chain. For venues with off-chain order matching (Polymarket, Hyperliquid),
prefer fully on-chain venues where every action passes through the kernel."*

Each example header states exactly what is enforced and what is not. Partially-verified examples
(Aave selector, Limitless function) carry explicit VERIFY BEFORE USE flags.

---

## 5. UX fixes (`bc77cf5`)

- **Agent wallet gas warning:** Browser wizard now shows an amber warning after agent wallet
  creation: "Fund your agent wallet before running the agent — ~0.001 ETH / ~$3 on Base."
- **Network confirmation:** AGENTS.md Stage 0 now asks the user to confirm the configured chain
  before advancing. Does not assume Base.
- **Strategy parameters:** AGENTS.md Stage 2 now asks 6 required questions before writing any
  code: deposit token, buy tokens, weekly budget, split, slippage tolerance, minimum idle balance.
  Shows a plain-English summary and requires explicit confirmation.
- **RPC URL explanation:** AGENTS.md Stage 0 now detects a missing `RPC_URL` and explains in
  plain English what it is, why it's needed, and lists Alchemy / Infura / public Base endpoint.
- **`sailor doctor` output:** Plain-English status line printed first. The multi-permission
  bricking warning now only fires when `permissions.length > 1` — a single restrictive permission
  is correct by design and no longer triggers the warning.
- **`SAIL_PASSPHRASE` auto-read:** `loadManagerSigner()` now reads `SAIL_PASSPHRASE` from
  `.sail/.env.local` via `parseEnvFile` before falling back to an interactive prompt. Eliminates
  the passphrase-prompt-in-background-mode failure seen during testing.

---

## 6. UI terminology + Arbitrum bug (`1a35054`)

**Terminology (zero remaining occurrences confirmed across 7 files):**

| Old | New |
|---|---|
| Delegated signer/s | Agent wallet/s |
| Your mandates | Your permissions |
| Create new mandate | Register a permission |
| No mandate yet | No permissions registered yet |
| SMA (Safe) | SMA |
| Agent key | Agent wallet |
| Sail, (persona) | Sailor, |

**Modal fixes:**
- `api.sail.money` reference removed from example prompt. Replaced with:
  *"Sailor, I want to register a permission that lets my agent swap up to $100 USDC into ETH
  weekly on Base."* (DeFi-agnostic, works today without any external service).
- "Open your AI →" button replaced with "Copy prompt →" (LLM-agnostic, calls `copyPrompt()`).
  Note: "Paste this into your AI coding assistant (Claude Code, Cursor, Codex, …)."

**Post-signing screen:** After successful browser signature, `SuccessScreen` now shows:
- Permission kind: "✓ Permission registered. Your agent is authorized to dispatch within this permission."
- Other kinds: "✓ Done. The request was signed and submitted."
- Single button: "Back to dashboard →" navigating to `#/dashboard`.

**Raw error messages replaced:**
- `overview.onchainError` (previously showed raw viem transport URL error) →
  "Add RPC_URL to .sail/.env.local to see balances."
- "on-chain read unavailable" badge → clickable "Add RPC URL to enable balance tracking"
  with tooltip showing the exact `.env.local` line and a link to alchemy.com.

**Arbitrum `AccountRegistered event not found` — two root-cause bugs fixed:**

Bug 1 (simulation catch too narrow): The wizard only triggered `useRegisterPath = true` when
the simulation error matched `UntrustedFactory` selector `0xe6c4247b`. On Arbitrum's selective
kernel the factory reverts with different encoding or no error data, so `useRegisterPath` stayed
`false`. The wizard then tried `createAccount` directly, which reverted on-chain (status `0x0`),
and threw the misleading "AccountRegistered event not found" message.
Fix: `useRegisterPath = true` for ANY `sim?.error` response.

Bug 2 (wrong `registerAccount` args): Was called as `registerAccount(safe, owner, managerAddress)`
— passing the Safe address as `permissionSigner`. Correct call:
`registerAccount(owner, managerAddress, ZERO_ADDRESS)` — owner is permissionSigner, manager is
the agent wallet, `address(0)` means no fee policy.

ABI confirmed: both conjunctive and selective kernels share the same `AccountRegistered` event
signature. The bug was factory-revert detection and wrong args — not a topic0 mismatch.

---

## Known issues — deferred to next round

- `npx create-sailor-agent` returns 404 — package not yet published to npm.
  Workaround: `npm install -g sailor && sailor init my-agent`.
- Aave V3 borrow selector (0xa415bcad) in `BoundedBorrow_AaveV3_Arbitrum.sol` —
  flagged for independent verification via `keccak256("borrow(address,uint256,uint256,uint16,address)")`.
- Limitless exchange function in `BoundedBet_Limitless_Base.sol` — ABI not independently
  verified against deployed contracts. VERIFY BEFORE USE with real funds.
- `docs/PERMISSION_MODEL.md` references `AGENTS.md` correctly (fixed earlier) but has not been
  reviewed for other stale content.
- The `welcome message` suggestion (show it in raw terminal, not summarized by the coding agent)
  is a UX recommendation for the landing page copy — not a code fix.

---

## Testing notes

**Confirmed working on Base mainnet (conjunctive kernel `0xbEd6...F154`):**
- SMA deployment via browser wizard
- Permission contract compilation and deployment
- Permission registration (owner signs in browser, mandate-signer guard verified)
- `sailor run --once` — loads agent, reads chain, fails closed on zero balance

**Recommended test sequence:**
1. Clone `mvp-fixes` branch
2. `pnpm install && pnpm build && npm install -g .`
3. `sailor init my-agent && cd my-agent`
4. `sailor ui start` — connect wallet on Base, deploy SMA, create agent wallet
5. Fund agent wallet with 0.001 ETH on Base (gas for permission registration)
6. Say "start" to your coding agent — describe your strategy
7. Agent asks 6 questions, builds the permission, runs the verification gate
8. `forge build` → `sailor mandate deploy --contract <Name> --attach --sma <addr>`
9. Owner signs in browser (the signer guard confirms correct wallet)
10. Fund SMA with $10 USDC on Base
11. `sailor run --once` — confirm tick executes and swap confirms on-chain
12. Check `sailor doctor` — should show "✓ Everything looks good"

**Arbitrum:** The two-bug fix is in this branch but has not been tested live.
Test SMA deployment on Arbitrum after confirming Base works.

---

## 9. Sequential dispatch — nonce safety for conjunctive kernels (`403309d`)

**Problem found during live testing:** When an agent tick submits multiple transactions
sequentially on a conjunctive kernel (Base), rapid submission caused nonce conflicts:
"replacement transaction underpriced". The runner submitted the next transaction before
the previous one's nonce was fully propagated across Alchemy's load-balanced RPC nodes.

This affects every multi-transaction strategy on Base — not just DCA. LP management,
rebalancing, yield compounding, any tick with 2+ transactions hits this without the fix.

**Fix:** Receipt-waiting moved into the SDK runner (`packages/cli/src/commands/run.ts`),
not the agent. The agent returns intent objects only — the runner owns all submission.

After each `dispatch.single()` on a conjunctive kernel:
1. `waitForTransactionReceipt` — waits for on-chain confirmation (30s timeout)
2. 500ms pause — lets Alchemy's load-balanced nodes propagate the updated nonce

Selective kernels (Arbitrum) skip this path entirely — `dispatchBatch` handles atomicity.

The agent template (`agent.ts`) has zero nonce/receipt/sleep logic — confirmed by grep.
AGENTS.md Stage 0 updated: "On conjunctive kernels, the runner waits for each transaction
receipt before submitting the next. This is automatic — your agent does not need to manage
nonces."

---

## Live test results — confirmed on Base mainnet

**All 8 transactions confirmed on-chain in a single tick:**

| Step | Tx hash |
|---|---|
| MORPHO approve | 0x0e88fe... |
| MORPHO swap | 0x52648b... |
| VVV approve | 0x36dd2a... |
| VVV swap | 0xf393d9... |
| SYRUP approve | 0xb385d5... |
| SYRUP swap | 0x220a0d... |
| AAVE approve | 0x9c8715... |
| AAVE swap | 0x579f73... |

`dca-state.json` written after tick — 7-day gate active, next live run Monday June 16.

**GitHub Actions automation confirmed working:**
- Repo: `https://github.com/aadopii/my-agent` (private)
- Schedule: every Monday at 09:00 UTC
- Secrets: `MANAGER_KEY` (agent wallet, decrypted from keystore), `RPC_URL`
- CI run confirmed: agent loaded, checked `dca-state.json`, correctly skipped
  (< 7 days since last run), exited 0. No errors.
- First real CI DCA: Monday June 16

**Agent wallet:** `0x3dcAFBD5C040CC943eca42016749A35f94223bec`
**SMA:** `0x9D634330D5bb3858e1DB8f5a1154b808BAd92af1`
**Permission contract:** `0xcb484e304fbcaabce6eae43de9eeed4a3150121e`

## SAIL-185 Attribution

Capabilities command, doctor gas preflight, eval harness, and CI workflow authored by @dreski3.
