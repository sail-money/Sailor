import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'test/ui',
  use: {
    baseURL: 'http://localhost:14333',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Start the test server once before all UI tests. Requires `pnpm build` first.
  webServer: {
    command: 'node test/helpers/start-test-server.js',
    url: 'http://localhost:14333',
    reuseExistingServer: false,
    timeout: 15_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  timeout: 20_000,
  reporter: [['list']],
})
