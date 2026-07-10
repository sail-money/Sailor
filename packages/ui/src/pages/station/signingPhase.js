// Pure phase-decision + copy for the signing station, extracted from
// SigningStation.jsx so the confirmation-protocol invariants are unit-testable
// without rendering React:
//  - queue handling: confirming/resolving ONE request must advance to the next
//    pending card, and only take the terminal full screen when none remain
//    (the DEFECT-2 guard);
//  - screen mapping: `reverted` (mined & reverted) and `failed` (never
//    submitted) are failures, while `unverified` (submitted but the receipt
//    could not be observed) is deliberately NOT — a timeout must never read as a
//    revert.

/**
 * Copy for the failure screen. 'reverted' (the tx mined then reverted) reads
 * differently from 'failed' (the submission itself errored — never sent).
 */
export function failureCopy(outcome) {
  return outcome === 'reverted'
    ? { kicker: 'REVERTED', headline: '✕ Transaction reverted on-chain.' }
    : { kicker: 'FAILED', headline: '✕ Transaction was not submitted.' }
}

/**
 * Next phase given the previous phase, the number of requests that remain AFTER
 * pruning the one this message concerns, and the server message.
 *
 * A message for a request that is not the one on screen leaves the phase
 * untouched. `request-resolved` never shows a success/failure screen (nothing
 * is confirmed yet); `request-confirmed` only takes the full screen when no
 * requests remain, otherwise it advances to the next card.
 */
export function nextSigningPhase(prevPhase, remainingCount, msg) {
  if (prevPhase.requestId !== msg.requestId) return prevPhase

  if (msg.type === 'request-resolved') {
    if (prevPhase.phase === 'done' && remainingCount === 0) {
      return { phase: 'awaiting-confirmation', requestId: msg.requestId, kind: prevPhase.kind }
    }
    return { phase: 'idle' }
  }

  if (msg.type === 'request-confirmed') {
    if (remainingCount > 0) return { phase: 'idle' }
    const { outcome, error, note } = msg.confirmation ?? {}
    if (outcome === 'confirmed') {
      return { phase: 'success', requestId: msg.requestId, kind: prevPhase.kind, note }
    }
    if (outcome === 'unverified') {
      // Submitted but not observable (no RPC / timeout) — never a failure verdict.
      return { phase: 'unverified', requestId: msg.requestId, kind: prevPhase.kind, message: error }
    }
    // 'reverted' (mined & reverted) or 'failed' (never submitted).
    return {
      phase: 'chain-failed',
      requestId: msg.requestId,
      kind: prevPhase.kind,
      outcome,
      message: error ?? 'The transaction failed on-chain.',
    }
  }

  return prevPhase
}
