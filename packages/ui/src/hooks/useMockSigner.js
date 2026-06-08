import { useSendTransaction, useSignTypedData } from 'wagmi'

/**
 * Signer seam — LIVE (wagmi).
 *
 * Returns the wallet's async senders with the SAME shape the mock exposed, so
 * callers (PendingSigningModal, useDeploySma) never changed during the swap:
 *
 *   sendTransactionAsync({ to, data, value?, chainId }) → Promise<`0x${hash}`>
 *   signTypedDataAsync({ domain, types, primaryType, message }) → Promise<`0x${sig}`>
 *
 * The name `useMockSigner` is intentionally preserved so call sites don't move.
 */
export function useMockSigner() {
  const { sendTransactionAsync } = useSendTransaction()
  const { signTypedDataAsync } = useSignTypedData()
  return { sendTransactionAsync, signTypedDataAsync }
}
