/**
 * Demo state registry.
 *
 * Every reachable UI state has a stable URL you can paste anywhere
 * (including a Claude chat). The DemoConsole reads from this registry
 * to render its preset list; Dashboard.jsx and Signing.jsx read query
 * params to decide what data and initial UI step to render.
 *
 * The `incoming` state accepts extra params so Claude can build a URL
 * that opens the dashboard with a fresh PendingModal containing a
 * specific mandate proposal — see buildIncomingMandate().
 */
export const DEMO_GROUPS = [
  {
    title: 'New visitor',
    presets: [
      {
        id: 'landing',
        label: 'Marketing landing',
        description: 'The sail.money splash page',
        url: '#/landing',
      },
    ],
  },
  {
    title: 'Sign-in flow',
    presets: [
      {
        id: 'welcome',
        label: 'Welcome',
        description: 'Single Connect-wallet entry',
        url: '#/signing?demo=welcome',
      },
      {
        id: 'connect',
        label: 'Connect wallet',
        description: 'Pick from the full wallet grid',
        url: '#/signing?demo=connect',
      },
      {
        id: 'deploy',
        label: 'Deploy SMA',
        description: 'Review the deployment transaction',
        url: '#/signing?demo=deploy',
      },
      {
        id: 'confirming',
        label: 'Confirming signature',
        description: 'Waiting for wallet signature',
        url: '#/signing?demo=confirming',
      },
    ],
  },
  {
    title: 'Dashboard states',
    presets: [
      {
        id: 'empty',
        label: 'Connected, no SMA',
        description: 'Wallet connected — first-agent hero, SMA not deployed.',
        url: '#/dashboard?demo=empty',
      },
      {
        id: 'funded-empty',
        label: 'SMA created, no agents',
        description: 'Portfolio funded, but AI hasn’t drafted anything yet.',
        url: '#/dashboard?demo=funded-empty',
      },
      {
        id: 'full',
        label: 'Full live demo',
        description: '7 agents, 3 pending signatures',
        url: '#/dashboard?demo=full',
      },
    ],
  },
  {
    title: 'Claude integration',
    presets: [
      {
        id: 'incoming',
        label: 'Claude just drafted an agent',
        description: 'Pending modal opens with a brand-new draft',
        url: buildIncomingUrl({
          ai: 'Claude',
          title: '$300 into Ethena sUSDe',
          summary:
            'Move up to $300 of idle USDC into Ethena sUSDe for 14 days to capture stable yield. Withdraw on expiry, no rolling.',
          cap: '$300 max',
          time: '14 days',
          net: 'Arbitrum',
          asset: 'USDC',
          acts: ['Deposit USDC into sUSDe', 'Claim sUSDe rewards', 'Withdraw on expiry'],
        }),
      },
      {
        id: 'incoming-cursor',
        label: 'Cursor drafted a hedge',
        description: 'Demo a different AI provider drafting',
        url: buildIncomingUrl({
          ai: 'Cursor',
          title: '0.25 ETH hedge ceiling',
          summary:
            'Open a 0.25 ETH short on GMX as a hedge against my spot ETH for 10 days. Roll once if expiring during weekend.',
          cap: '0.25 ETH max',
          time: '10 days',
          net: 'Arbitrum',
          asset: 'WETH',
          acts: ['Open short up to 0.25 ETH on GMX', 'Close or reduce position', 'Roll once at expiry'],
        }),
      },
    ],
  },
]

/**
 * Builds a #/dashboard?demo=incoming URL with the supplied draft fields.
 * Use this from the demo console "Copy link for Claude" feature or share
 * the helper in docs so Claude can construct URLs in its responses.
 */
export function buildIncomingUrl({
  ai = 'Claude',
  title = '',
  summary = '',
  cap = '',
  time = '',
  net = 'Arbitrum',
  asset = 'USDC',
  acts = [],
} = {}) {
  const params = new URLSearchParams({
    demo: 'incoming',
    ai,
    title,
    summary,
    cap,
    time,
    net,
    asset,
    acts: Array.isArray(acts) ? acts.join('|') : String(acts),
  })
  return `#/dashboard?${params.toString()}`
}

/** Reverse of buildIncomingUrl — parses an incoming pending mandate from a URLSearchParams. */
export function parseIncomingMandate(searchParams) {
  if (searchParams.get('demo') !== 'incoming') return null
  const ai = searchParams.get('ai') ?? 'Claude'
  const title = searchParams.get('title') ?? 'New mandate draft'
  const summary = searchParams.get('summary') ?? ''
  const cap = searchParams.get('cap') ?? ''
  const time = searchParams.get('time') ?? ''
  const net = searchParams.get('net') ?? 'Arbitrum'
  const asset = searchParams.get('asset') ?? 'USDC'
  const actsRaw = searchParams.get('acts') ?? ''
  const allowed = actsRaw.split('|').map((s) => s.trim()).filter(Boolean)

  // Compose constraint pills (for legacy renderers) from the structured spec
  const constraints = [cap, time, `${asset} on ${net}`].filter(Boolean)

  return {
    id: 'pending-incoming',
    aiName: ai,
    aiInitial: ai[0]?.toUpperCase() ?? '?',
    title,
    summary,
    requestedAgo: 'just now',
    constraints,
    allowed,
    disallowed: [],
    calldata: '// Draft mandate — calldata generated on sign.',
  }
}
