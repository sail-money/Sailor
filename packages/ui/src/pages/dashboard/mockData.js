export const mockWallet = '0x6f2A8b3f9C4d5E1A7B0c2D3E4F5A6B7C8D9E0F12'

// One EOA can own multiple SMAs. Listed in order they were created.
// The first SMA is the "primary" — used wherever a single SMA is
// implied (legacy `mockSafe` alias, AgentPage banner, etc.).
/* `network` is the SMA's home chain (back-compat for single-chain
   surfaces). `networks` is the full set of chains the same SMA is
   counterfactually deployed on — when it has more than one, the
   selector / wallet UI shows "Multichain" with a stacked-dot avatar
   instead of a single chain name. */
/* One SMA = one chain. Per the protocol's EIP-712 domain, every
 * signature binds (chainId, kernel address) — so a single SMA can
 * only ever live on one chain. Multi-chain setups become multiple
 * SMAs (one per chain). The `networks` array stays as a single
 * element for layout compatibility with the multi-network selector. */
export const mockSafes = [
  {
    id: 'sma-1',
    name: 'DeFi conservative',
    address: '0x4e2a91b3F7c5dA8bC09f1E2d3B4a5C6d7E8f9c8b8d11',
    network: 'arbitrum',
    networks: ['arbitrum'],
    agentCount: 2,
    createdAgo: 'May 18, 2026',
    createdAt: 'May 18, 2026',
  },
  {
    id: 'sma-2',
    name: 'Hedging SMA',
    address: '0xS42Fa0bcd91e4c5A2D3F8e7C6b0A9F1e2D3C4b5A6',
    network: 'arbitrum',
    networks: ['arbitrum'],
    agentCount: 1,
    createdAgo: '12 days ago',
  },
  {
    id: 'sma-3',
    name: 'Yield · Base',
    address: '0xS44A1e2f3D4c5B6a7E8F9c0D1e2A3B4c5D6E7F8a9',
    network: 'base',
    networks: ['base'],
    agentCount: 2,
    createdAgo: '3 weeks ago',
  },
]
// Backwards-compat alias — the primary SMA address.
export const mockSafe = mockSafes[0].address

