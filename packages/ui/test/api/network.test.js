import { afterEach, describe, expect, it } from 'vitest'
import { loadFixture } from '../helpers/fixture.js'

describe('GET /api/network', () => {
  let fix
  afterEach(() => fix?.cleanup())

  it('flags a localhost RPC as a local network and echoes rpcUrl + chainId', async () => {
    fix = loadFixture('fresh', {
      '.env.local': 'RPC_URL=http://127.0.0.1:18545\nCHAIN_ID=84532\n',
    })
    const res = await fix.api.get('/api/network')
    expect(res.status).toBe(200)
    expect(res.body.isLocal).toBe(true)
    expect(res.body.rpcUrl).toBe('http://127.0.0.1:18545')
    expect(res.body.chainId).toBe(84532)
  })

  it('treats localhost (by hostname) as local too', async () => {
    fix = loadFixture('fresh', {
      '.env.local': 'RPC_URL=http://localhost:8545\nCHAIN_ID=8453\n',
    })
    const res = await fix.api.get('/api/network')
    expect(res.body.isLocal).toBe(true)
    expect(res.body.chainId).toBe(8453)
  })

  it('does not flag a public RPC as local', async () => {
    fix = loadFixture('fresh', {
      '.env.local': 'RPC_URL=https://sepolia.base.org\nCHAIN_ID=84532\n',
    })
    const res = await fix.api.get('/api/network')
    expect(res.status).toBe(200)
    expect(res.body.isLocal).toBe(false)
    expect(res.body.rpcUrl).toBe('https://sepolia.base.org')
  })

  it('handles a missing .env.local without throwing', async () => {
    fix = loadFixture('fresh')
    const res = await fix.api.get('/api/network')
    expect(res.status).toBe(200)
    expect(res.body.isLocal).toBe(false)
    expect(res.body.rpcUrl).toBeNull()
  })
})
