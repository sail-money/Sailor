/* Flat, single-hue chain marks — the "precise · dark · electric" take on
   chain identity. Unlike ChainIcon (full-colour circular badges), these are
   monochrome geometry tinted with each chain's brand hue, so they sit cleanly
   on the sail-card surfaces in both onboarding and the dashboard.

   One source of truth for both the mark and the brand colour, keyed by chainId
   (mainnet + matching testnet share a mark). */

const CHAIN_COLORS = {
  1:        '#627eea', // Ethereum
  11155111: '#627eea', // Ethereum Sepolia
  8453:     '#0052ff', // Base
  84532:    '#0052ff', // Base Sepolia
  42161:    '#28a0f0', // Arbitrum One
  421614:   '#28a0f0', // Arbitrum Sepolia
  130:      '#ff007a', // Unichain
  1301:     '#ff007a', // Unichain Sepolia
}

function chainColor(chainId) {
  return CHAIN_COLORS[chainId] ?? 'rgba(255,255,255,0.5)'
}

function Mark({ chainId, color }) {
  // Ethereum — twin rhombus
  if (chainId === 1 || chainId === 11155111) return (
    <svg viewBox="0 0 24 24" fill={color} xmlns="http://www.w3.org/2000/svg">
      <path d="M11.944 17.97L4.58 13.62 11.943 24l7.37-10.38-7.372 4.35h.003zM12.056 0L4.69 12.223l7.365 4.354 7.365-4.35L12.056 0z" />
    </svg>
  )
  // Base — disc with a struck bar
  if (chainId === 8453 || chainId === 84532) return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path fill={color} fillRule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Z M2.2 10.5h11.1v3H2.2Z" />
    </svg>
  )
  // Arbitrum — faceted mark (native 2500 viewBox, fully tinted)
  if (chainId === 42161 || chainId === 421614) return (
    <svg viewBox="0 0 2500 2500" xmlns="http://www.w3.org/2000/svg">
      <g fill={color}>
        <path d="M1435,1440l-121,332c-3,9-3,19,0,29l208,571l241-139l-289-793C1467,1422,1442,1422,1435,1440z" />
        <path d="M1678,882c-7-18-32-18-39,0l-121,332c-3,9-3,19,0,29l341,935l241-139L1678,883V882z" />
        <path d="M1250,155c6,0,12,2,17,5l918,530c11,6,17,18,17,30v1060c0,12-7,24-17,30l-918,530c-5,3-11,5-17,5s-12-2-17-5l-918-530c-11-6-17-18-17-30V719c0-12,7-24,17-30l918-530c5-3,11-5,17-5l0,0V155z M1250,0c-33,0-65,8-95,25L237,555c-59,34-95,96-95,164v1060c0,68,36,130,95,164l918,530c29,17,62,25,95,25s65-8,95-25l918-530c59-34,95-96,95-164V719c0-68-36-130-95-164L1344,25c-29-17-62-25-95-25l0,0H1250z" />
        <path d="M1172,644H939c-17,0-33,11-39,27L401,2039l241,139l550-1507c5-14-5-28-19-28L1172,644z" />
        <path d="M1580,644h-233c-17,0-33,11-39,27L738,2233l241,139l620-1701c5-14-5-28-19-28V644z" />
      </g>
    </svg>
  )
  // Unichain — stroked four-point spiral
  if (chainId === 130 || chainId === 1301) return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2.5C12 8 8 12 2.5 12 8 12 12 16 12 21.5 12 16 16 12 21.5 12 16 12 12 8 12 2.5Z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
  // Fallback — neutral dot
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="6" fill={color} />
    </svg>
  )
}

/**
 * A monochrome chain mark tinted with the chain's brand colour.
 *
 * Props:
 *   chainId — numeric chain id (mainnet or testnet)
 *   size    — px square (default 20)
 *   color   — override the brand colour (e.g. muted for "coming soon")
 */
export default function ChainGlyph({ chainId, size = 20, color }) {
  const tint = color ?? chainColor(chainId)
  return (
    <span
      aria-hidden
      style={{ display: 'inline-flex', width: size, height: size, flexShrink: 0 }}
    >
      <Mark chainId={chainId} color={tint} />
    </span>
  )
}
