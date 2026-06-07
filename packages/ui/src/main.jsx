import '@rainbow-me/rainbowkit/styles.css'
import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { RainbowKitProvider } from '@rainbow-me/rainbowkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import App from './App'
import Dashboard from './pages/dashboard/Dashboard'
import Signing from './pages/signing/Signing'
import { wagmiConfig } from './wagmi'
import './styles/globals.css'

const queryClient = new QueryClient()

function readRoute() {
  if (typeof window === 'undefined') return '/'
  const raw = window.location.hash.replace(/^#/, '') || '/'
  return raw.startsWith('/') ? raw : `/${raw}`
}

/**
 * The signing daemon serves this SPA on ports 3141–3150. When the page is
 * opened from there (the URL the CLI prints), default to the signing flow
 * instead of the dashboard so approvals are front-and-center.
 */
function servedBySigningDaemon() {
  if (typeof window === 'undefined') return false
  const port = Number(window.location.port)
  return port >= 3141 && port <= 3150
}

function Router() {
  const [route, setRoute] = useState(readRoute)

  // Default landing for the local UI is the dashboard. The marketing
  // landing page remains accessible at #/landing. But when this SPA is served
  // by the signing daemon (ports 3141–3150 — the URL `sailor owner connect` /
  // mandate signing print), land on the signing flow so wallet-connect and
  // approvals are front-and-centre.
  useEffect(() => {
    if (route === '/' || route === '') {
      window.location.replace(servedBySigningDaemon() ? '#/signing' : '#/dashboard')
    }
  }, [route])

  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHash)
    return () => {
      window.removeEventListener('hashchange', onHash)
    }
  }, [])

  let page
  if (route.startsWith('/signing')) page = <Signing key={route} />
  else if (route.startsWith('/landing')) page = <App />
  else page = <Dashboard key={route} />

  return page
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <Router />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
)
