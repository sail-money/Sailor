# Sailor UI — Project Audit (design · structure · bugs)

> Snapshot audit of `Sailor/packages/ui` on branch `feat/ui-ux-overhaul`, taken to
> guide the next phase: building the full **chat-driven creation UX** (new SMA →
> mandates → automation → RPC). Read alongside [SESSION-HANDOFF.md](./SESSION-HANDOFF.md).
> Synthesized from three parallel audits (design / architecture / bugs).

## Executive verdict

The app is **roughly half-finished and honestly built where it's finished.** The
dashboard *shell*, the SMA-deploy/onboarding flow, the RPC connect, the live
rotation + fund flows, and the mandate-history ledger are real and on-chain. But:

- **Design:** ~half the surfaces follow the sharp "electric blueprint" direction;
  the other half (8 modals + the signing page) still carry the **old navy / soft-corner /
  frosted-glass** language, plus two systematic **hue leaks** (green for success, amber for warn).
- **Structure:** one 1,760-line `Dashboard.jsx`, a big pile of **dead code** (6 unused
  modals, stale mock fixtures, ~10 unused server routes, a duplicate route), and a
  **misleadingly-named** live hook (`useMockSigner`).
- **Truthfulness:** the single biggest risk is that **"Revoke" is theater** — it animates
  and flips local state but does **no on-chain transaction**, so the mandate silently
  reappears as active on reload. For a product whose stated job is "see what's happening
  and stop it," this is the most important thing to fix.
- **The chat-driven model:** the *reflect* half (dashboard mirrors daemon-pushed signing
  requests + drafts, and signs them live) is **done**. The *origination* half (an
  in-product AI that authors SMAs/mandates) **does not exist** — today it's delegated to
  an external assistant via copy-paste prompts. This is the gap the next chat should close.

---

## 1 · Bug audit (prioritized)

> Build: `pnpm build` (vite) succeeds, no errors (one chunk-size perf warning). There is
> **no typecheck or lint script** and no TypeScript checking — plain JS/JSX. Adding a
> lint/typecheck pass would catch a class of these automatically.

### HIGH
1. **~~Revoke is cosmetic~~ — FIXED this session.** Wired a real owner-signed
   `revokePermissions`, mirroring the rotation pattern. Server builds the EIP-712
   `RevokePermissions` typed-data (`/api/account/build-revoke`, reads `signerNonces`
   + asserts the target is in the live permission set) and the
   `kernel.revokePermissions` calldata (`/api/account/build-revoke-tx`); the owner
   signs + submits both from their wallet (no unfunded-agent gas gotcha). On a
   confirmed receipt, `/api/account/revoke-complete` appends a `permission_revoked`
   event (tagged with `safe` + `txHash`) and busts the overview cache, then
   `loadLive()` re-reads `getPermissions` so the row flips to Revoked from on-chain
   truth. New hook `useRevokePermission`; `ContractModal.revoke()` is now async —
   the REVOKED stamp plays **only after** the tx confirms, with live wallet/tx
   status + a Try-again error state. (Also fixed bug #6 here: the Escape handler
   reads `phaseRef` instead of a stale `phase` closure.)
2. **~~Mandate-ledger cross-SMA leak~~ — FIXED this session.** `buildMandateLedger` scanned all of `activity.jsonl` without a `safe` filter, injecting other SMAs' addresses as phantom "revoked" mandates in multi-SMA projects. Now filters `e.safe === safeLower` (server.js ~L1413).

