#!/usr/bin/env node
// settled.mjs — is the portfolio settled after the last tick?
//
// "Settled" means the last tick emitted no dispatches AND nothing is in flight: no CCTP
// burn still waiting for its mint, no Across deposit still waiting for its fill (or refund),
// and no swap or bridge intent still waiting for the runner's confirmation. A tick that says
// "nothing actionable" while a bridge is mid-flight is NOT settled — the buy on the
// destination chain is still owed.
//
// Prints "settled" (exit 0) or "pending: <why>" (exit 1). Read-only.
//
// The decision is `settledReasons(entries, activityLines)`, exported so it can be tested
// without a project on disk; the CLI below only reads the files and prints the verdict.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Why the portfolio is not settled, as human-readable reasons. Empty means settled.
 *
 * @param {Record<string, unknown>[]} entries   ledger entries, oldest first
 * @param {string[]} activityLines              raw .sail/activity.jsonl lines written since the tick started
 * @returns {string[]}
 */
export function settledReasons(entries, activityLines = []) {
  const reasons = [];

  // 0. Did the runner execute anything since the tick started? An approve-only tick leaves no
  //    ledger entry at all, so the ledger alone would call it settled while the swap it
  //    prepared is still owed.
  const fresh = activityLines.filter((l) =>
    /"type":"dispatch_(executed|approved|reverted|denied)"/.test(l),
  );
  if (fresh.length > 0) reasons.push(`${fresh.length} dispatch(es) this tick`);

  // 1. Did the last tick dispatch anything? The runtime appends `skipped` only when it returned
  //    zero dispatches, and it is the last thing a quiet tick writes. (`reported` is the
  //    cadence report's baseline entry, written after the snapshot on a tick that may also
  //    have been quiet — not a dispatch.)
  const last = entries[entries.length - 1];
  if (!last) reasons.push("no ledger yet");
  else if (last.kind !== "skipped" && last.kind !== "reported")
    reasons.push(`last tick dispatched (${last.kind})`);

  // 2. Any bridge that left the source chain and has not arrived (or been refunded)? Mirrors
  //    the runtime's `unsettledBridges`: a confirmed `bridged` entry settles when a `minted`
  //    (CCTP), `filled` (Across) or `bridgeRefunded` (Across, expired) entry carries its
  //    txHash. Legacy CCTP entries without a txHash settle by the latest `minted` timestamp
  //    for their destination. An Across deposit is in flight until filled or refunded, never
  //    by timestamp — a CCTP mint to the same chain says nothing about it.
  const settledTx = new Set();
  const mintedTs = new Map();
  for (const e of entries) {
    if (e.kind !== "minted" && e.kind !== "filled" && e.kind !== "bridgeRefunded") continue;
    const tx = String(e.txHash ?? "").toLowerCase();
    if (tx) settledTx.add(tx);
    if (e.kind === "minted" && e.dest !== undefined)
      mintedTs.set(e.dest, Math.max(mintedTs.get(e.dest) ?? 0, e.ts ?? 0));
  }
  for (const e of entries) {
    if (e.kind !== "bridged") continue;
    const tx = String(e.txHash ?? "").toLowerCase();
    if (tx && settledTx.has(tx)) continue;
    const usd = Number(e.amount) / 1e6;
    if (e.via === "across") {
      reasons.push(`across deposit of ${usd} to chain ${e.dest} not filled yet`);
      continue;
    }
    if (tx || (e.ts ?? 0) > (mintedTs.get(e.dest) ?? 0))
      reasons.push(`bridge of ${usd} USDC to chain ${e.dest} not minted yet`);
  }

  // 3. Any swap or bridge intent not yet confirmed or failed? (`trade` → bought/sold/tradeFailed,
  //    `bridge` → bridged/bridgeFailed, matched by id.)
  const resolved = new Set(
    entries
      .filter((e) => ["bought", "sold", "tradeFailed", "bridged", "bridgeFailed"].includes(e.kind))
      .map((e) => e.id),
  );
  for (const e of entries) {
    if (!e.id || resolved.has(e.id)) continue;
    if (e.kind === "trade") reasons.push(`${e.side} ${e.symbol} awaiting confirmation`);
    else if (e.kind === "bridge") reasons.push(`bridge to chain ${e.dest} awaiting confirmation`);
  }

  return reasons;
}

function readJsonl(file) {
  const lines = fs.existsSync(file)
    ? fs.readFileSync(file, "utf-8").split("\n").filter(Boolean)
    : [];
  const out = [];
  for (const l of lines) {
    try {
      out.push(JSON.parse(l));
    } catch {
      // skip malformed line
    }
  }
  return { lines, entries: out };
}

function main() {
  const { entries } = readJsonl(path.join(process.cwd(), ".sail", "memory", "ledger.jsonl"));

  // `--since <activity line count>` (taken before the tick) selects the runner's fresh outcomes.
  let activityLines = [];
  const sinceArg = process.argv.indexOf("--since");
  if (sinceArg !== -1) {
    const since = Number(process.argv[sinceArg + 1] ?? 0);
    activityLines = readJsonl(path.join(process.cwd(), ".sail", "activity.jsonl")).lines.slice(
      since,
    );
  }

  const reasons = settledReasons(entries, activityLines);
  if (reasons.length === 0) {
    console.log("settled");
    process.exit(0);
  }
  console.log(`pending: ${reasons.join("; ")}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
