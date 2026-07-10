import { describe, expect, it } from 'vitest'
import { decideSignerEntry } from '../../src/pages/signer/signerEntry.js'

// Group — the signing-page first-load routing decision (the wrong-first-view
// bug: an onboarding user with no account and nothing pending must never see
// the bare "connect your wallet" signing-page chrome).

describe('decideSignerEntry', () => {
  it('no state yet → loading (never the signer chrome)', () => {
    expect(decideSignerEntry({ stateLoaded: false, hasAccount: false, pendingCount: 0 })).toBe('loading')
    // Still loading even if a stale pendingCount/hasAccount guess is passed in.
    expect(decideSignerEntry({ stateLoaded: false, hasAccount: true, pendingCount: 3 })).toBe('loading')
  })

  it('onboarding-pending (no account, nothing to approve) → wizard', () => {
    expect(decideSignerEntry({ stateLoaded: true, hasAccount: false, pendingCount: 0 })).toBe('wizard')
  })

  it('signing-request-pending, even pre-account (e.g. approving the create-sma push itself) → signer', () => {
    expect(decideSignerEntry({ stateLoaded: true, hasAccount: false, pendingCount: 1 })).toBe('signer')
  })

  it('an account already exists → signer, regardless of pending count', () => {
    expect(decideSignerEntry({ stateLoaded: true, hasAccount: true, pendingCount: 0 })).toBe('signer')
    expect(decideSignerEntry({ stateLoaded: true, hasAccount: true, pendingCount: 2 })).toBe('signer')
  })
})
