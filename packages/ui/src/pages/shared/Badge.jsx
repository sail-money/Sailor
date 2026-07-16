/**
 * Metadata badge — on-brand, square, dynamic.
 *
 * One cohesive pill used everywhere a permission's metadata (protocol, chain,
 * version…) is shown. The swatch is chosen deterministically from the label, so
 * badges stay dynamic and scalable (any new protocol/chain gets a stable color),
 * but the choices are constrained to the Sail palette — cool brand tints only —
 * so colors never drift off-brand. Square corners to match the app's surfaces.
 */

// Sail-blue tints only. The hash selects WITHIN this set, so a badge's hue is
// always on-brand (one accent hue — no green/purple/teal drift) regardless of
// the label that hashes in.
const PALETTE = [
  '#4DABFF', // Sail blue (bright)
  '#7EB8F7', // soft blue
  '#3E90E6', // mid blue
  '#A9CEFB', // pale blue
]

// Stable string → palette index. Same input always yields the same swatch.
function indexFromString(s, n) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % n
}

function Badge({ children, title }) {
  const label = String(children ?? '')
  if (!label) return null
  const c = PALETTE[indexFromString(label.toLowerCase(), PALETTE.length)]
  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        maxWidth: '100%',
        padding: '2px 9px',
        borderRadius: 2,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        background: `${c}22`,
        color: c,
        border: `1px solid ${c}55`,
      }}
    >
      {children}
    </span>
  )
}

/** Row wrapper: lays badges out with consistent spacing and clean wrapping. */
export function BadgeRow({ items }) {
  const present = (items ?? []).filter(Boolean)
  if (present.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
      {present.map((it) => <Badge key={it} title={it}>{it}</Badge>)}
    </div>
  )
}
