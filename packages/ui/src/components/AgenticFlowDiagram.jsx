import { useEffect, useState } from 'react'
import { useInView } from '../hooks/useInView'
import styles from './AgenticFlowDiagram.module.css'

/* ── Stage data — sourced from the Sail Protocol whitepaper ─────────
 * Roles  (§3): Owner · Permission Signer · Manager  (lives in the Three Roles band above)
 * Flow   (§4.3): SDK → AgentKernel → PolicyRegistry → Constraint VM
 *                → Custody Adapter → FeeKernel → ReadFacade
 * The Manager-Intent column has been removed from the diagram —
 * the SAIL · SDK is now the diagram entry point.
 * ──────────────────────────────────────────────────────────────────── */
const INTENT = []

const LAYERS = [
  { name: 'AgentKernel',     sub: 'session · nonce · auth',      icon: 'kernel'   },
  { name: 'PolicyRegistry',  sub: 'version · curation · policy', icon: 'registry' },
  { name: 'Constraint VM',   sub: 'calldata · value · return',   icon: 'vm'       },
  { name: 'Custody Adapter', sub: 'safe · 4337 · 7702',          icon: 'custody'  },
]

const SETTLEMENT = [
  { name: 'Authorized Call', sub: 'subject.execute', icon: 'call'    },
  { name: 'FeeKernel',       sub: 'hooks.settle',    icon: 'fee'     },
  { name: 'Evidence Events', sub: 'state.emit',      icon: 'event'   },
  { name: 'Read Facade',     sub: 'facade.expose',   icon: 'facade'  },
]

/* ── Iconography — proprietary glyphs rendered inline ──────────────── */
function Icon({ kind, x, y, size = 16, className }) {
  const half = size / 2
  const cx = x + half, cy = y + half
  const stroke = 'currentColor', sw = 1.4
  const common = { fill: 'none', stroke, strokeWidth: sw, strokeLinecap: 'round', strokeLinejoin: 'round' }
  const paths = {
    kernel: (
      <g {...common}>
        <rect x={x + 2} y={y + 2} width={size - 4} height={size - 4} rx={2} />
        <path d={`M${cx - 3},${cy - 3} L${cx + 3},${cy + 3} M${cx - 3},${cy + 3} L${cx + 3},${cy - 3}`} />
      </g>
    ),
    registry: (
      <g {...common}>
        <path d={`M${x + 3},${y + 3} L${x + size - 3},${y + 3}`} />
        <path d={`M${x + 3},${cy} L${x + size - 3},${cy}`} />
        <path d={`M${x + 3},${y + size - 3} L${x + size - 3},${y + size - 3}`} />
        <circle cx={x + 5} cy={y + 3} r={0.6} fill={stroke} />
        <circle cx={x + 5} cy={cy} r={0.6} fill={stroke} />
        <circle cx={x + 5} cy={y + size - 3} r={0.6} fill={stroke} />
      </g>
    ),
    vm: (
      <g {...common}>
        <path d={`M${cx - 3},${y + 3} L${x + 2.5},${cy} L${cx - 3},${y + size - 3}`} />
        <path d={`M${cx + 3},${y + 3} L${x + size - 2.5},${cy} L${cx + 3},${y + size - 3}`} />
      </g>
    ),
    custody: (
      <g {...common}>
        <path d={`M${cx},${y + 2} L${x + size - 2.5},${y + 4} L${x + size - 2.5},${cy} Q${x + size - 2.5},${y + size - 2} ${cx},${y + size - 2} Q${x + 2.5},${y + size - 2} ${x + 2.5},${cy} L${x + 2.5},${y + 4} Z`} />
      </g>
    ),
    call: (
      <g {...common}>
        <path d={`M${x + 3},${cy} L${x + size - 3},${cy}`} />
        <path d={`M${x + size - 6},${cy - 3} L${x + size - 3},${cy} L${x + size - 6},${cy + 3}`} />
      </g>
    ),
    fee: (
      <g {...common}>
        <circle cx={x + 5} cy={y + 5} r={1.5} />
        <circle cx={x + size - 5} cy={y + size - 5} r={1.5} />
        <path d={`M${x + size - 3},${y + 3} L${x + 3},${y + size - 3}`} />
      </g>
    ),
    event: (
      <g {...common}>
        <path d={`M${cx},${y + 2.5} L${x + size - 2.5},${cy} L${cx},${y + size - 2.5} L${x + 2.5},${cy} Z`} />
      </g>
    ),
    facade: (
      <g {...common}>
        <path d={`M${x + 2.5},${cy} Q${cx},${y + 3} ${x + size - 2.5},${cy} Q${cx},${y + size - 3} ${x + 2.5},${cy}`} />
        <circle cx={cx} cy={cy} r={1.5} />
      </g>
    ),
  }
  return <g className={className}>{paths[kind] || null}</g>
}

