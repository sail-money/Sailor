/**
 * $SAIL rewards — all user-facing token and campaign copy, in one place.
 *
 * Legal discipline: this copy celebrates FACTS only. It never implies price,
 * profit, future value, appreciation, or tradability upside. Non-transferable
 * is stated as a present fact, not as "locked value that will unlock." The
 * `rewards-copy.test.js` suite enforces a speculative-language denylist against
 * `ALL_REWARDS_COPY`, so keep every new string here and keep it factual.
 */

export const TOKEN_NAME = '$SAIL'

export const TOKEN_TAGLINE = 'Build-to-earn recognition for using Sail Protocol.'

export const TOKEN_WHAT_IS =
  '$SAIL is an on-chain record of your participation in Sail Protocol. You earn it by deploying SMAs and running mandated agents — it recognizes what you build and operate.'

export const CAMPAIGN_HOW =
  'During the current campaign, $SAIL is distributed to active accounts based on protocol usage. Distributions land directly on-chain in your account, so this page reflects exactly what was sent — nothing here is simulated.'

export const NON_TRANSFERABLE_LABEL = 'Non-transferable'

export const NON_TRANSFERABLE_NOTE =
  'Held in your account as an on-chain record. $SAIL cannot be sent, traded, or exchanged.'

export const NON_TRANSFERABLE_TGE_FACT =
  'It is non-transferable today. Whether transferability is ever enabled at a future token generation event is decided by protocol governance and is not promised here.'

/** Address is appended by the UI after this sentence. */
export const REWARDS_DESTINATION_NOTE = 'Rewards are sent to your first SMA:'

export const WEEKLY_HISTORY_TITLE = 'Weekly earnings'

export const WEEKLY_HISTORY_SUB =
  'How much $SAIL landed in your account each week, read directly from on-chain transfers.'

export const EMPTY_NO_SMA =
  'Deploy your first SMA to start earning $SAIL. Recognition accrues on-chain as your agents operate.'

export const EMPTY_NO_REWARDS =
  'No $SAIL has landed in this account yet. As your SMA participates, distributions will appear here.'

export const TOKEN_NOT_CONFIGURED =
  'The $SAIL token address is not configured yet. Once the token is deployed, set VITE_SAIL_TOKEN_ADDRESS to read your balance and history here.'

/** Every string above, for the copy-discipline test to scan. */
export const ALL_REWARDS_COPY = [
  TOKEN_NAME,
  TOKEN_TAGLINE,
  TOKEN_WHAT_IS,
  CAMPAIGN_HOW,
  NON_TRANSFERABLE_LABEL,
  NON_TRANSFERABLE_NOTE,
  NON_TRANSFERABLE_TGE_FACT,
  REWARDS_DESTINATION_NOTE,
  WEEKLY_HISTORY_TITLE,
  WEEKLY_HISTORY_SUB,
  EMPTY_NO_SMA,
  EMPTY_NO_REWARDS,
  TOKEN_NOT_CONFIGURED,
]
