# Sail — Design Direction

> The current visual language for `sail-local-ui-1.2` (the local dashboard).
> Read this first before touching any UI. Last updated 2026-06-05.

## TL;DR

A **dark-mode, high-contrast "electric blueprint"** system inspired by [sui.io](https://www.sui.io)
and Sui's "Sui Stack" mega-menu, evolved into Sail's own bold, *alive* identity.

- **True-black canvas. One hue: Sail blue `#1990FF`. Everything else is grayscale.**
- The blue does double duty: it's the brand **and** the signal for *alive / healthy / active*.
- The only non-blue accent is a **restrained red** (`#FF5C6C`), reserved for destructive (revoke).
- **Sharp corners** (0–2px), hairline borders, **monospace technical labels**, **monochrome icons**.
- It should feel **electric and alive** — glows, breathing indicators, a living horizon — premium and powerful, never busy.

If a change adds a new color, softens the corners, or makes it feel "appy" instead of
"engineered," it's off-direction.

---

## 1. Color architecture

**One accent + neutrals + one destructive red. Hierarchy comes from the blue's *treatment*
(filled vs hollow), *brightness*, and *motion* — never from extra hues.**

| Token | Value | Use |
|---|---|---|
| `--accent-blue` | `#1990FF` | The hero. CTAs, links, announcement bar, active/funded/live, brand nodes |
| `--accent-blue-bright` | `#4DABFF` | Hover / glow lift / bright labels |
| `--accent-glow` | `rgba(25,144,255,0.65)` | Glows + drop-shadows on live elements |
| `--positive` | `#1990FF` (= the blue) | Alive / funded / active / success. **Animates.** |
| `--warn` | `rgba(255,255,255,0.62)` | Needs-attention / paused = neutral grey (urgency carried by blue + motion, **not** a warm hue) |
| `--danger` | `#FF5C6C` | Destructive / revoked **only** — the single non-blue hue |
| `--ocean-dark` | `#000000` | True-black page canvas |
| `--surface-900 / 850 / 800` | `#111215 / #161719 / #1E1F24` | Nav · section panels/modals · raised cards |
| `--hairline` | `rgba(255,255,255,0.09)` | Borders, dotted dividers, dot-matrix |
| text | `#FFF` / `0.72` / `0.48` / `0.30` | primary · secondary · tertiary · quaternary |

**Hard rules**

- No green, amber, teal, or any extra hue. (They were tried and explicitly removed — the user
  wants *better architecture within the existing palette*, not more colors.)
- "Funded / active should feel **vibrant**, not light grey." → render them in **bold blue that
  glows + breathes**, not in neutral grey.
- All status semantics route through `--status-*` tokens, which point at the blue (active/success),
  grey (paused/expired/warn), or red (revoked). Change the token, not the component.
- Provider/partner logos (Claude, Cursor, Codex, DeBank, Safe) render **monochrome white** —
  a global `filter: grayscale(1) brightness(1.7)` on `img[src*="/brands/"]` plus neutral
  `BrandMark` tiles. No provider orange/coral/green ever leaks in.

---

## 2. The "alive" layer (motion)

Positive/live elements **breathe** so an active account feels live, not static. All gated behind
`@media (prefers-reduced-motion: reduce)`.

Keyframes live in `globals.css`:

- `liveBreathe` — opacity + glow pulse. On: funded dot, active-session dot, footnote "live" dot,
  active mandate dot, MandateStatus active dot.
- `liveRing` — an expanding square ring. On: the **LOW** wallet dot (motion = "act on me").
- `ctaSheen` — a light sheen sweeping across the **announcement bar** (`.pendingBanner::after`).
- `horizonBreathe` — the background horizon glow gently pulsing.

**State encoding via motion (same hue):** Funded = steady glow (healthy heartbeat). Low = pulsing
ring (needs attention). The label + the blue refill block disambiguate.

Also premium micro-glows: the SMA hero balance has a soft blue `text-shadow`; the ETH glyph has a
blue `drop-shadow`; the announcement bar + FUND button carry a blue box-shadow glow.

---

## 3. Shape & type

- **Radius ladder (sharp):** `--r-1: 0`, `--r-2: 2px`, `--r-3: 2px`, `--r-4: 3px`. Status glyphs
  are **2px squares**, not dots. No pills anywhere.
- **Type (do not change without asking):** Instrument Sans (display headlines), DM Sans (prose),
  **JetBrains Mono** leaned into for every number, label, address, status, and section eyebrow.
- **Surfaces:** flat raised `#1E1F24`-family cards with a 1px grey hairline + faint white top rim.
  Not frosted glass.

---

## 4. Signature elements (what makes it unmistakably Sail/Sui)

1. **Numbered mono eyebrows** — `01 / OPERATOR WALLETS`, `02 / YOUR MANDATES`,
   `03 / RECENT ACTIVITY`. Each leads with a **sharp blue square icon tile** (white monoline icon),
   a blue mono index, then a grey mono uppercase name. Classes: `.sectionTile`, `.sectionIndex`,
   `.sectionName`.
2. **Dotted dividers** — between journal rows, and a full-width dotted rule under every section
   header (the Sui `LABEL/` category-header treatment).
3. **Solid electric-blue announcement bar** — the pending-signature banner is a bold blue strip,
   white text, inverse white CTA, with the living sheen. The single boldest use of the accent.
4. **Blueprint registration brackets** — blue L-marks at the SMA hero's top-left + bottom-right
   corners (`.smaHero::before/::after`).
5. **Electric horizon background** — true black + a Sail-blue glow welling up from the bottom edge
   (breathes), over a faint **dot-matrix** field (replaced the old crossed lines). See
   `FluidBackground.module.css`.
6. **Mono "console readout" numbers** — balances are JetBrains Mono, tabular, slightly glowing.

---

## 5. Where things live

```
src/styles/globals.css                      ← tokens (color, radius, animations). START HERE.
src/pages/shared/FluidBackground.*          ← electric horizon + dot-matrix background
src/pages/shared/BrandMark.module.css       ← monochrome provider tiles
src/pages/shared/MandateStatus.*            ← status pill (breathing active dot)
src/pages/dashboard/Dashboard.jsx           ← the dashboard (hero, wallets, mandates, journal, modals)
src/pages/dashboard/Dashboard.module.css    ← the bulk of dashboard styling
src/pages/dashboard/SharedLayout.module.css ← shell, header, .card, journal rows, addr pills
```

Repo: `github.com/0xRcap/sail-local-ui-1.2` · run: `npm run dev` (port 5185).

---

## 6. Open / next

- **Detail routes not yet converted:** `/mandate/:id`, `/agent/:id`, `/journal/:id`, and the
  `ProfileModal` / `ContractModal` / `Pending*` / `CreateSMA` / `EditModal` / `DepositModal`
  components still carry the **old navy palette + soft corners**. They need the same pass:
  token sweep (any `#2680FE`/`38,128,254` → Sail blue is already done globally via tokens, but
  these files have their own literals), sharp corners, monochrome logos, dotted dividers,
  numbered eyebrows where appropriate.
- **Signing page** (`src/pages/signing/`) hasn't been touched in this direction at all.
- Consider an **isometric wireframe diagram** motif (Sui's "Sui Stack" blueprint) somewhere in the
  hero or an empty state — it's a strong Sui signature we gesture at (corner brackets) but don't
  fully use yet.

## 7. Guardrails (the "don'ts")

- Don't introduce a second accent hue. Vibrancy = bold blue + glow + motion.
- Don't round the corners. Sharp (≤2–3px) is the identity.
- Don't reach for frosted glass on cards — flat raised surfaces + hairlines.
- Don't color the provider logos. Monochrome white.
- Don't add em-dashes to visible copy; ration `·` separators.
- Keep every animation behind `prefers-reduced-motion`.
