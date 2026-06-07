'use client'

import { useCallback } from 'react'

/**
 * Mock signer — stands in for wagmi's `useSendTransaction` / `useSignTypedData`
 * during the mockup. Returns the SAME shape and async method names wagmi
 * exposes, so the live swap is mechanical:
 *
 *   // LIVE — delete this hook, swap the two call sites in PendingSigningModal:
 *   const { sendTransactionAsync } = useSendTransaction()   // from 'wagmi'
 *   const { signTypedDataAsync }   = useSignTypedData()     // from 'wagmi'
 *
 * In the mock there is no wallet prompt: each method resolves after a short
 * delay with a deterministic fake hash / signature so the Authorize flow shows
 * its submitting → done states exactly as it will against a real wallet.
 */

const FAKE_TX_HASH = '0xfeed1c0ffeebadc0de0000000000000000000000000000000000000000000abcd'
const FAKE_SIGNATURE =
  '0x' + 'a1b2c3d4'.repeat(16) + '1b' // 65-byte-ish r||s||v shaped string

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

export function useMockSigner() {
  // Mirrors wagmi: ({ to, data, value, chainId }) => Promise<`0x${hash}`>
  const sendTransactionAsync = useCallback(async (_tx) => {
    await delay(900)
    return FAKE_TX_HASH
  }, [])

  // Mirrors wagmi: ({ domain, types, primaryType, message }) => Promise<`0x${sig}`>
  const signTypedDataAsync = useCallback(async (_typed) => {
    await delay(700)
    return FAKE_SIGNATURE
  }, [])

  return { sendTransactionAsync, signTypedDataAsync }
}
