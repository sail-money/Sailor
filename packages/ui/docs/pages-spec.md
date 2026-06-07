# Sail local pages — build spec

**Two standalone React apps bundled with the Sail Skill. Both run locally on the user's machine.**

---

## Page 1 — Signing page

### Purpose

This page appears when the user needs to:
- Log in for the first time (Privy login)
- Deploy their Safe (first signature)
- Create a new mandate (most common use)
- Modify an existing mandate

The AI conversation hands off here by opening this page (via a local URL). After the user signs, they return to the AI conversation.

### The brand contract on this page

The signing page is the **highest-anxiety surface in the product.** The user is authorizing an AI to manage their money. The brand's job here is to counteract anxiety with calm. Every design decision must ask: *"does this make the user feel more in control, or less?"*

Calm register applies everywhere: generous padding, slow animations only, no flashing, no urgency copy, no red alerts unless something is genuinely wrong. The tech register appears only in the calldata section (collapsed by default) and in Sai's pixel character.

### States

The signing page has four states. Each renders as a distinct view inside the same page.

---

**State 1 — Login**

Triggered: first-ever visit, or wallet session expired.

Layout:
- Centered single card on the dark substrate
- Sai at top center, small (64px), gently bobbing animation
- Headline (MD Nichrome): `Connect your wallet.`
- Subtext (DM Sans 16px, 72% white): *"Sail will create a Separately Managed Account you own and control."*
- Privy login modal embedded below — uses Privy's `login()` method. Privy handles the method picker (social / email / Metamask / Rabby / Phantom etc.)
- Footer line (DM Sans 12px, 45% white): `Sail never sees your keys. Privy handles authentication.`

Copy notes:
- No urgency. No "get started". Just "connect your wallet." Declarative, not salesy.
- The word "control" should appear in every state. The user must keep hearing that word.

---

**State 2 — Deploy Safe (first-time only)**

Triggered: immediately after first login, before any mandate can be created.

Layout:
- Two-panel card on dark substrate (600px wide max, centered)
- Left panel: what's happening
  - Small label (12px uppercase letter-spaced, 45% white): `CREATING YOUR ACCOUNT`
  - Headline (MD Nichrome 32px): `Deploying your SMA.`
  - Italic mannerism line (DM Sans italic 16px, 72% white): *"This is the account your AI will manage for you."*
  - Three bullet points (DM Sans 15px, 72% white):
    - `You own this account. Not Sail.`
    - `Your AI will operate inside it.`
    - `You can revoke access at any time.`
- Right panel: the transaction details
  - Small label: `WHAT YOU ARE SIGNING`
  - Transaction type: `Safe deployment`
  - Network: `Arbitrum` (or whatever chain is configured)
  - Gas estimate: `~$X.XX` (live estimate, updates)
  - Calldata toggle: collapsed by default, `View calldata ↓` to expand
- CTA: `Deploy my account →` — Sail blue pill, glowing, full width of left panel
- Below CTA: `12px`, 45% white: `This deploys a smart contract wallet you own. No AI has access yet.`

Progress states:
- Waiting for signature: CTA stays active
- Signing: CTA shows `Waiting for wallet...` with a subtle pulse
- Confirmed: transition to State 3 automatically
- Failed: show error in red, retry button

---

**State 3 — Create or modify mandate**

Triggered: most common state. User has an SMA and wants to define what the AI can do.

Layout: three sections stacked vertically inside a card.

**Section A — Mandate summary (what the AI is being asked to do)**

Written by the AI in plain language and passed to this page as a prop/query param. This section renders the AI's prose.

- Small label: `YOUR AI IS REQUESTING`
- The mandate summary in DM Sans 17px, 72% white, line-height 1.6. Example:
  > *"Deposit up to $500 of your USDC into yield strategies on Arbitrum for the next 30 days. I won't withdraw, trade, or move funds elsewhere."*
