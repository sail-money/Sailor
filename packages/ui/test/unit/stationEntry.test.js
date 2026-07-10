import { describe, expect, it } from 'vitest'
import { decideStationEntry } from '../../src/pages/station/stationEntry.js'

// Group — the signing-station first-load routing decision (the wrong-first-view
// bug: an onboarding user with no account and nothing pending must never see
// the bare "connect your wallet" station chrome).

describe('decideStationEntry', () => {
  it('no state yet → loading (never the station chrome)', () => {
    expect(decideStationEntry({ stateLoaded: false, hasAccount: false, pendingCount: 0 })).toBe('loading')
    // Still loading even if a stale pendingCount/hasAccount guess is passed in.
    expect(decideStationEntry({ stateLoaded: false, hasAccount: true, pendingCount: 3 })).toBe('loading')
  })

  it('onboarding-pending (no account, nothing to approve) → wizard', () => {
    expect(decideStationEntry({ stateLoaded: true, hasAccount: false, pendingCount: 0 })).toBe('wizard')
  })

  it('signing-request-pending, even pre-account (e.g. approving the create-sma push itself) → station', () => {
    expect(decideStationEntry({ stateLoaded: true, hasAccount: false, pendingCount: 1 })).toBe('station')
  })

  it('an account already exists → station, regardless of pending count', () => {
    expect(decideStationEntry({ stateLoaded: true, hasAccount: true, pendingCount: 0 })).toBe('station')
    expect(decideStationEntry({ stateLoaded: true, hasAccount: true, pendingCount: 2 })).toBe('station')
  })
})
