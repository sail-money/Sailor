#!/usr/bin/env node
// build-top-assets-seed.mjs — offline helper: pull the top-N coins by market cap from
// CoinGecko's free ranking endpoint and write a seed file for build-liquidity-map.mjs.
//
//   node scripts/build-top-assets-seed.mjs                  # top 500 → scripts/top-assets-seed.json
//   node scripts/build-top-assets-seed.mjs --count 1000     # bigger seed
//   node scripts/build-top-assets-seed.mjs --out path.json
//
// CoinGecko is used ONLY here, offline, to build the seed list — never at resolve time.
// The shipped liquidity map is a static JSON; the runtime stays keyless. Re-run this on a
// schedule to refresh the seed, then re-run build-liquidity-map.mjs --seed <file>.

import { writeFileSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = resolvePath(dirname(fileURLToPath(import.meta.url)));
const CG = "https://api.coingecko.com/api/v3/coins/markets";

// Wrapped-native mapping: a user names the canonical asset; the contract on Sail's chains
// has a different ticker. Expand these so the seed carries the CONTRACT symbols the map
// actually resolves. (BTC on Ethereum/Arbitrum = WBTC, on Base = cbBTC, on BSC = BTCB.)
const CANONICAL_EXPAND = {
  BTC: ["WBTC", "cbBTC", "BTCB"],
  ETH: ["WETH"],
  BNB: ["WBNB"],
  MATIC: ["POL"],
};

// Known non-18 decimal contracts (provisional; on-chain verify overrides at resolve time).
const DECIMALS = {
  USDC: 6,
  USDT: 6,
  PYUSD: 6,
  FDUSD: 6,
  USDD: 6,
  GUSD: 2,
  WBTC: 8,
  cbBTC: 8,
  BTCB: 8,
  renBTC: 8,
  tBTC: 8,
};

const DEFAULT_DECIMALS = 18;

async function fetchTopCoins(count) {
  const perPage = 250;
  const pages = Math.ceil(count / perPage);
  const coins = [];
  for (let p = 1; p <= pages; p++) {
    const url = `${CG}?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=${p}`;
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "sailor-top-assets-seed" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    coins.push(...(await res.json()));
    await new Promise((r) => setTimeout(r, 1500)); // respect the free tier
  }
  return coins.slice(0, count);
}

async function main() {
  const args = process.argv.slice(2);
  let count = 500;
  let outPath = resolvePath(SCRIPT_DIR, "top-assets-seed.json");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--count") count = Number(args[++i]);
    else if (args[i] === "--out") outPath = resolvePath(args[++i]);
  }

  const coins = await fetchTopCoins(count);
  const seed = {};
  for (const c of coins) {
    const sym = (c.symbol || "").toUpperCase();
    const expanded = CANONICAL_EXPAND[sym] || [sym];
    for (const cs of expanded) {
      seed[cs] = DECIMALS[cs] ?? DEFAULT_DECIMALS;
    }
  }

  writeFileSync(outPath, JSON.stringify(seed, null, 2) + "\n");
  process.stderr.write(`Wrote ${Object.keys(seed).length} contract symbol(s) from top ${count} coins → ${outPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`\nbuild-top-assets-seed failed: ${err && err.message ? err.message : err}\n`);
  process.exit(1);
});
