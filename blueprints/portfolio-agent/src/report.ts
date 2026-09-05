/**
 * Portfolio agent — report composer, flow decomposition, and snapshot writer.
 *
 * The runtime writes a portfolio snapshot to .sail/state/snapshot.json every
 * tick; this module builds it, renders it as a three-state Telegram report, and
 * sends it. Everything here is either pure or side-effect-light, so the report
 * and the dashboard share one valuation with no dependency on the tick loop.
 *
 * The report answers three questions, in a fixed order:
 *   1. Am I okay?
 *   2. What happened?
 *   3. Do I need to do anything?
 *
 * Five beats, top to bottom: verdict → score → what the agent did → allocation →
 * action. Only the first three change by state (deposit / withdrawal / normal).
 */

import fs from "node:fs";
import path from "node:path";

const USD_DECIMALS = 6;
const USD_ONE = 10n ** BigInt(USD_DECIMALS);
const BPS = 10_000n;
/** One dollar in 6-decimal base units — the dust floor for "something external moved". */
const ONE_DOLLAR = USD_ONE;

export type HoldingStatus = "in-band" | "buy" | "sell";

export type Holding = {
  symbol: string;
  value: bigint; // USDC base units (6 decimals)
  weightBps: bigint; // 0..10000, share of the invested holdings
  targetBps: bigint; // 0..10000
  status: HoldingStatus;
  /** Signed drift: weight − target, in basis points. Negative = under target. */
  driftBps: bigint;
};

export type PortfolioSnapshot = {
  totalValue: bigint; // invested holdings + idle USDC + in-flight bridge USDC
  investedValue: bigint; // token holdings only
  idleUsdc: bigint; // uninvested USDC across all chains
  pendingBridgeUsdc: bigint; // USDC burned on a source chain, not yet minted on its destination
  costBasis: bigint | null; // null until cost-basis tracking lands
  asOf?: number; // block timestamp the snapshot was taken
  holdings: Holding[];
};

/** Classify a holding against its target band: sell if above, buy if below, else in band. */
export function statusFor(weightBps: bigint, targetBps: bigint, bandBps: bigint): HoldingStatus {
  if (weightBps > targetBps + bandBps) return "sell";
  if (weightBps < targetBps - bandBps) return "buy";
  return "in-band";
}

/** Format a USDC base-unit amount (6 decimals) as a dollar string, e.g. $109.32. */
export function formatUsd(amount: bigint): string {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const whole = abs / USD_ONE;
  const frac = (abs % USD_ONE).toString().padStart(USD_DECIMALS, "0").slice(0, 2);
  return `${neg ? "-" : ""}$${whole}.${frac}`;
}

/** A signed dollar string for a change figure: +$X or −$X (Unicode minus, never a dash). */
function signedUsd(amount: bigint): string {
  return amount < 0n ? `−${formatUsd(-amount)}` : `+${formatUsd(amount)}`;
}

