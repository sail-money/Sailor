# Sailor operator surfaces → new dashboard — HANDOFF

> Continuity doc to resume this work in a fresh conversation. Read this top to
> bottom; it contains everything: repo paths, the framework contract, what's
> built, what remains (with exact specs), how to run, and the standing rules.
> Last updated 2026-06-07.

---

## 0. Standing conventions (carry these into the new conversation)

- **This is a MOCKUP build.** Skip live integrations; use static/mock state shaped
  exactly like the real API. (User's standing preference.)
- **Do NOT push to git unless the user explicitly says "push".** Commit locally freely.
- **Design system is law.** Match `DESIGN.md` / `DESIGN_DIRECTION.md` exactly:
  electric-blueprint — true black, single Sail blue `#1990FF`, sharp 0–3px corners,
  JetBrains Mono technical labels, dotted dividers, breathing/glow live states.
  Reuse `src/pages/shared/*` primitives. CSS modules only. No new colors, no soft
  corners, no pills.
- **User-facing terminology** (never the code identifiers):
  | UI term | Code id | Meaning |
  |---|---|---|
  | Owner | `owner` | The connected wallet; custody anchor |
  | Mandate signer | `permissionSigner` | Authorizes mandates via EIP-712 (= Owner here) |
  | Agent wallet | `manager` | Key that signs the agent's dispatches; encrypted on disk |
- Commit messages end with `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.

---

## 1. Repos & paths

- **Build target (the new dashboard):** `/Users/rodrigorivas/Downloads/sail_code/sail-local-ui-1.2`
  - Next.js 15 App Router. Git remote `origin = github.com/0xRcap/sail-local-ui-1.2`, branch `main`.
  - Run: `npx next dev -p 4000` → http://localhost:4000/dashboard (root redirects to /dashboard).
  - **Recurring gotcha:** if a route 500s with "Could not find the module … in the React
    Client Manifest", the `.next` cache is wedged (often from two dev servers sharing
    `.next`). Fix: `pkill -f "next dev"; rm -rf .next; npx next dev -p 4000`. Run only ONE
    dev server at a time on this dir.
- **Framework (source of truth, read-only reference):** `/Users/rodrigorivas/Desktop/sailor_newui_test/Sailor`
  - TS pnpm monorepo. Key files already read & summarized in §3.

---

## 2. The task (unchanged)

Build, in the new UI's style, the operator surfaces missing from the new dashboard
that let it actually drive the Sailor framework. Mock-backed now, **contract-shaped**
so mock→live is a near-one-line swap. Four surfaces:

1. **Network config** (RPC URL + Sail API key + chain) — persistent Settings surface.
2. **Agent wallet (manager key) generation** + funding address/balance.
3. **Wallet connect + not-connected gated state** (Owner = connected wallet).
4. **Banner → pending signing** (replaces the standalone station page) — **primary task.**

Decision taken: **Option 1 (mock, swap-ready)** — no wagmi/RainbowKit/viem installed;
everything behind a thin seam. Surface 5 (signer rotation) is deferred unless asked.

---

## 3. The framework contract (verified against source)

### Endpoints (`Sailor/packages/ui/server.js`) — all same-origin `/api/*`
- `GET  /api/onboard/state` → `{ hasAccount, hasManagerKey, managerAddress, hasRpc, rpcUrl, hasSailApiKey, chainId, projectName, kernel, safeModuleEnabler, proxyFactory, singleton, standardFeePolicy }`
- `POST /api/onboard/save-config { rpcUrl, sailApiKey, chainId }` → `{ ok }`
- `POST /api/onboard/generate-key { passphrase }` → `{ address, existed }` (returns existing if present)
- `POST /api/onboard/build-create-tx { owner, manager, chainId?, saltNonce? }` → `{ to, data, chainId, saltNonce }`
- `POST /api/onboard/build-register-path {...}` → two-step fallback (`{ deployTx, kernel }`) when kernel doesn't trust the factory
- `POST /api/onboard/complete { safe, owner, manager, txHash, chainId }` → `{ ok, account }`
- `GET  /api/account` → active SMA, 404 before it exists
- `GET  /api/overview` → `{ generatedAt, chainId, network, kernel, rpcConfigured, onchain, sma{ address,owner,manager,permissionSigner,network,registered,sessionActive,balanceWei,balanceEth,balanceStatus }, mandates[{address,name,template,network}], signers[{role:'manager'|'owner', address, balanceWei, balanceEth, status:'funded'|'low'|'empty'|'local'|'unconfigured'}] }`
- `GET  /api/station/pending` → `SigningRequest[]` (proxied from the daemon; poll ~3s)
- `WS   /api/station/ws` → same-origin relay to the signing daemon (proxy holds the secret server-side — NEVER open a raw `ws://`)
- `GET  /api/mandate-draft` → `{ account, chainId, items:[{template,params,explanation}] }` | null
- `POST /api/mandate-submit { signature, signedAt }` → persisted mandate
- (also: `/api/activity`, `/api/positions`, `/api/mandate`, `/api/agent-status`, `/api/accounts`, `/api/account/switch|rename`, `/api/signer*` for rotation)

### Signing protocol — AUTHORITATIVE (`Sailor/packages/sdk/src/signing.ts`)
`SigningRequest` = base `{ id, kind, title, description, chainId, details:[{label,value}], createdAt }`
**plus one of:**
- `{ type:'transaction', to?, value?, data }` (no `to` = contract-creation, e.g. deploy-mandate)
- `{ type:'typed-data', typedData:{ domain, types, primaryType, message } }` (message bigints are decimal strings)

`kind ∈ create-sma | deploy-mandate | register-permission | attach-mandate | revoke-permissions | set-delegate | arbitrary-tx`

WS messages:
- server→UI: `{type:'pending',requests}` · `{type:'request',request}` · `{type:'request-resolved',requestId}`
- UI→server: `{type:'signed',requestId,txHash}` · `{type:'signature',requestId,signature}` · `{type:'rejected',requestId,reason?}` · `{type:'wallet-connected',address}` · `{type:'wallet-disconnected'}`

### Signing mechanics to LIFT (`Sailor/packages/ui/src/pages/station/SigningStation.jsx`)
- tx request → wagmi `useSendTransaction().sendTransactionAsync({to,data,value:BigInt,chainId})` → `send({type:'signed',requestId,txHash})`
- typed-data → restore stringified-bigint message to BigInt, `useSignTypedData().signTypedDataAsync({domain,types,primaryType,message})` → `send({type:'signature',requestId,signature})`
- reject → `send({type:'rejected',requestId})`
- on wallet connect, relay `send({type:'wallet-connected',address})`; on disconnect `{type:'wallet-disconnected'}`
- only one signing op active at a time (disable other cards while one is submitting)

### Wallet config to MATCH (`Sailor/packages/ui/src/wagmi.js`)
RainbowKit `getDefaultConfig`, chains: base, arbitrum, mainnet, unichain(130), baseSepolia,
arbitrumSepolia, unichainSepolia(1301), sepolia. `projectId` from `VITE_WALLETCONNECT_PROJECT_ID`
(in Next that'd be `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`).

### Deploy flow (`Sailor/packages/ui/src/pages/onboarding/OnboardingWizard.jsx` ~400)
per chain: `build-create-tx` → simulate via public RPC → if revert, `build-register-path`
(deploy Safe via factory, parse ProxyCreation, then `registerAccount(owner, manager, 0x0)`) →
else direct `createAccount` → parse AccountRegistered → `POST /api/onboard/complete`.

### Station page removal — CRITICAL
Remove the standalone signing-station PAGE only. The daemon (`sailor station start`) + the
`/api/station/ws` proxy + the wallet-connected relay MUST stay — they're the bridge between
the agent/CLI and the Owner's wallet. The banner is the new front-end for that same bridge.

---

## 4. What's BUILT this pass (all mock, contract-shaped)

| File | What it is | Status |
|---|---|---|
| `src/data/sailorClient.js` | **The seam.** Every endpoint as a fn, mock-backed, `USE_LIVE` flag flips to real `/api` fetch. Mocks shaped exactly per §3. Each fn documents its endpoint. Has `_mockResolvePending(id)` test helper. | ✅ done |
| `src/hooks/useOwnerWallet.js` | Mock owner-wallet hook mirroring wagmi (`{address,isConnected,chainId,connect,disconnect}`), shared module store. Swap body for wagmi+RainbowKit later. | ✅ done |
| `src/hooks/useSigningChannel.js` | Mock signing channel mirroring `useSigningSocket` (`{status,send}`) + the exact wire protocol; `send` resolves the pending request and echoes `request-resolved`. Swap for real `useSigningSocket` over `/api/station/ws`. | ✅ done |
| `src/pages/dashboard/SettingsModal.jsx` + `.module.css` | **Surfaces 1 & 2.** Network (chain selector, RPC URL, Sail API key, health pill mirroring `sailor doctor`) + Agent wallet (generate w/ double-entry passphrase, or show address+balance+copy). Wired to seam. | ✅ done |
| `src/pages/dashboard/ProfileModal.jsx` + `.module.css` | Added a **Settings** entry (`onSettings` prop + `.settingsPill`/`.identityActions`). | ✅ done |
| `src/pages/dashboard/Dashboard.jsx` | Imports + mounts `<SettingsModal>`, `settingsOpen` state, passes `onSettings`. | ✅ done |

Verified live: profile → Settings renders correctly (network + agent wallet), no console errors.

### Added in the follow-up pass (Surfaces 4 & 3 — DONE)

| File | What it is | Status |
|---|---|---|
| `src/hooks/useMockSigner.js` | Mock signer mirroring wagmi `useSendTransaction`/`useSignTypedData` (same method names + async shapes). Resolves a fake hash/sig. Live swap = delete + use the two wagmi hooks at the call sites. | ✅ done |
| `src/pages/dashboard/PendingSigningModal.jsx` + `.module.css` | **Surface 4.** Renders each pending `SigningRequest` as a reviewable contract: KIND_LABELS, title, description, `details[]` grid, fail-closed `RevealCalldata` for tx.data / typed-data. Authorize/Reject lifted from `SigningStation` Orchestrator. Surfaces the mandate draft too (sign → `submitMandate`). Electric-blueprint. | ✅ done |
| `src/pages/shared/ConnectGate.jsx` + `.module.css` | **Surface 3.** Connect-wallet gated state (absorbs `NotConnectedCard`). Exported from `shared/index.js`. | ✅ done |
| `src/pages/dashboard/Dashboard.jsx` | Sources pending from the seam (`getPending` poll 3s + `getMandateDraft`), `useOwnerWallet` + `useSigningChannel`, relays `wallet-connected`, channel `request-resolved` drops items so the banner clears. Header shows Connect when `!isConnected`; gates the whole body behind `ConnectGate`. Mounts `PendingSigningModal` in place of `PendingModal`. Removed the dead `pendingOperations`/`asPendingItem` bridge. | ✅ done |
| `src/pages/dashboard/ProfileModal.jsx` | Added `onDisconnect` prop; Disconnect now calls `wallet.disconnect`. | ✅ done |

Verified in-browser (preview): banner → modal renders both mock requests; Authorize
(typed-data sign) and Reject both resolve through the channel and clear the banner;
multi-item phase reset works (no stuck "Waiting…"); queue-clear empty state; header
Connect button; disconnect → ConnectGate → reconnect restores the dashboard. No console errors.

**Still open (deferred, not blocking):** Surface 5 (signer rotation). Live wiring
(wagmi/RainbowKit providers + `useSigningSocket` over `/api/station/ws` + `USE_LIVE`)
per §5 "Going live later" — all shapes already match, nothing downstream changes.
The draft path is implemented but unexercised (mock `mandateDraft` is `null`).

---

## 5. What REMAINS (next conversation — exact specs)

### Surface 4 — Banner → pending signing (PRIMARY, not yet done)
Current state: `Dashboard.jsx` sources pending from `pendingOperations` (mockState) mapped via
`asPendingItem`, opens `PendingModal` → "Review mandate" → `ContractModal` whose Authorize/Reject
are stubs that just close. `ContractModal` is built around the **dashboard mandate shape**, not the
**SigningRequest shape** — that mismatch is the work.

Do this:
1. **Source pending from the seam:** in `Dashboard.jsx`, replace the `pendingOperations`/`asPendingItem`
   source with state from `getPending()` (poll 3s, mirror `useSailorPending`). Banner count = that length.
2. **Render each pending item as a reviewable SigningRequest** in `PendingModal` (or a new
   `PendingSigningModal`): show `kind` (use a KIND_LABELS map — see SigningStation.jsx:14), `title`,
   `description`, the `details[]` rows, and a **calldata reveal** (`src/pages/shared/RevealCalldata`)
   for `tx.data`/`typedData`. Keep the electric-blueprint styling. Plain-English `explanation`/`details`
   must match the calldata — fail-closed framing.
3. **Wire Authorize/Reject through the channel:** use `useSigningChannel({onMessage})` +
   `useOwnerWallet()`. Lift the exact handlers from `SigningStation.jsx` (Orchestrator, lines 172–204):
   tx → `useSendTransaction` → `send({type:'signed',...})`; typed-data → `useSignTypedData` (restore
   bigint strings) → `send({type:'signature',...})`; reject → `send({type:'rejected',...})`. In the
   mock, `useSigningChannel.send` already resolves the request + echoes `request-resolved`; on that
   message, remove it from local state so the banner clears.
   - In mock mode there's no real wallet prompt — `useSendTransaction`/`useSignTypedData` don't exist
     yet. Either stub them in `useSigningChannel`/a `useMockSigner`, or just call `send()` directly with
     a fake hash/signature on Authorize. Keep the call sites shaped like the real wagmi hooks so the
     live swap is mechanical.
4. **Mandate draft path:** also surface `getMandateDraft()` when present — review `items[].explanation`,
   sign, `submitMandate({signature, signedAt})`.
5. **Relay wallet-connected:** when `useOwnerWallet().isConnected`, `send({type:'wallet-connected',address})`
   (effect mirroring SigningStation.jsx:115–119).

### Surface 3 — finish the gated state
`useOwnerWallet` exists. Still to do: a real **"Connect wallet" gated state** for the dashboard and for
any action needing a signature (absorbs the old `NotConnectedCard`). Header should show connect when
`!isConnected`. When live: add `WagmiProvider`+`RainbowKitProvider` in a `'use client'` providers
wrapper imported by `app/layout.jsx`; deps `wagmi @rainbow-me/rainbowkit viem @tanstack/react-query`.

### Going live later (when served by the Sailor `/api` server)
- Flip `USE_LIVE = true` in `sailorClient.js` (or per-fn).
- Replace `useOwnerWallet` body with wagmi + RainbowKit; `useSigningChannel` body with the real
  `useSigningSocket` (copy `Sailor/packages/ui/src/hooks/useSigningSocket.js`, points at `/api/station/ws`).
- Add the providers wrapper + env `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.
- Nothing else downstream changes — shapes already match.

---

## 6. IA notes to resolve before live wiring
- **RPC/chain config exists in TWO places now:** the onboarding `Signing.jsx` steps (Network/RPC/Password,
  built earlier) AND the new persistent `SettingsModal`. Both should read/write the same `/api/onboard/*`
  shape (Settings already does via the seam). Keep onboarding for first-run, Settings as the durable home —
  one source of truth (the seam).
- **Agent-wallet generation** also appears in both the onboarding password step and Settings. Same deal:
  both should call `generateKey()`.
- The dashboard's existing mock mandates (`mockState.pendingOperations`, `asContractMandate`) and the real
  `SigningRequest` shape are different models. Surface 4 should standardize on `SigningRequest` from the seam.

---

## 7. Where the design system lives (quick ref)
- `src/styles/globals.css` — tokens (color, `--t-*` type scale, `--s*` spacing, `--z-*` z-index, `--r-*` radius, `--label-*`). START HERE.
- `DESIGN.md` — the formalized system (label tiers, motion, component vocabulary).
- `src/pages/shared/*` — `GlassCard`, `SailButton` (sharp, sheen), `RevealCalldata`, `ConfirmDestructiveModal`, `BrandMark`, `Sai`, `FluidBackground`.
- Reference: the existing `SettingsModal.module.css` / `PendingModal.module.css` / `ProfileModal.module.css` are the closest blueprints for any new modal.

---

## 8. First moves in the new conversation
1. `cd /Users/rodrigorivas/Downloads/sail_code/sail-local-ui-1.2 && rm -rf .next && npx next dev -p 4000` → open /dashboard.
2. Read this file + `DESIGN.md` + `src/data/sailorClient.js` + `Sailor/packages/ui/src/pages/station/SigningStation.jsx`.
3. Build Surface 4 per §5 (the primary task). Then finish Surface 3's gated state.
4. Commit locally; do not push unless asked.
