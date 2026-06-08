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

## How to run

### Product path — what a real session uses (PREFER THIS)
One command serves the new UI (built `packages/ui/dist`) + its API on a single port:
```sh
cd test/my-agent          # the project dir (has .sail/)
sailor ui                 # → http://localhost:33xx  (auto-picks a free port)
sailor ui status          # show it / sailor ui stop to stop
# direct (no global bin): node Sailor/packages/cli/dist/index.cjs ui
```
`sailor ui` spawns the CLI's **bundled** `packages/cli/dist/server.cjs` (NOT `packages/ui/server.js`
directly) and serves `packages/ui/dist`. So after editing `server.js` or any UI source, the bundle is
stale until you rebuild:
```sh
cd Sailor/packages/ui  && npx vite build      # refresh packages/ui/dist
cd Sailor/packages/cli && npm run build        # re-bundle index.cjs + server.cjs  ← easy to forget
```
> The "old UI" symptom (new buttons 404, missing features) = a stale `packages/cli/dist/server.cjs`.
> The fix is always: rebuild both, then `sailor ui stop && sailor ui`.

### Dev path — only while actively editing UI source (HMR)
```sh
cd Sailor/packages/ui
SAIL_DIR=../../../test/my-agent/.sail PORT=3334 node server.js &   # API
npx vite --port 3700 &                                            # Vite (proxies /api → :3334)
# open http://localhost:3700 ; restart node server.js after server.js edits (not hot-reloaded)
```

> **Full project audit:** see [AUDIT.md](./AUDIT.md) — design + structure + bug
> findings, prioritized. Read it before picking up the next phase.

## Done (highlights, latest first)
- **Header "resync" control + real auto-refresh** — added a terminal-styled `resync`
  button (JetBrains Mono, lowercase, spins while working) in the dashboard top bar that
  HARD-refreshes (clears Cache API + `location.reload()`). Plus the auto-refresh now
  actually works: tab refocus / visibility → full `loadLive()` (same as a reconnect),
  a 15s background overview poll, and `loadLive` reads the overview with `?fresh=1` so
  every load/reconnect/refocus shows current on-chain state. No more disconnect/reconnect
  to refresh. (`Dashboard.jsx` header + `hardRefresh` + the auto-refresh effect.)
- **CAUTION / fixed: corrupted `dist`** — running `vite build` while a dev `vite` is also
  running (or two builds racing) can leave `dist/index.html` pointing at a bundle hash that
  isn't in `dist/assets/`. The server then SPA-falls-back to index.html for the `.js`
  request → MIME mismatch → blank page that looks "stale/broken". Fix: `pkill -f vite`,
  then ONE clean `rm -rf dist && vite build`, verify index.html's bundle == a file in
  dist/assets, then `sailor ui stop && sailor ui`. Never build while a dev vite is up.
- **Live balance auto-refresh** — fixed the "had to disconnect/reconnect to see new
  funds" bug. `loadLive` only ran on mount/connect, so balances froze. Added: a 15s
  overview poll + a FRESH on-chain refetch on window focus / tab-visible
  (`Dashboard.jsx`), and a server `GET /api/overview?fresh=1` that bypasses the 10s
  stale-while-revalidate cache and recomputes synchronously. Verified: `?fresh=1`
  returns current on-chain balances live; the built bundle ships the focus/visibility
  listeners + 15s poll. **Reminder: this is a server.js change — `sailor ui` needs the
  CLI rebuilt** (done this session).
- **Mandate-authoring ENGINE (chat-driven, no dashboard button)** — per explicit product
  direction (2026-06-07): mandates are created through the **AI chat origination flow**, NOT a
  button/form on the dashboard. The manual "+ New mandate" button + its modal wiring were
  REMOVED from `Dashboard.jsx`. What remains is the reusable on-chain ENGINE the chat will
  drive: `useCreateMandate` + `/api/account/build-deploy-mandate` + `/api/mandate-templates` +
  `/api/account/mandate-complete` (+ the proven `build-reattach`/`-tx` register path). The
  `CreateMandateModal.jsx`/`.module.css` files remain on disk **unwired**, staged as a possible
  chat-triggered review/sign surface (delete if the chat goes fully inline). The engine flow:
  permission contract (`/api/account/build-deploy-mandate` encodes the Foundry artifact
  from `<project>/out/<Name>.sol`), then signs + submits the registration (reuses the
  proven batch `build-reattach`/`build-reattach-tx` path). `/api/account/mandate-complete`
  records it (state/mandates.json + activity). New `useCreateMandate` hook;
  `GET /api/mandate-templates` discovers compiled `*Permission*` artifacts + their
  constructor inputs; the form is raw constructor fields (per the chosen UX). On Base only
  `BoundedCallPermission` is compiled (no on-chain templates/clone impls yet — deployments.ts
  `knownTemplates: []`), so deploy-a-compiled-artifact is the only real path. Endpoints
  verified live (templates + valid creation bytecode for the USDC-approve params); the full
  on-chain deploy+register was NOT run (real gas on mainnet — left for the user to drive).
  **NEXT: wire this same engine into the chat→dashboard origination layer** (user asked for
  the button now + chat next).
