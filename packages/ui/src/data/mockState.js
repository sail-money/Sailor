/**
 * Mock data shaped around the actual Sail protocol + framework
 * primitives (not the UI's earlier abstractions).
 *
 * Protocol mental model (from SailKernel.sol + docs):
 *   • Owner — Safe custody anchor (always the user's EOA in retail)
 *   • Permission Signer — authorises the mandate (signs registrations)
 *   • Manager — single address per SMA that dispatches actions
 *   • Account (SMA) — Safe + AccountConfig{permissionSigner, manager,
 *     feePolicy, sessionActive}
 *   • Mandate — the *live set* of Permission contracts in
 *     _permissions[account]. Not a signed object. Composable.
 *   • Permission — IPermission contract. Each individually signed
 *     at register time. Identifiable by contract address +
 *     permissionId() + permissionVersion().
 *   • Session — sessionActive boolean. Global kill switch.
 *
 * Framework mental model (from SailFramework studio + framework src):
 *   • Agent — a project configuration with a slug `id` and a
 *     deterministic numeric `agentId`. Lives under sail/agents/<id>/.
 *   • Delegated MPC wallet — AgentWalletRecord, threshold 2-of-3.
 *     One per agent.
 *   • Manager endpoint — HTTP URL + pinned publicKey. The actual
 *     runtime decision source. Returns signed
 *     ManagerRecommendationEnvelope objects.
 *   • Schedule — cron-driven trigger declared in schedules.ts.
 *   • Readiness — agent-draft → agent-runnable → fork-rehearsed →
 *     permission-ready → scheduled → live-ready.
 *   • Fork rehearsal — must be ≤24h old for live-ready.
 *   • Policy hash — canonical fingerprint of the on-chain permission
 *     template that gates this agent's calls.
 *   • Decision Journal — sail.audit.v1 JSONL + manager recommendations
 *     + fork rehearsals + sessions + runs.
 */

// ── EOA / Owner ───────────────────────────────────────────────
export const owner = {
  address: '0x6f2A8b3f9C4d5E1A7B0c2D3E4F5A6B7C8D9E0F12',
  ens: null,
}

// The Permission Signer may be the same EOA in retail. We model it
// separately so the UI can show institutional setups where they
// differ.
export const permissionSigner = {
  address: '0x6f2A8b3f9C4d5E1A7B0c2D3E4F5A6B7C8D9E0F12',
  sameAsOwner: true,
}

// ── SMA (Safe + AccountConfig) ────────────────────────────────
// Single-chain. If the user wanted multi-chain they'd have N SMAs.
export const sma = {
  id: 'sma-defi-conservative',
  name: 'DeFi conservative',
  // Gnosis Safe address.
  address: '0x4e2a91b3F7c5dA8bC09f1E2d3B4a5C6d7E8f9c8b',
  chain: { id: 42161, name: 'Arbitrum', short: 'arb1' },
  // Gnosis Safe Module status — SailKernel must be enabled as a
  // Safe module on this Safe for any dispatch to work.
  safeModuleEnabled: true,
  // Trusted Safe factory check — governance allowlists these.
  trustedSafeFactory: true,
  createdAt: 'May 18, 2026',
  // Live AccountConfig — what the kernel knows about us.
  config: {
    sessionActive: true,
    feePolicy: '0xFEE0a01a8e2F4d3a90eB67cC5fE4ab9c6E3D2B1A',
    feePolicyKind: 'StandardFeePolicy',
  },
  // Manager address — the single dispatcher EVM address. In our
  // model this is a Gnosis-Safe-style multisig that 2-of-3-routes
  // to per-agent MPC wallets, so individual agents can each have
  // their own delegated signing identity while the kernel only
  // ever sees the one manager.
  manager: {
    address: '0xA0c2D3E4F5A6B7C8D9E0F1234567890ABCDEF012',
    kind: 'safe-multisig',  // verified via ERC-1271
    erc1271Verified: true,
  },
}

