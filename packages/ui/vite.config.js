import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  // Surface a missing WalletConnect project id at build time. The runtime guard in
  // src/wagmi.js is DEV-only, so a production build with no VITE_WALLETCONNECT_PROJECT_ID
  // would otherwise ship a silently broken WalletConnect connector with no signal.
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    if (!env.VITE_WALLETCONNECT_PROJECT_ID) {
      console.warn(
        '\n[vite] WARNING: VITE_WALLETCONNECT_PROJECT_ID is not set for this build.\n' +
        'WalletConnect (e.g. connecting a Safe) will not produce a pairing link in the\n' +
        'shipped bundle. Set it before building for production — see packages/ui/.env.example.\n',
      )
    }
  }

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': { target: 'http://localhost:3334', ws: true },
      },
    },
  }
})