export const mockMandates = [
  {
    id: 'mandate-1',
    role: 'USDC Yield Specialist',
    aiName: 'Claude',
    aiInitial: 'C',
    title: '$500 USDC yield on Arbitrum',
    summary: 'Park up to $500 of idle USDC into the best USDC yield on Arbitrum for 24 days. Rebalance between Aave and Compound only.',
    duration: 'Ends in 24 days',
    networks: ['arbitrum'],
    assets: ['USDC'],
    caps: [{ asset: 'USDC', amount: 500, currency: 'USD' }],
    endsAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 24,
    actions: [
      {
        id: 'm1-a1',
        kind: 'deposit',
        label: 'Deposit USDC into the highest-APY lending pool',
        asset: 'USDC',
        venue: 'aave',
        networks: ['arbitrum'],
        strategy: 'best-apy',
      },
      {
        id: 'm1-a2',
        kind: 'rebalance',
        label: 'Rebalance between Aave and Compound when APY differs by ≥ 1%',
        asset: 'USDC',
        networks: ['arbitrum'],
      },
      {
        id: 'm1-a3',
        kind: 'claim',
        label: 'Claim accrued interest',
        asset: 'USDC',
        networks: ['arbitrum'],
      },
      {
        id: 'm1-a4',
        kind: 'withdraw',
        label: 'Withdraw on expiry to my wallet',
        asset: 'USDC',
        networks: ['arbitrum'],
      },
    ],
    status: 'active',
    constraints: ['$500 max', 'USDC', 'Arbitrum', 'Deposit only'],
    lastAction: { ago: '2h ago', label: 'Deposited $50 into Aave' },
    activeNow: true,
    pnl: { value: 23.84, pct: 4.77, principal: 500, denom: 'USD' },
    live: {
      balance: 523.84,
      principal: 500,
      apy: 4.6,
      // 28-point sparkline — 4 weeks of daily values starting at 500
      history: [500, 500.2, 500.7, 501.1, 501.6, 502.4, 503.1, 503.9, 504.8, 505.6, 506.5, 507.7, 508.9, 510.1, 511.4, 512.9, 514.3, 515.7, 517.2, 518.6, 519.9, 520.8, 521.4, 521.9, 522.6, 523.1, 523.5, 523.84],
      venue: 'Aave + Compound',
    },
    editable: {
      amount: 500,
      asset: 'USDC',
      chain: 'Arbitrum',
      days: 24,
      kind: 'yield',
      allowed: [
        { id: 'aave-deposit',  label: 'Deposit into Aave USDC',          on: true },
        { id: 'aave-withdraw', label: 'Withdraw from Aave USDC',         on: true },
        { id: 'rebalance',     label: 'Rebalance within USDC yield',     on: true },
        { id: 'compound',      label: 'Deposit into Compound USDC',      on: false },
      ],
      disallowed: [
        'Send to external wallets',
        'Swap into other tokens',
        'Exceed $500 total',
      ],
    },
  },
  {
    id: 'mandate-2',
    role: 'ETH Hedge Operator',
    aiName: 'Cursor',
    aiInitial: 'C',
    title: 'ETH hedge — 0.5 ETH ceiling',
    summary: 'Hedge up to 0.5 ETH of price exposure for 6 days using GMX shorts. Stay under 2× leverage at all times.',
    duration: 'Ends in 6 days',
    networks: ['arbitrum'],
    assets: ['WETH'],
    caps: [{ asset: 'WETH', amount: 0.5, currency: 'WETH' }],
    endsAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 6,
    actions: [
      { id: 'm2-a1', kind: 'short',  label: 'Open short up to 0.5 ETH on GMX',      asset: 'WETH', venue: 'gmx', networks: ['arbitrum'] },
      { id: 'm2-a2', kind: 'rebalance', label: 'Close or reduce the short position', asset: 'WETH', venue: 'gmx', networks: ['arbitrum'] },
      { id: 'm2-a3', kind: 'rebalance', label: 'Roll the position before expiry',    asset: 'WETH', venue: 'gmx', networks: ['arbitrum'] },
    ],
    status: 'active',
    constraints: ['0.5 ETH max', 'WETH', 'Arbitrum', 'Swap allowed'],
    lastAction: { ago: '1d ago', label: 'Opened short 0.12 ETH on GMX' },
    activeNow: false,
    pnl: { value: 8.42, pct: 1.6, principal: 525, denom: 'USD' },
    editable: {
      amount: 0.5,
      asset: 'WETH',
      chain: 'Arbitrum',
      days: 6,
      kind: 'hedge',
      allowed: [
        { id: 'gmx-short', label: 'Open short on GMX',      on: true },
        { id: 'gmx-close', label: 'Close or reduce position', on: true },
        { id: 'gmx-roll',  label: 'Roll position before expiry', on: true },
      ],
      disallowed: [
        'Leverage above 2x',
        'Swap into other tokens',
        'Exceed 0.5 ETH notional',
      ],
    },
  },
  {
    id: 'mandate-3',
    role: 'Stablecoin Park Agent',
    aiName: 'Claude',
    aiInitial: 'C',
    title: '$200 USDC stablecoin park',
    summary: 'Hold up to $200 of USDC in a low-risk stablecoin venue for 30 days. Withdraw on expiry without rolling.',
    duration: 'Expired May 4',
    networks: ['arbitrum'],
    assets: ['USDC'],
    caps: [{ asset: 'USDC', amount: 200, currency: 'USD' }],
    actions: [
      { id: 'm3-a1', kind: 'deposit',  label: 'Deposit USDC into a single low-risk lending venue', asset: 'USDC', venue: 'aave', networks: ['arbitrum'] },
      { id: 'm3-a2', kind: 'withdraw', label: 'Withdraw on expiry to my wallet',                   asset: 'USDC', networks: ['arbitrum'] },
    ],
    status: 'expired',
    constraints: ['$200 max', 'USDC', 'Arbitrum'],
    lastAction: { ago: '11d ago', label: 'Withdrew $200 to wallet' },
    activeNow: false,
    pnl: { value: 2.14, pct: 1.07, principal: 200, denom: 'USD' },
    editable: {
      amount: 200,
      asset: 'USDC',
      chain: 'Arbitrum',
      days: 0,
      kind: 'park',
      allowed: [
        { id: 'aave-deposit',  label: 'Deposit into Aave USDC',  on: true },
        { id: 'aave-withdraw', label: 'Withdraw from Aave USDC', on: true },
      ],
      disallowed: [
        'Send to external wallets',
        'Swap into other tokens',
      ],
    },
  },
  {
    id: 'mandate-4',
    role: 'Pendle PT Strategist',
    summary: 'Lock up to $1,000 USDC into Pendle PT to capture fixed yield. Do not exit early under any circumstances.',
    aiName: 'Claude',
    aiInitial: 'C',
    title: '$1,000 USDC into Pendle PT',
    duration: 'Revoked Apr 21',
    networks: ['arbitrum'],
    assets: ['USDC'],
    caps: [{ asset: 'USDC', amount: 1000, currency: 'USD' }],
    actions: [
      { id: 'm4-a1', kind: 'deposit',  label: 'Lock USDC into a fixed-yield PT vault', asset: 'USDC', venue: 'pendle', networks: ['arbitrum'] },
      { id: 'm4-a2', kind: 'withdraw', label: 'Withdraw the underlying on expiry',      asset: 'USDC', venue: 'pendle', networks: ['arbitrum'] },
    ],
    status: 'revoked',
    constraints: ['$1,000 max', 'USDC', 'Arbitrum', 'Pendle only'],
    lastAction: { ago: '27d ago', label: 'Withdrew $1,000 to wallet on revoke' },
    activeNow: false,
    pnl: { value: 6.30, pct: 0.63, principal: 1000, denom: 'USD' },
    editable: {
      amount: 1000,
      asset: 'USDC',
      chain: 'Arbitrum',
      days: 0,
      kind: 'yield',
      allowed: [
        { id: 'pendle-buy',  label: 'Buy Pendle PT-USDC',  on: true },
        { id: 'pendle-sell', label: 'Sell Pendle PT-USDC', on: true },
      ],
      disallowed: [
        'Send to external wallets',
        'Swap into other tokens',
      ],
    },
  },
  {
    id: 'mandate-5',
    role: 'Aave Yield Specialist',
    summary: 'Run up to $1,500 USDC in Aave yield on Arbitrum for 18 days. Rebalance only between Aave and Compound.',
    aiName: 'Claude',
    aiInitial: 'C',
    title: '$1,500 USDC yield on Aave',
    duration: 'Ends in 18 days',
    networks: ['arbitrum'],
    assets: ['USDC'],
    caps: [{ asset: 'USDC', amount: 1500, currency: 'USD' }],
    endsAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 18,
    actions: [
      { id: 'm5-a1', kind: 'deposit',   label: 'Deposit USDC into the higher-APY lending pool', asset: 'USDC', venue: 'aave',     networks: ['arbitrum'] },
      { id: 'm5-a2', kind: 'rebalance', label: 'Rebalance between Aave and Compound when APY differs by ≥ 1%', asset: 'USDC', venue: 'compound', networks: ['arbitrum'] },
      { id: 'm5-a3', kind: 'claim',     label: 'Claim accrued interest',                       asset: 'USDC', networks: ['arbitrum'] },
      { id: 'm5-a4', kind: 'withdraw',  label: 'Withdraw on expiry to my wallet',              asset: 'USDC', networks: ['arbitrum'] },
    ],
    status: 'active',
    constraints: ['$1,500 max', 'USDC', 'Arbitrum', 'Deposit only'],
    lastAction: { ago: '4h ago', label: 'Rebalanced $200 Aave → Compound' },
    activeNow: true,
    pnl: { value: 67.20, pct: 4.48, principal: 1500, denom: 'USD' },
    editable: {
      amount: 1500,
      asset: 'USDC',
      chain: 'Arbitrum',
      days: 18,
      kind: 'yield',
      allowed: [
        { id: 'aave-deposit',  label: 'Deposit into Aave USDC',          on: true },
        { id: 'aave-withdraw', label: 'Withdraw from Aave USDC',         on: true },
        { id: 'rebalance',     label: 'Rebalance within USDC yield',     on: true },
        { id: 'compound',      label: 'Deposit into Compound USDC',      on: true },
      ],
      disallowed: [
        'Send to external wallets',
        'Swap into other tokens',
      ],
    },
  },
  {
    id: 'mandate-6',
    role: 'BTC Hedge Operator',
    summary: 'Buy a 0.05 BTC put ceiling for 12 days as downside protection. Only on whitelisted DOPEX vaults.',
    aiName: 'Codex',
    aiInitial: 'O',
    title: 'BTC put ceiling — 0.05 BTC',
    duration: 'Ends in 12 days',
    networks: ['arbitrum'],
    assets: ['WBTC', 'USDC'],
    caps: [{ asset: 'WBTC', amount: 0.05, currency: 'WBTC' }],
    endsAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 12,
    actions: [
      { id: 'm6-a1', kind: 'hedge',     label: 'Buy WBTC put options up to a 0.05 BTC notional', asset: 'WBTC', venue: 'lyra',  networks: ['arbitrum'] },
      { id: 'm6-a2', kind: 'rebalance', label: 'Close or reduce the put position',               asset: 'WBTC', venue: 'lyra',  networks: ['arbitrum'] },
      { id: 'm6-a3', kind: 'rebalance', label: 'Roll the put forward if it expires under water', asset: 'WBTC', venue: 'dopex', networks: ['arbitrum'] },
    ],
    status: 'active',
    constraints: ['0.05 BTC max', 'WBTC', 'Arbitrum', 'Options only'],
    lastAction: { ago: '6h ago', label: 'Bought 0.01 BTC put on Lyra' },
    activeNow: false,
    pnl: { value: -12.30, pct: -0.91, principal: 1350, denom: 'USD' },
    editable: {
      amount: 0.05,
      asset: 'WBTC',
      chain: 'Arbitrum',
      days: 12,
      kind: 'hedge',
      allowed: [
        { id: 'lyra-buy-put', label: 'Buy BTC put on Lyra', on: true },
        { id: 'lyra-close',   label: 'Close or reduce position', on: true },
      ],
      disallowed: [
        'Buy calls or other options',
        'Sell options',
        'Exceed 0.05 BTC notional',
      ],
    },
  },
  /**
   * mandate-8 — "kitchen sink" mandate.
   * Five networks · ten assets · twelve actions across yield, swap,
   * bridge, options, lp, and rewards. Includes conditional triggers
   * and multiple caps. Exists so the AgentPage and PermissionsPanel
   * can be stress-tested against a maximalist permission set.
   */
  {
    id: 'mandate-8',
    role: 'Yield + Hedge Strategist',
    aiName: 'Claude',
    aiInitial: 'C',
    title: '$25,000 yield + hedge on Arbitrum',
    summary:
      'Run up to $25,000 of USDC and ETH across the top yield, LP, and options venues on Arbitrum for 90 days. Rebalance across vaults, claim incentives, recycle yield into ARB, and keep a small WBTC put hedge open the entire time.',
    duration: 'Ends in 87 days',
    networks: ['arbitrum'],
    assets: ['USDC', 'USDT', 'DAI', 'WETH', 'WBTC', 'ARB', 'CRV', 'AAVE', 'MORPHO'],
    caps: [
      { asset: 'USDC', amount: 25_000, currency: 'USD' },
      { asset: 'WETH', amount: 5,      currency: 'WETH' },
      { asset: 'WBTC', amount: 0.1,    currency: 'WBTC' },
    ],
    endsAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 87,
    actions: [
      { id: 'm8-a1',  kind: 'deposit',         label: 'Deposit USDC into the highest-APY Aave V3 market',           asset: 'USDC',  venue: 'aave-v3',         networks: ['ethereum', 'arbitrum', 'base', 'optimism', 'polygon'], strategy: 'best-apy' },
      { id: 'm8-a2',  kind: 'deposit',         label: 'Deposit USDC into Compound V3 when APY ≥ Aave + 1.2%',        asset: 'USDC',  venue: 'compound-v3',     networks: ['ethereum', 'arbitrum', 'base', 'optimism', 'polygon'] },
      { id: 'm8-a3',  kind: 'deposit',         label: 'Deposit USDC into top-3 Morpho Blue vaults by 30d APY',       asset: 'USDC',  venue: 'morpho-blue',     networks: ['ethereum', 'base'] },
      { id: 'm8-a4',  kind: 'rebalance',       label: 'Rebalance across Aave / Compound / Morpho when APY Δ ≥ 0.8%', asset: 'USDC',  venue: 'router',          networks: ['ethereum', 'arbitrum', 'base', 'optimism', 'polygon'] },
      { id: 'm8-a5',  kind: 'swap',            label: 'Swap USDC ↔ USDT ↔ DAI for arbitrage when spread ≥ 5 bps',    from: 'USDC',   to: 'USDT',   venue: 'uniswap-v3', networks: ['ethereum', 'arbitrum', 'base'] },
      { id: 'm8-a6',  kind: 'bridge',          label: 'Bridge USDC between chains via Across when fees ≤ 5 bps',     asset: 'USDC',  venue: 'across',          networks: ['ethereum', 'arbitrum', 'base', 'optimism', 'polygon'] },
      { id: 'm8-a7',  kind: 'lp',              label: 'Provide USDC/USDT/DAI LP to Curve 3pool',                    asset: 'USDC',  venue: 'curve',           networks: ['ethereum', 'arbitrum', 'optimism', 'polygon'] },
      { id: 'm8-a8',  kind: 'claim',           label: 'Claim CRV, AAVE, MORPHO, OP, ARB incentives',                 asset: 'CRV',   venue: 'multi',           networks: ['ethereum', 'arbitrum', 'base', 'optimism', 'polygon'] },
      { id: 'm8-a9',  kind: 'conditional-swap', label: 'When daily yield ≥ $25, swap that slice into ARB on Arbitrum', from: 'USDC', to: 'ARB',   venue: 'uniswap-v3', networks: ['arbitrum'], trigger: { type: 'yield-threshold', amountUsd: 25 } },
      { id: 'm8-a10', kind: 'conditional-swap', label: 'When daily yield ≥ $25, swap that slice into OP on Optimism', from: 'USDC', to: 'OP',    venue: 'velodrome',  networks: ['optimism'], trigger: { type: 'yield-threshold', amountUsd: 25 } },
      { id: 'm8-a11', kind: 'hedge',           label: 'Buy WBTC put options up to 0.1 BTC notional on Lyra / Dopex',  asset: 'WBTC', venue: 'lyra',           networks: ['arbitrum'] },
      { id: 'm8-a12', kind: 'withdraw',        label: 'Withdraw the entire position to my wallet on expiry',         asset: 'USDC', venue: 'router',          networks: ['ethereum', 'arbitrum', 'base', 'optimism', 'polygon'] },
    ],
    status: 'active',
    constraints: [
      '$25,000 USDC max', '5 ETH max', '0.1 BTC max',
      '5 networks', '10 assets',
      '90 day window', 'No leverage > 1x',
    ],
    lastAction: { ago: '12m ago', label: 'Rebalanced $1,200 Aave → Morpho (Base)' },
    activeNow: true,
    pnl: { value: 412.50, pct: 1.65, principal: 25_000, denom: 'USD' },
    live: {
      balance: 25_412.50,
      principal: 25_000,
      apy: 6.8,
      history: [25000, 25004, 25011, 25021, 25032, 25047, 25068, 25092, 25118, 25145, 25171, 25199, 25223, 25248, 25272, 25295, 25318, 25336, 25351, 25364, 25376, 25387, 25395, 25401, 25406, 25409, 25411, 25412.5],
      venue: 'Aave + Compound + Morpho + Curve',
    },
    editable: {
      amount: 25_000,
      asset: 'USDC',
      chain: 'Multi-chain',
      days: 87,
      kind: 'multi',
      allowed: [
        { id: 'aave-deposit',     label: 'Deposit into Aave V3 (any chain)',         on: true },
        { id: 'aave-withdraw',    label: 'Withdraw from Aave V3',                    on: true },
        { id: 'compound-deposit', label: 'Deposit into Compound V3',                 on: true },
        { id: 'compound-withdraw',label: 'Withdraw from Compound V3',                on: true },
        { id: 'morpho-deposit',   label: 'Deposit into Morpho Blue (top vaults)',    on: true },
        { id: 'morpho-withdraw',  label: 'Withdraw from Morpho Blue',                on: true },
        { id: 'curve-lp',         label: 'Provide LP to Curve 3pool',                on: true },
        { id: 'curve-claim',      label: 'Claim CRV rewards',                        on: true },
        { id: 'across-bridge',    label: 'Bridge USDC via Across (low-fee only)',    on: true },
        { id: 'uniswap-swap',     label: 'Swap stables on Uniswap V3 (≥ 5 bps edge)',on: true },
        { id: 'velodrome-swap',   label: 'Swap on Velodrome (Optimism only)',        on: true },
        { id: 'arb-buy',          label: 'Buy ARB from yield slice (Arbitrum only)', on: true },
        { id: 'op-buy',           label: 'Buy OP from yield slice (Optimism only)',  on: true },
        { id: 'lyra-buy-put',     label: 'Buy WBTC put on Lyra',                     on: true },
        { id: 'dopex-buy-put',    label: 'Buy WBTC put on Dopex',                    on: true },
      ],
      disallowed: [
        'Send to external wallets',
        'Use leverage above 1x',
        'Hold non-whitelisted tokens',
        'Sell options (write covered/naked)',
        'Bridge via non-whitelisted routers',
        'Exceed $25,000 net USDC notional',
      ],
    },
  },

  {
    id: 'mandate-7',
    role: 'Stablecoin Park Agent',
    summary: 'Hold $800 USDC in a stablecoin park for 30 days. No rebalancing, no leverage, withdraw on expiry.',
    aiName: 'Claude',
    aiInitial: 'C',
    title: '$800 USDC stablecoin park',
    duration: 'Expired Apr 9',
    networks: ['arbitrum'],
    assets: ['USDC'],
    caps: [{ asset: 'USDC', amount: 800, currency: 'USD' }],
    actions: [
      { id: 'm7-a1', kind: 'deposit',  label: 'Deposit USDC into a single low-risk stablecoin venue', asset: 'USDC', venue: 'aave', networks: ['arbitrum'] },
      { id: 'm7-a2', kind: 'withdraw', label: 'Withdraw on expiry to my wallet',                       asset: 'USDC', networks: ['arbitrum'] },
    ],
    status: 'expired',
    constraints: ['$800 max', 'USDC', 'Arbitrum'],
    lastAction: { ago: '39d ago', label: 'Withdrew $800 to wallet' },
    activeNow: false,
    pnl: { value: 7.20, pct: 0.90, principal: 800, denom: 'USD' },
    editable: {
      amount: 800,
      asset: 'USDC',
      chain: 'Arbitrum',
      days: 0,
      kind: 'park',
      allowed: [
        { id: 'aave-deposit',  label: 'Deposit into Aave USDC',  on: true },
        { id: 'aave-withdraw', label: 'Withdraw from Aave USDC', on: true },
      ],
      disallowed: [
        'Send to external wallets',
        'Swap into other tokens',
      ],
    },
  },
]

