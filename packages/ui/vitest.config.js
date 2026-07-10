import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // api/* = server + API tests; unit/* = pure logic (e.g. signing-station state machine).
    include: ['test/api/**/*.test.js', 'test/unit/**/*.test.js'],
    // Each file runs in its own worker to avoid port and file-system collisions
    // between test suites that write to the same fixture paths.
    pool: 'forks',
    testTimeout: 15_000,
    hookTimeout: 10_000,
  },
})
