import { describe, expect, it } from 'vitest'
import { classifyPermissionFailure, failureCopy, nextSigningPhase } from '../../src/pages/signer/signingPhase.js'

// Group B — the signing-page state machine (the DEFECT-2 guard + the
// reverted/failed/unverified/confirmed screen mapping). Pure, so it runs in the
// repo's node-env vitest without rendering React.

const done = (id, kind = 'register-permission') => ({ phase: 'done', requestId: id, kind })

describe('B1 — request-confirmed prunes + respects the queue (DEFECT-2 guard)', () => {
  it('confirming one request while others remain advances to the next card, not full-screen', () => {
    // r1 confirmed, r2 still pending (remainingCount = 1) → must NOT go to a
    // terminal success/failure screen; it goes idle so the next card shows.
    const next = nextSigningPhase(done('r1'), 1, {
      type: 'request-confirmed',
      requestId: 'r1',
      confirmation: { outcome: 'confirmed' },
    })
    expect(next.phase).toBe('idle')
  })

  it('confirming the LAST request (none remain) shows the terminal screen', () => {
    const next = nextSigningPhase(done('r1'), 0, {
      type: 'request-confirmed',
      requestId: 'r1',
      confirmation: { outcome: 'confirmed' },
    })
    expect(next.phase).toBe('success')
  })

  it('request-resolved mirrors the same queue rule (the branch that already worked)', () => {
    // last one resolved → park on awaiting-confirmation…
    expect(nextSigningPhase(done('r1'), 0, { type: 'request-resolved', requestId: 'r1' }).phase).toBe(
      'awaiting-confirmation',
    )
    // …others remain → advance instead of full-screen.
    expect(nextSigningPhase(done('r1'), 2, { type: 'request-resolved', requestId: 'r1' }).phase).toBe(
      'idle',
    )
  })

  it('a message for a different request never disturbs the current phase', () => {
    const cur = done('r1')
    const next = nextSigningPhase(cur, 0, {
      type: 'request-confirmed',
      requestId: 'other',
      confirmation: { outcome: 'reverted' },
    })
    expect(next).toBe(cur)
  })
})

describe('B2 — screen mapping: outcomes map to distinct screens (a timeout must not read as a revert)', () => {
  const confirm = (confirmation) =>
    nextSigningPhase(done('r1'), 0, { type: 'request-confirmed', requestId: 'r1', confirmation })

  it('confirmed → success', () => {
    expect(confirm({ outcome: 'confirmed' }).phase).toBe('success')
  })

  it('confirmed carries a note through when present, and omits it otherwise', () => {
    expect(confirm({ outcome: 'confirmed', note: 'indexing may lag' }).note).toBe('indexing may lag')
    expect(confirm({ outcome: 'confirmed' }).note).toBeUndefined()
  })

  it('reverted → chain-failed tagged reverted', () => {
    const p = confirm({ outcome: 'reverted', error: 'reverted on-chain' })
    expect(p.phase).toBe('chain-failed')
    expect(p.outcome).toBe('reverted')
    expect(p.message).toBe('reverted on-chain')
  })

  it('failed → chain-failed tagged failed (never submitted), distinct from reverted', () => {
    const p = confirm({ outcome: 'failed', error: 'sendTransaction threw' })
    expect(p.phase).toBe('chain-failed')
    expect(p.outcome).toBe('failed')
  })

  it("unverified → its OWN screen, never the failure screen — a timeout is not a revert", () => {
    const p = confirm({ outcome: 'unverified', error: 'no RPC for chain' })
    expect(p.phase).toBe('unverified')
    expect(p.phase).not.toBe('chain-failed')
    expect(p.message).toBe('no RPC for chain')
  })
})

describe('B2b — failure copy wording is distinct for reverted vs failed', () => {
  it('reverted reads as an on-chain revert', () => {
    const c = failureCopy('reverted')
    expect(c.kicker).toBe('REVERTED')
    expect(c.headline).toMatch(/reverted on-chain/i)
  })

  it('failed reads as never-submitted (distinct wording from reverted)', () => {
    const c = failureCopy('failed')
    expect(c.kicker).toBe('FAILED')
    expect(c.headline).toMatch(/not submitted/i)
    expect(c.headline).not.toMatch(/reverted/i)
  })
})

describe('B3 — classifyPermissionFailure recognizes the batch-signing stale-nonce revert', () => {
  it('matches on the decoded error name (InvalidSignerSignature)', () => {
    const c = classifyPermissionFailure('reverted with the following signature: InvalidSignerSignature()')
    expect(c).not.toBeNull()
    expect(c.kicker).toBe('SIGNATURE OUT OF DATE')
    expect(c.explanation).toMatch(/matched the current nonce/i)
  })

  it('matches on the companion manager-dispatch error name (InvalidManagerSignature)', () => {
    expect(classifyPermissionFailure('InvalidManagerSignature()')).not.toBeNull()
  })

  it('matches on the raw 4-byte selector when viem could not resolve a name', () => {
    expect(classifyPermissionFailure('unrecognized custom error (data: 0xcf92fef0)')).not.toBeNull()
    expect(classifyPermissionFailure('unrecognized custom error (data: 0xeb6942f1)')).not.toBeNull()
  })

  it('returns null for an unrelated revert — falls back to the generic failureCopy', () => {
    expect(classifyPermissionFailure('execution reverted for an unknown reason')).toBeNull()
  })

  it('returns null for empty/non-string input rather than throwing', () => {
    expect(classifyPermissionFailure('')).toBeNull()
    expect(classifyPermissionFailure(null)).toBeNull()
    expect(classifyPermissionFailure(undefined)).toBeNull()
  })
})

describe('B4 — classifyPermissionFailure distinguishes "already registered" from stale-nonce', () => {
  it('matches on the decoded error name (PermissionAlreadyRegistered) with DIFFERENT copy than the nonce case', () => {
    const c = classifyPermissionFailure('reverted with the following signature: PermissionAlreadyRegistered(address)')
    expect(c).not.toBeNull()
    expect(c.kicker).toBe('ALREADY REGISTERED')
    expect(c.kicker).not.toBe('SIGNATURE OUT OF DATE')
    expect(c.explanation).toMatch(/already confirmed/i)
    expect(c.explanation).not.toMatch(/nonce/i)
  })

  it('matches on the raw 4-byte selector', () => {
    expect(classifyPermissionFailure('unrecognized custom error (data: 0x451f8f10)')).not.toBeNull()
  })

  it('the two classified failures never collide on the same message', () => {
    const nonce = classifyPermissionFailure('InvalidSignerSignature()')
    const already = classifyPermissionFailure('PermissionAlreadyRegistered(address)')
    expect(nonce.kicker).not.toBe(already.kicker)
  })
})
