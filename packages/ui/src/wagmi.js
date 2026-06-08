import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { mainnet, sepolia, arbitrum, arbitrumSepolia, base, baseSepolia } from 'wagmi/chains'
import { defineChain, http } from 'viem'

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

export const chains = [
  base, arbitrum, mainnet, unichain,
  baseSepolia, arbitrumSepolia, unichainSepolia, sepolia,
]

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'sailor-local-dev'

/**
 * Build the wagmi config.
 *
 * When `rpcOverride` is supplied (the project is configured against a custom or
 * local RPC — see GET /api/network), the dapp's own transport for that chain is
 * pointed at the local RPC. This matters because wagmi/viem run a preflight
 * (e.g. `eth_getTransactionCount`, gas estimation) for owner-signed
 * transactions; without the override those reads go to the chain's *public*
 * RPC even when the wallet is switched to the local node, producing the
 * timeouts/mismatches seen during fork onboarding. With the override, reads and
 * preflight hit the same endpoint the wallet is on.
 *
 * Generic by design: any custom/local RPC works; nothing here is specific to a
 * particular simulation tool.
 *
 * @param {{ rpcUrl?: string|null, chainId?: number|null }} [rpcOverride]
 */
export function buildWagmiConfig(rpcOverride) {
  const hasOverride = Boolean(rpcOverride && rpcOverride.rpcUrl && rpcOverride.chainId)

  // When overriding, wagmi's createConfig requires a transport for EVERY chain
  // (a partial `transports` map leaves the other chains with none and throws at
  // provider mount). So build a complete map: each chain keeps its default
  // public transport (`http()` with no URL), and only the target chain is
  // redirected at the local RPC. With no override we omit `transports` entirely
  // and let getDefaultConfig build its own defaults.
  const transports = hasOverride
    ? Object.fromEntries(
        chains.map((c) => [
          c.id,
          c.id === rpcOverride.chainId ? http(rpcOverride.rpcUrl) : http(),
        ]),
      )
    : undefined

  return getDefaultConfig({
    appName: 'Sailor',
    projectId,
    chains,
    ssr: false,
    ...(transports ? { transports } : {}),
  })
}