export const mockExecutions = [
  // ────────────── $500 USDC yield (mandate-1, Claude) ──────────────
  { id: 'tx-1',  ago: '2h ago',   action: 'Deposited $50 into Aave USDC',           by: 'Claude', mandate: '$500 USDC yield',       gas: '$0.12', status: 'confirmed' },
  { id: 'tx-2',  ago: '8h ago',   action: 'Rebalanced $120 Aave → Compound',         by: 'Claude', mandate: '$500 USDC yield',       gas: '$0.21', status: 'confirmed' },
  { id: 'tx-4',  ago: '2d ago',   action: 'Attempted deposit $80 into Aave',         by: 'Claude', mandate: '$500 USDC yield',       gas: '$0.09', status: 'failed',
    retries: [ { id: 'tx-4-r1', label: '↳ Retry #1 — succeeded', gas: '$0.11', status: 'confirmed' } ] },
  { id: 'tx-5',  ago: '4d ago',   action: 'Deposited $300 into Aave USDC',           by: 'Claude', mandate: '$500 USDC yield',       gas: '$0.18', status: 'confirmed' },
  { id: 'tx-6',  ago: '6d ago',   action: 'Claimed $4.12 in interest',               by: 'Claude', mandate: '$500 USDC yield',       gas: '$0.07', status: 'confirmed' },
  { id: 'tx-7',  ago: '9d ago',   action: 'Rebalanced $80 Compound → Aave',          by: 'Claude', mandate: '$500 USDC yield',       gas: '$0.16', status: 'confirmed' },
  { id: 'tx-8',  ago: '12d ago',  action: 'Deposited $150 into Compound USDC',       by: 'Claude', mandate: '$500 USDC yield',       gas: '$0.14', status: 'confirmed' },

  // ────────────── ETH hedge (mandate-2, Cursor) ──────────────
  { id: 'tx-3',  ago: '1d ago',   action: 'Opened short 0.12 ETH on GMX',            by: 'Cursor', mandate: 'ETH hedge',             gas: '$0.46', status: 'confirmed' },
  { id: 'tx-9',  ago: '3d ago',   action: 'Rolled short 0.08 ETH on GMX',            by: 'Cursor', mandate: 'ETH hedge',             gas: '$0.52', status: 'confirmed' },
  { id: 'tx-10', ago: '7d ago',   action: 'Closed short 0.05 ETH on GMX',            by: 'Cursor', mandate: 'ETH hedge',             gas: '$0.38', status: 'confirmed' },
  { id: 'tx-11', ago: '10d ago',  action: 'Reduced position to 0.10 ETH',            by: 'Cursor', mandate: 'ETH hedge',             gas: '$0.41', status: 'confirmed' },
  { id: 'tx-12', ago: '14d ago',  action: 'Opened short 0.15 ETH on GMX',            by: 'Cursor', mandate: 'ETH hedge',             gas: '$0.49', status: 'confirmed' },

  // ────────────── $200 USDC stablecoin park (mandate-3, Claude) ──────────────
  { id: 'tx-13', ago: '11d ago',  action: 'Withdrew $200 to wallet',                 by: 'Claude', mandate: '$200 USDC park',        gas: '$0.08', status: 'confirmed' },
  { id: 'tx-14', ago: '24d ago',  action: 'Rebalanced $100 Aave → Compound',         by: 'Claude', mandate: '$200 USDC park',        gas: '$0.13', status: 'confirmed' },
  { id: 'tx-15', ago: '32d ago',  action: 'Deposited $200 into Aave USDC',           by: 'Claude', mandate: '$200 USDC park',        gas: '$0.11', status: 'confirmed' },

  // ────────────── $1,000 USDC into Pendle PT (mandate-4, Claude) — revoked ──────────────
  { id: 'tx-16', ago: '27d ago',  action: 'Withdrew $1,000 to wallet on revoke',      by: 'Claude', mandate: 'Pendle PT',             gas: '$0.22', status: 'confirmed' },
  { id: 'tx-17', ago: '34d ago',  action: 'Bought $1,000 Pendle PT-USDC',             by: 'Claude', mandate: 'Pendle PT',             gas: '$0.31', status: 'confirmed' },
  { id: 'tx-18', ago: '34d ago',  action: 'Approved Pendle router for USDC',          by: 'Claude', mandate: 'Pendle PT',             gas: '$0.06', status: 'confirmed' },

  // ────────────── $1,500 USDC yield on Aave (mandate-5, Claude) ──────────────
  { id: 'tx-19', ago: '4h ago',   action: 'Rebalanced $200 Aave → Compound',          by: 'Claude', mandate: '$1,500 USDC yield',     gas: '$0.24', status: 'confirmed' },
  { id: 'tx-20', ago: '1d ago',   action: 'Deposited $500 into Aave USDC',            by: 'Claude', mandate: '$1,500 USDC yield',     gas: '$0.27', status: 'confirmed' },
  { id: 'tx-21', ago: '3d ago',   action: 'Claimed $12.40 in interest',                by: 'Claude', mandate: '$1,500 USDC yield',     gas: '$0.09', status: 'confirmed' },
  { id: 'tx-22', ago: '5d ago',   action: 'Attempted deposit $1,000 into Aave',       by: 'Claude', mandate: '$1,500 USDC yield',     gas: '$0.10', status: 'failed',
    retries: [ { id: 'tx-22-r1', label: '↳ Retry #1 — succeeded', gas: '$0.18', status: 'confirmed' } ] },
  { id: 'tx-23', ago: '8d ago',   action: 'Deposited $1,500 into Aave USDC',           by: 'Claude', mandate: '$1,500 USDC yield',     gas: '$0.31', status: 'confirmed' },

  // ────────────── BTC put ceiling 0.05 BTC (mandate-6, Cursor) ──────────────
  { id: 'tx-24', ago: '6h ago',   action: 'Bought 0.01 BTC put on Lyra',               by: 'Codex',  mandate: 'BTC put ceiling',       gas: '$0.58', status: 'confirmed' },
  { id: 'tx-25', ago: '2d ago',   action: 'Rolled BTC put position',                    by: 'Codex',  mandate: 'BTC put ceiling',       gas: '$0.62', status: 'confirmed' },
  { id: 'tx-26', ago: '5d ago',   action: 'Bought 0.02 BTC put on Lyra',               by: 'Codex',  mandate: 'BTC put ceiling',       gas: '$0.71', status: 'confirmed' },
  { id: 'tx-27', ago: '9d ago',   action: 'Closed BTC put — $40 profit',                by: 'Codex',  mandate: 'BTC put ceiling',       gas: '$0.55', status: 'confirmed' },

  // ────────────── $800 USDC stablecoin park (mandate-7, Claude) — expired ──────────────
  { id: 'tx-28', ago: '39d ago',  action: 'Withdrew $800 to wallet',                   by: 'Claude', mandate: '$800 USDC park',        gas: '$0.10', status: 'confirmed' },
  { id: 'tx-29', ago: '52d ago',  action: 'Claimed $7.20 in interest',                  by: 'Claude', mandate: '$800 USDC park',        gas: '$0.06', status: 'confirmed' },
  { id: 'tx-30', ago: '64d ago',  action: 'Rebalanced $400 Aave → Compound',           by: 'Claude', mandate: '$800 USDC park',        gas: '$0.15', status: 'confirmed' },
  { id: 'tx-31', ago: '74d ago',  action: 'Deposited $800 into Aave USDC',             by: 'Claude', mandate: '$800 USDC park',        gas: '$0.19', status: 'confirmed' },
]

