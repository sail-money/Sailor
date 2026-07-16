import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { connect as wagmiConnect } from 'wagmi/actions'
import { buildWagmiConfig } from './wagmi'

const SandboxContext = createContext({ isSandbox: false, forks: {}, activateForks: () => {} })

/**
 * Owns the swap from the default wagmi config to the sandbox's own (connector
 * + one transport per forked chain) once forks are actually ready — there's
 * nothing to point at when this server first boots, so the app starts on the
 * same default config live mode uses.
 *
 * Two paths activate it: `activateForks` (called from the onboarding Network
 * step once its fork manifest reports every requested chain ready) and, for
 * every OTHER page load of an already-provisioned sandbox — a plain reload,
 * or returning to the dashboard later — the effect below, which asks
 * `/api/sandbox/forks` once `isSandbox` resolves true and self-activates from
 * whatever forks are already up. Without this, a reload would silently fall
 * back to the default config and start offering real wallet extensions.
 *
 * `forks` (`{ [chainId]: rpcUrl }`) is exposed alongside `isSandbox` because
 * a couple of onboarding call sites (receipt polling, tx simulation) make raw
 * RPC calls of their own rather than going through wagmi's client — those
 * need the same fork-vs-public-RPC choice the wagmi transport map makes.
 */
export function SandboxProvider({ isSandbox, config, setConfig, children }) {
  const [forks, setForks] = useState({})
  const activatedRef = useRef(false)

  function activateForks({ forks: forkMap, primary }) {
    activatedRef.current = true
    setForks(forkMap)
    const next = buildWagmiConfig({ forks: forkMap, primaryChainId: primary })
    setConfig(next)
    wagmiConnect(next, { connector: next.connectors[0] }).catch(() => {
      // Best-effort — ConnectStep's normal "Connect wallet" button still
      // works as a fallback if the programmatic connect is ever rejected.
    })
  }

  useEffect(() => {
    if (!isSandbox || activatedRef.current) return
    let cancelled = false
    fetch('/api/sandbox/forks', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { forks: {} }))
      .then((data) => {
        if (cancelled || activatedRef.current) return
        const ready = Object.values(data?.forks ?? {}).filter((f) => f.status === 'ready' && f.rpcUrl)
        if (!ready.length) return // nothing provisioned yet — the Network step will call activateForks itself
        activateForks({
          forks: Object.fromEntries(ready.map((f) => [f.chainId, f.rpcUrl])),
          primary: ready[0].chainId,
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isSandbox])

  const value = useMemo(() => ({ isSandbox, forks, activateForks }), [isSandbox, forks])

  return <SandboxContext.Provider value={value}>{children}</SandboxContext.Provider>
}

export function useSandbox() {
  return useContext(SandboxContext)
}

export function useWagmiConfigState() {
  return useState(() => buildWagmiConfig(null))
}
