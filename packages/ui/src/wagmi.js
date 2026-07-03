import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { mainnet, sepolia, arbitrum, arbitrumSepolia, base, baseSepolia, optimism, bsc, worldchain } from 'wagmi/chains'
import { defineChain } from 'viem'

const unichain = defineChain({
  id: 130,
  name: 'Unichain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.unichain.org/'] } },
  blockExplorers: { default: { name: 'Uniscan', url: 'https://uniscan.xyz' } },
})

const unichainSepolia = defineChain({
  id: 1301,
  name: 'Unichain Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia.unichain.org/'] } },
  blockExplorers: { default: { name: 'Uniscan Sepolia', url: 'https://sepolia.uniscan.xyz' } },
  testnet: true,
})

// Not (yet) published in wagmi/chains — defined here from the Sail Protocol deployment data.
const hyperevm = defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
  blockExplorers: { default: { name: 'HyperEVM Scan', url: 'https://hyperevmscan.io' } },
})

const megaeth = defineChain({
  id: 4326,
  name: 'MegaETH',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.megaeth.com/rpc'] } },
  blockExplorers: { default: { name: 'MegaExplorer', url: 'https://megaexplorer.xyz' } },
})

export const chains = [
  base, arbitrum, mainnet, unichain, optimism, bsc, worldchain, hyperevm, megaeth,
  baseSepolia, arbitrumSepolia, unichainSepolia, sepolia,
]

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'sailor-local-dev'

export const wagmiConfig = getDefaultConfig({
  appName: 'Sailor',
  projectId,
  chains,
  ssr: false,
})
