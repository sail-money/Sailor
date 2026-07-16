import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import * as viemChains from 'wagmi/chains'
import { createConfig, http } from 'wagmi'
import { chains as sailChains } from '@sail/sdk/chains'
import { defineChain } from 'viem'
import { createSandboxConnector } from './lib/sandboxWallet'

// viem/wagmi's built-in chain objects for the SDK-supported ids only, indexed
// by id. These carry the full metadata (multicall3, ENS, etc.) wagmi relies on,
// so we use the real object wherever viem ships one.
const SDK_CHAIN_IDS = new Set(Object.values(sailChains).map((c) => c.chainId))
const VIEM_CHAINS_BY_ID = Object.fromEntries(
  Object.values(viemChains)
    .filter((c) => c && typeof c === 'object' && SDK_CHAIN_IDS.has(c.id))
    .map((c) => [c.id, c]),
)

// Fallback for a Sail chain viem doesn't ship (e.g. Robinhood, MegaETH):
// generate the viem chain from the SDK registry.
const fromSdk = (c) => defineChain({
  id: c.chainId,
  name: c.displayName ?? c.name,
  nativeCurrency: c.nativeCurrency,
  rpcUrls: { default: { http: [c.defaultRpcUrl] } },
  ...(c.blockExplorer ? { blockExplorers: { default: c.blockExplorer } } : {}),
  ...(c.testnet ? { testnet: true } : {}),
})

// The wallet's chain list = exactly the SDK-supported chain ids, using viem's
// real chain object where available and generating from the SDK otherwise.
// Adding a chain to the SDK surfaces it here with no edit.
export const chains = Object.values(sailChains).map(
  (c) => VIEM_CHAINS_BY_ID[c.chainId] ?? fromSdk(c),
)

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'sailor-local-dev'

/**
 * `sandbox`, when given `{ forks: { [chainId]: rpcUrl }, primaryChainId }`,
 * builds a config with ONLY the sandbox's own dev-wallet connector —
 * `multiInjectedProviderDiscovery: false` so a real wallet extension installed
 * in the browser can neither appear nor auto-reconnect on a sandbox page.
 * Every chain still needs a transport (not just the forked ones) or
 * RainbowKitProvider crashes at mount on a partial map; every chain with no
 * fork of its own gets its normal default RPC, unchanged.
 */
export function buildWagmiConfig(sandbox) {
  if (sandbox?.forks && Object.keys(sandbox.forks).length > 0) {
    const forks = Object.fromEntries(Object.entries(sandbox.forks).map(([id, url]) => [Number(id), url]))
    return createConfig({
      chains,
      connectors: [createSandboxConnector({ forks, primaryChainId: sandbox.primaryChainId })],
      transports: Object.fromEntries(
        chains.map((c) => [c.id, http(forks[c.id])]),
      ),
      multiInjectedProviderDiscovery: false,
      ssr: false,
    })
  }
  return getDefaultConfig({ appName: 'Sailor', projectId, chains, ssr: false })
}

export const wagmiConfig = buildWagmiConfig(null)
