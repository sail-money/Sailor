import { injected } from 'wagmi/connectors'

// The canonical, publicly-documented Anvil/Hardhat dev account #0 (mnemonic
// "test test test test test test test test test test test junk") — the same
// account Shipyard's own fork tooling already treats as non-secret. Anvil
// keeps its dev accounts unlocked, so the fork signs on this address's behalf
// server-side; no private key ever exists in the browser.
export const SANDBOX_DEV_ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

/**
 * A minimal EIP-1193 provider spanning every chain the sandbox has forked.
 * Every method except account-listing and chain-switching is forwarded
 * verbatim to whichever fork is "current" — anvil signs `personal_sign` /
 * `eth_signTypedData_v4` / `eth_sendTransaction` for its unlocked dev
 * accounts without needing a key on this end.
 *
 * `forks`: `{ [chainId]: rpcUrl }`. `primaryChainId` is the one active at
 * connect time; `wallet_switchEthereumChain` moves between the rest.
 */
function createSandboxProvider({ forks, primaryChainId }) {
  let currentChainId = primaryChainId
  const listeners = new Map()

  async function rpc(method, params) {
    const rpcUrl = forks[currentChainId]
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    })
    const json = await res.json()
    if (json.error) throw new Error(json.error.message || 'Sandbox RPC error')
    return json.result
  }

  return {
    async request({ method, params }) {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [SANDBOX_DEV_ACCOUNT]
        case 'eth_chainId':
          return `0x${currentChainId.toString(16)}`
        case 'wallet_switchEthereumChain': {
          const targetId = Number(params?.[0]?.chainId)
          if (!forks[targetId]) {
            throw new Error(`No sandbox fork is up for chain ${targetId} yet.`)
          }
          currentChainId = targetId
          listeners.get('chainChanged')?.(`0x${targetId.toString(16)}`)
          return null
        }
        default:
          return rpc(method, params)
      }
    },
    on(event, listener) {
      listeners.set(event, listener)
    },
    removeListener(event) {
      listeners.delete(event)
    },
  }
}

/** A wagmi connector wired directly to this sandbox's own forks — bypasses
 *  EIP-6963/window.ethereum discovery entirely, so it can never collide with
 *  (or be mistaken for) a real wallet extension. */
export function createSandboxConnector({ forks, primaryChainId }) {
  return injected({
    target: {
      id: 'sandboxDevWallet',
      name: 'Sandbox Dev Wallet',
      provider: createSandboxProvider({ forks, primaryChainId }),
    },
  })
}