// ── Manager endpoint (framework) ──────────────────────────────
// The HTTP URL + pinned pubkey that produces signed
// ManagerRecommendationEnvelope objects.
export const managerEndpoint = {
  url: 'https://manager.sail.local',
  publicKey: '0x04a9c2e3f4d5...8b9c0d1e2f3a',
  pinned: true,
  lastSeenAt: '12 minutes ago',
  signaturesVerified: 1287,
  signaturesFailed: 0,
}

// ── Live ETH balances per wallet (gas + custody) ──────────────
// Three wallets matter for an SMA project's day-to-day ops:
//   1. Agent wallet — signs each dispatch, pays the gas. Should be
//      topped up before every run; runs low fast on busy days.
//   2. Owner wallet — the EOA that owns the Safe. Signs registrations
//      and revocations. Funds itself.
//   3. SMA (Safe) — the account the agent trades inside. Holds the
//      strategy capital; native ETH shown here is gas only — tokens
//      aren't summed in this card.
//
// `status` drives the pill: 'low' triggers the inline refill CTA on
// the Agent card.
export const gas = {
  agent: {
    address: '0xc0Fe18a32bD8e0F9c1A2d3B4c5E6f7891f283574',
    balanceEth: 0.00150,
    status: 'low',
    label: 'Manager',
    description: 'The dispatcher. Signs and pays gas for every run. Keep it funded.',
    refillSuggestionEth: 0.01,
    refillHint: 'Running low. Top up soon.',
  },
  owner: {
    address: '0x39D6c3b81F4eA72cD90a1b2C3d4e5F6a7b8c5b52',
    balanceEth: 0.01234,
    status: 'funded',
    label: 'Owner',
    description: 'Holds the Safe and signs mandates.',
  },
  sma: {
    // Same as sma.address — the SMA *is* the Safe. We expose
    // `gas.sma` so the dashboard can read the balance without
    // having to know where the address comes from.
    address: '0x4e2a91b3F7c5dA8bC09f1E2d3B4a5C6d7E8f9c8b',
    balanceEth: 0.01700,
    status: 'funded',
    label: 'SMA',
    description: 'Holds your funds. Native ETH shown; tokens not counted.',
  },
}

// ── Cumulative bookkeeping (informational, not enforced) ──────
export const bookkeeping = {
  cumulativeDeposits: 48_750,
  cumulativeWithdrawals: 12_300,
  // Manager-attested. The protocol does NOT verify this onchain.
  // Disclose this honestly in the UI.
  currentNavReported: 41_240.55,
  navReportedAt: '2026-05-25 09:00 UTC',
  navAttestedBy: 'manager',
}

// ── Mandates (the live signed delegations) ────────────────────
// One SMA can carry multiple mandates — each a distinct bounded
// delegation drafted by an AI and signed onchain. Surfaces as the
// "Your mandates" list on the dashboard.
//
// Field roles, for the row + modals:
//   name        — short human handle the user thinks of it by
//   drafter     — which AI drafted it; drives the brand mark
//   address     — onchain Mandate contract; explorer target
//   status      — active | paused | expired
//   signedAt    — date string surfaced on the row + in the contract
//   brief       — one-paragraph plain-English summary from the LLM
//   permissionsCount — small count badge on the row
export const mandates = [
  {
    id: 'mandate-yield',
    name: 'Yield mandate',
    drafter: 'Claude',
    address: '0x8B4D9e0F1A2c3B5d7E8f0123456789ABcDeF0042',
    status: 'active',
    signedAt: 'May 18, 2026',
    brief: 'A bounded delegation authorizing AI agents to operate conservative USDC and WETH yield strategies on Arbitrum, strictly within the whitelisted lending and structured-yield venues listed below.',
    permissionsCount: 3,
  },
  {
    id: 'mandate-hedge',
    name: 'ETH hedge mandate',
    drafter: 'Cursor',
    address: '0xC1f2E3a4B5C6d7E8f9A0123456789ABCDEF01234',
    status: 'active',
    signedAt: 'May 22, 2026',
    brief: "Maintains modest downside protection on the SMA's ETH exposure through bounded shorts and option ceilings on whitelisted derivatives venues. Notionals are capped per call; positions are auto-closed at expiry so the SMA never carries open derivative risk overnight.",
    permissionsCount: 2,
  },
  {
    id: 'mandate-rebalance',
    name: 'Rebalance mandate',
    drafter: 'Codex',
    address: '0x7A3b9c2D8e1F4a5B6c7D8e9F0a1B2c3D4e5F6789',
    status: 'paused',
    signedAt: 'May 24, 2026',
    brief: 'Detects APY drift between whitelisted lending markets and proposes within-asset rebalances when the delta crosses 1%. Limited to USDC and WETH markets; no cross-asset swaps permitted. Currently paused while the operator audits venue health.',
    permissionsCount: 1,
  },
  {
    id: 'mandate-stable',
    name: 'Stablecoin sweep',
    drafter: 'Claude',
    address: '0x4E8F9a0B1c2D3e4F5a6B7c8D9e0F1a2B3c4D5E6f',
    status: 'expired',
    signedAt: 'Apr 02, 2026',
    brief: 'Sweeps idle stablecoin balances into the highest-APY whitelisted lending market once per day. Expired on May 02 after its 30-day window closed; no agent currently has authority to run this strategy.',
    permissionsCount: 2,
  },
]

