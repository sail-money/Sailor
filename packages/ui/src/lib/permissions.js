// Plain-language description of a permission/template, keyed off its name.
// Bespoke permissions rarely carry a structured explainer, so this guarantees
// every row still reads in human terms (the "always describe what they're
// signing" rule). Falls back to a generic line. Shared by the dashboard's
// mandate cards and the signing page so the two never drift.
export function describePermission(name = '') {
  const n = String(name).toLowerCase()
  if (/permit2/.test(n)) return 'Lets the agent grant a capped Permit2 spend allowance — nothing above the limit.'
  if (/universalrouter|router.*execute|\bexecute\b/.test(n)) return 'Lets the agent route swaps through the Universal Router within the bounds you set.'
  if (/aero|slipstream/.test(n)) return 'Lets the agent swap on Aerodrome Slipstream pools within your limits.'
  if (/erc20.*approve|approve.*erc20|bounded.*approve|\bapprove\b/.test(n)) return 'Lets the agent approve a capped token amount for a specific spender.'
  if (/swap/.test(n)) return 'Lets the agent swap tokens within the size, slippage and token limits you set.'
  if (/transfer/.test(n)) return 'Lets the agent transfer tokens only to the recipients you approved.'
  if (/deposit/.test(n)) return 'Lets the agent deposit funds into an approved venue.'
  if (/withdraw/.test(n)) return 'Lets the agent withdraw funds from an approved venue.'
  if (/borrow|repay/.test(n)) return 'Lets the agent borrow or repay within the limits you set.'
  if (/mandate/.test(n)) return 'Registers this mandate on-chain so your agent can act within its permissions.'
  if (/delegate|manager/.test(n)) return 'Sets your agent wallet as the account manager so it can submit dispatches.'
  return 'An on-chain rule that scopes exactly what your agent may do — it can never act beyond it.'
}
