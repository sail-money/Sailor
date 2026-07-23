/* Sailor-dashboard presentation for each chain, keyed by chainId.
 *
 * This is the UI-only counterpart to the SDK chain registry (@sail/sdk/chains):
 * the SDK owns objective facts (name, slug, explorer, RPC, native currency); this
 * file owns how a chain LOOKS in the dashboard — brand color, the onboarding
 * blurb, and the managed-RPC provider hosts used by the "paste an API key" flow.
 * Marketing copy and brand hex deliberately do NOT live in the published SDK.
 *
 * Every NON-testnet chain in the SDK registry MUST have an entry here. That is
 * enforced at build time by the chain-coverage plugin in vite.config.js — a
 * chain added to the SDK without a presentation entry fails `vite build`.
 *
 * Per-chain SVG icons live separately in pages/shared/ChainGlyph.jsx (an icon is
 * optional — a chain with no mark falls back to a neutral dot). */
export const CHAIN_PRESENTATION = {
  1:     { color: '#627eea', description: 'The original chain.',
           alchemyHost: 'eth-mainnet.g.alchemy.com', infuraHost: 'mainnet.infura.io' },
  8453:  { color: '#0052ff', description: 'Fast, cheap Coinbase L2.',
           alchemyHost: 'base-mainnet.g.alchemy.com', infuraHost: 'base-mainnet.infura.io' },
  42161: { color: '#28a0f0', description: 'Low-fee Ethereum L2.',
           alchemyHost: 'arb-mainnet.g.alchemy.com', infuraHost: 'arbitrum-mainnet.infura.io' },
  130:   { color: '#ff007a', description: 'Uniswap-native L2.',
           alchemyHost: 'unichain-mainnet.g.alchemy.com', infuraHost: 'unichain-mainnet.infura.io' },
  10:    { color: '#ff0420', description: 'OP Stack L2.',
           alchemyHost: 'opt-mainnet.g.alchemy.com', infuraHost: 'optimism-mainnet.infura.io' },
  56:    { color: '#f3ba2f', description: 'High-throughput BNB chain.',
           alchemyHost: 'bnb-mainnet.g.alchemy.com', infuraHost: 'bsc-mainnet.infura.io' },
  480:   { color: '#dfe3e8', description: 'Worldcoin L2.',
           alchemyHost: 'worldchain-mainnet.g.alchemy.com' },
  999:   { color: '#50d2c1', description: 'Hyperliquid EVM.',
           alchemyHost: 'hyperliquid-mainnet.g.alchemy.com' },
  4326:  { color: '#ffffff', description: 'Real-time EVM.',
           alchemyHost: 'megaeth-mainnet.g.alchemy.com' },
  4663:  { color: '#ccff00', description: 'Robinhood Chain.',
           alchemyHost: 'robinhood-mainnet.g.alchemy.com' },
}