/**
 * Custom UIs — interfaces the user has asked their AI to build around
 * one or more agents / SMAs. The list intentionally spans the whole
 * spectrum of scope:
 *  - granular   (one agent, one specific metric)
 *  - single SMA (no agent — just a balance/transfer surface)
 *  - multi-agent or multi-SMA portfolio views
 * so the dashboard surface can demonstrate that a UI can be as narrow
 * or as broad as the user wants.
 *
 * Each entry's `scope` carries the IDs the UI was built around. The
 * dashboard renders those IDs as chips and uses them to generate the
 * "copy IDs for your AI" payload when the user asks the AI to build
 * another UI.
 */
export const mockCustomUIs = [
  {
    id: 'ui-portfolio',
    title: 'Portfolio overview',
    description:
      'Combined balance, yield, and hedge exposure across every SMA and every active agent. Refreshes every block.',
    icon: '◰',
    maker: 'Claude',
    updated: '1h ago',
    scope: { agents: ['mandate-1', 'mandate-2', 'mandate-5', 'mandate-6'], smas: ['sma-1', 'sma-2', 'sma-3'] },
    url: 'http://localhost:5180/#/dashboard?demo=full',
  },
  {
    id: 'ui-yield-watch',
    title: 'USDC yield watchlist',
    description:
      'Live APY across Aave / Compound / Morpho with rebalance hints — scoped to my USDC yield mandates.',
    icon: '$',
    maker: 'Claude',
    updated: '2h ago',
    scope: { agents: ['mandate-1', 'mandate-5'], smas: ['sma-1'] },
    url: 'http://localhost:5180/#/dashboard?demo=full',
  },
  {
    id: 'ui-eth-hedge',
    title: 'ETH hedge P&L',
    description:
      'Real-time delta, margin headroom, and roll calendar for the ETH hedge running on GMX.',
    icon: 'Ξ',
    maker: 'Cursor',
    updated: '3h ago',
    scope: { agents: ['mandate-2'], smas: ['sma-2'] },
    url: 'http://localhost:5180/#/dashboard?demo=full',
  },
  {
    id: 'ui-btc-delta',
    title: 'BTC put delta sheet',
    description:
      'Put delta, breakeven, and exit thresholds for the BTC hedge — checked once a day at market open.',
    icon: '₿',
    maker: 'Codex',
    updated: '6h ago',
    scope: { agents: ['mandate-6'], smas: ['sma-1'] },
    url: 'http://localhost:5180/#/dashboard?demo=full',
  },
  {
    id: 'ui-sma-primary',
    title: 'Primary SMA balances',
    description:
      'Token-by-token balances and the last 50 transfers for the Primary SMA on Arbitrum. No agent context.',
    icon: '⊞',
    maker: 'Claude',
    updated: '1d ago',
    scope: { agents: [], smas: ['sma-1'] },
    url: 'http://localhost:5180/#/dashboard?demo=full',
  },
  {
    id: 'ui-apy-delta',
    title: 'Aave ↔ Compound APY delta',
    description:
      'Single-chart UI showing the live APY spread that triggers my Aave ↔ Compound rebalance rule.',
    icon: '%',
    maker: 'Claude',
    updated: '2d ago',
    scope: { agents: ['mandate-1'], smas: [] },
    url: 'http://localhost:5180/#/dashboard?demo=full',
  },
]

export const initialChannels = {
  'mandate-1': { push: true, email: true, telegram: false, discord: false },
  'mandate-2': { push: false, email: false, telegram: true, discord: false },
  'mandate-3': { push: false, email: false, telegram: false, discord: false },
}

/**
 * Dashboard-shaped data for the SMA-centric main view.
 * One SMA → one mandate (composed of multiple permissions) → multiple
 * delegated signers running under it → one shared decision journal.
 *
 * Hard-coded here (rather than derived) because the previous data
 * model was mandate-centric — each mockMandate carried its own agent.
 * The new model collapses that ladder: the user signs *one* mandate
 * per SMA, and capability specialists share it as delegated signers.
 */
/* Master mandates at the SMA level. Each is its own signed contract
   with its own permission set, its own onchain hashes, and its own
   set of delegated-signer agents running under it. Revoking is
   per-mandate (atomic at the contract boundary); stopping individual
   agents is reversible and doesn't affect the contract.
   We deliberately model these around capability buckets the user
   thinks about — yield, hedging, multi-chain — rather than per-trade
   contracts. */
