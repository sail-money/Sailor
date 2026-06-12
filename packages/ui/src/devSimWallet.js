/**
 * LOCAL-ONLY simulated wallet (test harness — not a product feature).
 *
 * When the dapp is pointed at a local fork (GET /api/network → isLocal) AND the
 * URL carries an explicit opt-in (`?sim=1`), this installs a minimal EIP-1193
 * provider that proxies every JSON-RPC call to the local node. Because a local
 * anvil fork keeps its dev accounts **unlocked**, `eth_sendTransaction` is signed
 * by the node itself — no private key ever touches the browser. This lets the
 * full RainbowKit/wagmi connect → deploy-SMA → attach-manager onboarding flow run
 * end-to-end against a shipyard fork without a human-driven browser wallet.
 *
 * Gated so it has ZERO effect anywhere else: no `?sim=1`, or a non-local RPC, and
 * this is a no-op. Generic by design (nothing here is shipyard-specific — it just
 * surfaces the local node's unlocked accounts as an injected wallet).
 *
 * Default owner is anvil dev account 0; override with `?owner=0x…`.
 */

const DEFAULT_OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

export function maybeInstallSimWallet(localNetwork, forks = {}) {
  if (typeof window === 'undefined') return false
  let params
  try { params = new URLSearchParams(window.location.search) } catch { return false }
  if (params.get('sim') !== '1') return false
  if (!localNetwork?.isLocal || !localNetwork.rpcUrl || !localNetwork.chainId) {
    console.warn('[sim-wallet] ?sim=1 but no local RPC detected — not installing.')
    return false
  }

  const account = (params.get('owner') || DEFAULT_OWNER)
  let rpcId = 0

  // Multi-fork routing. Each chain's calls go to ITS fork: the active fork
  // (localNetwork) is always known; additional forks for the other selected
  // chains come from the sim-fork manifest (GET /api/sim/forks). `currentChainId`
  // follows wallet_switchEthereumChain, and we refresh the manifest on every
  // switch so forks spun up AFTER page load (during onboarding) are picked up.
  // This lets a multi-chain SMA deploy hit the right fork per chain with no reload.
  const forkRpc = new Map([[Number(localNetwork.chainId), localNetwork.rpcUrl]])
  for (const [cid, f] of Object.entries(forks || {})) {
    if (f?.rpcUrl) forkRpc.set(Number(cid), f.rpcUrl)
  }
  let currentChainId = Number(localNetwork.chainId)
  // The fork URL for a chain, or null if we have none. The active chain always
  // has one (localNetwork); other chains only once their fork is up.
  const rpcUrlFor = (cid) =>
    forkRpc.get(Number(cid)) || (Number(cid) === Number(localNetwork.chainId) ? localNetwork.rpcUrl : null)

  async function refreshForks() {
    try {
      const data = await fetch('/api/sim/forks', { cache: 'no-store' }).then((r) => r.json())
      for (const [cid, f] of Object.entries(data?.forks || {})) {
        if (f?.rpcUrl) forkRpc.set(Number(cid), f.rpcUrl)
      }
    } catch { /* keep what we have */ }
  }

  async function rpc(method, rpcParams = []) {
    const url = rpcUrlFor(currentChainId)
    if (!url) {
      // Refuse to route to the wrong chain's fork (which would hang on receipt
      // polling). Surfaces as a clear wallet error instead of a silent stall.
      const err = new Error(`[sim-wallet] no local fork for chain ${currentChainId}. Run \`shipyard watch\` (or re-run \`shipyard up\`) and select this chain so its fork spins up.`)
      err.code = 4900
      throw err
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params: rpcParams }),
    })
    const json = await res.json()
    if (json.error) {
      const err = new Error(json.error.message || 'RPC error')
      err.code = json.error.code
      err.data = json.error.data
      throw err
    }
    return json.result
  }

  const listeners = {}
  function emit(event, data) { (listeners[event] || []).forEach((fn) => { try { fn(data) } catch {} }) }

  const provider = {
    isMetaMask: true,        // so RainbowKit's MetaMask entry binds to us
    isSimWallet: true,
    async request({ method, params = [] }) {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [account]
        case 'eth_chainId':
          return `0x${currentChainId.toString(16)}`
        case 'net_version':
          return String(currentChainId)
        case 'wallet_switchEthereumChain': {
          // Follow the dapp to the target chain and route subsequent calls at
          // that chain's fork. Refresh the manifest so a just-spun-up fork is seen.
          const target = params?.[0]?.chainId
          if (target) {
            currentChainId = parseInt(target, 16)
            await refreshForks()
            emit('chainChanged', `0x${currentChainId.toString(16)}`)
          }
          return null
        }
        case 'wallet_addEthereumChain':
          return null
        case 'wallet_requestPermissions':
          return [{ parentCapability: 'eth_accounts' }]
        case 'wallet_getPermissions':
          return [{ parentCapability: 'eth_accounts' }]
        default:
          // eth_sendTransaction, eth_getTransactionCount, eth_estimateGas,
          // eth_call, eth_getTransactionReceipt, eth_blockNumber, … → the fork
          // for the CURRENT chain.
          return rpc(method, params)
      }
    },
    on(event, fn) { (listeners[event] || (listeners[event] = [])).push(fn); return provider },
    removeListener(event, fn) {
      listeners[event] = (listeners[event] || []).filter((f) => f !== fn)
      return provider
    },
  }

  // Install as the legacy injected provider. Some wallet extensions (Rabby,
  // MetaMask) define `window.ethereum` as a non-configurable / read-only
  // property; a bare assignment then THROWS, and because this runs inside
  // bootstrap() before React mounts, the throw aborts boot and the page renders
  // blank. Guard it (assign → defineProperty → give up gracefully). The EIP-6963
  // announcement below surfaces the sim wallet to modern wagmi/RainbowKit
  // regardless, so discovery still works even when we can't take over
  // window.ethereum — the user just picks "Sim Wallet (fork)" in the dialog.
  try {
    window.ethereum = provider
  } catch {
    try {
      Object.defineProperty(window, 'ethereum', { value: provider, configurable: true, writable: true })
    } catch {
      console.warn('[sim-wallet] window.ethereum is locked by another wallet extension; relying on EIP-6963 discovery. Pick "Sim Wallet (fork)" in the connect dialog.')
    }
  }

  // EIP-6963 — modern wagmi/RainbowKit discover injected wallets via this event
  // rather than reading window.ethereum directly.
  const info = {
    uuid: '00000000-0000-4000-8000-5a41494c53494d', // fixed (no Date/random in this module's spirit)
    name: 'Sim Wallet (fork)',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNiIgZmlsbD0iI2YwYiIvPjwvc3ZnPg==',
    rdns: 'money.sail.sim',
  }
  const announce = () => window.dispatchEvent(
    new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }),
  )
  window.addEventListener('eip6963:requestProvider', announce)
  announce()

  // Pick up any forks already running at install time (best-effort, async).
  refreshForks()

  console.info(`[sim-wallet] installed → ${account} on chain ${localNetwork.chainId} via ${localNetwork.rpcUrl} (multi-fork aware)`)
  return provider
}