### MEDIUM
3. **~~Pending-signing tx reported "signed" without a receipt check~~ — FIXED this session.** `PendingSigningModal.handleSign` (transaction branch) now awaits `waitForTransactionReceipt` (chain-pinned `readsFor`, mirroring the hooks) and throws on `reverted` before signalling `signed` to the daemon; a new `confirming` phase shows "Confirming…" and locks the controls. (Also fixed LOW bug #7: phase is reset on re-open so a stale error banner no longer persists.)
4. **Deferred re-attach after rotation mislabeled `'revoked'`** — `server.js` (~L1437): a post-rotation "cleared, pending re-bind" mandate (recoverable) shows as terminally revoked after reload, because `setManager`'s clear never logs a detach event. **Fix:** log a `mandates_cleared_pending_reattach` event on rotation; emit a distinct `'detached'`/`'pending'` status.
5. **Wrong explorer / Safe / DeBank links for testnets + Unichain** — `mockState.js` (~L700) maps only `42161/1/8453/10` and falls back to mainnet etherscan + `eth:` Safe prefix; but wagmi enables Base Sepolia (84532), Unichain (130), Arbitrum/Unichain Sepolia, Sepolia. `RotateSignerModal.jsx` (~L352) only knows 8453/84532. **Fix:** source explorer/Safe prefixes from the wagmi chain defs; drop the silent mainnet fallback.
6. **~~ContractModal Escape uses a stale `phase` closure~~ — FIXED this session** (alongside bug #1). The keydown handler now reads `phaseRef.current` and locks on `signing`/`submitting`/`revoking`/`revoked`.

### LOW
7. `PendingSigningModal` phase not reset on re-open (stale error persists). 8. `liveStatus` code/comment disagree on non-zero "critical" SMA. 9. The "Expired" mandate filter is permanently empty (no deadline source — see Gap below) and Revoke is disabled for an expired row that can never exist.

**Top 5 to fix first:** ~~#1 revoke~~ ✅, #3 pending-receipt, #4 deferred-reattach label, #5 explorer links, ~~#6 Escape closure~~ ✅. (#2 also already fixed.)

---

## 2 · Mock-vs-real gaps (what looks real but isn't)

- **Revoke** — UI-only (bug #1 above). The most dangerous false-affordance.
- **"Expired" status** — never detected; `buildMandateLedger` only emits `active`/`revoked` (server.js: `expired` is "reserved, no deadline source"). The filter tab is dead. **Either** read each permission's on-chain deadline and classify, **or** hide the tab.
- **"Paused" status** — `MandateRow` renders it, but no live data ever produces it. Dead branch.
- **`ContractModal` scope is empty/fabricated** — `asContractMandate` hardcodes `assets:[]`, `caps:[]`, `actions:[]`, `permissionsCount:1`, and `deriveAgentAddress` builds a **fake agent address from a string hash**. Against the live `approve`-only mandate it shows empty Scope/Limits/Actions. **Fix:** populate from real permission params, or collapse absent sections.
- **`DepositModal`** — fully fake (hardcoded address, `MOCK_POSITIONS`, `setTimeout` settlement) **and** not imported. `ProfileModal` still receives dead `onDeposit`/`onWithdraw` props.
- **Recent Activity** can never show revoke/expire events because the UI never emits them.

---

## 3 · Design audit (against `DESIGN_DIRECTION.md`)

**On-direction already (don't touch):** dashboard shell, SMA hero, `PendingSigningModal`,
`RotateSignerModal`, `FundModal`, `SharedLayout`, `MandateStatus`, `WalletAddress`,
`RpcSection`, `AutomationSection`. Modal *scrim* blur is sanctioned.

**Highest-leverage cleanup — a mechanical sweep of the un-converted modals:**

### Tier 1 — whole modals still in the old navy/soft/glass language
`ProfileModal`, `ContractModal`, `DepositModal`, `EditModal`, `AIHandoffModal`,
`MandateDetailModal`, `PendingDrawer`, `PendingModal`. Each needs: (a) `border-radius
8–28px` and `999px` pills → the `--r-1/2/3/4` ladder (≤3px, no pills); (b) navy gradients
(`rgba(20,52,140)`, `rgba(8,14,26)`) + panel `backdrop-filter` → flat `--surface-800/850`
+ `--hairline` + white top rim; (c) generic `ui-monospace` → **JetBrains Mono** for
labels/addresses/calldata. `ProfileModal` and the **signing page** are the two worst files.

### Two systematic hue leaks (kill these everywhere)
- **Green for success/done/live** — `Dashboard.module.css` `.flowStep_done` (`rgba(58,200,144)`),
  `PendingModal`/`DepositModal` "ready" blocks (`rgba(95,210,138)`), `ContractModal` "signed"
  (`rgba(34,197,94)`). Direction: success = **blue that breathes**, never green. → route through `--positive`.
- **Amber for warn** — `EditModal` revoke-notice (`rgba(245,165,36)`), `ConfirmDestructiveModal`
  icon glow. Direction: warn = **neutral grey** (and destructive = red, not amber). → `--status-warn`.

### Secondary
- **Provider hue leaks** (must be monochrome white): MetaMask orange (`#F6851B`) in the
  signing page, DeBank coral / Codex green tints in Pending/Dashboard.
- **Em-dashes in visible copy** (banned; use `·`): present in `Signing.jsx`, `Dashboard.jsx`,
  `DepositModal`, `EditModal`, `ContractModal`, `MandateDetailModal`, `PendingModal`,
  `AutomationSection`, `RpcSection`, `PendingDrawer`. Do a global `—`→`·` copy pass (skip code comments).
- **`GlassCard`** is the frosted-glass anti-pattern incarnate (`22px` + `blur(28px)`); retire or reskin.
- **Red-as-dismiss** links (non-destructive "reject/dismiss" in `MandateDetailModal`/`PendingModal`) → neutral grey.
- The **signing page** (`Signing.jsx`/`.module.css`) was never converted — full sharp/flat/mono sweep needed.

---

## 4 · Structure & dead code

- **`Dashboard.jsx` is 1,760 lines.** Extract `MandateRow`, `GasCard`, `RecentActivity`/`ActivityRow`,
  `EditMandateModal`, the live→studio adapter fns (→ `dashboardAdapters.js`), and the ~25 inline
  SVG icons (→ a shared `icons.jsx`; they're re-defined across Dashboard/Signing/RpcSection/ProfileModal).
- **Dead modals (not imported):** `DepositModal`, `EditModal`, `PendingModal`, `PendingDrawer`,
  `AIHandoffModal`, `MandateDetailModal` (+ their CSS).
- **Dead client seams:** `sailorClient.getPositions`, `sailorClient.getMandate`, `_mockResolvePending`,
  and ~250 lines of stale mock fixtures (describe Arbitrum/rich templates; reality is Base/one mandate).
  `mockState.js` (744 lines) survives only for 4 URL helpers; `dashboard/mockData.js` imported nowhere.
- **Dead/legacy server routes (no UI caller):** `DELETE /account`, `POST /account`, `/account/switch`,
  `POST /activity`, `/signer`, `/manager/complete`, `/signers`, `/signer/activate`, `/mandate`,
  `/wizard-state` (GET+POST). **`/api/positions` is registered twice** (L308 & L1324) — remove one.
  (Some are CLI-shared — document or delete.)
- **Misleading name:** `useMockSigner` is the **live** wagmi signer used by deploy/rotate/pending →
  rename `useWalletSigner`.
- **Multi-SMA switch is unbuilt** — server has `/accounts` + `/account/switch`, UI lists SMAs, but
  `onSelectSafe` just closes the modal.

---

## 5 · The creation UX & the chat-driven model (the next phase)

| Flow | State |
|---|---|
| **Create SMA** (Signing wizard → `useDeploySma`) | ✅ Complete, live, on-chain end-to-end — the strongest part. |
| **Connect RPC** (`RpcSection` → `/onboard/save-config`) | ✅ Complete, live. |
| **Automation** (`AutomationSection` → `/agent-status`) | ✅ Live read-only + Stop; schedule/strategy changes are a copy-a-prompt handoff (by design). |
| **Create mandate** | ✅ **Browser authoring shipped this session.** `CreateMandateModal` + `useCreateMandate` author a permission contract from a compiled template (raw constructor fields), then bring it on-chain end-to-end: owner deploys (`/api/account/build-deploy-mandate` encodes the artifact) → owner signs + submits registration (reuses the proven `build-reattach`/`build-reattach-tx` batch path) → `/api/account/mandate-complete` records it. On Base today only `BoundedCallPermission` is compiled (no on-chain templates/clone impls — deployments.ts `knownTemplates: []`), so deploy-a-compiled-artifact is the only real path. The legacy `mandate-draft.json`/`mandate-submit` surface (CLI-written) remains for the daemon-pushed draft. |
| **Chat → dashboard** | ⚠️ **Reflect half done, origination half absent.** The dashboard live-reflects daemon-pushed `SigningRequest`s + drafts (`useSigningChannel` ↔ `/api/station/ws`, `/station/pending`, the bell/banner) and signs them with the owner wallet. But there is **no in-product AI/chat** (`/api/ai`, `/api/onboard/chat` — none exist). The "AI" is an external assistant the user pastes prompts into. |

**To reach the framework's intended chat-driven creation UX**, the next chat needs to close the
*origination* gap: an in-product surface where the AI conversation authors SMAs and mandates
(create-SMA, draft+register mandate, set automation, connect RPC) and the dashboard reflects it —
ideally an embedded SDK-backed chat, or a tightly-designed handoff to the external assistant + a
browser mandate-author flow that pushes a real `register-permission` request through the station.

---

## 6 · Suggested order to move forward

1. **Truthfulness first:** wire **real revoke** (bug #1) — it's the product's whole promise. Then bug #3 (pending receipt) and #4 (deferred-reattach label).
2. **Build the creation UX** (the new chat's mission): browser mandate authoring + real on-chain registration; flesh out the chat→dashboard origination loop; multi-SMA switch.
3. **Design sweep:** Tier-1 modal token conversion + kill the green/amber hue leaks + em-dash pass (mechanical, high visual ROI).
4. **Hygiene:** delete dead code, decompose `Dashboard.jsx`, rename `useMockSigner`, add a lint/typecheck script, fix explorer-link chain maps (#5) and the Escape closure (#6).
