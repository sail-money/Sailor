# Sail Local Dashboard — Design System

> The formalized design language for `sail-local-ui-1.2`. Read alongside
> `DESIGN_DIRECTION.md` (the "why / mood") — this file is the "how / spec".
> Last refined 2026-06-05 in a full IA + visual pass.

## 0. One-line

A **dark "electric blueprint"** product UI: true-black canvas, a single
Sail-blue accent (`#1990FF`), sharp 0–3px corners, JetBrains Mono technical
labels, and a quiet living layer (breathing glow on the account). Design
**serves the task** — chrome defers, the account's state is always legible.

---

## 1. Color

One accent + neutrals + one destructive red. Hierarchy comes from the blue's
*treatment* and *placement*, never from extra hues.

| Token | Value | Role |
|---|---|---|
| `--accent-blue` | `#1990FF` | The hero. Section indices, CTAs, live/active, the announcement bar |
| `--accent-blue-bright` | `#4DABFF` | Hover lift, signature lines |
| `--danger` | `#FF5C6C` | Destructive / revoke **only** — the single non-blue hue |
| `--ocean-dark` | `#000000` | True-black canvas |
| `--surface-900/850/800` | `#111215 / #161719 / #1E1F24` | Nav · panels/modals · raised cards |
| `--hairline` | `rgba(255,255,255,0.09)` | Borders, dotted dividers |

**Ink ramp (contrast-tuned).** Tertiary/quaternary were lifted so meta labels
that carry real information stay legible on raised surfaces:

| Token | Value |
|---|---|
| `--text-primary` | `#FFFFFF` |
| `--text-secondary` | `rgba(255,255,255,0.72)` |
| `--text-tertiary` | `rgba(255,255,255,0.56)` |
| `--text-quaternary` | `rgba(255,255,255,0.40)` |

**The deference rule (the system's backbone).** Blue earns meaning by being
rationed. It appears only on: section indices (`01`, `ARTICLE I`), live/active
state, the hero balance glyph, and primary actions. It is **never** used on
field-tier micro-labels — those are grey mono. When blue is everywhere it reads
as flat noise; rationing it gives the blueprint depth.

---

## 2. Type

Three families, each with a job (never more):

- **Instrument Sans** — display: the SMA name, modal titles.
- **DM Sans** — prose: descriptions, body, button labels.
- **JetBrains Mono** — every number, address, status, label, eyebrow.

**Fixed rem scale** (product UI, consistent DPI — no fluid clamp):

```
--t-micro 10.5  field labels, status chips
--t-mono  11.5  section eyebrows, addresses
--t-xs    12.5  meta, captions
--t-sm    13.5  secondary body
--t-base  15    body
--t-md    18    card titles
--t-lg    22    modal titles
--t-xl    28    section / page titles
--t-2xl   40    hero title
--t-balance 46  the SMA console readout
```

---

## 3. Label tiers (the depth mechanism)

| Tier | Treatment | Where |
|---|---|---|
| **Section** | blue index/roman + grey name, `--label-section-tracking` | `01 / OPERATOR WALLETS`, `ARTICLE I / PARTIES` |
| **Field** | grey mono (`--text-tertiary`), `--label-field-tracking` | `RECITAL`, `ONCHAIN`, `ADDRESS`, `NETWORKS`, `DRAFTED BY`, `SMA BALANCE` |
| **Value** | white / secondary, the real content | balances, names, addresses, prose |

Two tiers of chrome (section vs field), one tier of content. The field tier
defers; the value tier reads first.

---

## 4. Shape & spacing

- **Radius ladder (sharp):** `--r-1: 0`, `--r-2/3: 2px`, `--r-4: 3px`. Status
  glyphs are 2px squares, not dots. No pills.
- **Spacing — 8pt scale** (`--s1: 4` … `--s11: 80`). Every gap/pad/inset
  resolves to a step. **Sections own one rhythm:** the page container's
  `gap: var(--s7)` (32px) is the only thing that spaces sections — individual
  sections add no `margin-top`.
- **Surfaces:** flat raised `#1E1F24`-family cards, 1px grey hairline + faint
  white top rim. Not frosted glass.
- **No side-stripe accents.** A colored `border-left` as a callout accent is
  banned (reads as a tell). Use a full hairline + faint tint instead — see the
  recital block.

---

## 5. Z-index (semantic, no magic numbers)

```
--z-raised 10 · --z-sticky 100 · --z-dropdown 200 · --z-header 300
--z-scrim 900 · --z-modal 1000 · --z-toast 1100 · --z-tooltip 1200
```

---

## 6. Motion — the living layer

Quiet, state-bearing, never decorative. 150–250ms on interactions; the
breathing loops run long (2.6–5.6s) so they read as *alive*, not busy.

- **`smaHeroBreathe`** (5.6s) — the SMA hero's base glow exhales. The account
  *is* the living thing; its heartbeat lives here, not on the wallets.
- **`liveBreathe`** — active-mandate dot + session-active dot.
- **`liveRingSquare`** — expanding square ring on the active mandate dot.
- **`ctaSheen`** — sheen sweep across primary CTAs on hover (VIEW CONTRACT,
  FUND, Open in Safe, REVIEW MANDATE) and the announcement bar.

Every loop is gated behind `@media (prefers-reduced-motion: reduce)`.

---

## 7. Component vocabulary (identical across every surface)

- **Section eyebrow** — `.sectionTile` (blue square icon) + blue index + grey name.
- **Field eyebrow** — grey mono, trailing `/`.
- **Chip** — 2px, hairline border, mono; lifts to blue tint on hover.
- **Primary button** — filled blue, mono uppercase, sheen on hover.
- **Ghost button** — transparent, hairline, mono; → blue tint on hover.
- **Address pill** — mono truncated + copy icon + explorer arrow.
- **Divider** — dotted hairline (section heads) or dashed hairline (in-card blocks).
- **Close** — 2px square chip, never a circle.

When a modal needs the system, it imports these patterns — it does not invent a
local variant. Each modal's `module.css` ends with an override block that snaps
any legacy soft-corner/pill/per-provider-tint back onto the system.

---

## 8. Surfaces

```
src/styles/globals.css                  ← tokens. START HERE.
src/pages/shared/FluidBackground.*       ← electric horizon + dot-matrix
src/pages/dashboard/Dashboard.*          ← hero, wallets, mandates, journal
src/pages/dashboard/SharedLayout.module  ← shell, header, .card, journal rows
src/pages/dashboard/ContractModal.*      ← the mandate as a legal document
src/pages/dashboard/ProfileModal.*       ← SMA profile menu
src/pages/dashboard/PendingModal.*       ← pending-signatures queue
src/pages/signing/Signing.*              ← connect + deploy flow
```

Run: `npm run dev` (Next.js 15, port 3553).
