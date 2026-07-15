import '@rainbow-me/rainbowkit/styles.css'
import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { RainbowKitProvider } from '@rainbow-me/rainbowkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import SigningPage from './pages/signer/SigningPage'
import Dashboard from './pages/dashboard/Dashboard'
import { wagmiConfig } from './wagmi'
import { useWalletLifecycle } from './hooks/useWalletLifecycle'
import './styles/globals.css'

const queryClient = new QueryClient()

/** Headless: syncs wallet state with the injected provider (clears stale sessions). See F3. */
function WalletLifecycle() {
  useWalletLifecycle()
  return null
}

function readRoute() {
  if (typeof window === 'undefined') return '/'
  const raw = window.location.hash.replace(/^#/, '') || '/'
  return raw.startsWith('/') ? raw : `/${raw}`
}

/**
 * The signing daemon serves this SPA on ports 3141–3150. When the page is
 * opened from there (the URL the CLI prints), default to the signing page
 * instead of the dashboard so approvals are front-and-center.
 */
function servedBySigningDaemon() {
  if (typeof window === 'undefined') return false
  const port = Number(window.location.port)
  return port >= 3141 && port <= 3150
}

// Redirect bare / to the correct default route synchronously — before React
// renders — so the Router never starts with route='/' and mounts Dashboard
// with key='/', only to immediately remount it with key='/dashboard' after the
// useEffect fires. That double-mount caused Dashboard to hit its
// `onboardChecked = false → return null` gate twice, showing a black screen
// for the duration of the second refreshOnboard fetch.
if (typeof window !== 'undefined') {
  const initial = readRoute()
  if (initial === '/' || initial === '') {
    window.location.replace(servedBySigningDaemon() ? '#/signer' : '#/dashboard')
  }
}

function Router() {
  const [route, setRoute] = useState(readRoute)

  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHash)

      return () => {
      window.removeEventListener('hashchange', onHash)
    }
  }, [])

  let page
  if (route.startsWith('/home')) page = <Dashboard key={route} />
  // `/signer` is the canonical signing-page route; `/station` is a
  // v1.2.0-compatible alias — any bookmark or printed URL from that release
  // still lands on the same component. Do not remove before the next major.
  // `/signer` is canonical; `/station` (v1.2.0) and `/signing` (pre-daemon
  // standalone page, removed) are compat aliases so stale bookmarks and
  // printed URLs still land on the live signing surface.
  else if (route.startsWith('/signer') || route.startsWith('/station') || route.startsWith('/signing')) page = <SigningPage key={route} />
  else if (route.startsWith('/dashboard')) page = <Dashboard key={route} />
  else page = <Dashboard key={route} />

  return page
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <WalletLifecycle />
          <Router />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
)
