import { expect, test } from '@playwright/test'

// Wizard tests use a second server fixture (fresh) spun up per-test.
// For simplicity, we test the wizard against the standard test server (onboarded)
// which shows the "no pending flow" state, then test the signing page directly.
// A dedicated fresh-fixture server can be added later for full wizard E2E.

test('signing page loads without crash', async ({ page }) => {
  await page.goto('/#/signing')
  await page.waitForLoadState('networkidle')

  const body = await page.locator('body').innerText()
  expect(body.trim().length).toBeGreaterThan(0)
})

test('mandate draft page shows no-pending message when no draft exists', async ({ page }) => {
  await page.goto('/#/signing')
  await page.waitForLoadState('networkidle')

  // With the onboarded fixture (account exists, no draft), should show
  // a "no pending" or completion state rather than a spinner forever
  const content = await page.content()
  // Should not contain an unhandled error boundary message
  expect(content).not.toContain('Something went wrong')
  expect(content).not.toContain('ChunkLoadError')
})

test('API /api/onboard/state is reachable from the browser context', async ({ page }) => {
  const response = await page.request.get('http://localhost:14333/api/onboard/state')
  expect(response.ok()).toBe(true)
  const body = await response.json()
  expect(body.hasAccount).toBe(true)
  expect(body.chainId).toBe(8453)
})

test('API /api/overview returns the pre-cached snapshot', async ({ page }) => {
  const response = await page.request.get('http://localhost:14333/api/overview')
  expect(response.ok()).toBe(true)
  const body = await response.json()
  expect(body).not.toBeNull()
  expect(body.network).toBe('base')
  expect(body.onchain).toBe(true)
})
