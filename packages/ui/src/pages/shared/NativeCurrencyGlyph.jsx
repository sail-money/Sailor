import { nativeCurrencySymbol } from '../../lib/explorer'

/* Ethereum diamond — single accent hue at varied opacities (design manual §3).
   Shared fallback for every ETH-native chain (Ethereum, Base, Arbitrum, Unichain, …). */
function EthMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden>
      <path d="M16 3 7.8 16.6 16 12.9Z" fill="#1990ff" />
      <path d="M16 3 24.2 16.6 16 12.9Z" fill="#1990ff" opacity="0.55" />
      <path d="M16 20.2 7.8 16.6 16 12.9Z" fill="#1990ff" opacity="0.8" />
      <path d="M16 20.2 24.2 16.6 16 12.9Z" fill="#1990ff" opacity="0.4" />
      <path d="M16 29 7.8 18.2 16 21.7Z" fill="#1990ff" />
      <path d="M16 29 24.2 18.2 16 21.7Z" fill="#1990ff" opacity="0.55" />
    </svg>
  )
}

/* BNB Smart Chain — official four-diamond mark, same path + tint as ChainGlyph. */
function BnbMark() {
  return (
    <svg viewBox="0 0 24 24" fill="#f3ba2f" xmlns="http://www.w3.org/2000/svg">
      <path d="M16.624 13.9202l2.7175 2.7154-7.353 7.353-7.353-7.352 2.7175-2.7164 4.6355 4.6595 4.6356-4.6595zm4.6366-4.6366L24 12l-2.7154 2.7164L18.5682 12l2.6924-2.7164zm-9.272.001l2.7163 2.6914-2.7164 2.7174v-.001L9.2721 12l2.7164-2.7154zm-9.2722-.001L5.4088 12l-2.6914 2.6924L0 12l2.7164-2.7164zM11.9885.0115l7.353 7.329-2.7174 2.7154-4.6356-4.6356-4.6355 4.6595-2.7174-2.7154 7.353-7.353z" />
    </svg>
  )
}

/* HyperEVM — Hyperliquid wave mark, same path + tint as ChainGlyph. */
function HypeMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill="#50d2c1" d="M21 11.937a9.4 9.4 0 0 1-.901 4.112c-.867 1.863-2.947 3.387-4.846 1.765-1.55-1.322-1.837-4.005-4.157-4.398-3.07-.361-3.145 3.092-5.15 3.482-2.236.44-2.978-3.206-2.945-4.862s.487-3.984 2.43-3.984c2.236 0 2.386 3.283 5.224 3.105 2.81-.186 2.86-3.602 4.696-5.064 1.585-1.264 3.448-.337 4.381 1.184.865 1.406 1.245 3.057 1.265 4.66z" />
    </svg>
  )
}

/**
 * The native-gas-token mark for a balance display, resolved by currency symbol
 * (via nativeCurrencySymbol(chainId)) rather than by chain — every ETH-native
 * chain (Ethereum, Base, Arbitrum, Unichain, …) keeps the existing diamond
 * unchanged; only BNB and HYPE get their own mark. Reuses the exact paths and
 * tint colors already defined in ChainGlyph for those two chains, so the
 * balance-card icon never drifts from the chain-switcher icon.
 */
export default function NativeCurrencyGlyph({ chainId, size = 20 }) {
  const symbol = nativeCurrencySymbol(chainId)
  const Mark = symbol === 'BNB' ? BnbMark : symbol === 'HYPE' ? HypeMark : EthMark
  return (
    <span aria-hidden style={{ display: 'inline-flex', width: size, height: size, flexShrink: 0 }}>
      <Mark />
    </span>
  )
}