export const mockSmaMandates = [
  {
    id: 'yield',
    smaId: 'sma-1',
    title: 'Yield mandate',
    aiName: 'Claude',
    aiInitial: 'C',
    status: 'active',
    summary:
      'A bounded delegation authorizing AI agents to operate conservative USDC and WETH yield strategies on Arbitrum, strictly within the whitelisted lending and structured-yield venues listed below.',
    signedAt: '2026-05-18',
    signedBy: '0x6f2A8b3f9C4d5E1A7B0c2D3E4F5A6B7C8D9E0F12',
    templateHash: '0xa1f3e2d49c0b8276',
    policyHash: '0x4e2a91b3…c8b8d11',
    blockNumber: 23_480_004,
    txHash: '0xb2c3d49a01f783ab0c2e4f7a91b3c5d80c2e4f7a91b3c5d8',
    duration: 'No expiry · revocable any time',
    networks: ['arbitrum'],
    assets: ['USDC', 'WETH'],
    caps: [{ asset: 'USDC', amount: 25_000, currency: 'USD' }],
    constraints: ['Whitelisted markets only', 'Max 80% of NAV', 'No external transfers'],
    actions: [
      { id: 'y-a1', kind: 'deposit', label: 'Deposit USDC into Aave / Compound / Morpho', asset: 'USDC', venue: 'aave-v3', networks: ['arbitrum'] },
      { id: 'y-a2', kind: 'deposit', label: 'Deposit into Pendle PT positions', asset: 'USDC', venue: 'pendle', networks: ['arbitrum'] },
      { id: 'y-a3', kind: 'rebalance', label: 'Rebalance between whitelisted lending markets', asset: 'USDC', venue: 'router', networks: ['arbitrum'] },
    ],
    permissionsAllowed: [
      {
        id: 'y-p1', label: 'Deposit into Aave V3, Compound V3, and Morpho',
        sub: 'Whitelisted USDC and WETH markets · max 80% of NAV',
        description:
          'Spot lending into the highest-APY whitelisted market. Constrained to USDC and WETH; routes through Aave V3, Compound V3, and Morpho Blue only. No external transfers, no leverage, no swap leg.',
        selector: '0x617ba037', signature: 'supply(address,uint256,address,uint16)',
        template: 'SharedBoundedSwapPermission',
        permissionId: 'sail.permission.swap.v1',
        version: '1.3.0',
        address: '0x8a3D7e9F12bC56a4E8d92cD61f3c7A0B5e8c1234',
        registeredBlock: 23_480_004,
        registeredAt: '2026-05-18 14:32 UTC',
        registeredTxHash: '0xb2c3d49a01f783ab',
        registrationFeeEth: 0.001,
        metadataURI: 'ipfs://bafkreih.../swap-v1.json',
        provenance: 'MandateFactory',
        capabilityIds: ['cap.swap.exactInputSingle', 'cap.lending.supply'],
      },
      {
        id: 'y-p2', label: 'Deposit into Pendle PT yield positions',
        sub: 'USDC and WETH PT markets · max 50% of NAV',
        description:
          'Supply USDC or WETH into Pendle PT markets to capture fixed yield. Hard-capped at 50% of NAV to keep the agent diversified across other yield surfaces.',
        selector: '0x617ba037', signature: 'supply(address,uint256,address,uint16)',
        template: 'SharedPendlePermission',
        permissionId: 'sail.permission.pendle-pt.v1',
        version: '1.0.2',
        address: '0x9b4C8e1A3F76dE2BcA85bD90eC7c4b8A6f9d2345',
        registeredBlock: 23_480_007,
        registeredAt: '2026-05-18 14:34 UTC',
        registeredTxHash: '0x57d21c4a8b9a0f12',
        registrationFeeEth: 0.001,
        metadataURI: 'ipfs://bafkreih.../pendle-v1.json',
        provenance: 'MandateFactory',
        capabilityIds: ['cap.pendle.supply', 'cap.pendle.redeem'],
      },
      {
        id: 'y-p3', label: 'Rebalance between Aave and Compound',
        sub: 'When APY delta ≥ 1% · same asset only',
        description:
          'Within-asset rebalancing across whitelisted lending markets when the APY delta crosses 1%. LTV check enforced. Cannot swap into a different asset, cannot exit to an external address.',
        selector: '0x69328dec', signature: 'withdraw(address,uint256,address)',
        template: 'SharedBoundedBorrowPermission',
        permissionId: 'sail.permission.rebalance.v1',
        version: '1.1.0',
        address: '0xc7d8E9F0a1B2c3D4e5F6789012345678ABCDEF34',
        registeredBlock: 23_480_009,
        registeredAt: '2026-05-18 14:35 UTC',
        registeredTxHash: '0xa1b2c3d4e5f67890',
        registrationFeeEth: 0.001,
        metadataURI: 'ipfs://bafkreih.../rebalance-v1.json',
        provenance: 'MandateFactory',
        capabilityIds: ['cap.lending.withdraw'],
      },
    ],
    permissionsCap: 20,
    registrationFeeEth: 0.001,
    sessionActive: true,
    feePolicyKind: 'StandardFeePolicy',
    feePolicyAddress: '0xFEE0a01a8e2F4d3a90eB67cC5fE4ab9c6E3D2B1A',
    agentIds: ['mandate-1', 'mandate-3', 'mandate-5', 'mandate-7'],
  },
  {
    id: 'hedging',
    smaId: 'sma-1',
    title: 'Hedging mandate',
    aiName: 'Cursor',
    aiInitial: 'C',
    status: 'active',
    summary:
      'A bounded delegation authorizing AI agents to maintain modest downside protection through delta hedging and option ceilings, strictly within the notional caps and whitelisted venues listed below.',
    signedAt: '2026-05-20',
    signedBy: '0x6f2A8b3f9C4d5E1A7B0c2D3E4F5A6B7C8D9E0F12',
    templateHash: '0x8c4f1a2b9d3e7065',
    policyHash: '0x7b3f12d4…a91e082',
    blockNumber: 23_481_120,
    txHash: '0xe7c4f2d931a8602b5d6e7c4f2d931a8602b5d6e7c4f2d931',
    duration: 'No expiry · revocable any time',
    networks: ['arbitrum'],
    assets: ['WETH', 'WBTC'],
    caps: [
      { asset: 'WETH', amount: 0.5, currency: 'WETH' },
      { asset: 'WBTC', amount: 0.05, currency: 'WBTC' },
    ],
    constraints: ['Max 2× leverage', 'Whitelisted derivatives venues', 'Long-only options'],
    actions: [
      { id: 'h-a1', kind: 'short', label: 'Open short positions on GMX', asset: 'WETH', venue: 'gmx', networks: ['arbitrum'] },
      { id: 'h-a2', kind: 'hedge', label: 'Buy put options on Lyra and Dopex', asset: 'WBTC', venue: 'lyra', networks: ['arbitrum'] },
      { id: 'h-a3', kind: 'rebalance', label: 'Roll or close hedge positions', asset: 'WETH', venue: 'gmx', networks: ['arbitrum'] },
    ],
    permissionsAllowed: [
      {
        id: 'h-p1', label: 'Open short positions on GMX',
        sub: 'Up to 0.5 ETH notional · max 2× leverage',
        description:
          'Open short ETH positions on GMX up to a 0.5 ETH notional ceiling with leverage hard-capped at 2×. Cannot open long positions or trade unrelated assets.',
        selector: '0xa1d3e9bd', signature: 'openShort(uint256,uint256,uint256)',
        template: 'SharedDeFiBundlePermission',
        permissionId: 'sail.permission.gmx-short.v1',
        version: '1.0.4',
        address: '0x2eF1c0bD3a72D8a1Fc04eB67cC5fE4ab9c6E3D2B',
        registeredBlock: 23_481_122,
        registeredAt: '2026-05-20 09:11 UTC',
        registeredTxHash: '0xe7c4f2d931a8602b',
        registrationFeeEth: 0.001,
        metadataURI: 'ipfs://bafkreih.../gmx-short-v1.json',
        provenance: 'MandateFactory',
        capabilityIds: ['cap.gmx.openShort'],
      },
      {
        id: 'h-p2', label: 'Buy put options on Lyra and Dopex',
        sub: 'WBTC puts up to 0.05 BTC notional',
        description:
          'Long-only put-option purchases on Lyra and Dopex with WBTC notional capped at 0.05. Cannot write options, cannot trade calls.',
        selector: '0xb6b1b6c3', signature: 'openPosition(address,uint256,bool)',
        template: 'SharedApproveAndCallBatchPermission',
        permissionId: 'sail.permission.option-buy.v1',
        version: '1.0.1',
        address: '0x4A0e3F12bC56a4E8d92cD61f3c7A0B5e8c1c7c8A',
        registeredBlock: 23_481_124,
        registeredAt: '2026-05-20 09:12 UTC',
        registeredTxHash: '0x9a4c2f81d76e30bc',
        registrationFeeEth: 0.001,
        metadataURI: 'ipfs://bafkreih.../option-buy-v1.json',
        provenance: 'MandateFactory',
        capabilityIds: ['cap.option.buyPut'],
      },
      {
        id: 'h-p3', label: 'Roll or close hedge positions',
        sub: 'When hedge expires within 24h',
        description:
          'Roll forward or close out hedge positions when their expiry is within 24 hours. Cannot open new exposure outside of the existing hedge perimeter.',
        selector: '0x69328dec', signature: 'closePosition(uint256)',
        template: 'SharedBoundedBorrowPermission',
        permissionId: 'sail.permission.hedge-close.v1',
        version: '1.0.0',
        address: '0x05c2dE9F0a1B2c3D4e5F6789012345678ABCDE19',
        registeredBlock: 23_481_127,
        registeredAt: '2026-05-20 09:14 UTC',
        registeredTxHash: '0x3b9e0a72c5f81d46',
        registrationFeeEth: 0.001,
        metadataURI: 'ipfs://bafkreih.../hedge-close-v1.json',
        provenance: 'MandateFactory',
        capabilityIds: ['cap.position.close'],
      },
    ],
    permissionsCap: 20,
    registrationFeeEth: 0.001,
    sessionActive: true,
    feePolicyKind: 'StandardFeePolicy',
    feePolicyAddress: '0xFEE0a01a8e2F4d3a90eB67cC5fE4ab9c6E3D2B1A',
    agentIds: ['mandate-2', 'mandate-4', 'mandate-6'],
  },
  {
    id: 'multichain',
    smaId: 'sma-1',
    title: 'Multi-chain mandate',
    aiName: 'Claude',
    aiInitial: 'C',
    status: 'active',
    summary:
      'A bounded delegation authorizing AI agents to operate cross-chain yield and liquidity across Ethereum, Arbitrum, Base, Optimism, and Polygon under a single coherent permission set, strictly within whitelisted bridges and LP venues.',
    signedAt: '2026-05-22',
    signedBy: '0x6f2A8b3f9C4d5E1A7B0c2D3E4F5A6B7C8D9E0F12',
    templateHash: '0xc9d2e3f4a5b6c708',
    policyHash: '0x9e4d2c1b…f0a8b76',
    blockNumber: 23_482_517,
    txHash: '0x3a8b9c0d1e2f54761a2b3c4d5e6f78901a2b3c4d5e6f7890',
    duration: 'No expiry · revocable any time',
    networks: ['ethereum', 'arbitrum', 'base', 'optimism', 'polygon'],
    assets: ['USDC', 'WETH', 'ARB', 'OP', 'CRV'],
    caps: [{ asset: 'USDC', amount: 25_000, currency: 'USD' }],
    constraints: ['Whitelisted bridges only', 'Bridge fee ≤ 5 bps', 'Stablecoin-only LP'],
    actions: [
      { id: 'm-a1', kind: 'bridge', label: 'Bridge USDC and WETH across chains via Across', asset: 'USDC', venue: 'across', networks: ['ethereum', 'arbitrum', 'base', 'optimism', 'polygon'] },
      { id: 'm-a2', kind: 'lp', label: 'Provide liquidity to Curve 3pool', asset: 'USDC', venue: 'curve', networks: ['ethereum', 'arbitrum', 'optimism', 'polygon'] },
      { id: 'm-a3', kind: 'conditional-swap', label: 'Recycle yield into ARB / OP', asset: 'USDC', venue: 'uniswap-v3', networks: ['arbitrum', 'optimism'] },
    ],
    permissionsAllowed: [
      {
        id: 'm-p1', label: 'Bridge USDC and WETH across chains via Across',
        sub: 'Bridge fee ≤ 5 bps · whitelisted routes only',
        description:
          'Bridge USDC and WETH between whitelisted chains via Across. Hard fee cap at 5 bps; routes outside the allowlist revert at pre-flight simulation.',
        selector: '0x7b939232', signature: 'depositV3(address,uint256,uint32,bytes)',
        template: 'SharedApproveAndCallBatchPermission',
        permissionId: 'sail.permission.bridge-across.v1',
        version: '1.0.3',
        address: '0x71E2b4cD9F0a1B2c3D4e5F67890123456ABCD012',
        registeredBlock: 23_482_517,
        registeredAt: '2026-05-22 18:08 UTC',
        registeredTxHash: '0x3a8b9c0d1e2f5476',
        registrationFeeEth: 0.001,
        metadataURI: 'ipfs://bafkreih.../bridge-across-v1.json',
        provenance: 'MandateFactory',
        capabilityIds: ['cap.bridge.deposit'],
      },
      {
        id: 'm-p2', label: 'Provide stablecoin LP to Curve 3pool',
        sub: 'USDC / USDT / DAI · 4 chains',
        description:
          'Provide LP to the Curve 3pool (USDC/USDT/DAI) on Ethereum, Arbitrum, Optimism, and Polygon. Stablecoin-only — cannot LP volatile pairs.',
        selector: '0x4515cef3', signature: 'add_liquidity(uint256[3],uint256)',
        template: 'SharedAMMLiquidityPermission',
        permissionId: 'sail.permission.curve-lp.v1',
        version: '1.0.0',
        address: '0xB1c2D3E4F5A6B7C8D9E0F1234567890ABCDE0A12',
        registeredBlock: 23_482_519,
        registeredAt: '2026-05-22 18:10 UTC',
        registeredTxHash: '0xc1d2e3f456789012',
        registrationFeeEth: 0.001,
        metadataURI: 'ipfs://bafkreih.../curve-lp-v1.json',
        provenance: 'MandateFactory',
        capabilityIds: ['cap.curve.addLiquidity', 'cap.curve.removeLiquidity'],
      },
      {
        id: 'm-p3', label: 'Recycle yield into ARB and OP',
        sub: 'When daily yield ≥ $25 · home-chain only',
        description:
          'When accumulated daily yield crosses $25, recycle that slice into ARB on Arbitrum or OP on Optimism. Home-chain only — no cross-chain swap leg.',
        selector: '0x8d5f63a2', signature: 'swapWhenYieldOver(uint256,bytes)',
        template: 'SharedDeFiBundlePermission',
        permissionId: 'sail.permission.yield-recycle.v1',
        version: '1.0.1',
        address: '0x3F5d9e1A8B2cC04eA7f9C61aB3DfE5C8c1d2E3F4',
        registeredBlock: 23_482_522,
        registeredAt: '2026-05-22 18:12 UTC',
        registeredTxHash: '0xa7b8c9d0e1f23456',
        registrationFeeEth: 0.001,
        metadataURI: 'ipfs://bafkreih.../yield-recycle-v1.json',
        provenance: 'MandateFactory',
        capabilityIds: ['cap.swap.conditional'],
      },
    ],
    permissionsCap: 20,
    registrationFeeEth: 0.001,
    sessionActive: true,
    feePolicyKind: 'StandardFeePolicy',
    feePolicyAddress: '0xFEE0a01a8e2F4d3a90eB67cC5fE4ab9c6E3D2B1A',
    agentIds: ['mandate-8'],
  },
]
/* Legacy alias retained for any imports still referencing the
   singular master mandate. Resolves to the first entry. */
