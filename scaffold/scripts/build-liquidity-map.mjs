#!/usr/bin/env node
// build-liquidity-map.mjs — offline generator for scripts/liquidity-map.json.
//
// Resolve a curated seed of token symbols to their canonical contract address on each
// of Sail's 10 live chains, plus whether a Sail-routable USDC pool exists and how deep
// it is. Writes the result as a compact map that resolve-token.mjs reads FIRST (instant
// answers for the top assets) before falling back to a live DexScreener/GeckoTerminal
// lookup for the long tail.
//
//   node scripts/build-liquidity-map.mjs                 # rebuild the whole seed
//   node scripts/build-liquidity-map.mjs --out path.json # custom output path
//   node scripts/build-liquidity-map.mjs --symbols USDC,UNI,LINK  # override the seed
//
// Free + keyless: DexScreener only (no API keys). Addresses are DexScreener-derived and
// NOT on-chain verified — resolve-token.mjs re-verifies on-chain whenever an RPC is set.
// Run this on a schedule (offline) to refresh the map; the agent never waits on it.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = resolvePath(dirname(fileURLToPath(import.meta.url)));

const DEX_API = "https://api.dexscreener.com";
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

// Sail chain name → DexScreener chain id. Matches resolve-token.mjs's CHAINS `dex` field.
// The two Sail testnets are omitted: they carry no real DEX liquidity.
const CHAINS = {
  ethereum: "ethereum",
  base: "base",
  arbitrum: "arbitrum",
  optimism: "optimism",
  unichain: "unichain",
  bsc: "bsc",
  worldchain: "worldchain",
  hyperevm: "hyperevm",
  megaeth: "megaeth",
  robinhood: "robinhood",
};

// Seed: top assets by circulating market cap that actually trade on Sail's chains, with
// their well-known decimals (stable public knowledge; NOT on-chain verified here). The
// map stores these so the no-RPC path has a usable decimals fallback; resolve-token.mjs
// overrides with on-chain decimals() whenever an RPC is present.
const SEED = {
  USDC: 6,
  USDT: 6,
  DAI: 18,
  WBTC: 8,
  cbBTC: 8,
  WETH: 18,
  SOL: 9,
  WBNB: 18,
  UNI: 18,
  LINK: 18,
  AAVE: 18,
  ARB: 18,
  OP: 18,
  MKR: 18,
  LDO: 18,
  CRV: 18,
  SNX: 18,
  COMP: 18,
  GRT: 18,
  AERO: 18,
  MORPHO: 18,
  ENA: 18,
  ONDO: 18,
  EIGEN: 18,
  LAYER: 18,
  JUP: 6,
  TIA: 6,
  SEI: 6,
  INJ: 18,
  PEPE: 18,
  SHIB: 18,
  WIF: 6,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = new Map();
let lastTs = 0;
let spacing = 400;

async function dexGet(url) {
  if (cache.has(url)) return cache.get(url);
  const since = Date.now() - lastTs;
  if (since < spacing) await sleep(spacing - since);
  lastTs = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "sailor-build-liquidity-map" },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 429) {
        spacing = Math.min(spacing * 2, 5000);
        await sleep(spacing);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      cache.set(url, json);
      spacing = Math.max(spacing * 0.9, 400);
      return json;
    } catch (e) {
      await sleep(1500);
    }
  }
  return null;
}

// Mirror resolve-token.mjs classifyDex's routable decision: the shared SwapPermission's
// `routers[]` allowlist is DEX-agnostic, so Uniswap V2/V3, SushiSwap, PancakeSwap,
// Aerodrome and Velodrome are all routable; Uniswap V4 is Unichain-only.
function isRoutableDex(dexId, labels, chainName) {
  const id = (dexId || "").toLowerCase();
  const tags = new Set((labels || []).map((l) => String(l).toLowerCase()));
  if (id === "uniswap" || id.startsWith("uniswap-v") || id.startsWith("uniswap_v")) {
    if (tags.has("v4") || id.includes("v4")) return chainName === "unichain";
    return true; // V2, V3, or bare "uniswap" (V3) — all routable
  }
  return id.includes("sushiswap") || id.includes("pancakeswap") || id.includes("aerodrome") || id.includes("velodrome");
}

// The canonical protocol family string for a dexId (mirrors classifyDex). Used to record
// WHICH routable DEX a token's USDC pool lives on, so the map doesn't mislabel an
// Aerodrome pool as "uniswap-v3".
function dexFamily(dexId, labels) {
  const id = (dexId || "").toLowerCase();
  const tags = new Set((labels || []).map((l) => String(l).toLowerCase()));
  if (id === "uniswap" || id.startsWith("uniswap-v") || id.startsWith("uniswap_v")) {
    if (tags.has("v2") || id.includes("v2")) return "uniswap-v2";
    if (tags.has("v4") || id.includes("v4")) return "uniswap-v4";
    return "uniswap-v3";
  }
  if (id.includes("sushiswap")) return "sushiswap";
  if (id.includes("pancakeswap")) return "pancakeswap";
  if (id.includes("aerodrome")) return "aerodrome";
  if (id.includes("velodrome")) return "velodrome";
  return "other";
}

