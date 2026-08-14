/**
 * Index agent — report composer and snapshot writer.
 *
 * The runtime writes a portfolio snapshot to .sail/state/snapshot.json every
 * tick; this module builds it, renders it as a human report for Telegram, and
 * sends it. Everything here is either pure or side-effect-light, so the report
 * and the dashboard share one valuation with no dependency on the tick loop.
 */

import fs from "node:fs";
import path from "node:path";

const USD_DECIMALS = 6;
const USD_ONE = 10n ** BigInt(USD_DECIMALS);
const BPS = 10_000n;

export type HoldingStatus = "in-band" | "buy" | "sell";

export type Holding = {
  symbol: string;
  value: bigint; // USDC base units (6 decimals)
  weightBps: bigint; // 0..10000, share of the invested holdings
  targetBps: bigint; // 0..10000
  status: HoldingStatus;
};

export type PortfolioSnapshot = {
  totalValue: bigint; // invested holdings + idle USDC
  investedValue: bigint; // token holdings only
  idleUsdc: bigint; // uninvested USDC across all chains
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
 * is reported separately as a reserve, matching the dashboard.
 */
export function buildSnapshot(opts: {
  usdcTotal: bigint;
  holdings: { symbol: string; value: bigint; targetBps: bigint }[];
  bandBps: number;
  costBasis?: bigint | null;
  asOf?: number;
}): PortfolioSnapshot {
  const investedValue = opts.holdings.reduce((a, h) => a + h.value, 0n);
  const band = BigInt(opts.bandBps);
  const holdings: Holding[] = opts.holdings.map((h) => {
    const weightBps = investedValue === 0n ? 0n : (h.value * BPS) / investedValue;
    return {
      symbol: h.symbol,
      value: h.value,
      weightBps,
      targetBps: h.targetBps,
      status: statusFor(weightBps, h.targetBps, band),
    };
  });
  return {
    totalValue: opts.usdcTotal + investedValue,
    investedValue,
    idleUsdc: opts.usdcTotal,
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
};

type SnapshotJson = {
  totalValue: string;
  investedValue: string;
  idleUsdc: string;
  costBasis: string | null;
  asOf?: number;
  holdings: HoldingJson[];
};

function toJson(s: PortfolioSnapshot): SnapshotJson {
  return {
    totalValue: s.totalValue.toString(),
    investedValue: s.investedValue.toString(),
    idleUsdc: s.idleUsdc.toString(),
    costBasis: s.costBasis === null ? null : s.costBasis.toString(),
    asOf: s.asOf,
    holdings: s.holdings.map((h) => ({
      symbol: h.symbol,
      value: h.value.toString(),
      weightBps: h.weightBps.toString(),
      targetBps: h.targetBps.toString(),
      status: h.status,
    })),
  };
}

/** Write the snapshot to .sail/state/snapshot.json (bigints as decimal strings). */
export function writeSnapshot(s: PortfolioSnapshot): void {
  const dir = path.join(process.cwd(), ".sail", "state");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "snapshot.json"), `${JSON.stringify(toJson(s))}\n`);
}

// ── Report rendering and delivery ────────────────────────────────────────────

const STATUS_LABEL: Record<HoldingStatus, string> = {
  "in-band": "in band",
  buy: "buy",
  sell: "sell",
};

/** Render a snapshot as a plain-text report body (Telegram/email). */
export function composeReport(
  s: PortfolioSnapshot,
  opts: { title?: string; asOf?: string } = {},
): string {
  const lines: string[] = [];
  lines.push(opts.title ?? "Your index");
  if (opts.asOf) lines.push(opts.asOf);
  lines.push("");
  lines.push(`Portfolio value   ${formatUsd(s.totalValue)}`);
  lines.push(`Holdings value    ${formatUsd(s.investedValue)}`);
  lines.push(`Idle USDC         ${formatUsd(s.idleUsdc)}`);
  if (s.costBasis !== null) {
    const pnl = s.investedValue - s.costBasis;
    const sign = pnl < 0n ? "" : "+";
    if (s.costBasis > 0n) {
      const pct = (Number(pnl) / Number(s.costBasis)) * 100;
      lines.push(`Unrealized        ${sign}${formatUsd(pnl)} (${sign}${pct.toFixed(2)}%)`);
    } else {
      lines.push(`Unrealized        ${sign}${formatUsd(pnl)}`);
    }
  }
  lines.push("");
  lines.push("Holdings vs target");
  if (s.investedValue === 0n) {
    lines.push("Nothing invested yet. Your deposit is invested across the basket on the next run.");
  } else {
    for (const h of s.holdings) {
      lines.push(
        `${h.symbol.padEnd(6)} ${formatPct(h.weightBps)} · target ${formatPct(h.targetBps)} · ${STATUS_LABEL[h.status]}`,
      );
    }
    const buys = s.holdings.filter((h) => h.status === "buy").length;
    const sells = s.holdings.filter((h) => h.status === "sell").length;
    if (buys === 0 && sells === 0) {
      lines.push("");
      lines.push("All holdings in band. Nothing to rebalance.");
    } else {
      const parts: string[] = [];
      if (sells > 0) parts.push(`${sells} over target (sell)`);
      if (buys > 0) parts.push(`${buys} under target (buy)`);
      lines.push("");
      lines.push(`Rebalance: ${parts.join(", ")}.`);
    }
  }
  return lines.join("\n");
}

/** Send a Telegram message via the Bot API. Reads TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID from env. */
export async function sendTelegramReport(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not set (see .sail/.env.local).");
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    throw new Error(`Telegram send failed: ${res.status} ${await res.text()}`);
  }
}
