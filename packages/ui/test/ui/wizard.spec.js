import { expect, test } from '@playwright/test'

test('signing page loads without crash', async ({ page }) => {
  await page.goto('/#/signer')
  await page.waitForLoadState('networkidle')

  const body = await page.locator('body').innerText()
  expect(body.trim().length).toBeGreaterThan(0)
})

test('mandate draft page shows no error boundary', async ({ page }) => {
  await page.goto('/#/signer')
  await page.waitForLoadState('networkidle')

  const content = await page.content()
  expect(content).not.toContain('Something went wrong')
  expect(content).not.toContain('ChunkLoadError')
})

test('API /api/onboard/state is reachable from browser context', async ({ page }) => {
  const response = await page.request.get('http://localhost:14333/api/onboard/state')
  expect(response.ok()).toBe(true)
  const body = await response.json()
  expect(body.hasAccount).toBe(true)
  expect(body.chainId).toBe(8453)
  expect(body.managerAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
})

test('API /api/overview returns the fixture SMA address and network', async ({ page }) => {
  const response = await page.request.get('http://localhost:14333/api/overview')
  expect(response.ok()).toBe(true)
  const body = await response.json()
  expect(body).not.toBeNull()
  // These come from account.json, not RPC — stable even after background refresh fails
  expect(body.network).toBe('base')
  expect(body.chainId).toBe(8453)
  expect(body.sma.address).toBe('0x8E637d9573Ad81B60cb93edA78b9C827860950a4')
})

test('API /api/activity returns events array', async ({ page }) => {
  const response = await page.request.get('http://localhost:14333/api/activity')
  expect(response.ok()).toBe(true)
  const body = await response.json()
  expect(Array.isArray(body)).toBe(true)
  expect(body.length).toBeGreaterThan(0)
})

test('API /api/positions returns positions data', async ({ page }) => {
  const response = await page.request.get('http://localhost:14333/api/positions')
  expect(response.ok()).toBe(true)
  const body = await response.json()
  expect(Array.isArray(body.positions)).toBe(true)
  expect(body.positions.length).toBeGreaterThan(0)
})