// Discover the canonical address + whether a Sail-routable USDC pool exists for
// `symbol` on one Sail chain. Returns { address, routable, liquidityUsd } or null when
// the symbol has no pool there. Two passes:
//   1. search → canonical address (deepest matching pool)
//   2. token-pairs/{chain}/{addr} → reliable USDC-routable check (search caps at ~30
//      pairs and routinely misses the USDC pool, so we can't trust it for routability).
async function resolveOneChain(symbolUp, chainName, chainId) {
  const search = await dexGet(`${DEX_API}/latest/dex/search?q=${encodeURIComponent(symbolUp)}`);
  const pairs = (search && Array.isArray(search.pairs) && search.pairs) || [];

  let bestAddr = null;
  let bestLiq = -1;
  for (const p of pairs) {
    if ((p.chainId || "").toLowerCase() !== chainId) continue;
    const base = p.baseToken || {};
    const quote = p.quoteToken || {};
    const liq = Number((p.liquidity && p.liquidity.usd) || 0);
    if ((base.symbol || "").toUpperCase() === symbolUp && ADDR_RE.test(base.address || "") && liq > bestLiq) {
      bestLiq = liq;
      bestAddr = base.address.toLowerCase();
    }
    if ((quote.symbol || "").toUpperCase() === symbolUp && ADDR_RE.test(quote.address || "") && liq > bestLiq) {
      bestLiq = liq;
      bestAddr = quote.address.toLowerCase();
    }
  }
  if (!bestAddr) return null;

  // Reliable venue check: full pair list for this address on this chain.
  const tp = await dexGet(`${DEX_API}/token-pairs/v1/${chainId}/${bestAddr}`);
  const all = (tp && Array.isArray(tp) && tp) || [];
  let routable = false;
  let routableDex = null;
  let bestUsdcLiq = 0;
  for (const p of all) {
    const baseSym = ((p.baseToken || {}).symbol || "").toUpperCase();
    const quoteSym = ((p.quoteToken || {}).symbol || "").toUpperCase();
    const isUsdcPair = baseSym === "USDC" || baseSym === "USDC.E" || quoteSym === "USDC" || quoteSym === "USDC.E";
    const dexId = (p.dexId || "").toLowerCase();
    if (isUsdcPair && isRoutableDex(dexId, p.labels, chainName)) {
      const liq = Number((p.liquidity && p.liquidity.usd) || 0);
      if (liq > bestUsdcLiq) {
        bestUsdcLiq = liq;
        routable = true;
        routableDex = dexFamily(dexId, p.labels);
      }
    }
  }

  return { address: bestAddr, routable, liquidityUsd: Math.round(bestUsdcLiq || bestLiq), dex: routable ? routableDex : null };
}

async function main() {
  const args = process.argv.slice(2);
  let outPath = resolvePath(SCRIPT_DIR, "liquidity-map.json");
  let seed = SEED;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") outPath = resolvePath(args[++i]);
    else if (args[i] === "--seed") {
      // A JSON file of { "SYMBOL": decimals } — e.g. a top-N-by-market-cap list built
      // offline. Overrides the built-in SEED.
      const raw = JSON.parse(readFileSync(resolvePath(args[++i]), "utf8"));
      seed = {};
      const entries = Array.isArray(raw) ? raw.map((s) => [String(s), null]) : Object.entries(raw);
      for (const [k, v] of entries) {
        const sym = k.toUpperCase().trim();
        if (sym) seed[sym] = typeof v === "number" ? v : (SEED[sym] ?? 18);
      }
    } else if (args[i] === "--symbols") {
      seed = {};
      for (const s of args[++i].split(",")) {
        const sym = s.trim().toUpperCase();
        if (sym) seed[sym] = SEED[sym] ?? 18; // unknown → assume 18 (most ERC20s)
      }
    }
  }

  const symbols = Object.keys(seed);
  const tokens = {};
  const chainNames = Object.keys(CHAINS);

  process.stderr.write(
    `Building liquidity map for ${symbols.length} symbol(s) across ${chainNames.length} Sail chain(s)…\n`,
  );
  for (const sym of symbols) {
    tokens[sym] = {};
    for (const name of chainNames) {
      try {
        const r = await resolveOneChain(sym, name, CHAINS[name]);
        if (r) tokens[sym][name] = { address: r.address, decimals: seed[sym], routable: r.routable, liquidityUsd: r.liquidityUsd, dex: r.dex };
      } catch {
        // symbol not on this chain — leave it absent
      }
    }
    const n = Object.keys(tokens[sym]).length;
    process.stderr.write(`  ${sym}: ${n} chain(s)${n ? ` — ${Object.keys(tokens[sym]).join(", ")}` : ""}\n`);
  }

  const map = {
    version: 2,
    generatedAt: new Date().toISOString(),
    source: "DexScreener (keyless). Addresses/decimals are NOT on-chain verified — resolve-token.mjs re-verifies on-chain when an RPC is set. `dex` is the DEX family of the deepest routable USDC pool.",
    chains: chainNames,
    tokens,
  };

  writeFileSync(outPath, JSON.stringify(map, null, 2) + "\n");
  process.stderr.write(`\nWrote ${outPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`\nbuild-liquidity-map failed: ${err && err.message ? err.message : err}\n`);
  process.exit(1);
});
