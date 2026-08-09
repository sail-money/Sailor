import { connectorsForWallets, getDefaultConfig } from '@rainbow-me/rainbowkit'
import { injectedWallet, safeWallet } from '@rainbow-me/rainbowkit/wallets'
import { createConfig, http } from 'wagmi'
import * as viemChains from 'wagmi/chains'
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

// ── WalletConnect project id ────────────────────────────────────────────────
// WalletConnect needs a Reown project id (https://cloud.reown.com). It is a
// public app identifier rather than a secret, but it must be a *registered*
// one: the relay answers 403 to anything else, and after that 403 the
// connector can never produce a pairing URI. The visible symptom is that
// choosing "WalletConnect" in the connect modal highlights the row and then
// nothing happens — no QR, no error. So a placeholder id is strictly worse
// than none, and we omit the wallet entirely rather than render a dead row.
//
// This id is per-operator: set WALLETCONNECT_PROJECT_ID in .sail/.env.local.
//
// The id is also shape-checked (32 hex characters). Since every operator now
// types it in by hand, a truncated or mis-pasted value is otherwise
// indistinguishable from a good one until the relay 403s — at which point the
// row goes silently dead again, the very symptom this fix removes.
const PROJECT_ID_RE = /^[0-9a-f]{32}$/i

function resolveProjectId() {
  // Runtime value wins. The npm package ships a pre-built `dist`, so anything
  // read through `import.meta.env` is frozen at publish time and an operator
  // can never set it; `sailor ui` therefore injects window.__SAILOR_CONFIG__
  // into index.html from .sail/.env.local. The build-time var stays as the
  // path for `vite dev` in this repo.
  const runtime = globalThis.window?.__SAILOR_CONFIG__?.walletConnectProjectId
  const buildTime = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID
  const id = String(runtime ?? buildTime ?? '').trim()
  if (id === '') return ''
  if (!PROJECT_ID_RE.test(id)) {
    console.warn(
      `[Sailor] WALLETCONNECT_PROJECT_ID is not a valid Reown project id ` +
        `(expected 32 hex characters, got ${id.length}). WalletConnect is ` +
        `disabled — connecting a Safe over WalletConnect will not be offered. ` +
        `Set a real id from https://cloud.reown.com in .sail/.env.local.`,
    )
    return ''
  }
  return id
}

export const walletConnectProjectId = resolveProjectId()

/** False when no project id is configured — the connect modal then offers only
 *  wallets that work without the WalletConnect relay. */
export const walletConnectEnabled = walletConnectProjectId !== ''

/**
 * `sandbox`, when given `{ forks: { [chainId]: rpcUrl }, primaryChainId }`,
 * builds a config with ONLY the sandbox's own dev-wallet connector —
 * `multiInjectedProviderDiscovery: false` so a real wallet extension installed
 * in the browser can neither appear nor auto-reconnect on a sandbox page.
 * Every chain still needs a transport (not just the forked ones) or
 * RainbowKitProvider crashes at mount on a partial map; every chain with no
 * fork of its own gets its normal default RPC, unchanged.
 *
 * Otherwise this is the live config. With a project id: RainbowKit's default
 * wallet set (WalletConnect included), which is what lets a Safe be connected
 * through Safe's WalletConnect app. Without one: injected browser wallets plus
 * `safeWallet`, which speaks the Safe Apps SDK over the iframe and so needs no
 * relay at all.
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
  return walletConnectEnabled
    ? getDefaultConfig({
        appName: 'Sailor',
        projectId: walletConnectProjectId,
        chains,
        ssr: false,
      })
    : createConfig({
        chains,
        connectors: connectorsForWallets(
          [{ groupName: 'Installed', wallets: [injectedWallet, safeWallet] }],
          { appName: 'Sailor', projectId: '' },
        ),
        transports: Object.fromEntries(chains.map((c) => [c.id, http()])),
      })
}

export const wagmiConfig = buildWagmiConfig(null)