// Legacy single-mandate export — kept for any caller that still
// expects a singular `mandate`. Points at the first active mandate
// in the list.
export const mandate = {
  smaId: sma.id,
  ...mandates[0],
  // Aggregate "policy hash" — represents the union of permission
  // template hashes. For real chain data this would be derived from
  // each Permission's introspection.
  policyHash: '0x4e2a91b3c8b8d11a',
  permissions: [
    {
      id: 'perm-swap-uniswap',
      address: '0x8a3D7e9F12bC56a4E8d92cD61f3c7A0B5e8c1234',
      label: 'Swap on Uniswap V3 and 1inch',
      description: 'Spot swaps on whitelisted DEX routers within bounded notional caps.',
      sub: 'Up to $500 per trade · USDC, ETH, WETH, WBTC only',
      // 4-byte selector the permission accepts on its target.
      selector: '0x414bf389',
      signature: 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))',
      // Permission contract introspection (IPermissionIntrospection).
      permissionId: 'sail.permission.swap.v1',
      permissionVersion: '1.3.0',
      metadataURI: 'ipfs://bafkreih.../swap-v1.json',
      // Per-permission registration receipt.
      registeredAt: '2026-05-18 14:32 UTC',
      registeredTxHash: '0xb2c3d49a01f783ab',
      registeredBlock: 23_480_004,
      registrationFeeWei: '1000000000000000', // 0.001 ETH
      // Was this attached via MandateFactory or direct kernel call?
      provenance: 'MandateFactory',
    },
    {
      id: 'perm-pendle',
      address: '0x9b4C8e1A3F76dE2BcA85bD90eC7c4b8A6f9d2345',
      label: 'Deposit into Pendle yield positions',
      description: 'Supply USDC/WETH into Pendle PT markets with NAV-share ceiling.',
      sub: 'USDC and WETH PT markets · max 50% of NAV',
      selector: '0x617ba037',
      signature: 'supply(address,uint256,address,uint16)',
      permissionId: 'sail.permission.pendle-pt.v1',
      permissionVersion: '1.0.2',
      metadataURI: 'ipfs://bafkreih.../pendle-v1.json',
      registeredAt: '2026-05-18 14:34 UTC',
      registeredTxHash: '0x57d21c4a8b9a0f12',
      registeredBlock: 23_480_007,
      registrationFeeWei: '1000000000000000',
      provenance: 'MandateFactory',
    },
    {
      id: 'perm-rebalance',
      address: '0xc7d8E9F0a1B2c3D4e5F6789012345678ABCDEF34',
      label: 'Rebalance between Aave and Compound',
      description: 'Within-asset rebalancing when APY delta crosses threshold.',
      sub: 'When APY delta ≥ 1% · same asset only',
      selector: '0x69328dec',
      signature: 'withdraw(address,uint256,address)',
      permissionId: 'sail.permission.rebalance.v1',
      permissionVersion: '1.1.0',
      metadataURI: 'ipfs://bafkreih.../rebalance-v1.json',
      registeredAt: '2026-05-18 14:35 UTC',
      registeredTxHash: '0xa1b2c3d4e5f67890',
      registeredBlock: 23_480_009,
      registrationFeeWei: '1000000000000000',
      provenance: 'MandateFactory',
    },
  ],
  // Per-account cap from SailGovernance.maxPermissionsPerAccount.
  maxPermissionsPerAccount: 20,
  // The protocol's permission registration fee. Flat per permission.
  registrationFeeEth: 0.001,
}

