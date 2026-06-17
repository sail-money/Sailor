import { isAddress } from 'viem'

/**
 * $SAIL rewards — configuration.
 *
 * The token address is NEVER hardcoded. The real $SHELL test-token address is
 * filled in via the `VITE_SAIL_TOKEN_ADDRESS` env var after deployment; until
 * then `resolveTokenAddress` returns a clear placeholder (the zero address) and
 * `isTokenConfigured` is false, so the page shows a "not configured yet" state
 * instead of reading a bogus address.
 *
 * Every resolver takes an explicit `env` (defaulting to Vite's `import.meta.env`)
 * so the resolution logic is testable without touching process/global state.
 */

/** Clear, recognizable placeholder used until the token address is configured. */
export const SAIL_TOKEN_PLACEHOLDER = '0x0000000000000000000000000000000000000000'

function env_(env) {
  // Default to Vite's compile-time env; tolerate environments where it's absent.
  return env ?? (typeof import.meta !== 'undefined' ? import.meta.env : undefined) ?? {}
}

/** The $SAIL token address from config/env, or the placeholder when unset/invalid. */
export function resolveTokenAddress(env) {
  const addr = env_(env).VITE_SAIL_TOKEN_ADDRESS
  return typeof addr === 'string' && isAddress(addr) ? addr : SAIL_TOKEN_PLACEHOLDER
}

/** True once a real token address has been configured. */
export function isTokenConfigured(env) {
  return resolveTokenAddress(env) !== SAIL_TOKEN_PLACEHOLDER
}

/**
 * Earliest block to scan for inbound transfers, from `VITE_SAIL_TOKEN_FROM_BLOCK`.
 * Defaults to `'earliest'` (the token is recently deployed in the test campaign,
 * so a full scan is cheap). Returns a bigint when a numeric block is configured.
 */
export function resolveFromBlock(env) {
  const b = env_(env).VITE_SAIL_TOKEN_FROM_BLOCK
  if (b === undefined || b === null || b === '') return 'earliest'
  try {
    return BigInt(b)
  } catch {
    return 'earliest'
  }
}

/**
 * Minimal ERC-20 surface the rewards page reads LIVE from the token:
 *  - `balanceOf` for the current held balance,
 *  - `decimals`/`symbol` for display,
 *  - the `Transfer` event to reconstruct what actually landed on-chain
 *    (no indexer — purely on-chain reality).
 */
export const ERC20_REWARDS_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
]