- Below the prose: three constraint pills in a row (Sail blue outline, no fill):
  - `$500 max`
  - `30 days`
  - `USDC on Arbitrum`

Design note: the constraint pills are the tech accent in an otherwise calm section. They're precise. They're bounded. They make the mandate *legible* at a glance.

**Section B — Permissions being granted**

- Small label: `WHAT YOUR AI CAN DO`
- Allowed action list, each with a checkmark icon in Sail blue:
  - e.g. `Deposit into Aave USDC`
  - e.g. `Withdraw from Aave USDC`
- Below: `WHAT YOUR AI CANNOT DO` with X icons:
  - e.g. `Send to external wallets`
  - e.g. `Swap into other tokens`
  - e.g. `Exceed $500 total`

Design note: the cannot-do list is as important as the can-do list. Users need to see the bounded nature of the delegation to trust it.

**Section C — Calldata (collapsed by default)**

- Toggle: `View technical details ↓`
- When expanded: monospace gray text block showing the actual calldata / EIP-712 typed data
- Below calldata: `This is what gets recorded onchain. It defines exactly what your AI can do.`

---

**Section D — Sign or reject**

- Primary CTA: `Authorize mandate →` — Sail blue pill, full width, glowing on hover
- Below CTA, italic mannerism: *"Revocable on-chain at any time from your dashboard."*
- Secondary action: `Reject this mandate` — small, no styling, 45% white, below the primary. Routes back to AI conversation without signing.

Sai placement: small Sai pixel character (48px) in the bottom right corner of the card, watching. No animation except a slow 4px bob.

---

**State 4 — Signing in progress / confirmation**

Triggered: user clicked authorize.

- Wallet popup fires (or Privy embedded modal appears for social login users)
- Page dims to 60% opacity
- Center modal (glass surface): `Waiting for your signature...` with a slow pulsing Sail blue circle
- On confirmation: success animation (Sai does a small hop, circle becomes a checkmark in Sail blue)
- Headline changes: `Mandate authorized.`
- Italic mannerism: *"Your AI is now operating within your mandate."*
- Auto-closes after 2 seconds and opens the dashboard page

---

### Signing page — acceptance criteria

- [ ] Renders correctly on 1280px desktop and 375px mobile
- [ ] All four states reachable
- [ ] Privy login flow completes without leaving the page
- [ ] Mandate summary renders correctly from query params or injected props
- [ ] Constraint pills render for amount, duration, and asset
- [ ] Calldata section is collapsed by default and expandable
- [ ] Gas estimate shows live (updates every 15 seconds)
- [ ] Primary CTA glows on hover (`--glow-primary-hover`)
- [ ] "Reject" action routes back to AI conversation (closes window or posts message to opener)
- [ ] Sai present in corner, bobbing
- [ ] No Sail backend calls anywhere in the component tree
- [ ] `prefers-reduced-motion` collapses all animations
- [ ] Dark mode only — no light mode variant
- [ ] Offline state: if RPC unavailable, show "Network unavailable — connect to sign" without crashing

---

## Page 2 — Dashboard page

### Purpose

The dashboard is the **trust spine** of the product. It answers one question at all times: *"What is my AI doing with my money, and can I stop it?"*

It opens automatically after the first execution completes. After that, the user can open it any time from:
- The AI conversation (Sai sends a link)
- The Sail Skill's menu (if the AI client exposes one)
- A notification deep-link
- Running `open localhost:XXXX/dashboard` directly

### The brand contract on this page

Less calm-dominant than the signing page, but still 60/40. The dashboard is allowed to be information-dense — it's a trust surface, and trust requires visibility. The tech register can be slightly more present here: precise numbers, timestamps, action logs, gas costs. But the surface should never feel like Etherscan. Generous spacing. Clear hierarchy. Sai as a presence.

### Layout — top level