// ── Agents (framework project configs) ────────────────────────
// Each agent is a configuration + folder + numeric agentId. NOT
// a separate onchain signer. Each has its own delegated MPC wallet
// that routes through the manager multisig.
export const agents = [
  {
    id: 'usdc-yield',
    agentId: 8_004_127, // deterministic-hashed from slug
    name: 'USDC Yield Specialist',
    description:
      'Compounds idle USDC into the highest-APY whitelisted lending market and rebalances when the spread crosses 1%.',
    drafter: 'Claude',                    // who edited the project files
    // The actual runtime actor:
    managerEndpoint: managerEndpoint.url, // who proposes actions
    mpcWallet: {
      address: '0xa3f1c8927B5dE40fA92cd6E92c4',
      threshold: '2-of-3',
      walletId: 'wallet-usdc-yield',
      provenance: 'sail-mpc-lab',
      keyShareLocations: ['operator-a', 'operator-b', 'paper-backup'],
    },
    // Permissions this agent can call (subset of the mandate).
    usesPermissions: ['perm-swap-uniswap', 'perm-pendle', 'perm-rebalance'],
    // Framework readiness (gated by local checks).
    readiness: 'live-ready',
    // Fork rehearsal freshness — must be ≤24h for live-ready.
    lastForkRehearsal: { at: '3 hours ago', passed: true },
    // Cron-driven schedules.
    schedules: [
      {
        id: 'rebalance-check',
        cron: '*/30 * * * *',
        cronHuman: 'Every 30 min',
        mode: 'live',
        enabled: true,
        lastRun: { at: '14:32', status: 'submitted' },
        nextRun: '14:50',
      },
      {
        id: 'daily-fork-sanity',
        cron: '0 6 * * *',
        cronHuman: 'Daily · 06:00',
        mode: 'fork',
        enabled: true,
        lastRun: { at: 'today 06:00', status: 'confirmed' },
        nextRun: 'tomorrow 06:00',
      },
    ],
    dispatchesToday: 47,
    lastActionAt: '14:32',
  },
  {
    id: 'eth-hedge',
    agentId: 8_004_211,
    name: 'ETH Hedge Operator',
    description:
      'Maintains modest downside protection through bounded shorts and option ceilings on whitelisted derivatives venues.',
    drafter: 'Cursor',
    managerEndpoint: managerEndpoint.url,
    mpcWallet: {
      address: '0x7c1b04Ea2F8D3a90eB67cC5fE4ab9',
      threshold: '2-of-3',
      walletId: 'wallet-eth-hedge',
      provenance: 'sail-mpc-lab',
      keyShareLocations: ['operator-a', 'operator-b', 'paper-backup'],
    },
    usesPermissions: ['perm-swap-uniswap', 'perm-rebalance'],
    readiness: 'live-ready',
    lastForkRehearsal: { at: '5 hours ago', passed: true },
    schedules: [
      {
        id: 'hedge-check',
        cron: '0 */6 * * *',
        cronHuman: 'Every 6 hours',
        mode: 'live',
        enabled: true,
        lastRun: { at: '12:00', status: 'confirmed' },
        nextRun: '18:00',
      },
    ],
    dispatchesToday: 3,
    lastActionAt: '14:15',
  },
  {
    id: 'rebalance-agent',
    agentId: 8_004_318,
    name: 'Rebalance Optimizer',
    description:
      'Detects APY drift between whitelisted lending markets and proposes within-asset rebalances when the delta crosses 1%.',
    drafter: 'Claude',
    managerEndpoint: managerEndpoint.url,
    mpcWallet: {
      address: '0xb8e2D4F5a6B7c8D9e0F1234567890ABcDeF12',
      threshold: '2-of-3',
      walletId: 'wallet-rebalance',
      provenance: 'sail-mpc-lab',
      keyShareLocations: ['operator-a', 'operator-b', 'paper-backup'],
    },
    usesPermissions: ['perm-rebalance'],
    // Fork rehearsal is stale (>24h) — readiness drops below
    // live-ready until re-run.
    readiness: 'permission-ready',
    lastForkRehearsal: { at: '2 days ago', passed: true },
    schedules: [
      {
        id: 'apy-watch',
        cron: '*/15 * * * *',
        cronHuman: 'Every 15 min',
        mode: 'live',
        enabled: false,
        lastRun: null,
        nextRun: null,
      },
    ],
    dispatchesToday: 0,
    lastActionAt: null,
  },
]

