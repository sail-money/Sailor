# Sail — Claude Code project brief

## What this project is

Sail is a protocol for AI-managed onchain Separately Managed Accounts (SMAs). Allocators keep self-custody. Managers — human or AI — operate under cryptographically bounded delegation enforced onchain.

The current task is building **two local static pages** bundled with the Sail Skill install package. These pages have no Sail-operated backend — they run entirely on the user's machine and read state directly from the blockchain via the user's wallet.

## Repository layout

```
sail-landing-v2/
  src/
    components/       React components for the marketing landing
    styles/
      globals.css     Brand tokens — color, type, motion. Read this first.
    App.jsx           Marketing landing page
  docs/
    pages-spec.md     Detailed spec for the two new local pages (read this)
  public/
    fonts/            MDNichromeTrial-Regular.otf (display font)
```

## Stack

- Vite + React 18
- Vanilla CSS modules (no Tailwind)
- Three.js (already installed, used in landing)
- No backend. No server-side rendering.

## The two pages to build

Both live at `src/pages/` as standalone React apps with their own entry points:

1. **Signing page** (`src/pages/signing/`) — appears whenever the user creates or modifies a mandate. Hosts Privy login, plain-language mandate explanation, and the cryptographic signature hand-off.

2. **Dashboard page** (`src/pages/dashboard/`) — always available after first sign. Shows all mandates for the connected wallet, execution history, notification settings, and the revocation pathway.

Full spec in `docs/pages-spec.md`.

## Brand tokens

All design tokens are in `src/styles/globals.css`. Read that file before writing any CSS. Key tokens:

```css
/* Substrate */
--ocean-dark: #030507;       /* page background */

/* Brand blue */
--accent-blue: #1990FF;      /* Sail blue — the only accent color */
--ocean-light: #6ba3ff;      /* lifted blue for highlights */

/* Text on dark */
--text-primary: #FFFFFF;
--text-secondary: rgba(255,255,255,0.72);
--text-tertiary: rgba(255,255,255,0.45);

/* Glass surface */
--glass-bg: rgba(255,255,255,0.055);
--glass-border: rgba(255,255,255,0.10);

/* Glow */
--glow-primary: 0 0 60px rgba(25,144,255,0.42);
--glow-primary-hover: 0 0 100px rgba(25,144,255,0.65);
```

## Typography

- **Display / headlines**: `'MD Nichrome'` loaded from `/public/fonts/MDNichromeTrial-Regular.otf`. Weight 400. Letter-spacing -0.03em.
- **Body / everything else**: `'DM Sans'` from Google Fonts (already imported in globals.css).
- **Italic mannerism**: DM Sans italic 400. Used sparingly — once or twice per page maximum.

## Design principle

The brand holds two emotional registers in calibrated contrast:

- **Calm (60%)** — ocean atmosphere, generous whitespace, glass surfaces, soft blue depth, slow motion.
- **Tech (30%)** — sharp pixel edges on Sai the mascot, calldata-level copy, uppercase letter-spaced metadata labels.

The **signing page must be the calmest surface in the product.** The user is authorizing an AI to manage their money. Anxiety is high. The surface must counteract it.

The **dashboard is the trust spine** — the user should always be able to see what's happening and stop it. Calm overall with precise data surfaces.

## Sai — the mascot

Sai is a small blue pixel-art sailboat. Two colors: Sail blue body `#1990FF`, Sail navy eyes `#0A1124`. Sharp pixels only — `image-rendering: pixelated`, `shape-rendering: crispEdges`. No anti-aliasing.

Sai appears on both pages. On the signing page: watching from a corner, small, calm presence. On the dashboard: shown next to active mandate status, slightly larger.

SVG pixel grid for Sai (16×12 grid, scale up as needed):
```
Row 0: col 7         (mast tip)
Row 1: cols 6-8      (mast)
Row 2: cols 5-9      (sail starts)
Row 3: cols 4-10
Row 4: cols 3-11
Row 5: cols 2-12
Row 7: cols 1-14     (hull)
Row 8: cols 0-15     (hull wide)
Row 9: cols 0-4, col 5 (eye navy), cols 6-8, col 9 (eye navy), cols 10-15
Row 10: cols 0-15    (hull bottom)
Row 11: cols 1-14    (hull taper)
```

## Architecture constraints

- **No Sail-operated servers.** Both pages read state via Privy SDK and direct RPC calls.
- **Privy handles wallet.** Use `@privy-io/react-auth` for login and signing.
- **Local static output.** Both pages build to static HTML/JS/CSS that can be opened from the filesystem or served from `localhost`.
- **No analytics, no tracking, no third-party scripts** except Privy and DM Sans from Google Fonts.
- **Offline-first reads.** If RPC is unavailable, show cached state with a clear "last updated" indicator.

## What not to build

- No navigation between pages (they open separately from the AI conversation)
- No page that requires a Sail backend API call
- No amber/gold color anywhere (the 3D amber sailboat `SailboatScene.jsx` is dead code — ignore it)
- No Tailwind
- No gradients outside the blue family
- No rounded pixel corners on Sai

## Handoff notes

Full build spec with component breakdown, user flows, copy, and acceptance criteria is in `docs/pages-spec.md`. Read that before writing any component.

When in doubt about a brand decision, check `src/styles/globals.css` for the token — it exists if it's in the book.
