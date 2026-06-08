import '@rainbow-me/rainbowkit/styles.css'
import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { RainbowKitProvider } from '@rainbow-me/rainbowkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import App from './App'
import SigningStation from './pages/station/SigningStation'
import Dashboard from './pages/dashboard/Dashboard'
import AgentPage from './pages/dashboard/AgentPage'
import MandatePage from './pages/dashboard/MandatePage'
import JournalPage from './pages/dashboard/JournalPage'
import { buildWagmiConfig } from './wagmi'
import { maybeInstallSimWallet } from './devSimWallet'
import LocalRpcBanner from './components/LocalRpcBanner'
import SimControls from './components/SimControls'
import SimModeToggle from './components/SimModeToggle'
import './styles/globals.css'

const queryClient = new QueryClient()

/**
 * Probe the project's configured RPC before building the wagmi config. When the
 * project points at a custom/local RPC (e.g. a local anvil fork wired through
 * .sail/.env.local), we route the dapp's transport for that chain at it so
 * reads and owner-signing preflight hit the same endpoint the wallet is on.
 * Falls back to the default (public-RPC) config if the probe fails or the
 * project is on a normal network. Bounded so app boot never hangs on the fetch.
 */
async function probeLocalNetwork() {
  try {
    const r = await fetch('/api/network', { cache: 'no-store', signal: AbortSignal.timeout(1500) })
    if (!r.ok) return null
    const data = await r.json()
    return data && data.isLocal ? data : null
  } catch {
    return null
  }
}

function readRoute() {
  if (typeof window === 'undefined') return '/'
  const raw = window.location.hash.replace(/^#/, '') || '/'
  return raw.startsWith('/') ? raw : `/${raw}`
}

/**
 * The signing daemon serves this SPA on ports 3141–3150. When the page is
 * opened from there (the URL the CLI prints), default to the signing station
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
  // mandate signing print), land on the signing station so wallet-connect and
  // approvals are front-and-centre and the connected wallet is relayed back to
  // the CLI (the dashboard has no such relay once a project is onboarded).
  useEffect(() => {
    if (route === '/' || route === '') {
      window.location.replace(servedBySigningDaemon() ? '#/station' : '#/dashboard')
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
  if (route.startsWith('/home')) page = <Dashboard key={route} />
  else if (route.startsWith('/station')) page = <SigningStation key={route} />
  else if (route.startsWith('/signing')) page = <Dashboard key={route} />
  else if (route.startsWith('/mandate/')) {
    // /mandate/:id — the canonical home for contract + permissions
    // detail. Revoking from here triggers the contract animation, then
    // routes back to the dashboard.
    const id = route.slice('/mandate/'.length).split('?')[0]
    page = (
      <MandatePage
        key={route}
        mandateId={id}
        onBack={() => { window.location.hash = '#/dashboard' }}
        onRevoke={() => { window.location.hash = '#/dashboard' }}
      />
    )
  }
  else if (route.startsWith('/agent/')) {
    const id = route.slice('/agent/'.length).split('?')[0]
    page = (
      <AgentPage
        key={route}
        agentId={id}
        onBack={() => { window.location.hash = '#/dashboard' }}
        onEdit={() => { window.location.hash = '#/dashboard' }}
        onRevoke={() => { window.location.hash = '#/dashboard' }}
      />
    )
  }
  else if (route.startsWith('/journal/')) {
    // /journal/:entryId — full-page detail of one Decision Journal
    // entry. Replaces the older right-side drawer; users get the same
    // visual chrome as MandatePage/AgentPage and can step through
    // adjacent entries from inside the page.
    const id = route.slice('/journal/'.length).split('?')[0]
    page = (
      <JournalPage
        key={route}
        entryId={id}
        onBack={() => { window.location.hash = '#/dashboard' }}
      />
    )
  }
  else if (route.startsWith('/dashboard')) page = <Dashboard key={route} />
  else if (route.startsWith('/landing')) page = <App />
  else page = <Dashboard key={route} />

  return page
}

async function bootstrap() {
  const localNetwork = await probeLocalNetwork()
  // Local-only test harness: install a simulated wallet BEFORE building the wagmi
  // config so RainbowKit/wagmi discover it. No-op unless ?sim=1 on a local fork.
  // Never let a sim-wallet install failure abort boot (a blank page) — it's a
  // dev-only convenience, the real app must always render.
  let simProvider = null
  try {
    simProvider = maybeInstallSimWallet(localNetwork)
  } catch (e) {
    console.warn('[sim-wallet] install failed (continuing without it):', e)
  }
  // In sim mode, buildWagmiConfig presents ONLY the sim wallet (no Rabby/MetaMask),
  // so the fork auto-signs and no real wallet can intercept with signing prompts.
  const config = buildWagmiConfig(localNetwork, simProvider)

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider>
            <LocalRpcBanner info={localNetwork} />
            <SimModeToggle info={localNetwork} />
            <SimControls info={localNetwork} />
            <Router />
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </React.StrictMode>,
  )
}

bootstrap()
