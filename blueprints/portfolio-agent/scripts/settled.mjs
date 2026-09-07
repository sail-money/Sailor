#!/usr/bin/env node
// settled.mjs — is the portfolio settled after the last tick?
//
// "Settled" means the last tick emitted no dispatches AND nothing is in flight: no CCTP
// burn still waiting for its mint, and no swap intent still waiting for the runner's
// confirmation. A tick that says "nothing actionable" while a bridge is mid-flight is
// NOT settled — the buy on the destination chain is still owed.
//
// Prints "settled" (exit 0) or "pending: <why>" (exit 1). Read-only.
import fs from "node:fs";
import path from "node:path";

const ledgerPath = path.join(process.cwd(), ".sail", "memory", "ledger.jsonl");
const lines = fs.existsSync(ledgerPath)
  ? fs.readFileSync(ledgerPath, "utf-8").split("\n").filter(Boolean)
  : [];
const entries = [];
for (const l of lines) {
  try {
    entries.push(JSON.parse(l));
  } catch {
    // skip malformed line
  }
}

const reasons = [];

// 0. Did the runner execute anything since the tick started? (`--since <activity line count>`
//    taken before the tick.) An approve-only tick leaves no ledger entry at all, so the ledger
//    alone would call it settled while the swap it prepared is still owed.
const sinceArg = process.argv.indexOf("--since");
if (sinceArg !== -1) {
  const since = Number(process.argv[sinceArg + 1] ?? 0);
  const activityPath = path.join(process.cwd(), ".sail", "activity.jsonl");
  const activity = fs.existsSync(activityPath)
    ? fs.readFileSync(activityPath, "utf-8").split("\n").filter(Boolean)
    : [];
  const fresh = activity
    .slice(since)
    .filter((l) => /"type":"dispatch_(executed|approved|reverted|denied)"/.test(l));
  if (fresh.length > 0) reasons.push(`${fresh.length} dispatch(es) this tick`);
}

// 1. Did the last tick dispatch anything? The runtime appends `skipped` only when it returned
//    zero dispatches, and it is the last thing a quiet tick writes.
const last = entries[entries.length - 1];
if (!last) reasons.push("no ledger yet");
else if (last.kind !== "skipped" && last.kind !== "reported")
  reasons.push(`last tick dispatched (${last.kind})`);
// (`reported` can also be the last line after a manual `scripts/send-report.ts` run — not a dispatch.)

// 2. Any bridge burned but not yet minted? (`bridged` newer than the latest `minted` for its dest)
const mintedTs = new Map();
for (const e of entries) {
  if (e.kind === "minted" && e.dest !== undefined)
    mintedTs.set(e.dest, Math.max(mintedTs.get(e.dest) ?? 0, e.ts ?? 0));
}
for (const e of entries) {
  if (e.kind === "bridged" && (e.ts ?? 0) > (mintedTs.get(e.dest) ?? 0)) {
    reasons.push(`bridge of ${Number(e.amount) / 1e6} USDC to chain ${e.dest} not minted yet`);
  }
}

// 3. Any swap intent not yet confirmed or failed?
const resolved = new Set(
  entries.filter((e) => ["bought", "sold", "tradeFailed"].includes(e.kind)).map((e) => e.id),
);
for (const e of entries) {
  if (e.kind === "trade" && e.id && !resolved.has(e.id))
    reasons.push(`${e.side} ${e.symbol} awaiting confirmation`);
}

if (reasons.length === 0) {
  console.log("settled");
  process.exit(0);
}
console.log(`pending: ${reasons.join("; ")}`);
process.exit(1);
