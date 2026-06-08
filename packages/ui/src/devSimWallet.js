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

export function maybeInstallSimWallet(localNetwork) {
  if (typeof window === 'undefined') return false
  let params
  try { params = new URLSearchParams(window.location.search) } catch { return false }
  if (params.get('sim') !== '1') return false
  if (!localNetwork?.isLocal || !localNetwork.rpcUrl || !localNetwork.chainId) {
    console.warn('[sim-wallet] ?sim=1 but no local RPC detected — not installing.')
    return false
  }

  const rpcUrl = localNetwork.rpcUrl
  const account = (params.get('owner') || DEFAULT_OWNER)
  const chainIdHex = `0x${Number(localNetwork.chainId).toString(16)}`
  let rpcId = 0

  async function rpc(method, rpcParams = []) {
    const res = await fetch(rpcUrl, {
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
          return chainIdHex
        case 'net_version':
          return String(Number(localNetwork.chainId))
        case 'wallet_switchEthereumChain':
          return null            // single-chain fork — already here
        case 'wallet_addEthereumChain':
          return null
        case 'wallet_requestPermissions':
          return [{ parentCapability: 'eth_accounts' }]
        case 'wallet_getPermissions':
          return [{ parentCapability: 'eth_accounts' }]
        default:
          // eth_sendTransaction, eth_getTransactionCount, eth_estimateGas,
          // eth_call, eth_getTransactionReceipt, eth_blockNumber, … → the fork.
          return rpc(method, params)
      }
    },
    on(event, fn) { (listeners[event] || (listeners[event] = [])).push(fn); return provider },
    removeListener(event, fn) {
      listeners[event] = (listeners[event] || []).filter((f) => f !== fn)
      return provider
    },
  }

  window.ethereum = provider

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

  console.info(`[sim-wallet] installed → ${account} on chain ${localNetwork.chainId} via ${rpcUrl}`)
  return true
}
