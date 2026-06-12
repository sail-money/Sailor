/**
 * Thin top bar shown when the project is configured against a custom/local RPC
 * (see GET /api/network -> { isLocal }). It tells the operator that every
 * transaction signed here executes against a non-production endpoint — e.g. a
 * local node or an anvil fork — rather than a public network.
 *
 * Generic: it reports the configured RPC, with no reference to any specific
 * simulation tool.
 */
export default function LocalRpcBanner({ info }) {
  if (!info || !info.isLocal) return null
  const { rpcUrl, chainId } = info

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        boxSizing: 'border-box',
        padding: '6px 14px',
        background: 'linear-gradient(90deg, #3a2d00, #4a3a00)',
        color: '#ffd66b',
        fontSize: 12.5,
        lineHeight: 1.4,
        textAlign: 'center',
        borderBottom: '1px solid rgba(255, 214, 107, 0.35)',
        letterSpacing: 0.2,
        // Float above the wizard/dashboard full-viewport backgrounds (which
        // create their own stacking contexts); a positioned element is required
        // for z-index to take effect.
        zIndex: 2147483647,
        pointerEvents: 'none',
      }}
    >
      ⚓ Local RPC — transactions execute against{' '}
      <code style={{ background: 'rgba(0,0,0,0.25)', padding: '1px 5px', borderRadius: 4 }}>
        {rpcUrl}
      </code>
      {chainId ? ` (chain ${chainId})` : ''}, not a public network.
    </div>
  )
}
