import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadFixture } from '../helpers/fixture.js'

const readConfig = (sailDir) => JSON.parse(fs.readFileSync(path.join(sailDir, 'config.json'), 'utf-8'))

describe('GET /api/account', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('returns the active account', async () => {
    const res = await fix.api.get('/api/account')
    expect(res.status).toBe(200)
    expect(res.body.safe).toBe('0x8E637d9573Ad81B60cb93edA78b9C827860950a4')
    expect(res.body.chainId).toBe(8453)
  })
})

describe('GET /api/account (fresh)', () => {
  let fix
  beforeEach(() => { fix = loadFixture('fresh') })
  afterEach(() => fix.cleanup())

  it('returns 404 before any SMA is set', async () => {
    const res = await fix.api.get('/api/account')
    expect(res.status).toBe(404)
  })
})

describe('GET /api/accounts', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('returns list with the active SMA marked', async () => {
    const res = await fix.api.get('/api/accounts')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    const active = res.body.find(a => a.active)
    expect(active).toBeTruthy()
    expect(active.safe).toBe('0x8E637d9573Ad81B60cb93edA78b9C827860950a4')
  })
})

describe('POST /api/account (register new SMA)', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('creates a second SMA and makes it active', async () => {
    const newSafe = '0x1111111111111111111111111111111111111111'
    const res = await fix.api.post('/api/account').send({
      safe: newSafe,
      owner: '0x7f8c6DB60b46F7eCBA131b882fBea1Fed4F5f4F5',
      chainId: 8453,
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const active = await fix.api.get('/api/account')
    expect(active.body.safe.toLowerCase()).toBe(newSafe.toLowerCase())
  })
})

describe('POST /api/account/switch — multichain chainId sync (FUNC-2)', () => {
  let fix
  const SMA_A = '0x8E637d9573Ad81B60cb93edA78b9C827860950a4' // chain 8453 (active)
  const SMA_B = '0x2222222222222222222222222222222222222222' // chain 42161
  beforeEach(() => {
    // Two SMAs on different chains; active SMA (and config) start on 8453.
    fix = loadFixture('onboarded', {
      'config.json': JSON.stringify({ version: 1, name: 'multichain', chainId: 8453 }),
      'state/accounts.json': JSON.stringify([
        { safe: SMA_A, owner: '0x7f8c6DB60b46F7eCBA131b882fBea1Fed4F5f4F5', chainId: 8453, name: 'On Base' },
        { safe: SMA_B, owner: '0x7f8c6DB60b46F7eCBA131b882fBea1Fed4F5f4F5', chainId: 42161, name: 'On Arbitrum' },
      ]),
    })
  })
  afterEach(() => fix.cleanup())

  it('switching to an SMA on another chain moves config.json.chainId with it', async () => {
    expect(readConfig(fix.sailDir).chainId).toBe(8453)

    const res = await fix.api.post('/api/account/switch').send({ safe: SMA_B })
    expect(res.status).toBe(200)
    expect(res.body.active.chainId).toBe(42161)

    // config.json followed the active SMA — the stage machine / CLI no longer go stale.
    expect(readConfig(fix.sailDir).chainId).toBe(42161)
    const state = await fix.api.get('/api/onboard/state')
    expect(state.body.chainId).toBe(42161)

    // Switching back restores it.
    await fix.api.post('/api/account/switch').send({ safe: SMA_A })
    expect(readConfig(fix.sailDir).chainId).toBe(8453)
  })
})

describe('POST /api/account/rename', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('updates the display name', async () => {
    const res = await fix.api.post('/api/account/rename').send({
      safe: '0x8E637d9573Ad81B60cb93edA78b9C827860950a4',
      name: 'My Renamed SMA',
    })
    expect(res.status).toBe(200)

    const accounts = await fix.api.get('/api/accounts')
    const target = accounts.body.find(
      a => a.safe.toLowerCase() === '0x8e637d9573ad81b60cb93eda78b9c827860950a4'
    )
    expect(target.name).toBe('My Renamed SMA')
  })
})