// ── Operations pending signature ──────────────────────────────
// Real framework concept: SailOperationState. Each operation has a
// kind, subject (Safe), signer (which role signs it), chain (pinned),
// policyHash, calldata, and readback checks. Lives under
// /u/sign/<operationId> in Studio.
export const pendingOperations = [
  {
    id: 'op-9d4a',
    kind: 'permission.session.create',
    title: 'Authorise a new yield permission',
    summary:
      'Adds a "Deposit into Morpho Blue vaults" permission to the DeFi conservative mandate.',
    subjectKind: 'sma',
    subject: sma.address,
    chain: sma.chain,
    signerRole: 'permissionSigner',
    signerAddress: permissionSigner.address,
    policyHash: '0x9b4c8e1a3f76de28',
    estimatedFeeEth: 0.001,
    drafter: 'Claude',
    requestedAt: 'just now',
    readbackChecks: [
      { label: 'Safe module status', status: 'ok', detail: 'SailKernel enabled' },
      { label: 'Trusted Safe factory', status: 'ok', detail: 'Allowlisted' },
      { label: 'Permission count', status: 'ok', detail: '3 / 20 (one slot used by this op)' },
      { label: 'Permission template compiled', status: 'ok', detail: 'sail.permission.morpho.v1@1.0.0' },
      { label: 'Fork rehearsal', status: 'ok', detail: 'Passed 6 min ago' },
    ],
    calldataPreview: '0x4f1ef286000000000000000000000000…',
  },
  {
    id: 'op-7c1b',
    kind: 'safe.deposit',
    title: 'Top up your SMA',
    summary: 'Direct transfer of 5,000 USDC from your EOA into the SMA Safe address.',
    subjectKind: 'safe',
    subject: sma.address,
    chain: sma.chain,
    signerRole: 'owner',
    signerAddress: owner.address,
    policyHash: null, // safe deposit doesn't touch the permission registry
    estimatedFeeEth: 0,
    drafter: 'Cursor',
    requestedAt: '12 minutes ago',
    readbackChecks: [
      { label: 'Recipient address matches SMA', status: 'ok', detail: sma.address },
      { label: 'Token contract', status: 'ok', detail: 'USDC · Arbitrum native' },
      { label: 'Amount', status: 'ok', detail: '5,000 USDC' },
    ],
    calldataPreview: '0xa9059cbb…',
  },
  {
    id: 'op-3e8f',
    kind: 'permission.signer.bind',
    title: 'Bind a new delegated MPC wallet',
    summary: 'Registers a new 2-of-3 MPC wallet as the dispatcher for the BTC Hedge agent.',
    subjectKind: 'agent',
    subject: 'agent-btc-hedge',
    chain: sma.chain,
    signerRole: 'permissionSigner',
    signerAddress: permissionSigner.address,
    policyHash: '0xc7d8e9f0a1b2c3d4',
    estimatedFeeEth: 0,
    drafter: 'Codex',
    requestedAt: '1 hour ago',
    readbackChecks: [
      { label: 'MPC wallet generated', status: 'ok', detail: '2-of-3 · sail-mpc-lab' },
      { label: 'Manager whitelist updated', status: 'ok', detail: 'Pending kernel binding' },
      { label: 'Fork rehearsal', status: 'warn', detail: 'Not yet performed' },
    ],
    calldataPreview: '0xbe75c89d…',
  },
]

