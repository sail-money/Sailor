#!/usr/bin/env node
// build-liquidity-map.mjs — offline generator for scripts/liquidity-map.json.
//
// Builds a map of canonical token addresses (from the Uniswap default token list, a
// curated catalog of real contracts) plus, for each, whether a Sail-routable USDC pool
// exists, how deep it is, and whether it actually trades. Writes the result as a compact
// map that resolve-token.mjs reads FIRST (instant answers for the top assets) before
// falling back to a live, volume-ranked DexScreener/GeckoTerminal lookup for the long tail.
//
//   node scripts/build-top-assets-seed.mjs                 # FIRST: token list → top-assets-seed.json
//   node scripts/build-liquidity-map.mjs --seed top-assets-seed.json
//   node scripts/build-liquidity-map.mjs --seed top-assets-seed.json --out path.json
//
// Identity is NEVER derived from a DexScreener search. `--seed` must supply a trusted
// per-chain address for every symbol (from build-top-assets-seed.mjs); a symbol with no
// trusted address on a chain is simply left out. This is what keeps a planted look-alike
// (a copied ticker with fake liquidity) out of the map.
//
// Free + keyless: the Uniswap token list (offline, once) + DexScreener (keyless).
// Addresses are list-sourced and NOT on-chain verified — resolve-token.mjs re-verifies
// on-chain whenever an RPC is set. Run on a schedule (offline); the agent never waits.

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

// Two-hop intermediates per chain: liquid, settlement-routable assets (WETH/WBNB/USDT/
// WBTC/DAI). A token with no direct USDC pool but a Sail-routable pool against any of
// these is still swappable in TWO swaps (USDC → via → token). Matches resolve-token.mjs
// VIA_SYMBOLS. The map records WHICH via matched (hubSymbol), so the resolver can
// reconstruct the exact intermediate instead of assuming WETH.
const VIA_SYMBOLS = {
  ethereum: ["WETH", "USDT", "WBTC", "DAI"],
  base: ["WETH", "DAI"],
  arbitrum: ["WETH", "WBTC", "DAI"],
  optimism: ["WETH", "USDT", "WBTC", "DAI"],
  unichain: ["WETH", "USDT", "WBTC", "DAI"],
  bsc: ["WBNB", "USDT", "DAI"],
  worldchain: ["WETH", "WBTC"],
};

// Below this USD depth a two-hop (hub-paired) pool is dust and is not recorded as a
// route — matches resolve-token.mjs MIN_TWO_HOP_LIQUIDITY_USD.
const MIN_TWO_HOP_LIQUIDITY_USD = 10_000;

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

// Seed helpers. A seed entry is EITHER a bare number (legacy: the token's decimals) OR
// a per-chain map { chain: { address, decimals } } produced by build-top-assets-seed.mjs.
function seedAddress(seed, sym, chain) {
  const v = seed[sym];
  if (v && typeof v === "object" && v[chain] && v[chain].address) return v[chain].address;
  return null;
}
function seedDecimals(seed, sym, chain) {
  const v = seed[sym];
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    if (v[chain] && v[chain].decimals != null) return v[chain].decimals;
    const any = Object.values(v).find((x) => x && x.decimals != null);
    if (any) return any.decimals;
  }
  return 18;
}

// Discover the canonical address + whether a Sail-routable USDC pool exists for
// `symbol` on one Sail chain. `knownAddr` (from the seed) skips the search pass. Returns
// { address, routable, liquidityUsd, dex } or null when the symbol has no pool there.
// Discover, for a KNOWN address, whether a Sail-routable USDC pool exists on one Sail
// chain, how deep it is, and whether it actually trades. Returns
// { address, routable, liquidityUsd, dex, hubDex, hubLiquidityUsd, volume24hUsd } or null.
//
// Identity is NEVER guessed here. `knownAddr` (the canonical contract from the Uniswap
// default token list, via build-top-assets-seed.mjs) is REQUIRED.
// Asking DexScreener "what is the deepest pool called X?" is how a planted look-alike
// (a copied ticker with fake liquidity and zero volume) becomes the canonical address —
// the ZAMA/SKY bug class, which poisoned 378 committed entries. With no trusted address,
// the chain is left OUT of the map and the resolver falls back to a live, volume-ranked
// search instead.
async function resolveOneChain(symbolUp, chainName, chainId, knownAddr = null) {
  if (!knownAddr) return null;
  const bestAddr = knownAddr.toLowerCase();

  // Reliable venue check: full pair list for this KNOWN address on this chain.
  const tp = await dexGet(`${DEX_API}/token-pairs/v1/${chainId}/${bestAddr}`);
  const all = (tp && Array.isArray(tp) && tp) || [];
  let routable = false;
  let routableDex = null;
  let bestUsdcLiq = 0;
  // Max 24h volume across this token's pairs — the "it actually trades" signal the
  // resolver uses to trust the entry. A planted look-alike trades nothing.
  let bestVolume = 0;
  // Two-hop: a Sail-routable pool paired with a curated via asset (WETH/WBNB/USDT/WBTC/
  // DAI), used when there is no direct USDC pool. Recorded (with WHICH via matched) so
  // resolve-token.mjs can surface it as a two-swap route instead of "no pool".
  const vias = VIA_SYMBOLS[chainName] || [];
  let hubDex = null;
  let bestHubLiq = 0;
  let hubSymbol = null;
  for (const p of all) {
    const baseSym = ((p.baseToken || {}).symbol || "").toUpperCase();
    const quoteSym = ((p.quoteToken || {}).symbol || "").toUpperCase();
    const isUsdcPair = baseSym === "USDC" || baseSym === "USDC.E" || quoteSym === "USDC" || quoteSym === "USDC.E";
    const viaBase = vias.includes(baseSym);
    const viaQuote = vias.includes(quoteSym);
    const viaSym = viaBase ? baseSym : viaQuote ? quoteSym : null;
    const isViaPair = !!viaSym;
    const dexId = (p.dexId || "").toLowerCase();
    const vol = Number((p.volume && p.volume.h24) || 0);
    if (vol > bestVolume) bestVolume = vol;
    if (isUsdcPair && isRoutableDex(dexId, p.labels, chainName)) {
      const liq = Number((p.liquidity && p.liquidity.usd) || 0);
      if (liq > bestUsdcLiq) {
        bestUsdcLiq = liq;
        routable = true;
        routableDex = dexFamily(dexId, p.labels);
      }
    } else if (!routable && isViaPair && isRoutableDex(dexId, p.labels, chainName)) {
      const liq = Number((p.liquidity && p.liquidity.usd) || 0);
      if (liq > bestHubLiq && liq >= MIN_TWO_HOP_LIQUIDITY_USD) {
        bestHubLiq = liq;
        hubDex = dexFamily(dexId, p.labels);
        hubSymbol = viaSym;
      }
    }
  }

  return {
    address: bestAddr,
    routable,
    liquidityUsd: Math.round(bestUsdcLiq),
    dex: routable ? routableDex : null,
    hubDex: routable ? null : hubDex,
    hubSymbol: routable ? null : hubSymbol,
    hubLiquidityUsd: routable ? null : Math.round(bestHubLiq),
    volume24hUsd: Math.round(bestVolume),
  };
}

