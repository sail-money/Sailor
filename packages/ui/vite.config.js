import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // The signing-station WebSocket — proxied with ws:true so the live
      // useSigningChannel can relay signed results back to the daemon.
      '/api/station/ws': {
        target: 'ws://localhost:3334',
        ws: true,
        changeOrigin: true,
      },
      '/api': 'http://localhost:3334',
    },
  },
})
