/**
 * $SAIL reward messages — the contextual "you earned it" notes shown on REAL
 * detected on-chain events.
 *
 * Truthfulness: every message maps to an event the app actually detects (an SMA
 * on disk/chain, a `permission_registered` activity entry, a non-empty positions
 * snapshot, a settled weekly distribution from on-chain Transfer logs). Nothing
 * is fired speculatively.
 *
 * Copy discipline (legal): celebrate the ACTION, state facts — never imply
 * price, profit, future value, appreciation, or tradability. The
 * `reward-messages.test.js` suite enforces a denylist over `ALL_MESSAGE_COPY`.
 *
 * This module is PURE (no React, no I/O) so the detection logic is unit-testable
 * in the repo's node-env harness.
 */

export const MESSAGE_SMA_LIVE =
  "SMA live. You're now earning $SAIL on activity in this account."

export const MESSAGE_MANDATE_SIGNED =
  'Mandate signed — permission registrations are rewarded.'

export const MESSAGE_FIRST_DEPOSIT =
  'First deposit detected. AUM rewards now accruing.'

/** Weekly distribution copy — `amount` is the $SAIL that actually landed. */
export function messageWeeklyDistribution(amount, symbol = 'SAIL') {
  return `This week's $SAIL distribution settled. You earned ${amount} ${symbol}.`
}

/** Static copy (plus a sample weekly line) for the copy-discipline test. */
export const ALL_MESSAGE_COPY = [
  MESSAGE_SMA_LIVE,
  MESSAGE_MANDATE_SIGNED,
  MESSAGE_FIRST_DEPOSIT,
  messageWeeklyDistribution('0', 'SAIL'),
]

/**
 * Derive the reward messages from REAL detected signals. Each message appears
 * only when its event is actually present, so nothing fires spuriously.
 *
 * @param signals
 *   - smaDeployed   boolean — an SMA exists (account on disk/chain or sma_created)
 *   - mandateSigned boolean — a permission_registered event was detected
 *   - firstDeposit  boolean — the positions snapshot shows holdings (AUM)
 *   - weeklyAmount  string|null — $SAIL that landed this week, or null if none
 *   - weeklySymbol  string — token symbol for the weekly line
 * @returns Array<{ key, event, text }>
 */
export function deriveRewardMessages(signals = {}) {
  const { smaDeployed, mandateSigned, firstDeposit, weeklyAmount, weeklySymbol = 'SAIL' } = signals
  const messages = []
  if (smaDeployed) {
    messages.push({ key: 'sma_live', event: 'sma_created', text: MESSAGE_SMA_LIVE })
  }
  if (mandateSigned) {
    messages.push({ key: 'mandate_signed', event: 'permission_registered', text: MESSAGE_MANDATE_SIGNED })
  }
  if (firstDeposit) {
    messages.push({ key: 'first_deposit', event: 'deposit_detected', text: MESSAGE_FIRST_DEPOSIT })
  }
  if (weeklyAmount != null) {
    messages.push({
      key: 'weekly_distribution',
      event: 'weekly_distribution',
      text: messageWeeklyDistribution(weeklyAmount, weeklySymbol),
    })
  }
  return messages
}

/** Remove messages the user has dismissed (by key). */
export function applyDismissals(messages, dismissedKeys = []) {
  const dropped = new Set(dismissedKeys)
  return (messages ?? []).filter((m) => !dropped.has(m.key))
}
