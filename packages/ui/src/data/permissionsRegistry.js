/**
 * Networks, tokens, and protocols the structured permissions UI understands.
 *
 * Used by the rich PendingModal/MandateDetail renderers to resolve a
 * compact key (e.g. `network: 'arbitrum'`, `asset: 'USDC'`) into the
 * full record with chain ID, token contract address, and protocol logo.
 *
 * All addresses are mainnet — no testnet. Mock data only; nothing in
 * this file is read by an RPC call.
 */

export const NETWORKS = {
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    chainId: 1,
    color: '#627EEA',
    short: 'ETH',
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum',
    chainId: 42161,
    color: '#2D374B',
    short: 'ARB',
  },
  base: {
    id: 'base',
    name: 'Base',
    chainId: 8453,
    color: '#0052FF',
    short: 'BASE',
  },
  optimism: {
    id: 'optimism',
    name: 'Optimism',
    chainId: 10,
    color: '#FF0420',
    short: 'OP',
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    chainId: 137,
    color: '#8247E5',
    short: 'POL',
  },
}

/**
 * Tokens, keyed by symbol. Each token has a per-network address map
 * (some tokens exist on multiple chains under different addresses).
 */
export const TOKENS = {
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    color: '#2775CA',
    decimals: 6,
    addresses: {
      ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      base:     '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      optimism: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    },
  },
  USDT: {
    symbol: 'USDT',
    name: 'Tether USD',
    color: '#26A17B',
    decimals: 6,
    addresses: {
      ethereum: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      arbitrum: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      polygon:  '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    },
  },
  DAI: {
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    color: '#F4B731',
    decimals: 18,
    addresses: {
      ethereum: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      arbitrum: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
      base:     '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    },
  },
  WETH: {
    symbol: 'WETH',
    name: 'Wrapped Ether',
    color: '#627EEA',
    decimals: 18,
    addresses: {
      ethereum: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      arbitrum: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      base:     '0x4200000000000000000000000000000000000006',
    },
  },
  ARB: {
    symbol: 'ARB',
    name: 'Arbitrum',
    color: '#2D374B',
    decimals: 18,
    addresses: {
      arbitrum: '0x912CE59144191C1204E64559FE8253a0e49E6548',
    },
  },
  VVV: {
    symbol: 'VVV',
    name: 'Venice Token',
    color: '#FF3B5C',
    decimals: 18,
    addresses: {
      base: '0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf',
    },
  },
  LINK: {
    symbol: 'LINK',
    name: 'Chainlink',
    color: '#2A5ADA',
    decimals: 18,
    addresses: {
      ethereum: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
      arbitrum: '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4',
      base:     '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196',
    },
  },
  WBTC: {
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin',
    color: '#F7931A',
    decimals: 8,
    addresses: {
      ethereum: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      arbitrum: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    },
  },
  CRV: {
    symbol: 'CRV',
    name: 'Curve DAO Token',
    color: '#A50E0E',
    decimals: 18,
    addresses: {
      ethereum: '0xD533a949740bb3306d119CC777fa900bA034cd52',
      arbitrum: '0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978',
    },
  },
}

/**
 * Protocols / venues — each lists its contract address per network.
 * `kind` is used as a category label in the UI ('Lending', 'AMM', etc).
 */
export const PROTOCOLS = {
  'morpho-blue': {
    id: 'morpho-blue',
    name: 'Morpho Blue',
    kind: 'Lending vaults',
    color: '#2B5CFF',
    addresses: {
      ethereum: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFFb',
      base:     '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFFb',
    },
  },
  aave: {
    id: 'aave',
    name: 'Aave V3',
    kind: 'Lending pool',
    color: '#B6509E',
    addresses: {
      ethereum: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
      arbitrum: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
      base:     '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    },
  },
  compound: {
    id: 'compound',
    name: 'Compound III',
    kind: 'Lending pool',
    color: '#00D395',
    addresses: {
      ethereum: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
      arbitrum: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
      base:     '0xb125E6687d4313864e53df431d5425969c15Eb2F',
    },
  },
  'uniswap-v3': {
    id: 'uniswap-v3',
    name: 'Uniswap V3',
    kind: 'AMM',
    color: '#FF007A',
    addresses: {
      ethereum: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      arbitrum: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      base:     '0x2626664c2603336E57B271c5C0b26F421741e481',
    },
  },
  curve: {
    id: 'curve',
    name: 'Curve',
    kind: 'AMM',
    color: '#A50E0E',
    addresses: {
      ethereum: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7',
      arbitrum: '0x7544Fe3d184b6B55D6B36c3FCA1157eE0Ba30287',
    },
  },
  gmx: {
    id: 'gmx',
    name: 'GMX',
    kind: 'Perps',
    color: '#3D88FF',
    addresses: {
      arbitrum: '0x489ee077994B6658eAfA855C308275EAd8097C4A',
    },
  },
  pendle: {
    id: 'pendle',
    name: 'Pendle',
    kind: 'Fixed yield',
    color: '#00B388',
    addresses: {
      ethereum: '0x888888888889758F76e7103c6CbF23ABbF58F946',
      arbitrum: '0x888888888889758F76e7103c6CbF23ABbF58F946',
    },
  },
  ethena: {
    id: 'ethena',
    name: 'Ethena',
    kind: 'Yield strategy',
    color: '#7AFAA1',
    addresses: {
      ethereum: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497',
    },
  },
  lyra: {
    id: 'lyra',
    name: 'Lyra',
    kind: 'Options',
    color: '#39EBA0',
    addresses: {
      arbitrum: '0x2dD5edEEf3A77fcF8290a44C7CD96fAaa0E96322',
    },
  },
  dopex: {
    id: 'dopex',
    name: 'Dopex',
    kind: 'Options',
    color: '#22E1FF',
    addresses: {
      arbitrum: '0xa12d0FaF12BC4d2DB8DD0F1F94B7C9DA02b2D7A8',
    },
  },
}

/**
 * Action kinds — used for icon + category badge per ActionCard.
 */
export const ACTION_KINDS = {
  deposit:           { label: 'Deposit',     accent: '#1990FF' },
  withdraw:          { label: 'Withdraw',    accent: '#6ba3ff' },
  claim:             { label: 'Claim',       accent: '#5fd28a' },
  swap:              { label: 'Swap',        accent: '#9b8eff' },
  rebalance:         { label: 'Rebalance',   accent: '#ffb84d' },
  'conditional-swap':{ label: 'Conditional', accent: '#ff8a8a' },
  short:             { label: 'Short',       accent: '#ff8a8a' },
  long:              { label: 'Long',        accent: '#5fd28a' },
  hedge:             { label: 'Hedge',       accent: '#9b8eff' },
}

/* ── Lookups ── */
export const getNetwork = (id) => NETWORKS[id]
export const getToken = (symbol) => TOKENS[symbol]
export const getProtocol = (id) => PROTOCOLS[id]
export const getTokenAddress = (symbol, networkId) =>
  TOKENS[symbol]?.addresses?.[networkId]
export const getProtocolAddress = (protocolId, networkId) =>
  PROTOCOLS[protocolId]?.addresses?.[networkId]

/**
 * Truncate a 0x address for display: 0xaf88...e5831
 */
export function truncateAddress(addr, head = 6, tail = 4) {
  if (!addr || addr.length < head + tail + 2) return addr ?? ''
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`
}