describe('POST /api/account — merge preserves stored fields, both files stay identical', () => {
  let fix
  const SAFE = '0x8E637d9573Ad81B60cb93edA78b9C827860950a4'
  const OWNER = '0x7f8c6DB60b46F7eCBA131b882fBea1Fed4F5f4F5'
  const MANAGER = '0xa6D478146f03E9473582aCe099c67e3CbB5EC2BE'
  const SMA_B = '0x2222222222222222222222222222222222222222'
  const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(fix.sailDir, rel), 'utf-8'))
  const canonical = {
    safe: SAFE, owner: OWNER, permissionSigner: OWNER, manager: MANAGER,
    managers: [MANAGER], chainId: 8453, createdAtBlock: '46757914',
    saltNonce: '1784155478729', deployedChains: [8453], name: 'SMA 1', addedAt: '2026-07-16T12:00:00.000Z',
  }
  beforeEach(() => {
    fix = loadFixture('onboarded', {
      'account.json': JSON.stringify(canonical),
      'state/accounts.json': JSON.stringify([
        canonical,
        { safe: SMA_B, owner: OWNER, permissionSigner: OWNER, manager: MANAGER, managers: [MANAGER], chainId: 42161, createdAtBlock: '0', saltNonce: '999', deployedChains: [42161], name: 'SMA 2', addedAt: null },
      ]),
    })
  })
  afterEach(() => fix.cleanup())

  it('a partial add-network POST keeps saltNonce/managers, unions deployedChains, and keeps both files identical', async () => {
    // Add-network sends NO saltNonce/managers, and only the merged chain list.
    const res = await fix.api.post('/api/account').send({
      safe: SAFE, owner: OWNER, manager: MANAGER, chainId: 8453,
      deployedChains: [8453, 42161, 8453], // dup + new chain
    })
    expect(res.status).toBe(200)

    const account = readJson('account.json')
    const accounts = readJson('state/accounts.json')
    const listed = accounts.find((a) => a.safe.toLowerCase() === SAFE.toLowerCase())

    expect(account.saltNonce).toBe('1784155478729')     // NOT dropped
    expect(account.managers).toEqual([MANAGER])          // history preserved
    expect(account.deployedChains).toEqual([8453, 42161]) // unioned + deduped
    expect(listed).toEqual(account)                       // exact copy, both files
  })

  it('does not touch a non-selected SMA when a chain is added to the active one', async () => {
    await fix.api.post('/api/account').send({
      safe: SAFE, owner: OWNER, manager: MANAGER, chainId: 8453, deployedChains: [8453, 10],
    })
    const accounts = readJson('state/accounts.json')
    const other = accounts.find((a) => a.safe.toLowerCase() === SMA_B.toLowerCase())
    expect(other.deployedChains).toEqual([42161]) // SMA 2 unchanged
    expect(other.saltNonce).toBe('999')
    expect(other.name).toBe('SMA 2')
  })

  it('rename syncs both account.json and the list entry when the SMA is active', async () => {
    const res = await fix.api.post('/api/account/rename').send({ safe: SAFE, name: 'Renamed' })
    expect(res.status).toBe(200)
    const account = readJson('account.json')
    const listed = readJson('state/accounts.json').find((a) => a.safe.toLowerCase() === SAFE.toLowerCase())
    expect(account.name).toBe('Renamed')
    expect(listed.name).toBe('Renamed')
    expect(listed).toEqual(account)
  })
})

describe('selected vs executable flags', () => {
  let fix
  const SAFE = '0x8E637d9573Ad81B60cb93edA78b9C827860950a4'
  const OWNER = '0x7f8c6DB60b46F7eCBA131b882fBea1Fed4F5f4F5'
  const MANAGER = '0xa6D478146f03E9473582aCe099c67e3CbB5EC2BE'
  const SMA_B = '0x2222222222222222222222222222222222222222'
  const canonical = {
    safe: SAFE, owner: OWNER, permissionSigner: OWNER, manager: MANAGER,
    managers: [MANAGER], chainId: 8453, createdAtBlock: '46757914',
    saltNonce: '1784155478729', deployedChains: [8453], name: 'SMA 1', addedAt: '2026-07-16T12:00:00.000Z',
  }
  const readList = () => JSON.parse(fs.readFileSync(path.join(fix.sailDir, 'state/accounts.json'), 'utf-8'))
  const entry = (list, safe) => list.find((a) => a.safe.toLowerCase() === safe.toLowerCase())
  beforeEach(() => {
    fix = loadFixture('onboarded', {
      'account.json': JSON.stringify(canonical),
      'state/accounts.json': JSON.stringify([
        canonical,
        { safe: SMA_B, owner: OWNER, permissionSigner: OWNER, manager: MANAGER, managers: [MANAGER], chainId: 42161, createdAtBlock: '0', saltNonce: '999', deployedChains: [42161], name: 'SMA 2', addedAt: null },
      ]),
    })
  })
  afterEach(() => fix.cleanup())

  it('setting executable does not move selected', async () => {
    const res = await fix.api.post('/api/account/executable').send({ safe: SMA_B })
    expect(res.status).toBe(200)
    const list = readList()
    expect(entry(list, SMA_B).executable).toBe(true)
    expect(entry(list, SAFE).executable).toBeFalsy()
    // selected stays on the original active SMA (migrated from account.json).
    expect(entry(list, SAFE).selected).toBe(true)
    expect(entry(list, SMA_B).selected).toBeFalsy()
  })

  it('switching selected does not move executable', async () => {
    // SMA_A starts selected + executable (migrated). Switch UI selection to SMA_B.
    const res = await fix.api.post('/api/account/switch').send({ safe: SMA_B })
    expect(res.status).toBe(200)
    const list = readList()
    expect(entry(list, SMA_B).selected).toBe(true)
    expect(entry(list, SAFE).selected).toBeFalsy()
    // executable stayed on SMA_A — the agent keeps running it while the UI shows SMA_B.
    expect(entry(list, SAFE).executable).toBe(true)
    expect(entry(list, SMA_B).executable).toBeFalsy()
  })

  it('a newly registered SMA is selected but not executable (does not steal the run target)', async () => {
    const newSafe = '0x3333333333333333333333333333333333333333'
    const res = await fix.api.post('/api/account').send({ safe: newSafe, owner: OWNER, manager: MANAGER, chainId: 8453 })
    expect(res.status).toBe(200)
    const list = readList()
    expect(entry(list, newSafe).selected).toBe(true)
    expect(entry(list, newSafe).executable).toBeFalsy()
    expect(entry(list, SAFE).executable).toBe(true) // run target unchanged
  })

  it('404s for an unknown SMA', async () => {
    const res = await fix.api.post('/api/account/executable').send({ safe: '0x9999999999999999999999999999999999999999' })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/mandate', () => {
  let fix
  beforeEach(() => { fix = loadFixture('onboarded') })
  afterEach(() => fix.cleanup())

  it('returns mandates as an array', async () => {
    const res = await fix.api.get('/api/mandate')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
    const mandate = res.body[0]
    expect(mandate.safe).toBe('0x8E637d9573Ad81B60cb93edA78b9C827860950a4')
    expect(mandate.registeredOnChain).toBe(true)
    expect(mandate.permissions.length).toBeGreaterThan(0)
    expect(mandate.permissions[0].template).toBe('lifi-swap')
  })
})
