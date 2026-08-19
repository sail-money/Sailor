#!/usr/bin/env node
// build-top-assets-seed.mjs — offline helper: pull the top-N coins by market cap from
// CoinGecko's free ranking endpoint, then fetch each coin's per-chain contract addresses +
// decimals, and write a seed file for build-liquidity-map.mjs.
//
//   node scripts/build-top-assets-seed.mjs                  # top 500 → scripts/top-assets-seed.json
//   node scripts/build-top-assets-seed.mjs --count 1000
//   node scripts/build-top-assets-seed.mjs --out path.json
//
// CoinGecko is used ONLY here, offline, to build the seed list — never at resolve time.
// The shipped liquidity map is a static JSON; the runtime stays keyless. Re-run this on a
// schedule to refresh the seed, then re-run build-liquidity-map.mjs --seed <file>.

import { writeFileSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = resolvePath(dirname(fileURLToPath(import.meta.url)));
const CG = "https://api.coingecko.com/api/v3";

// CoinGecko platform key → Sail chain name. Only these chains land in the seed; the rest
// are discovered by build-liquidity-map.mjs via DexScreener search as a fallback.
const CG_TO_SAIL = {
  ethereum: "ethereum",
  base: "base",
  "arbitrum-one": "arbitrum",
  "optimistic-ethereum": "optimism",
  "binance-smart-chain": "bsc",
  unichain: "unichain",
  "world-chain": "worldchain",
  hyperliquid: "hyperevm",
  megaeth: "megaeth",
  robinhood: "robinhood",
};

const DEFAULT_DECIMALS = 18;

// Optional free CoinGecko demo key (https://www.coingecko.com/en/api/pricing). Without it
// the public tier rate-limits /coins/{id} to ~5-10 req/min, so a 500-token seed takes ~2h
// and skips coins on 429s. With a free key (~30 req/min) the same build takes ~20 min.
// This key is OFFLINE-ONLY, held by the team; the runtime never touches CoinGecko.
const CG_KEY = process.env.CG_KEY || "";

async function cgGet(path) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${CG}${path}${CG_KEY ? `${sep}x_cg_demo_api_key=${CG_KEY}` : ""}`;
  const headers = { accept: "application/json", "user-agent": "sailor-top-assets-seed" };
  if (CG_KEY) headers["x-cg-demo-api-key"] = CG_KEY;
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 429) throw new Error("CoinGecko 429 (rate-limited) — set CG_KEY for a faster build");
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status} for ${path}`);
  return res.json();
}

async function fetchTopCoins(count) {
  const perPage = 250;
  const pages = Math.ceil(count / perPage);
  const coins = [];
  for (let p = 1; p <= pages; p++) {
    const batch = await cgGet(`/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=${p}`);
    coins.push(...batch);
    await new Promise((r) => setTimeout(r, 1500));
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

  for (let i = 0; i < coins.length; i++) {
    const c = coins[i];
    const sym = (c.symbol || "").toUpperCase();
    let detail;
    try {
      detail = await cgGet(`/coins/${c.id}`);
    } catch {
      // rate-limited or missing — skip this coin, the resolver falls back to live discovery
      await new Promise((r) => setTimeout(r, 4000));
      continue;
    }
    const platforms = detail.platforms || {};
    const detailPlatforms = detail.detail_platforms || {};
    const entry = {};
    for (const [cgKey, addr] of Object.entries(platforms)) {
      const sail = CG_TO_SAIL[cgKey];
      if (!sail || typeof addr !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(addr)) continue;
      const dec = detailPlatforms[cgKey]?.decimal_place ?? DEFAULT_DECIMALS;
      entry[sail] = { address: addr.toLowerCase(), decimals: dec };
    }
    if (Object.keys(entry).length > 0) {
      seed[sym] = entry;
    }
    process.stderr.write(`  ${sym}: ${Object.keys(entry).length} Sail chain(s)\n`);
    await new Promise((r) => setTimeout(r, 1600)); // respect the free tier (~30 req/min)
  }

  writeFileSync(outPath, JSON.stringify(seed, null, 2) + "\n");
  process.stderr.write(`Wrote ${Object.keys(seed).length} contract symbol(s) with per-chain addresses → ${outPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`\nbuild-top-assets-seed failed: ${err && err.message ? err.message : err}\n`);
  process.exit(1);
});
