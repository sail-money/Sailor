export async function getOnboardState() {
  const res = await fetch('/api/onboard/state')
  if (!res.ok) throw new Error(`onboard/state ${res.status}`)
  return res.json()
}

export async function saveConfig({ rpcUrl, chainId }) {
  const res = await fetch('/api/onboard/save-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rpcUrl, chainId }),
  })
  if (!res.ok) throw new Error(`save-config ${res.status}`)
  return res.json()
}

export async function getWalletConfig() {
  const res = await fetch('/api/wallet-config')
  if (!res.ok) throw new Error(`wallet-config ${res.status}`)
  return res.json()
}

/** Persists the Reown project id to .sail/.env.local. Surfaces the server's
 *  validation message so a mis-pasted id is explained, not just rejected. */
export async function saveWalletConfig({ projectId }) {
  const res = await fetch('/api/wallet-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `wallet-config ${res.status}`)
  return body
}