```
┌─────────────────────────────────────────────────────┐
│  [Sail logo + Sai]          [wallet address]  [⚙]   │  ← header
├─────────────────────────────────────────────────────┤
│  ACTIVE MANDATES                                      │
│  [Mandate card 1]  [Mandate card 2]  [+ New]         │
├─────────────────────────────────────────────────────┤
│  EXECUTION HISTORY                                    │
│  [Action log table]                                   │
├─────────────────────────────────────────────────────┤
│  NOTIFICATIONS                                        │
│  [Channel settings per mandate]                       │
└─────────────────────────────────────────────────────┘
```

---

### Header

- Left: Sail pixel logo (the two curved sails mark) + `sail` wordmark in MD Nichrome 18px
- Right: connected wallet address (truncated, 6+4 chars), click to copy full address
- Far right: settings gear icon — opens notification settings panel

---

### Mandate cards section

Label: `ACTIVE MANDATES` (12px uppercase letter-spaced, 45% white)

Each mandate renders as a card. Glass surface: `rgba(255,255,255,0.055)` background, `rgba(255,255,255,0.10)` border, 20px border-radius.

**Mandate card anatomy:**

```
┌─────────────────────────────────────────────────┐
│  [AI icon]  Created in Claude           [ACTIVE] │
│                                                   │
│  $500 USDC yield on Arbitrum                      │  ← MD Nichrome 22px
│  Ends in 24 days                                  │  ← DM Sans 14px, 72% white
│                                                   │
│  [$500 max] [USDC] [Arbitrum] [Deposit only]      │  ← constraint pills
│                                                   │
│  Last action: 2h ago — Deposited $50 into Aave    │
│                                                   │
│  [View history]              [Revoke mandate]     │
└─────────────────────────────────────────────────┘
```

Elements:
- **AI attribution** (top left): small icon for the AI that created this mandate (Claude logo, Cursor logo, etc.) + `Created in [AI name]`
- **Status pill** (top right): `ACTIVE` in Sail blue outline, or `PAUSED`, `EXPIRED`, `REVOKED` in muted gray
- **Mandate title** (MD Nichrome 22px): auto-generated from the mandate's parameters — e.g. `$500 USDC yield on Arbitrum`
- **Duration line** (DM Sans 14px, 72% white): `Ends in 24 days` or `Expires [date]`
- **Constraint pills**: amount, asset, chain, allowed actions — each as a small outlined pill in 12px
- **Last action line**: most recent execution summary. `Last action: [time ago] — [action description]`
- **View history button**: expands inline to show full execution log for this mandate
- **Revoke mandate button**: red outlined pill, right-aligned. One click → confirmation modal → signed revocation transaction

Design note: `Revoke mandate` should always be visible. Never hide it behind a menu. The brand promise is *"revocable at any time"* — the button being visible is the brand promise made into UI.

---

### Execution history section

Label: `EXECUTION HISTORY` (12px uppercase letter-spaced, 45% white)

A chronological log of every action taken across all mandates.

Table columns:
- Time (relative, e.g. `2h ago`, then absolute on hover)
- Action (e.g. `Deposited $50 into Aave USDC`)
- Executed by (AI name + icon)
- Mandate (which mandate this action belongs to)
- Gas (e.g. `$0.12`)
- Status (`Confirmed` in 72% white, `Failed` in coral red, `Retried` in amber)

Retry rows: if an action was retried, show as a nested indented row under the original. `↳ Retry #1 — succeeded`

Empty state: if no executions yet, show Sai with small caption: *"Your AI hasn't acted yet. Authorize a mandate to begin."*

---

### Notifications section

Label: `NOTIFICATIONS` (12px uppercase letter-spaced, 45% white)

Per-mandate notification routing. Each mandate has its own row.

Row layout:
```
[Mandate name]    Push  Email  Telegram  Discord  None
[USDC yield]       ✓      ✓       -          -      -
[ETH hedge]        -      -       ✓          -      -
```

Controls: toggle switches per channel per mandate. Enabling Telegram or Discord shows an inline connect flow (user pastes their bot chat ID or connects OAuth).

