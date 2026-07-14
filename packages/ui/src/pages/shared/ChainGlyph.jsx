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
  10:       '#ff0420', // Optimism
  11155420: '#ff0420', // OP Sepolia
  56:       '#f3ba2f', // BNB Smart Chain
  97:       '#f3ba2f', // BNB Testnet
  480:      '#dfe3e8', // World Chain (brand is black/white — light tint for dark surfaces)
  4801:     '#dfe3e8', // World Chain Sepolia
  999:      '#50d2c1', // HyperEVM (Hyperliquid mint)
  998:      '#50d2c1', // HyperEVM Testnet
  4326:     '#ffffff', // MegaETH
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
  // Base — squared (rounded-square) brand mark
  if (chainId === 8453 || chainId === 84532) return (
    <svg viewBox="0 0 249 249" xmlns="http://www.w3.org/2000/svg">
      <path fill={color} d="M0 19.671C0 12.9332 0 9.56425 1.26956 6.97276C2.48511 4.49151 4.49151 2.48511 6.97276 1.26956C9.56425 0 12.9332 0 19.671 0H229.329C236.067 0 239.436 0 242.027 1.26956C244.508 2.48511 246.515 4.49151 247.73 6.97276C249 9.56425 249 12.9332 249 19.671V229.329C249 236.067 249 239.436 247.73 242.027C246.515 244.508 244.508 246.515 242.027 247.73C239.436 249 236.067 249 229.329 249H19.671C12.9332 249 9.56425 249 6.97276 247.73C4.49151 246.515 2.48511 244.508 1.26956 242.027C0 239.436 0 236.067 0 229.329V19.671Z" />
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
  // Optimism — "op" lettermark
  if (chainId === 10 || chainId === 11155420) return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill={color} fillRule="evenodd" clipRule="evenodd" d="M3.966 15.8q.979.7 2.512.7 1.854 0 2.962-.838 1.108-.85 1.559-2.562.27-1.05.464-2.163.063-.398.064-.663 0-.874-.451-1.499a2.7 2.7 0 0 0-1.237-.95Q9.053 7.5 8.062 7.5q-3.644 0-4.52 3.437a40 40 0 0 0-.477 2.163q-.058.335-.065.674 0 1.314.966 2.026m4.65-2.775c-.247.957-.926 1.58-1.958 1.58-1.02 0-1.368-.69-1.184-1.58a27 27 0 0 1 .464-2.05c.265-1.034.89-1.58 1.956-1.58 1.017 0 1.348.68 1.173 1.58a30 30 0 0 1-.451 2.05m3.902 3.385q.076.09.214.089h1.704a.38.38 0 0 0 .238-.089.36.36 0 0 0 .138-.232l.538-2.52h1.733c1.094 0 1.95-.53 2.576-1.002q.953-.707 1.266-2.186.075-.348.075-.67 0-1.117-.851-1.71-.84-.591-2.23-.591h-3.333a.38.38 0 0 0-.238.09.38.38 0 0 0-.138.232l-1.73 8.356a.3.3 0 0 0 .038.232m6.09-5.966c-.157.689-.757 1.319-1.462 1.319h-1.44l.496-2.369h1.503c.512 0 .94.102.94.665q0 .165-.037.385" />
    </svg>
  )
  // BNB Smart Chain — official four-diamond mark
  if (chainId === 56 || chainId === 97) return (
    <svg viewBox="0 0 24 24" fill={color} xmlns="http://www.w3.org/2000/svg">
      <path d="M16.624 13.9202l2.7175 2.7154-7.353 7.353-7.353-7.352 2.7175-2.7164 4.6355 4.6595 4.6356-4.6595zm4.6366-4.6366L24 12l-2.7154 2.7164L18.5682 12l2.6924-2.7164zm-9.272.001l2.7163 2.6914-2.7164 2.7174v-.001L9.2721 12l2.7164-2.7154zm-9.2722-.001L5.4088 12l-2.6914 2.6924L0 12l2.7164-2.7164zM11.9885.0115l7.353 7.329-2.7174 2.7154-4.6356-4.6356-4.6355 4.6595-2.7174-2.7154 7.353-7.353z" />
    </svg>
  )
  // World Chain — globe enclosing the "∈" (element-of) mark
  if (chainId === 480 || chainId === 4801) return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill={color} d="M16.513 4.203A8.8 8.8 0 0 0 12 3Q9.555 3 7.487 4.203a8.97 8.97 0 0 0-3.284 3.284A8.8 8.8 0 0 0 3 12q0 2.445 1.203 4.512a8.97 8.97 0 0 0 3.284 3.285A8.8 8.8 0 0 0 12 21q2.445 0 4.512-1.203a8.97 8.97 0 0 0 3.285-3.285A8.8 8.8 0 0 0 21 12q0-2.445-1.203-4.513a8.97 8.97 0 0 0-3.285-3.284M12.55 15.26c-1.027 0-1.83-.3-2.456-.877a2.74 2.74 0 0 1-.828-1.454h9.727c-.1.827-.35 1.604-.701 2.331h-5.741m-3.284-4.161a2.84 2.84 0 0 1 .828-1.455c.626-.576 1.429-.877 2.457-.877h5.74c.377.727.602 1.504.702 2.332zM5.908 8.415a7 7 0 0 1 2.557-2.582 6.94 6.94 0 0 1 3.56-.953 6.94 6.94 0 0 1 3.56.953 7.3 7.3 0 0 1 1.48 1.153h-4.539c-1.027 0-1.955.226-2.757.652a4.54 4.54 0 0 0-1.855 1.78 5.1 5.1 0 0 0-.602 1.705H5.081c.1-.953.4-1.856.877-2.683zm9.652 9.752a6.94 6.94 0 0 1-3.56.953 6.94 6.94 0 0 1-3.56-.953 7 7 0 0 1-2.557-2.582 6.7 6.7 0 0 1-.877-2.657h2.23a5.2 5.2 0 0 0 .602 1.704c.452.752 1.078 1.329 1.856 1.78.802.426 1.73.652 2.757.652h4.513a6.8 6.8 0 0 1-1.43 1.103z" />
    </svg>
  )
  // HyperEVM — Hyperliquid wave mark
  if (chainId === 999 || chainId === 998) return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill={color} d="M21 11.937a9.4 9.4 0 0 1-.901 4.112c-.867 1.863-2.947 3.387-4.846 1.765-1.55-1.322-1.837-4.005-4.157-4.398-3.07-.361-3.145 3.092-5.15 3.482-2.236.44-2.978-3.206-2.945-4.862s.487-3.984 2.43-3.984c2.236 0 2.386 3.283 5.224 3.105 2.81-.186 2.86-3.602 4.696-5.064 1.585-1.264 3.448-.337 4.381 1.184.865 1.406 1.245 3.057 1.265 4.66z" />
    </svg>
  )
  // MegaETH — M mascot
  if (chainId === 4326) return (
    <svg viewBox="0 0 24 24" fill={color} xmlns="http://www.w3.org/2000/svg">
      <path d="M3 16.5V5h2.8L12 12.2 18.2 5H21v11.5h-2.6V9.2L12 16.6 5.6 9.2v7.3z" />
      <circle cx="9.4" cy="20" r="1.3" />
      <circle cx="14.6" cy="20" r="1.3" />
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
