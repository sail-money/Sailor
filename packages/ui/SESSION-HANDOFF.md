# Sailor UI — session handoff

Continuation notes for picking this up in a fresh chat. The work lives in
`Sailor/packages/ui` (branch **`feat/ui-ux-overhaul`**).

## What this is
A UI/UX overhaul of Sailor's local dashboard. The new design (originally a
Next.js app, `0xRcap/sail-local-ui-1.2`) was **transplanted into the framework's
Vite shell** at `packages/ui` and wired **live** against a real SMA on **Base
mainnet**.

## Architecture
- **Vite + React 18 SPA** (`src/main.jsx` = hash router; `App.jsx` = landing;
  `src/pages/dashboard/Dashboard.jsx` + `src/pages/signing/Signing.jsx` = the two
  real surfaces). Served in prod by `server.js` (Express `/api` + static dist).
- **Data seam** `src/data/sailorClient.js` — `USE_LIVE = true`; proxies to the
  real `/api` (server.js). All account/overview/mandate/activity/positions/
  agent-status/onboard reads + the deploy/register/rename writes.
- **Mock seam** `src/data/studioClient.js` — ONLY the explorer-URL helpers +
  `getOwnerProfile` (returns null) remain. The fully-mock pages
  (AgentPage/MandatePage/JournalPage) were **deleted** (dead code, no endpoints).
- **Wallet seam** `src/hooks/useOwnerWallet.js` (wagmi + RainbowKit),
  `useMockSigner.js` (LIVE wagmi despite the name), `useDeploySma.js` (real
  on-chain SMA deploy), `useOwnerSafes.js` (live `getAccounts()`),
  `useSigningChannel.js` (LIVE WebSocket to the signing daemon via
  `/api/station/ws`).
- **Shared** `src/pages/shared/InfoTip.jsx` — reusable tooltip (portaled to
  `document.body`, viewport-clamped).

## Live project state (real, on Base mainnet, chainId 8453)
Project dir: `../../../test/my-agent` (NOT a git repo; secrets stay local).
- **SMA (Safe):** `0x39EB3437DC9294e71B562374A85AC1E3957bd826`
- **Owner (your wallet):** `0x39D6Eed80f0Bd6fA73b99438573c717Ed8895b52`
- **Manager (agent wallet):** `0x6AE45525a4746D2D55F37Da7BC2D34ea42044C64`
  — keystore at `.sail/keys/manager.json`, **empty passphrase** (created before
  the password wiring; `SAIL_PASSPHRASE` is irrelevant to it — use `""`).
- **Mandate:** `BoundedCallPermission` at
  `0xc61d2fb67cff91448d7c8b5311dc2b5d200152f4` — permits USDC `approve` only.
  Registered on-chain (tx `0x059ad6…`).
- **Session:** `sessionActive = false` (paused). Resume with
  `sailor session resume` to let the agent dispatch.
- **Secrets** in `test/my-agent/.sail/.env.local` (gitignored, local only):
  `RPC_URL=https://base-mainnet.g.alchemy.com/v2/…`, `CHAIN_ID=8453`.

## How to run (restart after a fresh session)
```sh
# 1. API server (reads the my-agent project's .sail state)
cd Sailor/packages/ui
SAIL_DIR=../../../test/my-agent/.sail PORT=3334 node server.js &

# 2. Vite dev (proxies /api → :3334, incl. WebSocket /api/station/ws)
npx vite --port 3700 &
# open http://localhost:3700
```

## Done this session (highlights)
- Transplant Next → Vite; live `/api`; RainbowKit wallet; real SMA deploy +
  mandate register on Base mainnet (full owner-signed flow).
- Killed mock leaks: live `useOwnerSafes`, honest mandate rows, real chain
  labels, deploy preview de-Arbitrum'd. Deleted Agent/Mandate/Journal pages.
- Real 3-state funding pills (Funded / Low balance / Not funded) — big-blue /
  small-yellow / red-no-dot.
- Live Recent Activity (real event fields + tx links).
- Removed all fabricated network/asset/provider logos → names only.
- Live created-date (block→timestamp). SMA rename wired (`/api/account/rename`).
- InfoTips on jargon (SMA, session, manager/owner, mandate, RPC, onboarding).
- **AutomationSection** (new) on the SMA hero: live `/api/agent-status`, 3-state
  (Running/Scheduled/Configured), schedule parsed from the real workflow cron,
  run methods (GitHub Actions + setup steps / Local / self-hosted), AI-edit prompt.

## Pending / next tasks
1. **Manager-key rotation UI** — real protocol feature: `sailor account
   rotate-signer` → kernel `setManager(newManager)` (SDK `encodeSetManager` /
   `buildSetManagerExecTransaction`). ⚠️ **`setManager` CLEARS all attached
   mandates (fail-closed)** + bumps nonce epoch — owner signs in browser. Add a
   "Rotate" action on the Manager card with a clear warning + re-register flow.
2. **Surface protocol multi-agent capability** — the SMA's manager can be a
   multisig routing to multiple agents. Current runtime runs one `src/agent.ts`;
   reflect the protocol possibility without faking agents.
3. **Complex mandate** — fund the SMA + manager, author a richer permission.
4. More InfoTips (pending-signing modal, funding states) — optional.
5. **Cleanup:** orphaned `smaBalancePillClass` + unused glyph components
   (`ChainGlyph`, `RpcGlyph`, `WalletGlyph/WalletGrid`) in Dashboard/Signing.

## Known gotchas
- **Phantom can't be made to switch accounts from the dApp** (ignores
  `wallet_requestPermissions`/`revokePermissions`). Real switch = change the
  active account inside the Phantom extension (wagmi follows `accountsChanged`).
- Register step needs the **manager funded** (it submits + pays gas) and the
  agent-key passphrase (empty here).
- `repoUrl` in agent-status is null because `test/my-agent` isn't a git repo.
