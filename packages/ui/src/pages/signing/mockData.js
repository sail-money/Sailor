export const mockMandate = {
  summary:
    'Deposit up to $500 of your USDC into yield strategies on Arbitrum for the next 30 days. I won’t withdraw, trade, or move funds elsewhere.',
  constraints: ['$500 max', '30 days', 'USDC on Arbitrum'],
  allowed: [
    'Deposit into Aave USDC',
    'Withdraw from Aave USDC',
    'Rebalance within USDC yield venues',
  ],
  disallowed: [
    'Send to external wallets',
    'Swap into other tokens',
    'Exceed $500 total',
  ],
  calldata: `// EIP-712 typed data
{
  "types": {
    "Mandate": [
      { "name": "manager",   "type": "address" },
      { "name": "asset",     "type": "address" },
      { "name": "maxAmount", "type": "uint256" },
      { "name": "expiresAt", "type": "uint256" },
      { "name": "actions",   "type": "bytes32[]" }
    ]
  },
  "domain": {
    "name": "Sail",
    "chainId": 42161,
    "verifyingContract": "0x5a11000000000000000000000000000000000001"
  },
  "message": {
    "manager":   "0xA1...c0de",
    "asset":     "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "maxAmount": "500000000",
    "expiresAt": 1747958400,
    "actions":   ["aave.deposit", "aave.withdraw"]
  }
}`,
  network: 'Arbitrum',
  gasEstimate: '$0.18',
}

export const mockDeploy = {
  type: 'Safe deployment',
  network: 'Arbitrum',
  gasEstimate: '$0.42',
  calldata: `// Safe proxy factory call
createProxyWithNonce(
  singleton:   0x3E5c63644E683549055b9Be8653de26E0B4CD36E,
  initializer: 0xb63e800d000000000000000000000000... (truncated),
  saltNonce:   1747756800
)`,
}