/* ══════════════════════════════════════════════════════════════════
   HORIZONTAL LAYOUT — desktop primary
   ══════════════════════════════════════════════════════════════════ */
const H = {
  vb: { w: 1280, h: 540 },

  // (Manager-intent column removed — SDK is now the diagram entry point.
  // Content is rebalanced edge-to-edge so there is no empty left band.)
  intent: {
    x: 60, w: 220, h: 40, gap: 12,
    centersY: [],
  },

  // Sail SDK pill — left entry point, sized up to match the new card scale
  sdk:    { x: 56,  y: 240, w: 88,  h: 68, cx: 100, cy: 274 },

  // Protocol Kernel column (was 320 wide, now 380 with breathing room)
  layers: {
    x: 224, w: 380, h: 80, gap: 14,
    centersY: [134, 228, 322, 416],
  },

  // Mandate verification gate
  check:  { cx: 724, cy: 274, size: 80, x: 684, y: 234 },

  // Onchain Outcomes column (matches kernel scale)
  exec: {
    x: 844, w: 380, h: 80, gap: 14,
    centersY: [134, 228, 322, 416],
  },

  // Stage label positions — aligned to the new column edges
  labels: {
    intent: { x: 60,  y: 132 },
    powers: { x: 224, y: 80  },
    exec:   { x: 844, y: 80  },
  },

  // Boundary — same outer rect, content now fills it symmetrically (32px margin)
  bound:  { x: 24, y: 56, w: 1232, h: 444, rx: 22 },
  boundLabelY: 504,
}

/* Wire geometry for horizontal layout */
const H_WIRES = (() => {
  const sdkLeft  = H.sdk.x,  sdkTop = H.sdk.cy
  const sdkRight = H.sdk.x + H.sdk.w
  const layLeft  = H.layers.x
  const layRight = H.layers.x + H.layers.w
  const chkLeft  = H.check.x,  chkRight = H.check.x + H.check.size, chkY = H.check.cy
  const exeLeft  = H.exec.x

  const intentRight = H.intent.x + H.intent.w  // 280

  const w = []

  // Intent → SDK (5 wires, fan-in)
  H.intent.centersY.forEach((cy, i) => {
    const midX = (intentRight + sdkLeft) / 2
    w.push({ id: `hi${i}`, g: 'in', d: `M${intentRight},${cy} C${midX},${cy} ${midX},${sdkTop} ${sdkLeft},${sdkTop}` })
  })

  // SDK → Layers (4 wires, fan-out)
  H.layers.centersY.forEach((cy, i) => {
    const midX = (sdkRight + layLeft) / 2
    w.push({ id: `hf${i}`, g: 'fan', d: `M${sdkRight},${sdkTop} C${midX},${sdkTop} ${midX},${cy} ${layLeft},${cy}` })
  })

  // Layers → Check (4 wires, fan-in)
  H.layers.centersY.forEach((cy, i) => {
    const midX = (layRight + chkLeft) / 2
    w.push({ id: `hg${i}`, g: 'gate-in', d: `M${layRight},${cy} C${midX},${cy} ${midX},${chkY} ${chkLeft},${chkY}` })
  })

  // Check → Settlement (4 wires, fan-out)
  H.exec.centersY.forEach((cy, i) => {
    const midX = (chkRight + exeLeft) / 2
    w.push({ id: `he${i}`, g: 'gate-out', d: `M${chkRight},${chkY} C${midX},${chkY} ${midX},${cy} ${exeLeft},${cy}` })
  })

  return w
})()

/* ══════════════════════════════════════════════════════════════════
   VERTICAL LAYOUT — mobile fallback
   Cards arranged as a 2x2 grid for both Protocol Kernel and Onchain
   Outcomes so labels (e.g. "Custody Adapter") have room to breathe.
   ══════════════════════════════════════════════════════════════════ */
