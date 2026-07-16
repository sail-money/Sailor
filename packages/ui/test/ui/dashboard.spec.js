import { expect, test } from '@playwright/test'

// All tests use the onboarded fixture served at http://localhost:14333 by
// test/helpers/start-test-server.js (configured in playwright.config.js).

const KNOWN_BACKGROUND_ERRORS = [
  // wagmi/RainbowKit fires RPC/wallet-connect probes on mount
  '400', '403', '401',
  'WalletConnect', 'walletconnect',
  'favicon',
  'ECONNREFUSED', 'net::ERR_CONNECTION_REFUSED',
  'Failed to fetch',
]

function isKnownNoise(msg) {
  return KNOWN_BACKGROUND_ERRORS.some(s => msg.includes(s))
}

test('dashboard loads and React mounts without critical errors', async ({ page }) => {
  const criticalErrors = []
  page.on('console', msg => {
    if (msg.type() === 'error' && !isKnownNoise(msg.text())) {
      criticalErrors.push(msg.text())
    }
  })

  await page.goto('/#/dashboard')
  await page.waitForLoadState('networkidle')

  const text = await page.locator('body').innerText()
  expect(text.trim().length).toBeGreaterThan(0)
  expect(criticalErrors).toHaveLength(0)
})

test('dashboard page shows expected UI landmarks', async ({ page }) => {
  await page.goto('/#/dashboard')
  await page.waitForLoadState('networkidle')

  const text = await page.locator('body').innerText()
  // Header navigation and main section are rendered
  expect(text.toUpperCase()).toContain('DASHBOARD')
})

test('activity feed renders without crashing', async ({ page }) => {
  await page.goto('/#/dashboard')
  await page.waitForLoadState('networkidle')

  const content = await page.content()
  expect(content).not.toContain('Something went wrong')
  expect(content).not.toContain('Unexpected Application Error')
})

test('navigation buttons are present', async ({ page }) => {
  await page.goto('/#/dashboard')
  await page.waitForLoadState('networkidle')

  // Navigation uses <button> elements (hash router without anchor tags)
  await page.waitForSelector('button', { timeout: 5000 })
  const buttons = await page.locator('button').count()
  expect(buttons).toBeGreaterThan(0)
})

test('signing page loads', async ({ page }) => {
  await page.goto('/#/signer')
  await page.waitForLoadState('networkidle')

  const body = await page.locator('body').innerText()
  expect(body.trim().length).toBeGreaterThan(0)
})

// `#/station` is the v1.2.0-compatible alias — any bookmark or printed URL
// from that release must still land on the same signing page, no breakage.
test('signing page loads via the deprecated #/station alias', async ({ page }) => {
  await page.goto('/#/station')
  await page.waitForLoadState('networkidle')

  const body = await page.locator('body').innerText()
  expect(body.trim().length).toBeGreaterThan(0)
})
