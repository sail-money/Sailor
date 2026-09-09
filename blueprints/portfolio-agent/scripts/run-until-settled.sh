#!/bin/bash
# run-until-settled.sh — tick the portfolio agent until it has nothing left to do.
#
# A single `sailor run --once` emits ONE round of transactions. A rebalance that needs
# sell → bridge → mint → buy spans four rounds, and the CCTP mint waits on Circle's
# attestation (minutes to about an hour Base→Ethereum). This wrapper keeps ticking, with a
# pause between rounds, until scripts/settled.mjs reports nothing in flight, or a time
# budget runs out (the next scheduled run resumes from the ledger).
#
# Only one run at a time: a scheduled run and a manual `npm run settle` would otherwise tick
# the same ledger concurrently and double-dispatch. The lock is a directory (mkdir is atomic
# everywhere, and macOS has no flock) holding the owner's pid; a lock whose pid is gone is
# stale and taken over.
#
#   scripts/run-until-settled.sh [reason]
#   SETTLE_MAX_SEC   time budget, default 5400 (90 min)
#   SETTLE_SLEEP_SEC pause between ticks, default 90
set -u
set -o pipefail
cd "$(dirname "$0")/.." || exit 1
REASON="${1:-settle}"
MAX_SEC="${SETTLE_MAX_SEC:-5400}"
SLEEP_SEC="${SETTLE_SLEEP_SEC:-90}"
LOCK_DIR=".sail/runtime/settle.lock"

# ── Overlap lock ────────────────────────────────────────────────────────────────
mkdir -p .sail/runtime
acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo $$ > "$LOCK_DIR/pid"
    return 0
  fi
  local pid
  pid=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "[$(date -u +%FT%TZ)] another run (pid $pid) holds $LOCK_DIR — not starting a second one"
    exit 0
  fi
  if [ -z "$pid" ] && [ -z "$(find "$LOCK_DIR" -maxdepth 0 -mmin +1 2>/dev/null)" ]; then
    # No pid yet and the directory is under a minute old: its owner is between mkdir and
    # writing the pid. Treat it as live rather than race it.
    echo "[$(date -u +%FT%TZ)] $LOCK_DIR was just taken by another run — not starting a second one"
    exit 0
  fi
  echo "[$(date -u +%FT%TZ)] stale lock (pid ${pid:-unknown} is gone) — taking it over"
  rm -rf "$LOCK_DIR"
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo $$ > "$LOCK_DIR/pid"
    return 0
  fi
  echo "[$(date -u +%FT%TZ)] could not take $LOCK_DIR (another run got there first)"
  exit 0
}
release_lock() {
  # Only the owner removes the lock: never delete a lock a later run has taken over.
  if [ "$(cat "$LOCK_DIR/pid" 2>/dev/null)" = "$$" ]; then rm -rf "$LOCK_DIR"; fi
}
acquire_lock
trap release_lock EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ── Tick until settled ──────────────────────────────────────────────────────────
start=$(date +%s)
i=0
while :; do
  i=$((i + 1))
  echo "[$(date -u +%FT%TZ)] tick $i ($REASON)"
  before=$(wc -l 2>/dev/null < .sail/activity.jsonl || echo 0)
  sailor run --once --reason "$REASON-$i" || echo "[$(date -u +%FT%TZ)] tick $i exited non-zero ($?)"
  status=$(node scripts/settled.mjs --since "$before")
  echo "[$(date -u +%FT%TZ)] $status"
  if [ "$status" = "settled" ]; then
    echo "[$(date -u +%FT%TZ)] settled after $i tick(s)"
    exit 0
  fi
  if [ $(( $(date +%s) - start )) -ge "$MAX_SEC" ]; then
    echo "[$(date -u +%FT%TZ)] time budget (${MAX_SEC}s) exhausted, still $status — the next scheduled run resumes"
    exit 1
  fi
  # Pause as a background job under `wait`, so INT/TERM during the pause stops the run at once
  # (bash defers a trap while a foreground child runs — right for a tick, wrong for a nap).
  sleep "$SLEEP_SEC" &
  wait $!
done
