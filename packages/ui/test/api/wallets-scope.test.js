import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadFixture } from '../helpers/fixture.js'

// Audit #10: the wallets panel must discover the active SMA's local key the same
// way `sailor run` resolves it — the per-SMA keystore wins, and the legacy flat
// keys/manager.json is only a fallback. The old code unioned all three, so a key
// belonging to a DIFFERENT SMA leaked in as this SMA's "local key".
describe('GET /api/overview — local-key discovery is scoped to the active SMA (#10)', () => {
  const SAFE = '0x8E637d9573Ad81B60cb93edA78b9C827860950a4'
  const PER_SMA_KEY = '0x1111111111111111111111111111111111111111'
  const FLAT_KEY = '0x2222222222222222222222222222222222222222' // a different SMA's key
  let fix

  beforeEach(() => {
    // Fresh fixture (no account.json, no RPC) + an active SMA with BOTH a per-SMA
    // keystore and a stale flat keystore present. computeOverview reads only the
    // `address` field (no decryption), so minimal keystores suffice.
    fix = loadFixture('fresh', {
      'account.json': JSON.stringify({
        safe: SAFE,
        owner: '0x7f8c6DB60b46F7eCBA131b882fBea1Fed4F5f4F5',
        permissionSigner: '0x7f8c6DB60b46F7eCBA131b882fBea1Fed4F5f4F5',
        manager: '0x7f8c6DB60b46F7eCBA131b882fBea1Fed4F5f4F5',
        chainId: 8453,
      }),
      [`keys/manager-${SAFE.toLowerCase()}.json`]: JSON.stringify({ address: PER_SMA_KEY }),
      'keys/manager.json': JSON.stringify({ address: FLAT_KEY }),
    })
  })
  afterEach(() => fix.cleanup())

  it('surfaces the per-SMA key, not the stale flat key from another SMA', async () => {
    const res = await fix.api.get('/api/overview')
    expect(res.status).toBe(200)
    const signers = res.body?.signers ?? []
    const addrs = signers.map((s) => s.address?.toLowerCase())
    expect(addrs).toContain(PER_SMA_KEY.toLowerCase())
    expect(addrs).not.toContain(FLAT_KEY.toLowerCase())
  })
})
