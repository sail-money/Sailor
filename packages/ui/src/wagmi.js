import { getDefaultConfig, connectorsForWallets } from '@rainbow-me/rainbowkit'
import { createConfig, createConnector } from 'wagmi'
import { injected } from 'wagmi/connectors'
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

const SIM_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNiIgZmlsbD0iI2YwYiIvPjwvc3ZnPg=='

/** Build a full transports map: default public http() per chain, with the target
 *  chain (if any) redirected at the local/custom RPC. */
function buildTransports(rpcOverride) {
  const hasOverride = Boolean(rpcOverride && rpcOverride.rpcUrl && rpcOverride.chainId)
  return Object.fromEntries(
    chains.map((c) => [
      c.id,
      hasOverride && c.id === rpcOverride.chainId ? http(rpcOverride.rpcUrl) : http(),
    ]),
  )
}

/**
 * A RainbowKit custom wallet that wraps a specific injected provider (our local
 * fork "sim wallet"). Using an explicit `target` provider — rather than the
 * ambient `window.ethereum` — means it binds to the sim provider even when a
 * real extension (Rabby/MetaMask) owns `window.ethereum`.
 */
function simWallet(provider) {
  return () => ({
    id: 'sailSim',
    name: 'Sim Wallet (fork)',
    iconUrl: SIM_ICON,
    iconBackground: '#ff00bb',
    createConnector: (walletDetails) =>
      createConnector((config) => ({
        ...injected({ target: () => ({ id: 'sailSim', name: 'Sim Wallet (fork)', provider }) })(config),
        ...walletDetails,
      })),
  })
}

/**
 * Build the wagmi config.
 *
 * Two modes:
 *
 *  • **Simulation** (`simProvider` supplied — `?sim=1` on a local fork): present
 *    ONLY the sim wallet and disable EIP-6963 injected-provider discovery, so a
 *    real extension (Rabby/MetaMask) can neither appear in the connect list nor
 *    auto-reconnect from a prior session and start popping signing prompts. The
 *    fork's unlocked account signs every tx, so onboarding runs hands-free.
 *
 *  • **Normal**: `getDefaultConfig` with the usual wallet set. When the project
 *    points at a custom/local RPC (see GET /api/network) the dapp's transport
 *    for that chain is pointed at it so reads and owner-signing preflight hit the
 *    same endpoint the wallet is on.
 *
 * @param {{ rpcUrl?: string|null, chainId?: number|null }} [rpcOverride]
 * @param {object|null} [simProvider] EIP-1193 sim provider (from maybeInstallSimWallet)
 */
export function buildWagmiConfig(rpcOverride, simProvider) {
  const hasOverride = Boolean(rpcOverride && rpcOverride.rpcUrl && rpcOverride.chainId)

  if (simProvider) {
    const connectors = connectorsForWallets(
      [{ groupName: 'Simulation', wallets: [simWallet(simProvider)] }],
      { appName: 'Sailor', projectId },
    )
    return createConfig({
      chains,
      connectors,
      ssr: false,
      multiInjectedProviderDiscovery: false,
      transports: buildTransports(rpcOverride),
    })
  }

  // Normal mode: a partial `transports` map leaves the other chains with none
  // and throws at provider mount, so only pass a (complete) map when overriding.
  const transports = hasOverride ? buildTransports(rpcOverride) : undefined
  return getDefaultConfig({
    appName: 'Sailor',
    projectId,
    chains,
    ssr: false,
    ...(transports ? { transports } : {}),
  })
}