// ── Decision Journal events ───────────────────────────────────
// Pulled from FIVE stores in the real framework:
//   1. operation.* events (operation.prepare, operation.readback, etc.)
//   2. fork.rehearsal records
//   3. session.* events (session.authorize, session.revoke)
//   4. tx.submit-live / tx.submit-live-blocked
//   5. manager recommendations (ManagerRecommendationRuntimeRecord)
//
// Each event has a `source` so the UI can filter by store.
export const journal = [
  {
    id: 'j-1',
    time: '14:32',
    dateLabel: 'today',
    source: 'tx.submit-live',
    sourceLabel: 'Run artifact',
    status: 'success',
    agentId: 'usdc-yield',
    actor: 'USDC Yield Specialist',
    action: 'swapped 100 USDC → 0.041 WETH on Uniswap V3',
    summary: 'authorised by perm-swap-uniswap · gas 142k',
    detail: {
      managerRecommendationId: 'rec-12a4',
      reasoning:
        'Aave USDC APY had slipped 0.4% below the rebalance trigger while the Uniswap V3 USDC/WETH pool widened to a 0.9% inefficiency on the inbound side. I converted 100 USDC into WETH at the better edge, sitting well inside the $500 per-trade cap.',
      evidence: [
        { k: 'Source APY (Aave)', v: '4.62%' },
        { k: 'Pool inefficiency', v: '0.9%' },
        { k: 'Cap headroom', v: '$400 remaining' },
        { k: 'Idle USDC', v: '423.00' },
      ],
      permissionUsed: 'perm-swap-uniswap',
      mpcWallet: '0xa3f1c8927B5dE40fA92cd6E92c4',
      artifact: {
        'Tx hash': '0xb1f3…8e21',
        Block: '23,481,004',
        Gas: '$0.14 (142k)',
        Venue: 'Uniswap V3',
      },
    },
  },
  {
    id: 'j-2',
    time: '14:25',
    dateLabel: 'today',
    source: 'manager-recommendation',
    sourceLabel: 'Manager recommendation',
    status: 'info',
    agentId: 'usdc-yield',
    actor: 'USDC Yield Specialist',
    action: 'received a swap recommendation from the manager endpoint',
    summary: 'signature verified · actionHash 0xb1f3…8e21 · expires in 15 min',
    detail: {
      managerRecommendationId: 'rec-12a4',
      reasoning:
        'Manager endpoint proposed a 100 USDC → WETH swap based on observed pool inefficiency. Signature verified against pinned publicKey.',
      evidence: [
        { k: 'Endpoint', v: 'https://manager.sail.local' },
        { k: 'Nonce', v: '0x1c4' },
        { k: 'Expires at', v: '14:40 UTC' },
        { k: 'Signature', v: 'verified' },
      ],
      mpcWallet: '0xa3f1c8927B5dE40fA92cd6E92c4',
    },
  },
  {
    id: 'j-3',
    time: '14:15',
    dateLabel: 'today',
    source: 'tx.submit-live',
    sourceLabel: 'Run artifact',
    status: 'success',
    agentId: 'usdc-yield',
    actor: 'USDC Yield Specialist',
    action: 'deposited 500 USDC into Pendle PT-USDC',
    summary: 'authorised by perm-pendle · gas 287k',
    detail: {
      reasoning:
        'Idle USDC crossed the deposit threshold and Pendle PT-USDC was within 4 bps of best fixed-yield in the whitelist. Deposit sits at 38% of NAV (ceiling 50%).',
      evidence: [
        { k: 'PT-USDC APY', v: '6.92%' },
        { k: 'NAV share', v: '38%' },
        { k: 'NAV ceiling', v: '50%' },
      ],
      permissionUsed: 'perm-pendle',
      mpcWallet: '0xa3f1c8927B5dE40fA92cd6E92c4',
      artifact: {
        'Tx hash': '0xa3b6…5210',
        Block: '23,480,997',
        Gas: '$0.27 (287k)',
        Venue: 'Pendle',
      },
    },
  },
  {
    id: 'j-4',
    time: '13:58',
    dateLabel: 'today',
    source: 'tx.submit-live-blocked',
    sourceLabel: 'Permission event',
    status: 'rejected',
    agentId: 'usdc-yield',
    actor: 'USDC Yield Specialist',
    action: 'swap rejected, $612 exceeded the $500 per-trade cap',
    summary: 'mandate held · zero gas',
    detail: {
      reasoning:
        'Proposed $612 swap to capture a 1.1% spread. Amount exceeded the per-trade cap so perm-swap-uniswap reverted at pre-flight simulation. No mainnet gas paid.',
      evidence: [
        { k: 'Proposed size', v: '$612' },
        { k: 'Per-trade cap', v: '$500' },
        { k: 'Spread forgone', v: '1.1%' },
        { k: 'Stage', v: 'pre-flight sim' },
      ],
      permissionUsed: 'perm-swap-uniswap',
      mpcWallet: '0xa3f1c8927B5dE40fA92cd6E92c4',
    },
  },
  {
    id: 'j-5',
    time: '13:30',
    dateLabel: 'today',
    source: 'fork.rehearsal',
    sourceLabel: 'Fork rehearsal',
    status: 'info',
    agentId: 'usdc-yield',
    actor: 'USDC Yield Specialist',
    action: 'rehearsed 12 candidate trades on a chain fork',
    summary: '12/12 passed · best path persisted · zero mainnet exposure',
    detail: {
      reasoning:
        'Pre-run rehearsal against a fork of block 23,480,891 simulated 12 candidate trades. All cleared the permission boundary and price-impact ceiling. Highest-EV path was selected and queued.',
      evidence: [
        { k: 'Fork block', v: '23,480,891' },
        { k: 'Candidates tested', v: '12' },
        { k: 'Passing paths', v: '12' },
        { k: 'Chosen EV', v: '+0.42%' },
      ],
    },
  },
  {
    id: 'j-6',
    time: '12:00',
    dateLabel: 'today',
    source: 'operation.prepare',
    sourceLabel: 'Operation prepared',
    status: 'info',
    agentId: null,
    actor: 'You',
    action: 'prepared operation op-9d4a — Authorise a new yield permission',
    summary: 'policyHash 0x9b4c8e1a · signer permissionSigner · pinned chain Arbitrum',
    detail: {
      reasoning:
        'Operation manifest prepared by sail operation prepare permission.session.create. Awaiting signature at /sign/op-9d4a.',
      evidence: [
        { k: 'Operation id', v: 'op-9d4a' },
        { k: 'Subject (SMA)', v: '0x4e2a91b3…c8b8d11' },
        { k: 'Policy hash', v: '0x9b4c8e1a3f76de28' },
        { k: 'Pinned chain', v: 'Arbitrum (42161)' },
        { k: 'Readback checks', v: '5/5 passed' },
      ],
    },
  },
  {
    id: 'j-7',
    time: '06:00',
    dateLabel: 'today',
    source: 'sail.audit.v1',
    sourceLabel: 'Runtime audit',
    status: 'info',
    agentId: null,
    actor: 'Sail runtime',
    action: 'daily audit — permissions, balances, oracle drift verified',
    summary: 'no anomalies · next audit 06:00 tomorrow',
    detail: {
      reasoning:
        'Daily checks: mandate hash matches deployed templates; all 3 delegated MPC wallets responsive; gas balances above floor; oracle drift under 5 bps across whitelisted assets.',
      evidence: [
        { k: 'Mandate hash', v: 'matches' },
        { k: 'MPC wallets online', v: '3 / 3' },
        { k: 'Gas balance floor', v: 'ok' },
        { k: 'Oracle drift', v: '< 5 bps' },
      ],
    },
  },
  {
    id: 'j-8',
    time: '23:14',
    dateLabel: 'yesterday',
    source: 'sail.audit.v1',
    sourceLabel: 'Error',
    status: 'warn',
    agentId: 'usdc-yield',
    actor: 'USDC Yield Specialist',
    action: 'oracle stale — paused dispatch for 14 minutes',
    summary: 'auto-resumed after Chainlink heartbeat caught up',
    detail: {
      reasoning:
        'Chainlink USDC/USD heartbeat lagged its 60-minute SLA by 14 minutes. Dispatch paused per runtime safety rule. After three consecutive heartbeats, dispatch resumed.',
      evidence: [
        { k: 'Feed', v: 'USDC/USD on Arbitrum' },
        { k: 'SLA', v: '60 min' },
        { k: 'Lag at trigger', v: '74 min' },
        { k: 'Recovery', v: '3 heartbeats verified' },
      ],
    },
  },
  {
    id: 'j-9',
    time: '09:00',
    dateLabel: 'yesterday',
    source: 'session.authorize',
    sourceLabel: 'Session event',
    status: 'success',
    agentId: null,
    actor: 'You',
    action: 'authorised the DeFi conservative mandate',
    summary: '3 permissions registered onchain · sessionActive set true',
    detail: {
      reasoning:
        'Permission Signer authorised the mandate. Three EIP-712 RegisterPermission messages submitted in a batch; sessionActive set true for the SMA.',
      evidence: [
        { k: 'Permissions registered', v: '3' },
        { k: 'Cumulative fee paid', v: '0.003 ETH' },
        { k: 'Tx hash', v: '0xb2c3d49a01f783ab' },
        { k: 'Block', v: '23,480,004' },
      ],
    },
  },
]