Global setting: `Notify on failure` — always on, cannot be disabled. Failures always notify on every configured channel regardless of mandate-level settings.

---

### Confirmation modals

**Revoke mandate modal:**
- Glass surface modal, centered, overlaid on dimmed dashboard
- Headline: `Revoke this mandate?`
- Body: *"Your AI will immediately lose the authority to act on this mandate. Any open positions remain yours — no automatic unwinding."*
- Two buttons: `Revoke now →` (Sail blue) and `Keep it active` (secondary)
- On confirm: signs revocation transaction, mandate card updates to `REVOKED` state

**Modify mandate flow:**
- Tapping `Edit` on a mandate card opens the signing page (State 3) pre-filled with the mandate's current values
- User edits parameters in the AI conversation, which updates the signing page props
- Signs a new mandate — old one revokes automatically

---

### Sai placement on dashboard

- Header: Sai appears at 24px next to the wordmark
- Empty execution history: Sai appears centered at 64px with caption
- Active mandate execution in progress: Sai appears on the mandate card being acted on, pulsing gently in Sail blue

---

### Dashboard — acceptance criteria

- [ ] Renders correctly on 1280px desktop and 375px mobile
- [ ] Reads all mandates for connected wallet address from onchain
- [ ] Mandate cards show correct status, constraint pills, and last action
- [ ] Execution history loads chronologically, handles empty state
- [ ] Retry rows appear as nested entries under failed actions
- [ ] Revoke button always visible on each mandate card
- [ ] Revoke confirmation modal works and signs the transaction
- [ ] Notification toggles persist (stored in local storage per wallet address)
- [ ] Telegram/Discord connect flow works inline without leaving the page
- [ ] Sai appears in header, empty states, and active execution cards
- [ ] No Sail backend calls anywhere in the component tree
- [ ] Offline state: show last known state with `Last updated [time]` indicator
- [ ] `prefers-reduced-motion` collapses all animations
- [ ] Dark mode only — no light mode variant

---

## Shared components

Both pages share these components. Build them in `src/pages/shared/`:

### `<Sai size={N} />` — the mascot

SVG pixel character. `size` prop sets the px width. Accepts `animate` boolean for the bobbing animation.

```jsx
<Sai size={48} animate />
```

### `<ConstraintPill label="$500 max" />`

Outlined pill. 12px text, Sail blue border, transparent background, 4px border-radius.

### `<MandateStatus status="active" />` 

Status pill. `active` = Sail blue outline. `paused` / `expired` / `revoked` = 45% white outline.

### `<WalletAddress address="0x..." />`

Truncated address. Click to copy full address. Shows a small checkmark for 1.5 seconds on copy.

### `<RevealCalldata calldata="0x..." />`

The collapsed calldata toggle. `View technical details ↓` → expands to monospace block.

### `<GlassCard>...</GlassCard>`

The glass surface container used throughout both pages.

```css
background: var(--glass-bg);
border: 1px solid var(--glass-border);
border-radius: 20px;
backdrop-filter: blur(24px) saturate(150%);
```

---

## Build output targets

```
dist/
  signing/
    index.html
    signing.[hash].js
    signing.[hash].css
  dashboard/
    index.html
    dashboard.[hash].js
    dashboard.[hash].css
```

Both build targets are configured in `vite.config.js` as separate entry points.

The Skill install package copies these two folders to the user's local machine and registers their URLs with the AI client.

---

## What to build first

Recommended order:

1. `src/pages/shared/` — all shared components. Start with `GlassCard`, `Sai`, `ConstraintPill`. These unblock both pages.
2. Signing page — State 1 (Login) and State 3 (Mandate review). These are the most-used states. State 2 (Safe deploy) and State 4 (Confirmation) follow.
3. Dashboard — Mandate cards section first. Then execution history. Then notifications.

Build and test each component in isolation before composing into pages.

---

*Spec version: v1.0 — May 15, 2026. Authored by HELM for the Sail build team.*