const V_CARD_W = 240
const V_CARD_H = 72
const V_COL_X = [60, 300]   /* card x-origin for col 1 / col 2 (cx = x + w/2) */

const V = {
  vb: { w: 600, h: 1180 },
  intent: { cy: 102, h: 38, w: 110, gap: 10, centersX: [] },
  sdk:    { x: 232, y: 226, w: 136, h: 56, cx: 300, cy: 254 },
  layers: {
    w: V_CARD_W, h: V_CARD_H,
    /* row 1 at y=348, row 2 at y=348+h+18 = 438 */
    centers: [
      { cx: V_COL_X[0] + V_CARD_W / 2, cy: 348 + V_CARD_H / 2 },
      { cx: V_COL_X[1] + V_CARD_W / 2, cy: 348 + V_CARD_H / 2 },
      { cx: V_COL_X[0] + V_CARD_W / 2, cy: 438 + V_CARD_H / 2 },
      { cx: V_COL_X[1] + V_CARD_W / 2, cy: 438 + V_CARD_H / 2 },
    ],
  },
  check:  { cx: 300, cy: 600, size: 72, x: 264, y: 564 },
  exec: {
    w: V_CARD_W, h: V_CARD_H,
    /* row 1 at y=716, row 2 at y=716+h+18 = 806 */
    centers: [
      { cx: V_COL_X[0] + V_CARD_W / 2, cy: 716 + V_CARD_H / 2 },
      { cx: V_COL_X[1] + V_CARD_W / 2, cy: 716 + V_CARD_H / 2 },
      { cx: V_COL_X[0] + V_CARD_W / 2, cy: 806 + V_CARD_H / 2 },
      { cx: V_COL_X[1] + V_CARD_W / 2, cy: 806 + V_CARD_H / 2 },
    ],
  },
  labels: {
    intent: { x: 30,  y: 64  },
    powers: { x: 30,  y: 320 },
    exec:   { x: 30,  y: 688 },
  },
  bound:  { x: 16, y: 40, w: 568, h: 1060, rx: 22 },
  boundLabelY: 1106,
}

const V_WIRES = (() => {
  const w = []
  /* Intent → SDK */
  V.intent.centersX.forEach((cx, i) => {
    const yStart = V.intent.cy + V.intent.h / 2
    const sdkTop = V.sdk.y
    const midY = (yStart + sdkTop) / 2
    w.push({ id: `vi${i}`, g: 'in', d: `M${cx},${yStart} C${cx},${midY} ${V.sdk.cx},${midY} ${V.sdk.cx},${sdkTop}` })
  })
  /* SDK → Layer cards (row 1 enters via the top edge, row 2 enters via top of its own card) */
  V.layers.centers.forEach(({ cx, cy }, i) => {
    const yStart = V.sdk.y + V.sdk.h
    const cardTop = cy - V.layers.h / 2
    const midY = (yStart + cardTop) / 2
    w.push({ id: `vf${i}`, g: 'fan', d: `M${V.sdk.cx},${yStart} C${V.sdk.cx},${midY} ${cx},${midY} ${cx},${cardTop}` })
  })
  /* Layer cards → Check (each card's bottom feeds the gate) */
  V.layers.centers.forEach(({ cx, cy }, i) => {
    const yStart = cy + V.layers.h / 2
    const chkTop = V.check.y
    const midY = (yStart + chkTop) / 2
    w.push({ id: `vg${i}`, g: 'gate-in', d: `M${cx},${yStart} C${cx},${midY} ${V.check.cx},${midY} ${V.check.cx},${chkTop}` })
  })
  /* Check → Outcome cards (each card's top receives) */
  V.exec.centers.forEach(({ cx, cy }, i) => {
    const yStart = V.check.y + V.check.size
    const cardTop = cy - V.exec.h / 2
    const midY = (yStart + cardTop) / 2
    w.push({ id: `ve${i}`, g: 'gate-out', d: `M${V.check.cx},${yStart} C${V.check.cx},${midY} ${cx},${midY} ${cx},${cardTop}` })
  })
  return w
})()

/* ══════════════════════════════════════════════════════════════════
   Lane timing — single coherent wave moving through stages
   ══════════════════════════════════════════════════════════════════ */