// ── Onchain identifiers (helpers) ─────────────────────────────
export function explorerUrl(chain, address) {
  const map = {
    42161: `https://arbiscan.io/address/${address}`,
    1: `https://etherscan.io/address/${address}`,
    8453: `https://basescan.org/address/${address}`,
    10: `https://optimistic.etherscan.io/address/${address}`,
  }
  return map[chain.id] ?? map[1]
}
// Transaction explorer link — used by activity rows that reference an
// onchain artifact (a dispatched run, a registered permission).
export function txExplorerUrl(chain, hash) {
  const base = {
    42161: 'https://arbiscan.io/tx/',
    1: 'https://etherscan.io/tx/',
    8453: 'https://basescan.org/tx/',
    10: 'https://optimistic.etherscan.io/tx/',
  }
  return (base[chain.id] ?? base[1]) + hash
}
export function safeAppUrl(chain, address) {
  const prefix = { 42161: 'arb1', 1: 'eth', 8453: 'base', 10: 'oeth' }[chain.id] ?? 'eth'
  return `https://app.safe.global/home?safe=${prefix}:${address}`
}
export function debankUrl(address) {
  return `https://debank.com/profile/${address}`
}

// ── Readiness ───────────────────────────────────────────────
export const READINESS_ORDER = [
  'agent-draft',
  'agent-runnable',
  'fork-rehearsed',
  'permission-ready',
  'scheduled',
  'live-ready',
]
export const READINESS_LABELS = {
  'agent-draft':       { label: 'Draft',           tone: 'muted',  hint: 'Project files written, no schedule yet.' },
  'agent-runnable':    { label: 'Runnable',        tone: 'muted',  hint: 'Policies + templates compiled.' },
  'fork-rehearsed':    { label: 'Fork rehearsed',  tone: 'info',   hint: 'Last fork rehearsal passed.' },
  'permission-ready':  { label: 'Permission ready',tone: 'info',   hint: 'Permission registered onchain.' },
  'scheduled':         { label: 'Scheduled',       tone: 'info',   hint: 'Schedule enabled.' },
  'live-ready':        { label: 'Live · ready',    tone: 'success',hint: 'Fork rehearsal fresh (≤24h) and session active.' },
}
