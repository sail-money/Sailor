import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadFixture } from '../helpers/fixture.js'

// The dashboard port is derived per project (projectPort → 3333–3999) and may be
// bumped again by findFreePort(), so CORS must not be pinned to a fixed 3333.
// It should reflect any loopback origin and ignore non-loopback ones.
describe('CORS scoping', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('reflects a localhost origin on any port', async () => {
    const res = await fix.api.get('/api/version').set('Origin', 'http://localhost:3555')
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3555')
  })

  it('reflects the IPv4 loopback origin', async () => {
    const res = await fix.api.get('/api/version').set('Origin', 'http://127.0.0.1:3999')
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:3999')
  })

  it('reflects the IPv6 loopback origin', async () => {
    const res = await fix.api.get('/api/version').set('Origin', 'http://[::1]:5173')
    expect(res.headers['access-control-allow-origin']).toBe('http://[::1]:5173')
  })

  it('still serves requests with no Origin header (same-origin / proxy)', async () => {
    const res = await fix.api.get('/api/version')
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('does NOT reflect a non-loopback origin', async () => {
    const res = await fix.api.get('/api/version').set('Origin', 'http://evil.com')
    // Request still completes (CORS is browser-enforced), but no ACAO header is
    // returned, so a browser would block the cross-origin read.
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('does NOT reflect a look-alike host', async () => {
    const res = await fix.api.get('/api/version').set('Origin', 'http://localhost.evil.com:80')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('answers a preflight from a loopback origin', async () => {
    const res = await fix.api.options('/api/account/switch')
      .set('Origin', 'http://localhost:3555')
      .set('Access-Control-Request-Method', 'POST')
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3555')
  })
})