export const mockMasterMandate = mockSmaMandates[0]

export const mockDashboardMandate = {
  smaId: 'sma-1',
  permissionsAllowed: [
    {
      id: 'perm-swap',
      label: 'Swap on Uniswap V3 and 1inch',
      sub: 'Up to $500 per trade · USDC, ETH, WETH, WBTC only',
    },
    {
      id: 'perm-pendle',
      label: 'Deposit into Pendle yield positions',
      sub: 'USDC and WETH PT markets · max 50% of NAV',
    },
  ],
  permissionsDisallowed: [
    {
      id: 'perm-no-external',
      label: 'Cannot transfer to external addresses',
      sub: 'Funds can never leave this account',
    },
    {
      id: 'perm-no-leverage',
      label: 'Cannot borrow or use leverage',
      sub: 'No lending protocol authorization granted',
    },
  ],
}

export const mockDashboardAgents = [
  {
    id: 'agent-swap',
    name: 'Swap specialist',
    address: '0xa3f1c8927B5dE40fA92cd6E92c4',
    erc8004Url: 'https://identity.erc8004.org/0xa3f1c8927B5dE40fA92cd6E92c4',
    lastActionTime: '14:32',
    dispatchesToday: 47,
    active: true,
  },
  {
    id: 'agent-yield',
    name: 'Yield strategist',
    address: '0x7c1b04Ea2F8D3a90eB67cC5fE4ab9',
    erc8004Url: 'https://identity.erc8004.org/0x7c1b04Ea2F8D3a90eB67cC5fE4ab9',
    lastActionTime: '14:15',
    dispatchesToday: 3,
    active: true,
  },
]

