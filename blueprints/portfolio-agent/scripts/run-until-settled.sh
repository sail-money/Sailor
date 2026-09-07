#!/bin/bash
# run-until-settled.sh — tick the portfolio agent until it has nothing left to do.
#
# A single `sailor run --once` emits ONE round of transactions. A rebalance that needs
# sell → bridge → mint → buy spans four rounds, and the CCTP mint waits on Circle's
# attestation (minutes to about an hour Base→Ethereum). This wrapper keeps ticking, with a
# pause between rounds, until scripts/settled.mjs reports nothing in flight, or a time
# budget runs out (the next scheduled run resumes from the ledger).
#
#   scripts/run-until-settled.sh [reason]
#   SETTLE_MAX_SEC   time budget, default 5400 (90 min)
#   SETTLE_SLEEP_SEC pause between ticks, default 90
set -u
cd "$(dirname "$0")/.." || exit 1
REASON="${1:-settle}"
MAX_SEC="${SETTLE_MAX_SEC:-5400}"
SLEEP_SEC="${SETTLE_SLEEP_SEC:-90}"
start=$(date +%s)
i=0
while :; do
  i=$((i + 1))
  echo "[$(date -u +%FT%TZ)] tick $i ($REASON)"
  before=$(wc -l < .sail/activity.jsonl 2>/dev/null || echo 0)
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
  sleep "$SLEEP_SEC"
done
