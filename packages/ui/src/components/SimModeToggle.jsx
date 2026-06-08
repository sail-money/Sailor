/**
 * Navigation affordance for the local fork's hands-free "sim wallet".
 *
 * The sim wallet (an injected provider backed by the fork's unlocked accounts —
 * no browser extension, no signing prompts) only activates when the page URL
 * carries `?sim=1`. Without a visible control, an operator on a local fork has
 * no way to discover that and ends up onboarding through their real wallet
 * (Rabby/MetaMask) — which, against a fork, hits cached-nonce gaps and stuck
 * transactions. This sits at the left of the LocalRpcBanner and flips `?sim=1`
 * on/off (preserving the current hash route), then reloads so the wagmi config
 * rebuilds for the chosen mode.
 *
 * Local-only: renders nothing unless GET /api/network reports isLocal.
 */
export default function SimModeToggle({ info }) {
  if (!info || !info.isLocal) return null

  let inSim = false
  try {
    inSim = new URLSearchParams(window.location.search).get('sim') === '1'
  } catch {
    inSim = false
  }

  const go = (enable) => {
    try {
      const url = new URL(window.location.href)
      if (enable) url.searchParams.set('sim', '1')
      else url.searchParams.delete('sim')
      // Navigating (rather than history.replace) forces a reload so main.jsx
      // re-probes /api/network and rebuilds the wagmi config for the new mode.
      window.location.href = url.toString()
    } catch {
      window.location.search = enable ? '?sim=1' : ''
    }
  }

  const btn = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '2px 9px',
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: 0.2,
    color: '#ffd66b',
    background: 'rgba(0,0,0,0.28)',
    border: '1px solid rgba(255, 214, 107, 0.4)',
    borderRadius: 5,
    cursor: 'pointer',
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 3,
        left: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        zIndex: 2147483647,
        pointerEvents: 'auto',
        fontSize: 11,
        color: 'rgba(255, 214, 107, 0.85)',
      }}
    >
      {inSim ? (
        <>
          <span title="A fork-backed wallet is signing automatically — no extension, no prompts.">
            🛟 Sim wallet active
          </span>
          <button
            type="button"
            style={btn}
            onClick={() => go(false)}
            title="Leave simulation mode and use your own browser wallet again"
          >
            Exit sim
          </button>
        </>
      ) : (
        <button
          type="button"
          style={btn}
          onClick={() => go(true)}
          title="Onboard hands-free with the fork's wallet — no browser extension or signing prompts (adds ?sim=1)"
        >
          🛟 Use Sim Wallet
        </button>
      )}
    </div>
  )
}