async function main() {
  const args = process.argv.slice(2);
  let outPath = resolvePath(SCRIPT_DIR, "liquidity-map.json");
  let seed = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") outPath = resolvePath(args[++i]);
    else if (args[i] === "--seed") {
      // A JSON file of { "SYMBOL": { "chain": { "address", "decimals" } } } from
      // build-top-assets-seed.mjs — the ONLY accepted form. The legacy bare-number
      // { "SYMBOL": decimals } form is rejected: without a trusted address the builder
      // cannot resolve identity (and must not guess it from a search).
      const raw = JSON.parse(readFileSync(resolvePath(args[++i]), "utf8"));
      seed = {};
      for (const [k, v] of Object.entries(raw)) {
        const sym = k.toUpperCase().trim();
        if (sym) seed[sym] = v;
      }
    }
  }

  // Every symbol must carry a trusted per-chain address from the seed. A bare-number
  // entry (legacy) has no address and cannot be mapped.
  if (!seed) {
    process.stderr.write(
      "build-liquidity-map requires --seed <file> with per-chain addresses. Generate it first:\n" +
        "  node scripts/build-top-assets-seed.mjs            # token list → top-assets-seed.json\n" +
        "  node scripts/build-liquidity-map.mjs --seed top-assets-seed.json\n",
    );
    process.exit(1);
  }
  const noAddr = Object.values(seed).filter((v) => typeof v === "number").length;
  if (noAddr > 0) {
    process.stderr.write(
      `Refusing to build: ${noAddr} seed entr${noAddr === 1 ? "y" : "ies"} are bare decimals with no address. ` +
        "Re-generate the seed with `node scripts/build-top-assets-seed.mjs` (per-chain addresses from the Uniswap token list). " +
        "The map must never record a guessed address.\n",
    );
    process.exit(1);
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
      const knownAddr = seedAddress(seed, sym, name);
      const decimals = seedDecimals(seed, sym, name);
      try {
        const r = await resolveOneChain(sym, name, CHAINS[name], knownAddr);
        if (r) {
          tokens[sym][name] = {
            address: r.address,
            decimals,
            routable: r.routable,
            liquidityUsd: r.liquidityUsd,
            dex: r.dex,
            volume24hUsd: r.volume24hUsd,
            ...(r.hubDex
              ? { hubDex: r.hubDex, hubSymbol: r.hubSymbol, hubLiquidityUsd: r.hubLiquidityUsd }
              : {}),
          };
        }
      } catch {
        // symbol not on this chain — leave it absent
      }
    }
    const n = Object.keys(tokens[sym]).length;
    process.stderr.write(`  ${sym}: ${n} chain(s)${n ? ` — ${Object.keys(tokens[sym]).join(", ")}` : ""}\n`);
  }

  const map = {
    version: 6,
    generatedAt: new Date().toISOString(),
    source: "Addresses from the Uniswap default token list (curated, offline) + DexScreener routable/volume check (keyless). Identity is NEVER derived from a DexScreener search — only a curated-list contract is recorded, so a planted look-alike cannot enter the map. `volume24hUsd` is the token's max 24h volume on the chain; the resolver trusts an entry only when it actually trades. `dex` is the DEX family of the deepest routable USDC pool; `hubDex`/`hubSymbol`/`hubLiquidityUsd` record the deepest Sail-routable pool against a curated two-hop via asset (WETH/WBNB/USDT/WBTC/DAI) when there is no USDC pool (a two-swap route).",
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
