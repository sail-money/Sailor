// Pure phase-decision + copy for the signing page, extracted from
// SigningPage.jsx so the confirmation-protocol invariants are unit-testable
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

// Kernel custom errors this page can recognize in a raw confirmation message,
// matched as plain substrings rather than decoded from raw revert bytes: the
// message reaches this page as flattened text from the signing daemon, with
// no structured revert data attached. Each entry's hex values are that
// error's 4-byte selector (`toFunctionSelector('ErrorName(...)')`)  — present
// verbatim in viem's error text whenever it can't resolve the error to a
// name. Two DIFFERENT failures look superficially similar ("a permission
// didn't register") but need opposite advice, so they're classified
// separately rather than lumped into one generic "it failed" bucket:
//   - stale nonce: the request is genuinely invalid now — resend it fresh.
//   - already registered: the request is redundant — it already succeeded
//     earlier, so resending the SAME thing again will just fail again. This
//     is the shape to suspect when an agent hallucinates that something
//     wasn't signed and keeps re-submitting an already-confirmed permission.
const CLASSIFIED_FAILURES = [
  {
    markers: ['InvalidSignerSignature', 'InvalidManagerSignature', '0xcf92fef0', '0xeb6942f1'],
    kicker: 'SIGNATURE OUT OF DATE',
    headline: 'This permission’s signature is out of date.',
    explanation:
      'Only the first matched the current nonce. Ask your agent to resend just this one, or batch them together.',
  },
  {
    markers: ['PermissionAlreadyRegistered', '0x451f8f10'],
    kicker: 'ALREADY REGISTERED',
    headline: 'This permission is already registered.',
    explanation:
      'This permission is already confirmed on-chain from an earlier signature. Check your Mandates list.',
  },
]

/**
 * Recognize a handful of kernel reverts that are common enough — and
 * confusing enough as raw text — to deserve a plain-language explanation
 * instead of the generic failureCopy() headline. Returns null (falls back to
 * the generic copy) when the message doesn't match anything known.
 */
export function classifyPermissionFailure(message) {
  if (!message || typeof message !== 'string') return null
  const match = CLASSIFIED_FAILURES.find((c) => c.markers.some((marker) => message.includes(marker)))
  if (!match) return null
  const { kicker, headline, explanation } = match
  return { kicker, headline, explanation }
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