- **Pending-signing receipt check** (AUDIT bug #3) — `PendingSigningModal` now awaits the
  tx receipt (chain-pinned) and throws on `reverted` before signalling `signed`; new
  `confirming` phase. Also fixed bug #7 (stale error banner reset on re-open).
- **Real revoke** — "Revoke" is now a real owner-signed `kernel.revokePermissions`,
  not theater (was AUDIT bug #1). Mirrors rotation: server builds the EIP-712
  `RevokePermissions` typed-data + calldata (`/api/account/build-revoke`,
  `/build-revoke-tx`, `/revoke-complete`); owner signs + submits from their wallet;
  on a confirmed receipt a `permission_revoked` event is logged + the overview
  cache busted, then `loadLive()` re-reads `getPermissions` so the row flips to
  Revoked from on-chain truth. New `useRevokePermission` hook; `ContractModal.revoke()`
  is async — the REVOKED stamp plays only **after** confirmation, with live wallet/tx
  status + a Try-again error state. Endpoints verified live (typed-data + calldata
  + selector `0x71859e53` against the Base kernel `0x6319…`); the on-chain tx itself
  was NOT executed (would irreversibly remove the live demo mandate — left for the
  user to drive in-browser). Also fixed AUDIT bug #6 (stale Escape `phase` closure).
- **Manager-key rotation UI** — shipped + verified live on Base mainnet (rotated
  `0x6AE4…` → `0x3665…`, both txs succeeded, mandate re-bound). Dashboard-native,
  owner-signed: server builds calldata (`buildSetManagerExecTransaction`,
  `buildRegisterPermissionsBatchTypedData`), owner submits via wagmi. `RotateSignerModal`
  + `useRotateSigner` + 6 `/api/account/*` endpoints. Re-attach is owner-submitted
  (dissolves the unfunded-agent gas gotcha).
- **Fund (receive-ETH) CTA + modal** — one calm "Fund" link on the SMA hero + both
  operator wallet cards → `FundModal` (network · full address · copy · warning).
- **Mandate history ledger** — `buildMandateLedger` (server.js) derives real per-mandate
  status (active/revoked) + dates from `state/mandates.json` + `activity.jsonl` +
  on-chain `getPermissions`. Mandate switcher (All/Active/Revoked/Expired). Active
  mandates fly the animated **Sai** mascot (leading avatar).
- **Design-direction fixes** — Rotate/Fund modals + `WalletAddress` made sharp/flat/mono
  (no glass, no amber, no em-dashes). RPC badge de-jargoned → calm "Connected · Base".
- (Earlier) Next→Vite transplant; live `/api`; RainbowKit; real SMA deploy + mandate
  register; AutomationSection; honest funding pills; live activity + created-date.

## Next phase — the chat-driven creation UX (primary goal for a fresh chat)
Build the **full creation experience the framework intends**: create a new SMA → create
mandates → automate → connect RPC, **driven through the AI chat ↔ dashboard loop**.
Today (see AUDIT §5) the *reflect* half is done (dashboard live-mirrors daemon-pushed
signing requests + drafts and signs them); the *origination* half is missing — there's
**no in-product mandate authoring** and **no embedded AI/chat** (drafts come from the CLI).
Close that gap: browser mandate authoring + real on-chain registration, and the
chat→dashboard origination flow.

## Highest-priority fixes before/with that (from AUDIT.md)
1. **Deferred-reattach mislabeled `revoked`** in the ledger after rotation. (AUDIT bug #4.)
2. **Design sweep** of the un-converted Tier-1 modals + kill green/amber hue leaks. (AUDIT §3.)
3. **Hygiene** — delete dead code, decompose `Dashboard.jsx` (1.7k lines), rename
   `useMockSigner`→`useWalletSigner`, add lint/typecheck. (AUDIT §4.)

Already fixed: in-browser mandate authoring + pending-receipt (bug #3) + stale-error
(bug #7) + real revoke (bug #1) + Escape `phase` closure (bug #6) this session; the
mandate-ledger cross-SMA leak (bug #2) earlier.

## Known gotchas
- **`/api/overview` is cached** at `.sail/state/overview/<safe>.json` (stale-while-revalidate).
  After a `server.js` change to the overview payload, `rm` it (or fetch twice) to see fresh data.
- `server.js` is **not** hot-reloaded — restart it after editing.
- The dashboard's `sma`/`gas` are **null** until a wallet connects (ConnectGate); props rendered
  outside the gate must optional-chain.
- **Phantom can't be made to switch accounts from the dApp** — switch inside the extension.
- Register/re-attach needs the **manager funded** (it submits + pays gas) unless owner-submitted.
- `repoUrl` in agent-status is null because `test/my-agent` isn't a git repo.

## Known gotchas
- **Phantom can't be made to switch accounts from the dApp** (ignores
  `wallet_requestPermissions`/`revokePermissions`). Real switch = change the
  active account inside the Phantom extension (wagmi follows `accountsChanged`).
- Register step needs the **manager funded** (it submits + pays gas) and the
  agent-key passphrase (empty here).
- `repoUrl` in agent-status is null because `test/my-agent` isn't a git repo.
