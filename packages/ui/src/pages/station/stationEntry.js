// Pure first-load routing decision for the signing station, extracted so the
// invariant is unit-testable without rendering React (mirrors signingPhase.js).
//
// The bug this exists to prevent: a user with no SMA yet who lands on
// `#/station` (e.g. a URL handed out before onboarding is complete) saw the
// station's bare "connect your wallet" prompt — the wrong first screen, with
// nothing to do — instead of the onboarding wizard, until a manual refresh
// happened to clear the hash. The station is for approving signing requests,
// not for onboarding; if there is nothing to approve and no account yet,
// there is nothing for this page to do.

/**
 * @param {{ stateLoaded: boolean, hasAccount: boolean, pendingCount: number }} args
 * @returns {'loading' | 'wizard' | 'station'}
 *
 *  - Account state hasn't resolved yet → a neutral loading beat, never the
 *    station's interactive chrome — a brief loading beat is fine, showing the
 *    wrong view before we know which one is right is not.
 *  - Resolved, no account yet, AND nothing is actually pending to approve →
 *    the wizard (via the dashboard route) — there is nothing to do here.
 *  - Otherwise (an account exists, OR there is a pending request even before
 *    one does — e.g. approving the create-sma push itself) → the station
 *    renders normally.
 */
export function decideStationEntry({ stateLoaded, hasAccount, pendingCount }) {
  if (!stateLoaded) return 'loading'
  if (!hasAccount && pendingCount === 0) return 'wizard'
  return 'station'
}