const LANE_DELAY = { in: 0, fan: 1.4, 'gate-in': 2.8, 'gate-out': 4.2 }

/* ══════════════════════════════════════════════════════════════════
   SVG <defs> — glass gradients, glow filters, wire colours
   ══════════════════════════════════════════════════════════════════ */
function GlassDefs({ ns }) {
  const id = (k) => `${ns}-${k}`
  return (
    <defs>
      {/* Card glass fill — top-edge refraction highlight baked into a single gradient */}
      <linearGradient id={id('glassFill')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor="rgba(220, 240, 255, 0.32)" />
        <stop offset="6%"   stopColor="rgba(140, 195, 250, 0.36)" />
        <stop offset="22%"  stopColor="rgba(70, 130, 200, 0.36)" />
        <stop offset="60%"  stopColor="rgba(20, 50, 100, 0.36)" />
        <stop offset="100%" stopColor="rgba(8, 18, 38, 0.42)" />
      </linearGradient>

      {/* Card edge — bright top, fading bottom (refraction) */}
      <linearGradient id={id('glassStroke')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor="rgba(180, 220, 255, 0.55)" />
        <stop offset="40%"  stopColor="rgba(102, 194, 255, 0.28)" />
        <stop offset="100%" stopColor="rgba(50, 100, 180, 0.16)" />
      </linearGradient>

      {/* SDK pill — slightly brighter top edge for emphasis */}
      <linearGradient id={id('sdkFill')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor="rgba(230, 245, 255, 0.55)" />
        <stop offset="8%"   stopColor="rgba(160, 210, 255, 0.55)" />
        <stop offset="50%"  stopColor="rgba(60, 130, 220, 0.45)" />
        <stop offset="100%" stopColor="rgba(20, 70, 160, 0.35)" />
      </linearGradient>

      {/* Verification gate — pale luminous mint with brighter crown */}
      <linearGradient id={id('checkFill')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor="rgba(245, 255, 245, 0.95)" />
        <stop offset="8%"   stopColor="rgba(220, 245, 230, 0.92)" />
        <stop offset="55%"  stopColor="rgba(190, 235, 215, 0.82)" />
        <stop offset="100%" stopColor="rgba(160, 220, 200, 0.72)" />
      </linearGradient>

      {/* Wire base — barely visible */}
      <linearGradient id={id('wireBase')} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stopColor="rgba(102, 194, 255, 0.08)" />
        <stop offset="50%"  stopColor="rgba(102, 194, 255, 0.22)" />
        <stop offset="100%" stopColor="rgba(102, 194, 255, 0.08)" />
      </linearGradient>

      {/* Wire flow — bright comet trail */}
      <linearGradient id={id('wireFlow')} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stopColor="rgba(160, 220, 255, 0)" />
        <stop offset="50%"  stopColor="rgba(220, 240, 255, 1)" />
        <stop offset="100%" stopColor="rgba(160, 220, 255, 0)" />
      </linearGradient>

      <filter id={id('softGlow')} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2.4" />
      </filter>
    </defs>
  )
}

/* ══════════════════════════════════════════════════════════════════
   Glass card primitive — used for layer + settlement boxes
   ══════════════════════════════════════════════════════════════════ */
function GlassCard({ x, y, w, h, name, sub, icon, idx, kind, ns, lit }) {
  const id = (k) => `url(#${ns}-${k})`
  return (
    <g
      className={`${styles.card} ${lit ? styles.cardLit : ''}`}
      style={{ '--idx': idx, '--lit-delay': `${lit}s` }}
    >
      {/* Opaque backplate — slightly oversized to cover wire stroke overflow */}
      <rect
        x={x - 2} y={y - 2} width={w + 4} height={h + 4} rx={16}
        className={styles.cardBackplate}
      />
      {/* Body — gradient bakes in the top-edge refraction highlight */}
      <rect
        x={x} y={y} width={w} height={h} rx={14}
        className={styles.cardBody}
        fill={id('glassFill')} stroke={id('glassStroke')}
      />
      {/* Lit accent rim — only animated when stage receives the wave */}
      <rect
        x={x} y={y} width={w} height={h} rx={14}
        className={styles.cardLitRim}
      />
      {/* Icon */}
      <g className={styles.cardIconWrap} transform={`translate(${x + 18}, ${y + h / 2 - 12})`}>
        <rect x={0} y={0} width={24} height={24} rx={7} className={styles.cardIconBg} />
        <g className={styles.cardIcon}>
          <Icon kind={icon} x={4} y={4} size={16} />
        </g>
      </g>
      {/* Text */}
      <text x={x + 54} y={y + h / 2 - 5} className={styles.cardName} dominantBaseline="middle">{name}</text>
      <text x={x + 54} y={y + h / 2 + 13} className={styles.cardSub}  dominantBaseline="middle">{sub}</text>
    </g>
  )
}

/* ══════════════════════════════════════════════════════════════════
   Manager intent chip — outer group handles positioning (SVG attr),
   inner group handles entrance animation (CSS transform). Keeping
   them separate avoids the CSS-overrides-SVG-transform collision.
   ══════════════════════════════════════════════════════════════════ */
function IntentChip({ x, y, w, h, label, idx, ns, orientation }) {
  const id = (k) => `url(#${ns}-${k})`
  return (
    <g transform={`translate(${x}, ${y})`}>
      <g className={styles.chip} style={{ '--idx': idx }}>
        {/* Opaque backplate — slightly oversized to cover wire stroke overflow */}
        <rect x={-2} y={-2} width={w + 4} height={h + 4} rx={(h + 4) / 2}
          className={styles.chipBackplate} />
        <rect x={0} y={0} width={w} height={h} rx={h / 2}
          className={styles.chipBody}
          fill={id('glassFill')} stroke={id('glassStroke')} />
        <circle cx={14} cy={h / 2} r={2.6} className={styles.chipDot} />
        <text x={(w + 18) / 2 + 5} y={h / 2 + 0.5} className={styles.chipText}
          textAnchor="middle" dominantBaseline="middle">{label}</text>
      </g>
    </g>
  )
}

/* ══════════════════════════════════════════════════════════════════
   Sail SDK node — small luminous pill
   ══════════════════════════════════════════════════════════════════ */
function SdkNode({ geo, ns, orientation }) {
  const id = (k) => `url(#${ns}-${k})`
  const { x, y, w, h, cx, cy } = geo
  const r = Math.min(w, h) / 2
  return (
    <g className={styles.sdk}>
      {/* Opaque backplate — slightly oversized to cover any wire stroke overflow */}
      <rect x={x - 2} y={y - 2} width={w + 4} height={h + 4} rx={r + 2}
        className={styles.sdkBackplate} />
      {/* Body — gradient bakes in the top-edge highlight */}
      <rect x={x} y={y} width={w} height={h} rx={r}
        className={styles.sdkBody}
        fill={id('sdkFill')} />
      <text x={cx} y={cy + 0.5}
        className={styles.sdkLabel} textAnchor="middle" dominantBaseline="middle">
        SAIL · SDK
      </text>
    </g>
  )
}

/* ══════════════════════════════════════════════════════════════════
   Verification gate — luminous mint check
   ══════════════════════════════════════════════════════════════════ */
function CheckGate({ geo, ns }) {
  const id = (k) => `url(#${ns}-${k})`
  const { cx, cy, size, x, y } = geo
  return (
    <g className={styles.check}>
      {/* Opaque backplate — slightly oversized to cover any wire stroke overflow */}
      <rect x={x - 2} y={y - 2} width={size + 4} height={size + 4} rx={16}
        className={styles.checkBackplate} />
      {/* Body — gradient bakes in the top-edge highlight */}
      <rect x={x} y={y} width={size} height={size} rx={14}
        className={styles.checkBody}
        fill={id('checkFill')} />
      {/* Check mark */}
      <path d={`M${cx - 14},${cy - 1} l8,9 l16,-18`}
        className={styles.checkMark} fill="none" />
    </g>
  )
}

/* ══════════════════════════════════════════════════════════════════
   Wire pair — base stroke + animated comet trail
   ══════════════════════════════════════════════════════════════════ */
function WirePair({ id, d, lane, ns, idxInLane }) {
  const grad = (k) => `url(#${ns}-${k})`
  const cometDelay = (LANE_DELAY[lane] ?? 0) + idxInLane * 0.06
  return (
    <g className={styles.wirePair}>
      <path d={d} pathLength={100}
        className={`${styles.wireBase} ${styles[`wire-${lane}`]}`}
        stroke={grad('wireBase')} fill="none" />
      <path d={d} pathLength={100}
        className={styles.wireFlow}
        stroke={grad('wireFlow')} fill="none"
        style={{ animationDelay: `${cometDelay}s` }} />
    </g>
  )
}

/* ══════════════════════════════════════════════════════════════════
   Horizontal SVG diagram
   ══════════════════════════════════════════════════════════════════ */
function HorizontalDiagram({ visible }) {
  const ns = 'h'

  // Per-lane idx counter for comet stagger
  const counters = {}
  const wireWithIdx = H_WIRES.map((w) => {
    const i = (counters[w.g] = (counters[w.g] ?? -1) + 1)
    return { ...w, idxInLane: i }
  })

  return (
    <svg
      viewBox={`0 0 ${H.vb.w} ${H.vb.h}`}
      preserveAspectRatio="xMidYMid meet"
      className={`${styles.svg} ${visible ? styles.svgVisible : ''}`}
      aria-hidden="true"
    >
      <GlassDefs ns={ns} />

      {/* Boundary */}
      <g className={styles.boundary}>
        <rect x={H.bound.x} y={H.bound.y} width={H.bound.w} height={H.bound.h} rx={H.bound.rx}
          className={styles.boundaryRect} />
        <g transform={`translate(${H.vb.w / 2}, ${H.boundLabelY})`} className={styles.boundaryLabel}>
          <rect x={-92} y={-13} width={184} height={26} rx={13} className={styles.boundaryLabelBg} />
          <circle cx={-72} cy={0} r={3} className={styles.boundaryLabelDot} />
          <text x={6} y={1} textAnchor="middle" dominantBaseline="middle"
            className={styles.boundaryLabelText}>MANDATE ENFORCED</text>
        </g>
      </g>

      {/* Stage labels */}
      <g className={styles.stageLabels}>
        <text x={H.labels.powers.x} y={H.labels.powers.y} className={styles.stageLabel}>PROTOCOL KERNEL</text>
        <text x={H.labels.exec.x}   y={H.labels.exec.y}   className={styles.stageLabel}>ONCHAIN OUTCOMES</text>
      </g>

      {/* Wires */}
      <g className={styles.wires}>
        {wireWithIdx.map((w) => (
          <WirePair key={w.id} id={w.id} d={w.d} lane={w.g} ns={ns} idxInLane={w.idxInLane} />
        ))}
      </g>

      {/* Intent chips (left column) */}
      <g className={styles.intentBand}>
        {INTENT.map((label, i) => (
          <IntentChip
            key={label}
            x={H.intent.x}
            y={H.intent.centersY[i] - H.intent.h / 2}
            w={H.intent.w} h={H.intent.h}
            label={label} idx={i} ns={ns} orientation="h"
          />
        ))}
      </g>

      {/* SDK */}
      <SdkNode geo={H.sdk} ns={ns} orientation="h" />

      {/* Layer cards (middle column) */}
      <g className={styles.layerBand}>
        {LAYERS.map((l, i) => (
          <GlassCard
            key={l.name}
            x={H.layers.x} y={H.layers.centersY[i] - H.layers.h / 2}
            w={H.layers.w} h={H.layers.h}
            name={l.name} sub={l.sub} icon={l.icon}
            idx={i} kind="layer" ns={ns}
            lit={LANE_DELAY['fan'] + i * 0.06 + 0.85}
          />
        ))}
      </g>

      {/* Check gate */}
      <CheckGate geo={H.check} ns={ns} />

      {/* Settlement cards (right column) */}
      <g className={styles.execBand}>
        {SETTLEMENT.map((e, i) => (
          <GlassCard
            key={e.name}
            x={H.exec.x} y={H.exec.centersY[i] - H.exec.h / 2}
            w={H.exec.w} h={H.exec.h}
            name={e.name} sub={e.sub} icon={e.icon}
            idx={i} kind="exec" ns={ns}
            lit={LANE_DELAY['gate-out'] + i * 0.06 + 0.85}
          />
        ))}
      </g>
    </svg>
  )
}

/* ══════════════════════════════════════════════════════════════════
   Vertical SVG diagram (mobile)
   ══════════════════════════════════════════════════════════════════ */
function VerticalDiagram({ visible }) {
  const ns = 'v'
  const counters = {}
  const wireWithIdx = V_WIRES.map((w) => {
    const i = (counters[w.g] = (counters[w.g] ?? -1) + 1)
    return { ...w, idxInLane: i }
  })

  return (
    <svg
      viewBox={`0 0 ${V.vb.w} ${V.vb.h}`}
      preserveAspectRatio="xMidYMid meet"
      className={`${styles.svg} ${visible ? styles.svgVisible : ''}`}
      aria-hidden="true"
    >
      <GlassDefs ns={ns} />

      <g className={styles.boundary}>
        <rect x={V.bound.x} y={V.bound.y} width={V.bound.w} height={V.bound.h} rx={V.bound.rx}
          className={styles.boundaryRect} />
        <g transform={`translate(${V.vb.w / 2}, ${V.boundLabelY})`} className={styles.boundaryLabel}>
          <rect x={-92} y={-13} width={184} height={26} rx={13} className={styles.boundaryLabelBg} />
          <circle cx={-72} cy={0} r={3} className={styles.boundaryLabelDot} />
          <text x={6} y={1} textAnchor="middle" dominantBaseline="middle"
            className={styles.boundaryLabelText}>MANDATE ENFORCED</text>
        </g>
      </g>

      <g className={styles.stageLabels}>
        <text x={V.labels.powers.x} y={V.labels.powers.y} className={styles.stageLabel}>PROTOCOL KERNEL</text>
        <text x={V.labels.exec.x} y={V.labels.exec.y} className={styles.stageLabel}>ONCHAIN OUTCOMES</text>
      </g>

      <g className={styles.wires}>
        {wireWithIdx.map((w) => (
          <WirePair key={w.id} id={w.id} d={w.d} lane={w.g} ns={ns} idxInLane={w.idxInLane} />
        ))}
      </g>

      <g className={styles.intentBand}>
        {INTENT.map((label, i) => (
          <IntentChip
            key={label}
            x={V.intent.centersX[i] - V.intent.w / 2}
            y={V.intent.cy - V.intent.h / 2}
            w={V.intent.w} h={V.intent.h}
            label={label} idx={i} ns={ns} orientation="v"
          />
        ))}
      </g>

      <SdkNode geo={V.sdk} ns={ns} orientation="v" />

      <g className={styles.layerBand}>
        {LAYERS.map((l, i) => {
          const c = V.layers.centers[i]
          return (
            <GlassCard
              key={l.name}
              x={c.cx - V.layers.w / 2}
              y={c.cy - V.layers.h / 2}
              w={V.layers.w} h={V.layers.h}
              name={l.name} sub={l.sub} icon={l.icon}
              idx={i} kind="layer" ns={ns}
              lit={LANE_DELAY['fan'] + i * 0.06 + 0.85}
            />
          )
        })}
      </g>

      <CheckGate geo={V.check} ns={ns} />

      <g className={styles.execBand}>
        {SETTLEMENT.map((e, i) => {
          const c = V.exec.centers[i]
          return (
            <GlassCard
              key={e.name}
              x={c.cx - V.exec.w / 2}
              y={c.cy - V.exec.h / 2}
              w={V.exec.w} h={V.exec.h}
              name={e.name} sub={e.sub} icon={e.icon}
              idx={i} kind="exec" ns={ns}
              lit={LANE_DELAY['gate-out'] + i * 0.06 + 0.85}
            />
          )
        })}
      </g>
    </svg>
  )
}

/* ══════════════════════════════════════════════════════════════════
   Top-level — picks layout from viewport width
   ══════════════════════════════════════════════════════════════════ */
export default function AgenticFlowDiagram() {
  const [ref, inView] = useInView(0.18)
  const [isHorizontal, setIsHorizontal] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(min-width: 760px)')
    const update = () => setIsHorizontal(mq.matches)
    update()
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [])

  return (
    <div ref={ref} className={`${styles.frame} ${inView ? styles.visible : ''} ${isHorizontal ? styles.frameH : styles.frameV}`}>
      <div className={styles.cardSurface}>
        {isHorizontal
          ? <HorizontalDiagram visible={inView} />
          : <VerticalDiagram   visible={inView} />}
      </div>
    </div>
  )
}