export const mockDashboardJournal = [
  {
    id: 'jd-1',
    time: '14:32',
    dateLabel: 'today',
    status: 'success',
    actor: 'Swap specialist',
    action: 'swapped 100 USDC → 0.041 WETH on Uniswap V3',
    meta: 'authorized by SharedBoundedSwapPermission · gas 142k',
    kind: 'run',
    kindLabel: 'Run artifact',
    detail: {
      reasoning:
        'Aave USDC APY had slipped 0.4% below the rebalance trigger while the Uniswap V3 USDC/WETH pool widened to a 0.9% inefficiency on the inbound side. I converted 100 USDC into WETH at the better edge, sitting well inside the $500 per-trade cap and inside today\'s net swap budget.',
      evidence: [
        { k: 'Source APY (Aave)',  v: '4.62%' },
        { k: 'Pool inefficiency',  v: '0.9%' },
        { k: 'Cap headroom',       v: '$400 remaining' },
        { k: 'Idle USDC balance',  v: '423.00' },
      ],
      authorization: {
        label: 'Swap on Uniswap V3 and 1inch',
        sub: 'Up to $500 per trade · USDC, ETH, WETH, WBTC only',
      },
      artifact: {
        'Tx hash': '0xb1f3…8e21',
        Block: '23,481,004',
        Gas: '$0.14 (142k)',
        Venue: 'Uniswap V3',
      },
    },
  },
  {
    id: 'jd-2',
    time: '14:15',
    dateLabel: 'today',
    status: 'success',
    actor: 'Yield strategist',
    action: 'deposited 500 USDC into Pendle PT-USDC',
    meta: 'authorized by SharedPendlePermission · gas 287k',
    kind: 'run',
    kindLabel: 'Run artifact',
    detail: {
      reasoning:
        'Idle USDC crossed the deposit threshold and the Pendle PT-USDC maturity-72d APY was within 4 bps of the best fixed-yield path in the whitelist. I deposited a 500 USDC tranche under the per-call cap and within the 50%-of-NAV ceiling.',
      evidence: [
        { k: 'PT-USDC APY',         v: '6.92%' },
        { k: 'Next best fixed',     v: '6.88%' },
        { k: 'NAV share post-trade',v: '38%' },
        { k: 'NAV ceiling',         v: '50%' },
      ],
      authorization: {
        label: 'Deposit into Pendle yield positions',
        sub: 'USDC and WETH PT markets · max 50% of NAV',
      },
      artifact: {
        'Tx hash': '0xa3b6…5210',
        Block: '23,480,997',
        Gas: '$0.27 (287k)',
        Venue: 'Pendle',
      },
    },
  },
  {
    id: 'jd-3',
    time: '13:58',
    dateLabel: 'today',
    status: 'rejected',
    actor: 'Swap specialist',
    action: 'attempted swap rejected — amount $612 exceeded $500 cap',
    meta: 'mandate held · no state change · zero gas cost to your account',
    kind: 'permission',
    kindLabel: 'Permission event',
    detail: {
      reasoning:
        'I proposed a $612 USDC → WETH swap to capture a 1.1% spread. The amount exceeded the per-trade cap so the call reverted at the permission layer during pre-flight simulation. No mainnet gas paid.',
      evidence: [
        { k: 'Proposed size',  v: '$612' },
        { k: 'Per-trade cap',  v: '$500' },
        { k: 'Spread (forgone)', v: '1.1%' },
        { k: 'Stage at revert', v: 'pre-flight sim' },
      ],
      authorization: {
        label: 'Swap on Uniswap V3 and 1inch',
        sub: 'Up to $500 per trade — call blocked at this boundary.',
      },
    },
  },
  {
    id: 'jd-4',
    time: '13:41',
    dateLabel: 'today',
    status: 'success',
    actor: 'Swap specialist',
    action: 'swapped 250 USDC → 0.102 WETH on Uniswap V3',
    meta: 'authorized by SharedBoundedSwapPermission · gas 138k',
    kind: 'run',
    kindLabel: 'Run artifact',
    detail: {
      reasoning:
        'Routine spread capture. The USDC/WETH edge widened to 0.6% on Uniswap V3 just after a tick reset; I took a 250 USDC tranche inside the per-trade cap and inside the day\'s swap-budget envelope.',
      evidence: [
        { k: 'Pool edge', v: '0.6%' },
        { k: 'Tranche size', v: '250 USDC' },
        { k: 'Daily swap budget left', v: '$1,200' },
      ],
      authorization: {
        label: 'Swap on Uniswap V3 and 1inch',
        sub: 'Up to $500 per trade · USDC, ETH, WETH, WBTC only',
      },
      artifact: {
        'Tx hash': '0x57d2…1c4a',
        Block: '23,480,940',
        Gas: '$0.13 (138k)',
        Venue: 'Uniswap V3',
      },
    },
  },
]

export const mockPending = [
  /**
   * Rich pending mandate — multi-network, multi-asset, multi-action with a
   * conditional trigger. Demonstrates the full granular permissions UI.
   */
  {
    id: 'pending-morpho-vvv',
    aiName: 'Claude',
    aiInitial: 'C',
    title: 'USDC yield on Morpho with $VVV reinvestment',
    requestedAgo: 'just now',
    summary:
      'Get the best yield on USDC across the top Morpho vaults on Arbitrum, Base, and Ethereum. Keep the position open for up to 3 months. Whenever accumulated yield ≥ $10, swap that slice into $VVV on Base.',

    // ── Structured permissions ──
    networks: ['arbitrum', 'base', 'ethereum'],
    assets: ['USDC', 'VVV'],
    caps: [{ asset: 'USDC', amount: 5000, currency: 'USD' }],
    duration: '3 months',
    endsAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 90,
    actions: [
      {
        id: 'a1',
        kind: 'deposit',
        label: 'Deposit USDC into the highest-APY Morpho vault',
        asset: 'USDC',
        venue: 'morpho-blue',
        networks: ['ethereum', 'base'],
        strategy: 'best-apy',
      },
      {
        id: 'a2',
        kind: 'rebalance',
        label: 'Rebalance between vaults when APY differs by ≥ 1.5%',
        asset: 'USDC',
        venue: 'morpho-blue',
        networks: ['ethereum', 'base'],
        trigger: { type: 'yield-threshold', amountUsd: null },
      },
      {
        id: 'a3',
        kind: 'conditional-swap',
        label: 'When yield ≥ $10, swap that slice into $VVV',
        from: 'USDC',
        to: 'VVV',
        venue: 'uniswap-v3',
        networks: ['base'],
        trigger: { type: 'yield-threshold', amountUsd: 10 },
      },
      {
        id: 'a4',
        kind: 'withdraw',
        label: 'Withdraw the position on expiry to my wallet',
        asset: 'USDC',
        networks: ['ethereum', 'base'],
      },
    ],

    // ── Legacy fields kept for backward compat ──
    constraints: ['$5,000 max', '3 months', 'USDC, VVV'],
    allowed: [
      'Deposit USDC into Morpho (best APY)',
      'Rebalance between Morpho vaults',
      'Swap accumulated yield → $VVV when ≥ $10',
      'Withdraw on expiry',
    ],
    disallowed: [
      'Send to external wallets',
      'Use leverage',
      'Hold non-whitelisted tokens',
    ],
    calldata: `// EIP-712 typed data — structured permissions
{
  "manager":   "0xA1...c0de",
  "networks":  [1, 8453, 42161],
  "assets":    ["USDC", "VVV"],
  "spendCap":  { "USDC": "5000000000" },
  "expiresAt": ${Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 90},
  "actions":   [
    { "kind": "deposit",  "asset": "USDC", "venue": "morpho-blue", "nets": [1, 8453] },
    { "kind": "rebalance","asset": "USDC", "venue": "morpho-blue", "nets": [1, 8453] },
    { "kind": "swap",     "from": "USDC", "to": "VVV",
                          "venue": "uniswap-v3", "nets": [8453],
                          "trigger": { "yieldUsd": 10 } },
    { "kind": "withdraw", "asset": "USDC", "nets": [1, 8453] }
  ]
}`,
  },
  {
    id: 'pending-1',
    aiName: 'Claude',
    aiInitial: 'C',
    title: '$250 USDC into Curve 3pool',
    requestedAgo: '12s ago',
    summary:
      'Move up to $250 of idle USDC into the Curve 3pool LP for 14 days to capture base + boost rewards. I won’t exit the position until the window closes.',
    networks: ['arbitrum'],
    assets: ['USDC', 'CRV'],
    caps: [{ asset: 'USDC', amount: 250, currency: 'USD' }],
    duration: '14 days',
    endsAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14,
    actions: [
      { id: 'p1-a1', kind: 'deposit', label: 'Deposit USDC into the Curve 3pool LP', asset: 'USDC', venue: 'curve', networks: ['arbitrum'] },
      { id: 'p1-a2', kind: 'claim',   label: 'Claim CRV rewards as they accrue',     asset: 'CRV',  venue: 'curve', networks: ['arbitrum'] },
      { id: 'p1-a3', kind: 'withdraw', label: 'Withdraw the LP position on expiry',  asset: 'USDC', venue: 'curve', networks: ['arbitrum'] },
    ],
    constraints: ['$250 max', '14 days', 'USDC on Arbitrum'],
    allowed: [
      'Deposit USDC into Curve 3pool',
      'Claim CRV rewards',
      'Withdraw on expiry',
    ],
    disallowed: [
      'Send to external wallets',
      'Swap into other tokens',
      'Use leverage',
    ],
    calldata: `// EIP-712 typed data
{
  "manager":   "0xA1...c0de",
  "asset":     "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  "venue":     "curve:3pool",
  "maxAmount": "250000000",
  "expiresAt": 1748563200,
  "actions":   ["curve.deposit", "curve.claim", "curve.withdraw"]
}`,
  },
  {
    id: 'pending-2',
    aiName: 'Cursor',
    aiInitial: 'C',
    title: 'Top up ETH hedge ceiling to 1.0 ETH',
    requestedAgo: '4m ago',
    summary:
      'Raise the ceiling on the existing ETH hedge from 0.5 ETH to 1.0 ETH for the remaining 6 days. Keep all other constraints the same.',
    networks: ['arbitrum'],
    assets: ['WETH'],
    caps: [{ asset: 'WETH', amount: 1.0, currency: 'WETH' }],
    duration: '6 days remaining',
    endsAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 6,
    actions: [
      { id: 'p2-a1', kind: 'short',     label: 'Open short up to 1.0 ETH on GMX',     asset: 'WETH', venue: 'gmx', networks: ['arbitrum'] },
      { id: 'p2-a2', kind: 'rebalance', label: 'Close or reduce the short position', asset: 'WETH', venue: 'gmx', networks: ['arbitrum'] },
      { id: 'p2-a3', kind: 'rebalance', label: 'Roll the position before expiry',    asset: 'WETH', venue: 'gmx', networks: ['arbitrum'] },
    ],
    constraints: ['1.0 ETH max', '6 days remaining', 'WETH on Arbitrum'],
    allowed: [
      'Open short up to 1.0 ETH on GMX',
      'Close or reduce position',
      'Roll position before expiry',
    ],
    disallowed: [
      'Increase leverage above 2x',
      'Swap into other tokens',
      'Exceed 1.0 ETH notional',
    ],
    calldata: `// EIP-712 typed data
{
  "manager":   "0xB2...f00d",
  "asset":     "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  "venue":     "gmx:perp",
  "maxAmount": "1000000000000000000",
  "expiresAt": 1748131200,
  "actions":   ["gmx.short", "gmx.close", "gmx.roll"]
}`,
  },
]