function formatPct(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(1)}%`;
}

/** True when `periodSec` has elapsed since `lastSec`. periodSec <= 0 means "every run". */
export function shouldRun(nowSec: number, lastSec: number, periodSec: number): boolean {
  if (periodSec <= 0) return true;
  return nowSec - lastSec >= periodSec;
}

/**
 * Build the display snapshot from the runtime's already-computed valuation.
 * Weights are the share of the invested holdings (they sum to ~100%); idle USDC
 * is reported separately as a reserve, and in-flight bridge USDC is counted in
 * total value (it is the user's money, just not yet visible on either chain),
 * matching the dashboard.
 */
export function buildSnapshot(opts: {
  usdcTotal: bigint;
  holdings: { symbol: string; value: bigint; targetBps: bigint }[];
  bandBps: number;
  costBasis?: bigint | null;
  pendingBridgeUsdc?: bigint;
  asOf?: number;
}): PortfolioSnapshot {
  const investedValue = opts.holdings.reduce((a, h) => a + h.value, 0n);
  const pendingBridgeUsdc = opts.pendingBridgeUsdc ?? 0n;
  const band = BigInt(opts.bandBps);
  const holdings: Holding[] = opts.holdings.map((h) => {
    const weightBps = investedValue === 0n ? 0n : (h.value * BPS) / investedValue;
    return {
      symbol: h.symbol,
      value: h.value,
      weightBps,
      targetBps: h.targetBps,
      status: statusFor(weightBps, h.targetBps, band),
      driftBps: weightBps - h.targetBps,
    };
  });
  return {
    totalValue: opts.usdcTotal + investedValue + pendingBridgeUsdc,
    investedValue,
    idleUsdc: opts.usdcTotal,
    pendingBridgeUsdc,
    costBasis: opts.costBasis ?? null,
    asOf: opts.asOf,
    holdings,
  };
}

// ── Persistence (.sail/state/snapshot.json) ──────────────────────────────────

type HoldingJson = {
  symbol: string;
  value: string;
  weightBps: string;
  targetBps: string;
  status: HoldingStatus;
  driftBps: string;
};

type SnapshotJson = {
  totalValue: string;
  investedValue: string;
  idleUsdc: string;
  pendingBridgeUsdc: string;
  costBasis: string | null;
  asOf?: number;
  holdings: HoldingJson[];
};

function toJson(s: PortfolioSnapshot): SnapshotJson {
  return {
    totalValue: s.totalValue.toString(),
    investedValue: s.investedValue.toString(),
    idleUsdc: s.idleUsdc.toString(),
    pendingBridgeUsdc: s.pendingBridgeUsdc.toString(),
    costBasis: s.costBasis === null ? null : s.costBasis.toString(),
    asOf: s.asOf,
    holdings: s.holdings.map((h) => ({
      symbol: h.symbol,
      value: h.value.toString(),
      weightBps: h.weightBps.toString(),
      targetBps: h.targetBps.toString(),
      status: h.status,
      driftBps: h.driftBps.toString(),
    })),
  };
}

/** Write the snapshot to .sail/state/snapshot.json (bigints as decimal strings). */
export function writeSnapshot(s: PortfolioSnapshot): void {
  const dir = path.join(process.cwd(), ".sail", "state");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "snapshot.json"), `${JSON.stringify(toJson(s))}\n`);
}

// ── Report context: flow decomposition from the ledger ────────────────────────

/** A confirmed trade since the last report, aggregated by symbol. */
export type ReportAction = { symbol: string; side: "bought" | "sold"; amount: bigint };

/** The snapshot values persisted with the previous `reported` entry. */
export type ReportBaseline = {
  totalValue: bigint;
  investedValue: bigint;
  costBasis: bigint;
  idleUsdc: bigint;
};

/**
 * Reconstruct the previous report's baseline and the confirmed trades since it.
 *
 * `costBasis + idleUsdc` is invariant to the agent's own trading — a buy moves
 * USDC from idle into costBasis and the sum is unchanged. Its week-over-week
 * change is therefore pure external flow (deposits − withdrawals). The baseline
 * here is what lets `composeReport` split a deposit from a price move.
 */
export function buildReportContext(lines: string[]): {
  baseline: ReportBaseline | null;
  actions: ReportAction[];
} {
  let lastReportTs = -1;
  let baseline: ReportBaseline | null = null;

  for (const line of lines) {
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (e.kind === "reported") {
      const ts = Number(e.ts ?? 0);
      if (ts >= lastReportTs) {
        lastReportTs = ts;
        baseline = {
          totalValue: BigInt(String(e.totalValue ?? "0")),
          investedValue: BigInt(String(e.investedValue ?? "0")),
          costBasis: BigInt(String(e.costBasis ?? "0")),
          idleUsdc: BigInt(String(e.idleUsdc ?? "0")),
        };
      }
    }
  }

  const actions: ReportAction[] = [];
  for (const line of lines) {
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if ((e.kind === "bought" || e.kind === "sold") && Number(e.ts ?? 0) > lastReportTs) {
      actions.push({
        symbol: String(e.symbol ?? ""),
        side: e.kind,
        amount: BigInt(String(e.amount ?? "0")),
      });
    }
  }
  return { baseline, actions };
}

// ── Report rendering and delivery ────────────────────────────────────────────

const STATUS_EMOJI: Record<HoldingStatus, string> = {
  "in-band": "🟢",
  buy: "🟡",
  sell: "🔴",
};

/** A 20-cell progress bar: filled `█` for the actual weight, a `▏` tick at the target. */
function progressBar(weightBps: bigint, targetBps: bigint): string {
  const N = 20;
  const w = Math.max(0, Math.min(N, Math.round((Number(weightBps) / 10_000) * N)));
  const t = Math.max(0, Math.min(N - 1, Math.round((Number(targetBps) / 10_000) * N)));
  let bar = "";
  for (let i = 0; i < N; i++) {
    if (i < w) bar += "█";
    else if (i === t) bar += "▏";
    else bar += "░";
  }
  return bar;
}

/**
 * Compose the three-state Telegram report (HTML). The skeleton is fixed — only the
 * verdict, score breakdown, and "what the agent did" change by state.
 */
export function composeReport(
  s: PortfolioSnapshot,
  opts: { baseline?: ReportBaseline | null; actions?: ReportAction[]; asOf?: string } = {},
): string {
  const baseline = opts.baseline ?? null;
  const actions = opts.actions ?? [];
  const lines: string[] = [];

  // Beat 1 — verdict, and Beat 2 — score + change breakdown. These are the only
  // two that change by state; everything below them is identical in every state.
  let verdict: string;
  let score: string;
  if (!baseline) {
    // First report: no prior snapshot to decompose against.
    verdict = s.investedValue === 0n
      ? "Your portfolio is live and waiting for its first deposit."
      : "Your portfolio is live and invested.";
    score = `Portfolio value <b>${formatUsd(s.totalValue)}</b>`;
  } else {
    const costBasis = s.costBasis ?? baseline.costBasis;
    const marketChange = (s.investedValue - baseline.investedValue) - (costBasis - baseline.costBasis);
    const netFlow = (s.totalValue - baseline.totalValue) - marketChange;
    const totalChange = s.totalValue - baseline.totalValue;

    if (netFlow >= ONE_DOLLAR) {
      verdict = `<b>${formatUsd(netFlow)} received and invested.</b>`;
      score = `<b>${formatUsd(s.totalValue)}</b>\n${formatUsd(netFlow)} deposited · ${signedUsd(marketChange)} market`;
    } else if (netFlow <= -ONE_DOLLAR) {
      verdict = `<b>${formatUsd(-netFlow)} withdrawn. Everything still on track.</b>`;
      score = `<b>${formatUsd(s.totalValue)}</b>\n${formatUsd(-netFlow)} withdrawn · ${signedUsd(marketChange)} market`;
    } else {
      verdict = "<b>Everything is on track. Nothing needs you.</b>";
      score = `<b>${formatUsd(s.totalValue)}</b>\n${signedUsd(totalChange)} this week`;
    }
  }
  lines.push(verdict);
  lines.push("");
  lines.push(score);
  lines.push("");

  // Beat 3 — what the agent did since the last report.
  lines.push("<b>What I did</b>");
  if (actions.length === 0) {
    lines.push("No trades this week.");
  } else {
    const bySymbol = new Map<string, { bought: bigint; sold: bigint }>();
    for (const a of actions) {
      const cur = bySymbol.get(a.symbol) ?? { bought: 0n, sold: 0n };
      cur[a.side] += a.amount;
      bySymbol.set(a.symbol, cur);
    }
    lines.push(
      [...bySymbol.entries()]
        .map(([symbol, v]) => {
          const parts: string[] = [];
          if (v.bought > 0n) parts.push(`bought ${formatUsd(v.bought)} of ${symbol}`);
          if (v.sold > 0n) parts.push(`sold ${formatUsd(v.sold)} of ${symbol}`);
          return parts.join(", ");
        })
        .join("\n"),
    );
  }
  lines.push("");

  // Beat 4 — allocation, one progress bar per holding.
  lines.push("<b>Allocation</b>");
  if (s.investedValue === 0n) {
    lines.push("Nothing invested yet. Your deposit is invested across the basket on the next run.");
  } else {
    for (const h of s.holdings) {
      const drift =
        h.status === "in-band" && (h.driftBps <= -100n || h.driftBps >= 100n)
          ? h.driftBps < 0n
            ? " · slightly under target"
            : " · slightly over target"
          : "";
      lines.push(
        `${STATUS_EMOJI[h.status]} ${h.symbol.padEnd(6)} ${progressBar(h.weightBps, h.targetBps)} ${formatPct(h.weightBps)} · target ${formatPct(h.targetBps)}${drift}`,
      );
    }
  }
  lines.push("");

  // Beat 5 — action, never a trailing-off.
  const buys = s.holdings.filter((h) => h.status === "buy").length;
  const sells = s.holdings.filter((h) => h.status === "sell").length;
  if (buys > 0 || sells > 0) {
    const parts: string[] = [];
    if (sells > 0) parts.push(`${sells} over target`);
    if (buys > 0) parts.push(`${buys} under target`);
    lines.push(`Rebalancing next: ${parts.join(", ")}.`);
  } else {
    lines.push("Nothing needs you.");
  }

  if (opts.asOf) lines.push("", `<i>${opts.asOf}</i>`);
  return lines.join("\n");
}

/** Send a Telegram message (HTML) via the Bot API. Reads TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID from env. */
export async function sendTelegramReport(html: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not set (see .sail/.env.local).");
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML" }),
  });
  if (!res.ok) {
    throw new Error(`Telegram send failed: ${res.status} ${await res.text()}`);
  }
}
