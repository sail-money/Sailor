import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Fail the build (and dev-server start) if a chain is registered in the SDK but
// has no UI presentation — so a chain can never ship un-styled. This is the
// build-time enforcement referenced in src/lib/chainPresentation.js.
function chainCoveragePlugin() {
  return {
    name: 'chain-coverage',
    async buildStart() {
      const { chains } = await import('@sail/sdk/chains')
      const { CHAIN_PRESENTATION } = await import('./src/lib/chainPresentation.js')
      const missing = Object.values(chains)
        .filter((c) => !c.testnet && !CHAIN_PRESENTATION[c.chainId])
        .map((c) => `${c.chainId} (${c.name})`)
      if (missing.length) {
        this.error(
          `Chain(s) in the SDK registry with no UI presentation: ${missing.join(', ')}. ` +
          `Add a color + description in src/lib/chainPresentation.js (and, optionally, an icon in ` +
          `src/pages/shared/ChainGlyph.jsx).`,
        )
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), chainCoveragePlugin()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3334', ws: true },
    },
  },
})