/* ──────────────────────────────────────────────────────────────────
 * Agent ↔ Mandate ↔ Permissions relationship helpers
 *
 * An agent is a delegated signer that operates UNDER one SMA-level
 * mandate. The mandate carries the full permission set; the agent
 * uses a subset matching its role.
 *
 * We don't hardcode the relationship inside every mockMandates entry
 * (there are eight of them, all with legacy fields). Instead we resolve
 * it here so the surfaces can stay simple:
 *
 *   getParentMandate(agentId) -> mockSmaMandates entry, or null
 *   getAgentPermissionIds(agentId) -> string[] of permission ids
 *
 * `AGENT_PERMISSION_USAGE` maps each agent (mockMandates entry) to the
 * specific permissions in its parent mandate it actually exercises.
 * Anything not listed here for a given agent is "available under the
 * mandate but not used by this agent" — surfaced as a faded row.
 */
export const AGENT_PERMISSION_USAGE = {
  'mandate-1': ['y-p1', 'y-p3'],            // USDC Yield Specialist
  'mandate-2': ['h-p1', 'h-p3'],            // ETH Hedge Operator
  'mandate-3': ['y-p1'],                    // $200 USDC park
  'mandate-4': ['h-p2'],                    // Pendle PT (mapped to hedging slot in legacy data)
  'mandate-5': ['y-p1', 'y-p3'],            // $1,500 USDC yield
  'mandate-6': ['h-p2', 'h-p3'],            // BTC put ceiling
  'mandate-7': ['y-p1'],                    // $800 USDC park
  'mandate-8': ['m-p1', 'm-p2', 'm-p3'],    // Multi-chain
}

export function getParentMandate(agentId) {
  return mockSmaMandates.find((m) => m.agentIds.includes(agentId)) ?? null
}

export function getAgentPermissionIds(agentId) {
  return AGENT_PERMISSION_USAGE[agentId] ?? []
}

/* ──────────────────────────────────────────────────────────────────
 * Bookkeeping (informational only).
 *
 * Cumulative deposits / withdrawals are recorded onchain via
 * `recordDeposit` / `recordWithdrawal` but **move no funds** — they
 * are counters. `currentNav` for fee collection is attested by the
 * manager; the kernel does not verify it. We disclose this honestly
 * in the UI rather than presenting NAV as a hard guarantee.
 */
export const mockBookkeeping = {
  currentNavReported: 41_240.55,
  navReportedAt: '2026-05-25 09:00 UTC',
  navAttestedBy: 'manager',
  cumulativeDeposits: 48_750,
  cumulativeWithdrawals: 12_300,
}

/* Protocol-level governance constants. These are immutable in the
 * kernel source — surfaced here so the Mandate page can show the
 * trust envelope (protocol cut cap, immutable fee ceiling). */
export const mockGovernance = {
  protocolCutBps: 0,
  MAX_PROTOCOL_CUT_BPS: 2_500,
  maxPermissionsPerAccount: 20,
  permissionRegistrationFeeEth: 0.001,
  MAX_PERMISSION_FEE_ETH: 0.001,
  permissionGasCapK: 150,
}

/* ──────────────────────────────────────────────────────────────────
 * Agent schedules.
 *
 * Per the framework, schedules are cron-driven triggers declared in
 * `schedules.ts` and consumed by the local runner. Each schedule has:
 *   - id        : unique within the agent
 *   - cron      : raw cron expression
 *   - cronHuman : friendly label
 *   - mode      : 'fork' (dry-run only) | 'live' (real onchain dispatch)
 *   - enabled   : whether the runner will fire this schedule
 *   - lastRun   : timestamp + status of the last firing
 *   - nextRun   : friendly next-fire time
 *
 * Schedules are local — the kernel never sees them. They drive when
 * the runner pulls a ManagerRecommendationEnvelope and tries to
 * dispatch. Stopping an agent flips `enabled` to false locally.
 */
export const mockAgentSchedules = {
  'mandate-1': [
    { id: 'rebalance-check',   cron: '*/30 * * * *', cronHuman: 'Every 30 min',  mode: 'live', enabled: true,  lastRun: { at: '14:32', status: 'submitted' }, nextRun: '15:02' },
    { id: 'daily-fork-sanity', cron: '0 6 * * *',    cronHuman: 'Daily · 06:00', mode: 'fork', enabled: true,  lastRun: { at: 'today 06:00', status: 'confirmed' }, nextRun: 'tomorrow 06:00' },
  ],
  'mandate-2': [
    { id: 'hedge-check', cron: '0 */6 * * *', cronHuman: 'Every 6 hours', mode: 'live', enabled: true, lastRun: { at: '12:00', status: 'confirmed' }, nextRun: '18:00' },
  ],
  'mandate-3': [
    { id: 'park-expiry', cron: '0 0 * * *', cronHuman: 'Daily · 00:00', mode: 'live', enabled: false, lastRun: { at: '—', status: 'expired' }, nextRun: '—' },
  ],
  'mandate-4': [
    { id: 'pendle-cycle', cron: '0 9 * * 1', cronHuman: 'Mondays · 09:00', mode: 'live', enabled: false, lastRun: { at: 'apr 21', status: 'cancelled' }, nextRun: '—' },
  ],
  'mandate-5': [
    { id: 'rebalance-watch',  cron: '*/15 * * * *', cronHuman: 'Every 15 min', mode: 'live', enabled: true, lastRun: { at: '14:15', status: 'submitted' }, nextRun: '14:30' },
    { id: 'sanity-rehearse',  cron: '0 4 * * *',    cronHuman: 'Daily · 04:00', mode: 'fork', enabled: true, lastRun: { at: 'today 04:00', status: 'confirmed' }, nextRun: 'tomorrow 04:00' },
  ],
  'mandate-6': [
    { id: 'put-roll-check', cron: '0 */4 * * *', cronHuman: 'Every 4 hours', mode: 'live', enabled: true, lastRun: { at: '12:00', status: 'confirmed' }, nextRun: '16:00' },
  ],
  'mandate-7': [
    { id: 'expiry-sweep', cron: '0 0 * * *', cronHuman: 'Daily · 00:00', mode: 'live', enabled: false, lastRun: { at: 'apr 9', status: 'expired' }, nextRun: '—' },
  ],
  'mandate-8': [
    { id: 'multi-rebalance',   cron: '*/30 * * * *', cronHuman: 'Every 30 min', mode: 'live', enabled: true, lastRun: { at: '14:42', status: 'submitted' }, nextRun: '15:12' },
    { id: 'yield-recycle',     cron: '0 22 * * *',   cronHuman: 'Daily · 22:00', mode: 'live', enabled: true, lastRun: { at: 'yesterday 22:00', status: 'confirmed' }, nextRun: 'today 22:00' },
    { id: 'fork-rehearse',     cron: '0 5 * * *',    cronHuman: 'Daily · 05:00', mode: 'fork', enabled: true, lastRun: { at: 'today 05:00', status: 'confirmed' }, nextRun: 'tomorrow 05:00' },
  ],
}

export function getAgentSchedules(agentId) {
  return mockAgentSchedules[agentId] ?? []
}

/* ──────────────────────────────────────────────────────────────────
 * Manager endpoint (project-level).
 *
 * Per the framework, `sail.config.ts.managers[]` pins one or more
 * HTTP endpoints with a publicKey for signature verification. The
 * endpoint produces signed `ManagerRecommendationEnvelope` objects
 * the runner verifies before each dispatch. For retail with one
 * project, one endpoint serves every agent's runtime decisions.
 *
 * This is the actual decision source — distinct from the drafter
 * (the AI that wrote the policy files) which has no runtime identity.
 */
export const mockManagerEndpoint = {
  url: 'https://manager.sail.local',
  publicKey: '0x04a9c2e3f4d5b6a7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3',
  pinned: true,
  verified: true,
  lastSeenAt: '12 minutes ago',
  signaturesVerified: 1287,
  signaturesFailed: 0,
}
