import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { connect as wagmiConnect } from 'wagmi/actions'
import { buildWagmiConfig } from './wagmi'

// Fallbacks used only until GET /api/sandbox/config resolves (or in live mode,
// where the route doesn't exist): the default cap and a conservative ceiling.
// The server is authoritative once fetched — these just avoid an undefined
// flash in the onboarding copy and the settings stepper.
const DEFAULT_MAX_CHAINS = 3
const DEFAULT_CHAINS_CEILING = 9

const SandboxContext = createContext({
  isSandbox: false,
  forks: {},
  activateForks: () => {},
  maxChains: DEFAULT_MAX_CHAINS,
  ceiling: DEFAULT_CHAINS_CEILING,
  reloadSandboxConfig: () => {},
})

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
// Stable signature of a fork set + its primary, so activateForks can tell
// "same as last time" from a genuine change regardless of key order/type.
function forksSignature(forkMap, primary) {
  const pairs = Object.entries(forkMap ?? {})
    .map(([id, url]) => `${Number(id)}=${url}`)
    .sort()
  return `${Number(primary)}|${pairs.join(',')}`
}

export function SandboxProvider({ isSandbox, config, setConfig, children }) {
  const [forks, setForks] = useState({})
  const [capConfig, setCapConfig] = useState({ maxChains: DEFAULT_MAX_CHAINS, ceiling: DEFAULT_CHAINS_CEILING })
  const activatedRef = useRef(false)
  const lastSigRef = useRef(null)

  // The sandbox chain cap lives server-side (config.json, resolved with env
  // overrides). Pull it so the onboarding picker, the banner summary, and the
  // settings stepper all agree on one authoritative value instead of a
  // hardcoded constant. `reloadSandboxConfig` lets the settings panel refresh
  // it in place right after a change, without a full reload.
  const reloadSandboxConfig = useCallback(() => {
    if (!isSandbox) return
    fetch('/api/sandbox/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return
        setCapConfig({
          maxChains: Number(data.maxChains) || DEFAULT_MAX_CHAINS,
          ceiling: Number(data.ceiling) || DEFAULT_CHAINS_CEILING,
        })
      })
      .catch(() => {})
  }, [isSandbox])

  useEffect(() => { reloadSandboxConfig() }, [reloadSandboxConfig])

  // Memoised so its identity is stable — consumers (e.g. the dashboard's
  // add-network flow) put it in effect deps, and a fresh closure each render
  // would re-fire those effects every time activateForks calls setForks.
  const activateForks = useCallback(({ forks: forkMap, primary }) => {
    // Re-pointing wagmi at an identical fork set + primary tears down and
    // reconnects the sandbox dev wallet for nothing. The Network step calls
    // this on every "Continue" and the self-activate effect on every load,
    // frequently with the exact forks already in place — skip those no-ops.
    // (A spurious reconnect is also what used to close the additional-SMA
    // wizard mid-flight; the Dashboard guard covers that too, but not churning
    // in the first place is cleaner.)
    const sig = forksSignature(forkMap, primary)
    if (activatedRef.current && lastSigRef.current === sig) return
    activatedRef.current = true
    lastSigRef.current = sig
    setForks(forkMap)
    const next = buildWagmiConfig({ forks: forkMap, primaryChainId: primary })
    setConfig(next)
    wagmiConnect(next, { connector: next.connectors[0] }).catch(() => {
      // Best-effort — ConnectStep's normal "Connect wallet" button still
      // works as a fallback if the programmatic connect is ever rejected.
    })
  }, [setConfig])

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

  const value = useMemo(
    () => ({ isSandbox, forks, activateForks, maxChains: capConfig.maxChains, ceiling: capConfig.ceiling, reloadSandboxConfig }),
    [isSandbox, forks, activateForks, capConfig.maxChains, capConfig.ceiling, reloadSandboxConfig],
  )

  return <SandboxContext.Provider value={value}>{children}</SandboxContext.Provider>
}

export function useSandbox() {
  return useContext(SandboxContext)
}

export function useWagmiConfigState() {
  return useState(() => buildWagmiConfig(null))
}
