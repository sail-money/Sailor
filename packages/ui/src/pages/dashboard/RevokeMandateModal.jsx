import { useEffect, useState } from 'react'
import {
  useAccount,
  usePublicClient,
  useSendTransaction,
  useSignTypedData,
  useSwitchChain,
  useWaitForTransactionReceipt,
} from 'wagmi'
import { encodeFunctionData } from 'viem'
import { GlassCard, SailButton } from '../shared'
import styles from './RevokeMandateModal.module.css'

const REVOKE_ABI = [
  {
    type: 'function',
    name: 'revokePermissions',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'permissions', type: 'address[]' },
      { name: 'deadline', type: 'uint256' },
      { name: 'sig', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'signerNonces',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
]

const REVOKE_TYPES = {
  RevokePermissions: [
    { name: 'account', type: 'address' },
    { name: 'permissions', type: 'address[]' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}

async function logRevoked(event) {
  try {
    await fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
  } catch {
    // best-effort
  }
}

/**
 * Revoke one or more permissions from the SMA.
 *
 * Two modes:
 *   - Single: pass `mandate` ({ address, name }) → straight to confirm.
 *   - Multi:  pass `permissions` (array of { address, name }) → selection step first.
 */
export default function RevokeMandateModal({ open, mandate, permissions, sma, kernel, chainId, onClose, onRevoked }) {
  const { address: ownerAddress, chainId: walletChainId } = useAccount()
  const publicClient = usePublicClient({ chainId })
  const { signTypedDataAsync } = useSignTypedData()
  const { sendTransactionAsync } = useSendTransaction()
  const { switchChainAsync } = useSwitchChain()

  const isMulti = Array.isArray(permissions) && permissions.length > 0
  // step: 'select' (multi only) | 'confirm' | 'pending' | 'done'
  const [step, setStep] = useState('confirm')
  const [selected, setSelected] = useState(new Set())
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState(null)
  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (!open) return
    setStep(isMulti ? 'select' : 'confirm')
    setSelected(new Set())
    setError('')
    setTxHash(null)
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape' && step !== 'pending') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!confirmed || !txHash || step === 'done') return
    setStep('done')
    const addrs = isMulti ? [...selected] : [mandate?.address]
    Promise.all(addrs.map((addr) =>
      logRevoked({ type: 'permission_revoked', actor: 'owner', permission: addr, sma, txHash, chainId })
    )).then(() => onRevoked?.())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed, txHash])

  if (!open) return null

  // Addresses that will actually be revoked
  const toRevoke = isMulti ? [...selected] : (mandate?.address ? [mandate.address] : [])

  async function handleRevoke() {
    if (!ownerAddress) { setError('Connect your owner wallet first.'); return }
    if (!kernel || !sma || toRevoke.length === 0) { setError('Select at least one permission to revoke.'); return }
    setStep('pending')
    setError('')
    try {
      if (walletChainId !== chainId) await switchChainAsync({ chainId })

      const nonce = await publicClient.readContract({
        address: kernel,
        abi: REVOKE_ABI,
        functionName: 'signerNonces',
        args: [sma],
      })
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)

      const signature = await signTypedDataAsync({
        domain: { name: 'SailKernel', version: '1', chainId, verifyingContract: kernel },
        types: REVOKE_TYPES,
        primaryType: 'RevokePermissions',
        message: { account: sma, permissions: toRevoke, nonce, deadline },
      })

      const data = encodeFunctionData({
        abi: REVOKE_ABI,
        functionName: 'revokePermissions',
        args: [sma, toRevoke, deadline, signature],
      })
      const hash = await sendTransactionAsync({ to: kernel, data, chainId })
      setTxHash(hash)
    } catch (err) {
      setError(err?.shortMessage || err?.message || 'Transaction rejected.')
      setStep(isMulti ? 'select' : 'confirm')
    }
  }

  function toggleSelect(addr) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(addr) ? next.delete(addr) : next.add(addr)
      return next
    })
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Revoke permission"
      onClick={step === 'pending' ? undefined : onClose}>
      <GlassCard className={styles.card} onClick={(e) => e.stopPropagation()}>
        {step !== 'pending' && (
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>
        )}

        {step === 'done' ? (
          <>
            <h2 className={styles.title}>Permission{toRevoke.length > 1 ? 's' : ''} revoked</h2>
            <p className={styles.body}>
              {toRevoke.length === 1
                ? <><strong>{(isMulti ? permissions.find((p) => p.address === toRevoke[0])?.name : mandate?.name) ?? toRevoke[0]}</strong> is no longer attached to your SMA.</>
                : <><strong>{toRevoke.length} permissions</strong> removed from your SMA.</>
              }
              {' '}It now appears in Recent Activity.
            </p>
            <div className={styles.actions}>
              <SailButton onClick={onClose}>Done</SailButton>
            </div>
          </>
        ) : step === 'select' ? (
          <>
            <h2 className={styles.title}>Select permissions to revoke</h2>
            <p className={styles.body}>Choose which permissions to remove from your SMA. The agent will no longer be able to act under revoked permissions.</p>
            <ul className={styles.permList}>
              {permissions.map((p) => (
                <li key={p.address} className={styles.permItem}>
                  <label className={styles.permLabel}>
                    <input
                      type="checkbox"
                      className={styles.permCheck}
                      checked={selected.has(p.address)}
                      onChange={() => toggleSelect(p.address)}
                    />
                    <span className={styles.permName}>{p.name ?? p.address}</span>
                    <span className={styles.permAddr}>{p.address.slice(0, 10)}…{p.address.slice(-6)}</span>
                  </label>
                </li>
              ))}
            </ul>
            {error && <p className={styles.error}>{error}</p>}
            {!ownerAddress && <p className={styles.warn}>Connect your owner wallet to continue.</p>}
            <div className={styles.actions}>
              <button type="button" className={styles.cancel} onClick={onClose}>Cancel</button>
              <SailButton
                onClick={() => {
                  if (selected.size === 0) { setError('Select at least one permission.'); return }
                  setError('')
                  setStep('confirm')
                }}
                disabled={!ownerAddress}
              >
                Next
              </SailButton>
            </div>
          </>
        ) : (
          <>
            <h2 className={styles.title}>Revoke {toRevoke.length > 1 ? `${toRevoke.length} permissions` : 'this permission'}?</h2>
            <p className={styles.body}>
              {toRevoke.length > 1
                ? `Removing these ${toRevoke.length} permissions means the agent can no longer act under them.`
                : <>Removing <strong>{(isMulti ? permissions?.find((p) => p.address === toRevoke[0])?.name : mandate?.name) ?? 'this permission'}</strong> means the agent can no longer act under it.</>
              }
              {' '}You authorize the removal in your wallet and pay gas.
            </p>
            {isMulti && toRevoke.length > 0 && (
              <ul className={styles.confirmList}>
                {toRevoke.map((addr) => {
                  const name = permissions.find((p) => p.address === addr)?.name
                  return <li key={addr} className={styles.confirmItem}>{name ?? addr}</li>
                })}
              </ul>
            )}
            {!isMulti && (
              <dl className={styles.meta}>
                <div><dt>Permission</dt><dd>{mandate?.address}</dd></div>
                <div><dt>SMA</dt><dd>{sma}</dd></div>
              </dl>
            )}
            {error && <p className={styles.error}>{error}</p>}
            {!ownerAddress && <p className={styles.warn}>Connect your owner wallet to continue.</p>}
            <div className={styles.actions}>
              <button type="button" className={styles.cancel} onClick={isMulti ? () => setStep('select') : onClose} disabled={step === 'pending'}>
                {isMulti ? 'Back' : 'Cancel'}
              </button>
              <SailButton onClick={handleRevoke} disabled={step === 'pending' || !ownerAddress}>
                {step === 'pending' ? 'Awaiting wallet…' : 'Revoke'}
              </SailButton>
            </div>
          </>
        )}
      </GlassCard>
    </div>
  )
}
