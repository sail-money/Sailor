import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { arbitrum, base, mainnet, optimism, polygon } from 'wagmi/chains'

/**
 * Supported EVM chains. mainnet is the default (listed first); the user
 * can switch to any of the others from the RainbowKit chain selector.
 * Sail SMAs are single-chain, so the connected chain selects which SMA
 * the dashboard reads.
 */
export const chains = [mainnet, arbitrum, base, optimism, polygon]

/**
 * A WalletConnect projectId is required by getDefaultConfig. Injected
 * wallets (MetaMask, Rabby, etc.) work locally without a real one; set
 * VITE_WALLETCONNECT_PROJECT_ID to enable WalletConnect/mobile wallets.
 */
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'sailor-local-dev'

export const wagmiConfig = getDefaultConfig({
  appName: 'Sailor',
  projectId,
  chains,
  ssr: false,
})
