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
