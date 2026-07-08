#!/usr/bin/env node
// resolve-token.mjs — resolve one or more token symbols/addresses to on-chain
// metadata and map WHERE each is swap-ready: which chain, which DEX/protocol, how
// deep the pool is. Built for prompts like "a portfolio of USDC, UNI, HYPE, MORPHO"
// or "a DCA of X and Y" — pass every symbol at once.
//
// Pure JS, no dependencies (works in a fresh project before Foundry is set up).
// Reads RPC + chain from .sail/.env.local or .sail/config.json, or --rpc/--chain.
//
//   node scripts/resolve-token.mjs WETH                       # single token, configured chain(s)
//   node scripts/resolve-token.mjs LINK --chain unichain      # force one chain
//   node scripts/resolve-token.mjs 0x4200…0006 --chain base   # address input
//   node scripts/resolve-token.mjs USDC UNI MORPHO            # portfolio (rich JSON)
//   node scripts/resolve-token.mjs UNI --all-chains --json    # scan every Sail mainnet
//
// Liquidity venues (chain + protocol + pool + depth) come from GeckoTerminal
// (CoinGecko's keyless DEX index — Uniswap V3/V4, Sushiswap, PancakeSwap, Aerodrome…).
// Swap-readiness is CONFIRMED on-chain only for Uniswap V3 (USDC→token via QuoterV2),
// Sail's executable fast-path route; other venues are surfaced as informational.
//
// Output: JSON on stdout (machine-readable); human notes on stderr.

import { readFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

// ── Curated registry (verified live June 2026). Always re-verify decimals on-chain. ──
// Per-chain Uniswap V3 infrastructure + the common tokens. Addresses are PER-CHAIN.
// `gecko` is the GeckoTerminal network id used for the cross-DEX liquidity lookup.
const CHAINS = {
  ethereum: {
    chainId: 1,
    gecko: "eth",
    quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    tokens: {
      USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
      WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
      UNI: { address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18 },
      LINK: { address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18 },
      WBTC: { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 },
    },
  },
  unichain: {
    chainId: 130,
    gecko: "unichain",
    quoterV2: "0x385a5cf5f83e99f7bb2852b6a19c3538b9fa7658",
    usdc: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
    tokens: {
      USDC: { address: "0x078D782b760474a361dDA0AF3839290b0EF57AD6", decimals: 6 },
      WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
      UNI: { address: "0x8f187aA05619a017077f5308904739877ce9eA21", decimals: 18 },
      LINK: { address: "0x5a53B6D19D8EDCb7923F0D840EeBB3f09BBeEfB7", decimals: 18 },
      MORPHO: { address: "0x6695a2692dCD2A53E7766492447B5254A56425aD", decimals: 18 },
    },
  },
  base: {
    chainId: 8453,
    gecko: "base",
    quoterV2: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokens: {
      USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    },
  },
  arbitrum: {
    chainId: 42161,
    gecko: "arbitrum",
    quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    tokens: {
      USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
      USDC_E: { address: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", decimals: 6 },
      WETH: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
      ARB: { address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18 },
      LINK: { address: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", decimals: 18 },
    },
  },
};

const FEE_TIERS = [500, 3000, 10000];
const PROBE_AMOUNT_USDC = 25n * 10n ** 6n; // 25 USDC — a representative DCA size
const ADDR_ZERO = "0x" + "0".repeat(40);
const MAX_VENUES = 8; // cap the per-chain venue list so portfolio JSON stays readable

// ── Minimal ABI encoding (no deps) ──────────────────────────────────────────────
// selector(string) → first 4 bytes of keccak256. We only call three functions, so
// hardcode the selectors (verified via `cast sig`).
const SEL = {
  symbol: "0x95d89b41", // symbol()
  decimals: "0x313ce567", // decimals()
  quoteExactInputSingle: "0xc6a5026a", // quoteExactInputSingle((address,address,uint256,uint24,uint160))
};

function pad32(hexOrAddr) {
  // left-pad an address or hex number to 32 bytes (64 hex chars)
  let h = hexOrAddr.toLowerCase().replace(/^0x/, "");
  if (h.length < 64) h = "0".repeat(64 - h.length) + h;
  return h;
}

function uintToHex(n) {
  // bigint → 32-byte hex word
  let h = n.toString(16);
  if (h.length % 2) h = "0" + h;
  return pad32(h);
}

function encodeQuoteCall(tokenIn, tokenOut, amountIn, fee) {
  // quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96))
  // Single tuple arg, all static fields → selector + 5 words, no offset table.
  return (
    SEL.quoteExactInputSingle +
    pad32(tokenIn) +
    pad32(tokenOut) +
    uintToHex(amountIn) +
    uintToHex(BigInt(fee)) +
    uintToHex(0n) // sqrtPriceLimitX96 = 0
  );
}

function decodeUint256Return(hex, wordIndex = 0) {
  const h = hex.toLowerCase().replace(/^0x/, "");
  const word = h.slice(wordIndex * 64, wordIndex * 64 + 64);
  return word ? BigInt("0x" + word) : 0n;
}

function decodeStringReturn(hex) {
  // string return: offset(0x20) + length + data
  const h = hex.toLowerCase().replace(/^0x/, "");
  const len = Number(BigInt("0x" + h.slice(64, 128)));
  if (!len) return "";
  const data = h.slice(128, 128 + len * 2);
  // Interpret as UTF-8 bytes.
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = parseInt(data.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

// ── JSON-RPC (eth_call) via fetch ───────────────────────────────────────────────
async function ethCall(rpc, to, data, from = ADDR_ZERO) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{ to, data, from }, "latest"],
  };
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`eth_call HTTP ${res.status} to ${to}`);
  const json = await res.json();
  if (json.error) throw new Error(`eth_call reverted: ${JSON.stringify(json.error)}`);
  if (!json.result) throw new Error(`eth_call returned no result`);
  return json.result;
}

// ── resolve project RPC + chain ─────────────────────────────────────────────────
function readSailEnv(projectRoot = process.cwd()) {
  const envPath = resolvePath(projectRoot, ".sail", ".env.local");
  const out = {};
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

function readSailConfig(projectRoot = process.cwd()) {
  const p = resolvePath(projectRoot, ".sail", "config.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function resolveChain(chainFlag) {
  if (chainFlag) {
    const c = CHAINS[chainFlag.toLowerCase()];
    if (c) return { name: chainFlag.toLowerCase(), ...c };
    // numeric chain id
    for (const [name, cfg] of Object.entries(CHAINS)) {
      if (String(cfg.chainId) === String(chainFlag)) return { name, ...cfg };
    }
    throw new Error(`Unknown chain "${chainFlag}". Known: ${Object.keys(CHAINS).join(", ")}`);
  }
  // From .sail/.env.local CHAIN_ID, or .sail/config.json
  const env = readSailEnv();
  const cfg = readSailConfig();
  const id = env.CHAIN_ID ?? cfg.chainId;
  if (id) {
    for (const [name, c] of Object.entries(CHAINS)) {
      if (String(c.chainId) === String(id)) return { name, ...c };
    }
  }
  throw new Error(
    `Could not resolve chain. Pass --chain <${Object.keys(CHAINS).join("|")}> or set CHAIN_ID in .sail/.env.local.`,
  );
}

function resolveRpc(chain, rpcFlag) {
  if (rpcFlag) return rpcFlag;
  const env = readSailEnv();
  // Mirrors packages/cli/src/lib/chain.ts getRpcUrl():
  //   1. named chain var (UNICHAIN_RPC_URL)
  //   2. chainId-keyed var (RPC_URL_130) — written by the UI's save-config
  //   3. generic RPC_URL (single-chain fallback)
  const nameVar = `${chain.name.toUpperCase().replace("-", "_")}_RPC_URL`;
  const idVar = `RPC_URL_${chain.chainId}`;
  return env[nameVar] ?? env[idVar] ?? env.RPC_URL ?? null;
}

// All chains with a chain-SPECIFIC RPC configured in .sail/.env.local (named or
// chainId-keyed). Generic RPC_URL does NOT count — it is one endpoint for one
// chain, not a per-chain wiring. Used to detect multi-chain projects so a symbol
// can be resolved on every active chain at once.
function configuredChains() {
  const env = readSailEnv();
  const out = [];
  for (const [name, cfg] of Object.entries(CHAINS)) {
    const nameVar = `${name.toUpperCase().replace("-", "_")}_RPC_URL`;
    const idVar = `RPC_URL_${cfg.chainId}`;
    const rpc = env[nameVar] ?? env[idVar] ?? null;
    if (rpc) out.push({ name, ...cfg, rpc });
  }
  return out;
}

// ── GeckoTerminal (CoinGecko's keyless DEX API) — throttled + cached + retried ───
// Free tier is rate-limited (~10–30 calls/min before 429). We serialize calls with
// a minimum spacing, cache per-URL within a run, and back off on 429/timeout. One
// token-pools call returns ALL venues for a token, so a portfolio stays cheap.
const GECKO_API = "https://api.geckoterminal.com/api/v2";
const GECKO_SPACING_MS = Number(process.env.GECKO_MIN_SPACING_MS || 2500);
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const geckoCache = new Map();
let geckoLock = Promise.resolve();
let lastGeckoTs = 0;

async function geckoGet(url) {
  if (geckoCache.has(url)) return geckoCache.get(url);
  const task = geckoLock.then(async () => {
    if (geckoCache.has(url)) return geckoCache.get(url); // filled while we queued
    const since = Date.now() - lastGeckoTs;
    if (since < GECKO_SPACING_MS) await sleep(GECKO_SPACING_MS - since);
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { accept: "application/json", "user-agent": "sailor-resolve-token" },
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 429) {
          const ra = Number(res.headers.get("retry-after") || 0);
          lastErr = new Error("GeckoTerminal 429 (rate-limited)");
          await sleep(ra > 0 ? ra * 1000 : 8000);
          continue;
        }
        if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status} for ${url}`);
        const json = await res.json();
        geckoCache.set(url, json);
        return json;
      } catch (e) {
        lastErr = e;
        await sleep(1500);
      }
    }
    throw lastErr || new Error("GeckoTerminal request failed");
  });
  // The next queued call waits for this one to finish (and the spacing it imposes),
  // regardless of success/failure.
  geckoLock = task.then(
    () => {
      lastGeckoTs = Date.now();
    },
    () => {
      lastGeckoTs = Date.now();
    },
  );
  return task;
}

// dexId (e.g. "uniswap-v3-base", "aerodrome-base", "uniswap-v4-unichain") → a
// canonical protocol family and whether Sail's fast-path SwapPermission can route
// it. Sail confirms swaps on-chain via Uniswap V3 QuoterV2 everywhere, plus the
// Uniswap V4 Universal Router on Unichain. Everything else is surfaced as an
// informational venue (the user can still build a custom mandate for it).
function classifyDex(dexId, chainName) {
  const id = (dexId || "").toLowerCase();
  let protocol = "other";
  if (id.startsWith("uniswap-v3") || id.startsWith("uniswap_v3")) protocol = "uniswap-v3";
  else if (id.startsWith("uniswap-v4") || id.startsWith("uniswap_v4")) protocol = "uniswap-v4";
  else if (id.startsWith("uniswap-v2") || id === "uniswap") protocol = "uniswap-v2";
  else if (id.includes("sushiswap")) protocol = "sushiswap";
  else if (id.includes("pancakeswap")) protocol = "pancakeswap";
  else if (id.includes("aerodrome")) protocol = "aerodrome";
  let sailRoutable = false;
  if (protocol === "uniswap-v3") sailRoutable = true;
  else if (protocol === "uniswap-v4" && chainName === "unichain") sailRoutable = true;
  return { protocol, sailRoutable };
}

// "WETH / USDC 0.3%" → 3000 (basis points). null when no fee is present (e.g. some
// V2/Solidly pools name themselves without a fee tier).
function parseFeeBps(name) {
  const m = (name || "").match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * 10000);
}

function addrFromGeckoId(id) {
  // GeckoTerminal ids look like "base_0xabc…". Return the lowercase address part.
  return id && id.includes("_") ? id.slice(id.indexOf("_") + 1).toLowerCase() : "";
}

// All swap venues for a token on a chain, ranked by USD liquidity, with their DEX
// protocol. One GeckoTerminal call covers every DEX it indexes.
async function fetchVenues(geckoNet, tokenAddrLower, chainName, ourSymbolUp) {
  if (!geckoNet) return [];
  const url = `${GECKO_API}/networks/${geckoNet}/tokens/${tokenAddrLower}/pools?page=1`;
  const json = await geckoGet(url);
  const pools = Array.isArray(json.data) ? json.data : [];
  const venues = [];
  for (const p of pools) {
    const at = p.attributes || {};
    const rel = p.relationships || {};
    const dexId = (((rel.dex || {}).data) || {}).id || "";
    const { protocol, sailRoutable } = classifyDex(dexId, chainName);
    const name = at.name || "";
    const baseAddr = addrFromGeckoId((((rel.base_token || {}).data) || {}).id || "");
    const quoteAddr = addrFromGeckoId((((rel.quote_token || {}).data) || {}).id || "");
    let pairedToken = "";
    if (baseAddr === tokenAddrLower) pairedToken = quoteAddr;
    else if (quoteAddr === tokenAddrLower) pairedToken = baseAddr;
    // else: our token isn't actually base/quote of this pool (a GeckoTerminal data
    // quirk) — leave pairedToken unset rather than guessing quoteAddr, which would
    // let isUsdcPair() mislabel a pool the token isn't even in as USDC-paired.
    const syms = name
      .split("/")
      .map((s) => s.trim().split(/\s+/)[0].toUpperCase())
      .filter(Boolean);
    const pairedSymbol = syms.find((s) => s !== ourSymbolUp) || syms[syms.length - 1] || null;
    const feeTier = parseFeeBps(name);
    // A pool with an absurd fee (>10%) is a spam/scam pool, never a real swap route —
    // don't treat it as Sail-routable even if the DEX family normally is.
    const exotic = feeTier != null && feeTier > 100000;
    venues.push({
      protocol,
      dexId,
      pool: at.address || null,
      feeTier,
      pairedSymbol,
      pairedToken: pairedToken || null,
      liquidityUsd: Math.round(Number(at.reserve_in_usd || 0)),
      volume24hUsd: Math.round(Number((at.volume_usd || {}).h24 || 0)),
      sailRoutable: sailRoutable && !exotic,
      quoteVerified: false,
    });
  }
  venues.sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  return venues;
}

// symbol + decimals for a token on a chain we have no RPC for (--all-chains scan of
// an unconfigured Sail mainnet). Clearly NOT the on-chain source of truth.
async function fetchTokenMeta(geckoNet, tokenAddrLower) {
  const url = `${GECKO_API}/networks/${geckoNet}/tokens/${tokenAddrLower}`;
  const json = await geckoGet(url);
  const at = ((json.data || {}).attributes) || {};
  return { symbol: at.symbol || null, decimals: at.decimals != null ? Number(at.decimals) : null };
}

// symbol → address via GeckoTerminal search (fallback when not in the curated
// registry). Ranks candidate addresses by pool reserve (deepest = most canonical);
// the on-chain symbol() check in resolveOnChain is the final authority.
async function resolveSymbolViaGeckoTerminal(symbolUp, geckoNet) {
  if (!geckoNet) return [];
  const url = `${GECKO_API}/search/pools?query=${encodeURIComponent(symbolUp)}&network=${encodeURIComponent(geckoNet)}`;
  const json = await geckoGet(url);
  const pools = Array.isArray(json.data) ? json.data : [];
  const byAddr = new Map(); // address -> max reserve_in_usd
  for (const p of pools) {
    const name = (p.attributes && p.attributes.name) || "";
    const parts = name.split("/").map((s) => s.trim().split(/\s+/)[0].toUpperCase());
    const rel = p.relationships || {};
    const baseAddr = addrFromGeckoId((((rel.base_token || {}).data) || {}).id || "");
    const quoteAddr = addrFromGeckoId((((rel.quote_token || {}).data) || {}).id || "");
    const liq = Number((p.attributes && p.attributes.reserve_in_usd) || 0);
    if (parts[0] === symbolUp && ADDR_RE.test(baseAddr)) {
      const prev = byAddr.get(baseAddr);
      if (prev === undefined || liq > prev) byAddr.set(baseAddr, liq);
    }
    if (parts[1] === symbolUp && ADDR_RE.test(quoteAddr)) {
      const prev = byAddr.get(quoteAddr);
      if (prev === undefined || liq > prev) byAddr.set(quoteAddr, liq);
    }
  }
  return [...byAddr.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
}

// ── on-chain verify: symbol() + decimals() — always the source of truth ────────
async function verifyTokenOnChain(rpc, address) {
  const symHex = await ethCall(rpc, address, SEL.symbol);
  const decHex = await ethCall(rpc, address, SEL.decimals);
  return {
    symbol: decodeStringReturn(symHex) || null,
    decimals: Number(decodeUint256Return(decHex)),
  };
}

function isUsdcPair(venue, chain) {
  if (!venue) return false;
  if (venue.pairedSymbol === "USDC" || venue.pairedSymbol === "USDC.E") return true;
  return !!(venue.pairedToken && venue.pairedToken.toLowerCase() === chain.usdc.toLowerCase());
}

// The single venue that best represents swap-readiness FROM USDC (Sail's DCA sell
// leg): deepest Sail-routable USDC pool, else deepest routable pool, else deepest
// pool overall. Drives the cross-chain depth ranking, so it must be USDC-relevant —
// not, say, a huge WETH/BEAT pool that we'd never route a USDC DCA through.
function pickBestVenue(venues, chain) {
  const routableUsdc = venues.filter((v) => v.sailRoutable && isUsdcPair(v, chain));
  const routable = venues.filter((v) => v.sailRoutable);
  const top = routableUsdc[0] || routable[0] || venues[0] || null; // venues are pre-sorted by depth
  if (!top) return null;
  return {
    protocol: top.protocol,
    feeTier: top.feeTier,
    liquidityUsd: top.liquidityUsd,
    pool: top.pool,
    pairedSymbol: top.pairedSymbol,
    sailRoutable: top.sailRoutable,
  };
}

// ── per-chain resolution (shared by single-, multi-chain and portfolio modes) ──
// Resolves symbolOrAddr on ONE chain. With an RPC it is the authority: on-chain
// symbol()/decimals() + a live Uniswap V3 USDC→token QuoterV2 probe. Without an RPC
// (an --all-chains scan of an unconfigured chain) it falls back to GeckoTerminal
// metadata and treats a deep Sail-routable venue as swap-ready (unverified).
async function resolveOnChain(symbolOrAddr, chain, rpc) {
  const geckoNet = chain.gecko || null;
  const onchain = !!rpc;
  const isAddrInput = ADDR_RE.test(symbolOrAddr);
  const wantSym = isAddrInput ? null : symbolOrAddr.toUpperCase();
  let address, verifiedSymbol, decimals, source, decimalsSource;

  if (isAddrInput) {
    address = symbolOrAddr;
    source = "address-input";
  } else {
    const entry = chain.tokens[wantSym];
    if (entry) {
      address = entry.address;
      source = "registry";
    } else {
      // Fallback: resolve symbol → address via GeckoTerminal (keyless DEX API).
      const candidates = await resolveSymbolViaGeckoTerminal(wantSym, geckoNet);
      if (candidates.length === 0) {
        throw new Error(
          `"${symbolOrAddr}" is not in the curated ${chain.name} registry and GeckoTerminal found no pool for it on ${chain.name}. ` +
            `Pass its 0x address directly: node scripts/resolve-token.mjs 0x... --chain ${chain.name}`,
        );
      }
      if (onchain) {
        // Verify each candidate on-chain; keep the first whose symbol() matches the query.
        // This is the authority — a wrong DEX-side match is rejected, not trusted.
        const tried = [];
        let resolved = null;
        for (const cand of candidates) {
          try {
            const v = await verifyTokenOnChain(rpc, cand);
            tried.push({ address: cand, symbol: v.symbol || "" });
            if (v.symbol && v.symbol.toUpperCase() === wantSym) {
              resolved = { address: cand, symbol: v.symbol, decimals: v.decimals };
              break;
            }
          } catch {
            // not a real contract on this chain — skip silently
          }
        }
        if (!resolved) {
          throw new Error(
            `GeckoTerminal returned ${candidates.length} candidate address(es) for "${symbolOrAddr}" on ${chain.name}, but none verified on-chain with symbol() == "${wantSym}" ` +
              `(tried: ${tried.map((t) => `${t.address}→${t.symbol || "no-contract"}`).join(", ")}). ` +
              `Pass the token's 0x address directly: node scripts/resolve-token.mjs 0x... --chain ${chain.name}`,
          );
        }
        address = resolved.address;
        verifiedSymbol = resolved.symbol;
        decimals = resolved.decimals;
        source = "geckoterminal";
        decimalsSource = "onchain";
      } else {
        // No RPC: candidates are ranked by pool depth, but depth alone can't tell two
        // different contracts sharing a ticker apart (a collision). Cross-check each
        // candidate's own GeckoTerminal token metadata — independent of the pool-name
        // parsing used to build the candidate list — and prefer the first whose symbol
        // actually matches, rather than blindly trusting the deepest pool.
        let verified = null;
        for (const cand of candidates) {
          try {
            const m = await fetchTokenMeta(geckoNet, cand.toLowerCase());
            if (m.symbol && m.symbol.toUpperCase() === wantSym) {
              verified = cand;
              break;
            }
          } catch {
            // metadata lookup failed for this candidate — try the next
          }
        }
        address = verified || candidates[0];
        source = verified ? "geckoterminal-unverified" : "geckoterminal-unverified-collision";
      }
    }
  }

  // Metadata: on-chain symbol()+decimals() is the source of truth when we have an RPC.
  if (onchain && source !== "geckoterminal") {
    try {
      const v = await verifyTokenOnChain(rpc, address);
      if (v.symbol) verifiedSymbol = v.symbol;
      decimals = v.decimals;
      decimalsSource = "onchain";
    } catch (err) {
      throw new Error(
        `On-chain verify failed for ${address} on ${chain.name}: ${errMsg(err)}. The contract may not exist on this chain.`,
      );
    }
  } else if (!onchain && decimals === undefined) {
    // gecko-only path: best-effort metadata from GeckoTerminal.
    try {
      const m = await fetchTokenMeta(geckoNet, address.toLowerCase());
      if (m.symbol) verifiedSymbol = m.symbol;
      decimals = m.decimals;
    } catch {
      decimals = null;
    }
    decimalsSource = "geckoterminal-unverified";
  }
  if (verifiedSymbol === undefined) verifiedSymbol = wantSym || null;
  if (decimals === undefined) decimals = null;

  // Liquidity venue map across every DEX GeckoTerminal indexes.
  let venues = [];
  let venuesError = null;
  if (geckoNet) {
    try {
      venues = await fetchVenues(geckoNet, address.toLowerCase(), chain.name, (verifiedSymbol || wantSym || "").toUpperCase());
    } catch (e) {
      venuesError = errMsg(e);
    }
  }

  const isUsdc = address.toLowerCase() === chain.usdc.toLowerCase();

  // Swap-readiness. On-chain: a live Uniswap V3 USDC→token QuoterV2 quote across fee
  // tiers (Sail's executable route). Off-chain (--all-chains scan): a deep Sail-routable
  // venue exists, but is NOT live-quoted (quoteVerified stays false).
  let best = null; // { fee, amountOut }
  const tried = [];
  let swapReady;
  let quote = null;

  if (isUsdc) {
    swapReady = true; // USDC is the quote asset itself
  } else if (onchain) {
    const tokenIn = chain.usdc;
    for (const fee of FEE_TIERS) {
      const data = encodeQuoteCall(tokenIn, address, PROBE_AMOUNT_USDC, fee);
      let amountOut = 0n;
      let ok = true;
      try {
        const ret = await ethCall(rpc, chain.quoterV2, data);
        amountOut = decodeUint256Return(ret); // first word = amountOut
      } catch {
        ok = false; // revert = no pool at this tier
      }
      tried.push({ fee, amountOut: amountOut.toString(), ok });
      if (ok && amountOut > 0n && (!best || amountOut > best.amountOut)) {
        best = { fee, amountOut };
      }
    }
    swapReady = best !== null;
    if (best) {
      // Flag the matching venue in the map as live-quoted.
      const m = venues.find(
        (v) => v.protocol === "uniswap-v3" && v.feeTier === best.fee && isUsdcPair(v, chain),
      );
      if (m) m.quoteVerified = true;
      quote = {
        tokenIn: "USDC",
        tokenInAddress: tokenIn,
        amountIn: PROBE_AMOUNT_USDC.toString(),
        amountOut: best.amountOut.toString(),
        note:
          "feeTier was chosen using this small probe amount. A thin low-fee pool that wins " +
          "at this size can be the worst tier for a much larger trade — for large amounts, " +
          "re-quote across fee tiers at the actual trade size via quote-swap.mjs before dispatch.",
      };
    }
  } else {
    // gecko-only: a Sail-routable USDC-paired venue ⇒ swap-ready (unverified).
    const r = venues.find((v) => v.sailRoutable && isUsdcPair(v, chain));
    swapReady = !!r;
    if (r) best = { fee: r.feeTier, amountOut: null };
  }

  // Best venue (USDC-relevant) computed from the FULL list, then cap the exposed
  // list so portfolio JSON stays readable.
  const bestVenue = pickBestVenue(venues, chain);
  const venuesTotal = venues.length;
  const topVenues = venues.slice(0, MAX_VENUES);

  return {
    symbol: verifiedSymbol,
    address,
    decimals,
    source, // registry | geckoterminal | geckoterminal-unverified | geckoterminal-unverified-collision | address-input
    decimalsSource, // onchain | geckoterminal-unverified
    chain: chain.name,
    chainId: chain.chainId,
    onchainVerified: onchain,
    swapReady,
    feeTier: best ? best.fee : null,
    quote,
    probedTiers: tried,
    venues: topVenues,
    venuesTotal,
    venuesError,
    bestVenue,
    recommendation: perChainRecommendation({
      symbol: verifiedSymbol,
      chain,
      swapReady,
      best,
      bestVenue,
      onchain,
      isUsdc,
      decimalsSource,
      source,
    }),
  };
}

function perChainRecommendation({ symbol, chain, swapReady, best, bestVenue, onchain, isUsdc, decimalsSource, source }) {
  const unverified =
    source === "geckoterminal-unverified-collision"
      ? ` NOTE: multiple "${symbol}" contracts were found on ${chain.name} and none of their GeckoTerminal metadata matched the symbol — this address is the deepest pool, NOT a verified match. Confirm the address before signing.`
      : decimalsSource === "geckoterminal-unverified"
        ? ` NOTE: address/decimals are NOT on-chain verified on ${chain.name} — confirm before signing.`
        : "";
  if (isUsdc) {
    return `${symbol} is the USDC quote asset on ${chain.name} — no swap needed to source it.`;
  }
  if (swapReady && onchain) {
    return `Swap-ready on ${chain.name} (live Uniswap V3 USDC quote${best ? `, fee ${best.fee}` : ""}). Hand to quote-swap.mjs for an exact quote + amountOutMinimum.${unverified}`;
  }
  if (swapReady && !onchain) {
    return `${chain.name} has a Sail-routable ${bestVenue ? bestVenue.protocol : "Uniswap"} pool (~${fmtUsd(bestVenue ? bestVenue.liquidityUsd : 0)}), but it was not live-quoted on-chain (no RPC / verify failed). Configure an RPC or SMA on ${chain.name} to confirm.${unverified}`;
  }
  if (bestVenue) {
    return `No Sail-routable USDC pool for ${symbol} on ${chain.name}, but liquidity exists on ${bestVenue.protocol} (~${fmtUsd(bestVenue.liquidityUsd)}). That DEX is not on Sail's fast path — use a custom mandate or hold the leg.${unverified}`;
  }
  return `No pool for ${symbol} on ${chain.name}. If liquidity is on another Sail chain, deploy/scan there; otherwise configure as a held leg.`;
}

// ── cross-chain recommendation across the chains we mapped for one token ────────
function fmtUsd(n) {
  return "$" + (Math.round(Number(n) || 0)).toLocaleString("en-US");
}

function recommendCrossChain(chains, configuredNames) {
  const entries = Object.entries(chains).filter(([, o]) => !o.error);
  const routable = entries
    .filter(([, o]) => o.swapReady)
    .map(([name, o]) => ({
      name,
      depth: o.bestVenue && o.bestVenue.sailRoutable ? o.bestVenue.liquidityUsd : 0,
      configured: configuredNames.includes(name),
      o,
    }));
  const liqChains = entries.filter(([, o]) => o.venues && o.venues.length).map(([name]) => name);

  const configuredRoutable = routable.filter((c) => c.configured).sort((a, b) => b.depth - a.depth);
  if (configuredRoutable.length) {
    const t = configuredRoutable[0];
    return {
      action: "route",
      deepestChain: t.name,
      routableChains: configuredRoutable.map((c) => c.name),
      note:
        `Swap-ready on your configured chain(s): ${configuredRoutable.map((c) => c.name).join(", ")}. ` +
        `Deepest: ${t.name}${t.o.bestVenue ? ` (${t.o.bestVenue.protocol}, ${fmtUsd(t.o.bestVenue.liquidityUsd)})` : ""}.` +
        (configuredRoutable.length > 1 ? " Liquidity on more than one configured chain — pick by depth or by where the rest of the portfolio lives." : ""),
    };
  }

  const anyRoutable = routable.slice().sort((a, b) => b.depth - a.depth);
  if (anyRoutable.length) {
    const t = anyRoutable[0];
    return {
      action: "suggest-sma",
      deepestChain: t.name,
      routableChains: anyRoutable.map((c) => c.name),
      note:
        `No Sail-routable pool on your configured chain(s). Deepest routable liquidity is on ${t.name}` +
        `${t.o.bestVenue ? ` (${t.o.bestVenue.protocol}, ${fmtUsd(t.o.bestVenue.liquidityUsd)})` : ""} — ` +
        `consider deploying an SMA on ${t.name} for this leg.`,
    };
  }

  if (liqChains.length) {
    const detail = entries
      .filter(([, o]) => o.bestVenue)
      .map(([name, o]) => `${name}: ${o.bestVenue.protocol} (${fmtUsd(o.bestVenue.liquidityUsd)})`)
      .join("; ");
    return {
      action: "manual-address",
      note: `Liquidity exists but only on DEXes Sail's fast path can't route (${detail}). Build a custom mandate against that pool/router, or hold the leg.`,
    };
  }

  return {
    action: "hold-skip",
    note: `No pool found on any scanned Sail chain. The token may live on a chain this project isn't configured for. Configure it as a held leg or drop it from the strategy.`,
  };
}

// Resolve one token across a set of chains → the rich per-token wrapper.
async function resolveToken(symbolOrAddr, chainSet, configuredNames) {
  const chains = {};
  for (const c of chainSet) {
    try {
      chains[c.name] = await resolveOnChain(symbolOrAddr, c, c.rpc || null);
    } catch (e) {
      // If the on-chain path failed (flaky RPC, etc.) but the chain has a GeckoTerminal
      // network, degrade to a GeckoTerminal-only map rather than dropping the chain.
      if (c.rpc && c.gecko) {
        try {
          const fallback = await resolveOnChain(symbolOrAddr, c, null);
          fallback.onchainError = errMsg(e);
          chains[c.name] = fallback;
          continue;
        } catch {
          // gecko-only also failed — fall through to the error entry
        }
      }
      chains[c.name] = { chain: c.name, chainId: c.chainId, error: errMsg(e) };
    }
  }
  const chainsWithLiquidity = Object.entries(chains)
    .filter(([, o]) => !o.error && ((o.venues && o.venues.length) || o.swapReady))
    .map(([name]) => name);
  const crossChain = recommendCrossChain(chains, configuredNames);
  return {
    query: symbolOrAddr,
    chains,
    chainsWithLiquidity,
    onSailChain: chainsWithLiquidity.length > 0,
    crossChain,
  };
}

function buildSummary(tokens, configuredNames, allScanned) {
  const route = [];
  const sma = [];
  const manual = [];
  const hold = [];
  for (const t of tokens) {
    const a = t.crossChain.action;
    if (a === "route") route.push(t.query);
    else if (a === "suggest-sma") sma.push(`${t.query}→${t.crossChain.deepestChain}`);
    else if (a === "manual-address") manual.push(t.query);
    else hold.push(t.query);
  }
  const parts = [];
  if (route.length) parts.push(`Ready to route on your chain(s): ${route.join(", ")}.`);
  if (sma.length) parts.push(`Liquidity lives on another Sail chain — consider an SMA there: ${sma.join(", ")}.`);
  if (manual.length) parts.push(`Liquidity only on non-routable DEXes (custom mandate or hold): ${manual.join(", ")}.`);
  if (hold.length) parts.push(`Not found on any scanned Sail chain — hold or drop: ${hold.join(", ")}.`);
  return {
    configuredChains: configuredNames,
    allChainsScanned: allScanned,
    recommendation: parts.join(" ") || "No tokens resolved.",
  };
}

// ── emitters ────────────────────────────────────────────────────────────────────
function emitSingle(out) {
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  const venueLine =
    out.venues && out.venues.length
      ? out.venues
          .slice(0, 3)
          .map((v) => `${v.protocol}${v.feeTier ? ` ${v.feeTier / 10000}%` : ""} ${fmtUsd(v.liquidityUsd)}${v.sailRoutable ? "" : " (info)"}`)
          .join(", ")
      : out.venuesError
        ? `unavailable (${out.venuesError.includes("429") ? "rate-limited" : "error"} — re-run --chain ${out.chain})`
        : "none indexed";
  process.stderr.write(
    `\n${out.symbol} on ${out.chain} (${out.chainId}):\n` +
      `  address:    ${out.address}  (source: ${out.source})\n` +
      `  decimals:   ${out.decimals} (${out.decimalsSource || "onchain"})\n` +
      `  swap-ready: ${out.swapReady ? `yes — fee ${out.feeTier} (deepest Uniswap V3)` : "NO USDC V3 pool on this chain"}\n` +
      `  venues:     ${venueLine}\n` +
      `  ${out.recommendation}\n`,
  );
}

function emitTokenHuman(token) {
  const lines = [`\n${token.query}:`];
  for (const [name, o] of Object.entries(token.chains)) {
    if (o.error) {
      lines.push(`  ${name}: FAILED — ${o.error}`);
      continue;
    }
    const venues =
      o.venues && o.venues.length
        ? o.venues
            .slice(0, 3)
            .map((v) => `${v.protocol}${v.feeTier ? ` ${v.feeTier / 10000}%` : ""}/${v.pairedSymbol || "?"} ${fmtUsd(v.liquidityUsd)}${v.sailRoutable ? (v.quoteVerified ? "✓" : "") : "(info)"}`)
            .join(", ")
        : o.venuesError
          ? `unavailable (${o.venuesError.includes("429") ? "rate-limited — re-run" : "error"})`
          : "none";
    lines.push(
      `  ${name} (${o.chainId}): ${o.address}  dec ${o.decimals} [${o.decimalsSource}], ${o.swapReady ? `swap-ready fee ${o.feeTier}` : "no USDC V3 pool"}`,
    );
    lines.push(`     venues: ${venues}`);
  }
  lines.push(`  → [${token.crossChain.action}] ${token.crossChain.note}`);
  return lines.join("\n");
}

// ── main ────────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    process.stderr.write(
      "Usage: node scripts/resolve-token.mjs <SYMBOL|ADDRESS> [<SYMBOL|ADDRESS> ...]\n" +
        "       [--chain ethereum|unichain|base|arbitrum] [--rpc URL] [--all-chains] [--json]\n" +
        "\n" +
        "  one symbol               → configured chain(s); bare object / array (back-compat)\n" +
        "  many symbols, or --json  → rich portfolio JSON (per-token, per-chain venue map)\n" +
        "  --all-chains             → also scan every Sail mainnet via GeckoTerminal\n",
    );
    process.exit(args.length === 0 ? 1 : 0);
  }

  const tokens = [];
  let chainFlag = null;
  let rpcFlag = null;
  let allChains = false;
  let jsonMode = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--chain") chainFlag = args[++i];
    else if (a === "--rpc") rpcFlag = args[++i];
    else if (a === "--all-chains") allChains = true;
    else if (a === "--json") jsonMode = true;
    else if (!a.startsWith("--")) tokens.push(a);
  }
  if (tokens.length === 0) throw new Error("Pass at least one token symbol or address.");

  const configured = configuredChains();
  const configuredNames = configured.map((c) => c.name);

  // ── legacy single-token path (back-compat with sail-swap-quote / sail-template-swap)
  // One token, no --json/--all-chains → today's bare object or array.
  const richMode = tokens.length >= 2 || jsonMode || allChains;
  if (!richMode) {
    const symbolOrAddr = tokens[0];
    if (chainFlag) {
      const chain = resolveChain(chainFlag);
      const rpc = resolveRpc(chain, rpcFlag);
      if (!rpc) throw new Error(rpcHint(chain));
      emitSingle(await resolveOnChain(symbolOrAddr, chain, rpc));
      return;
    }
    if (configured.length >= 2) {
      const results = [];
      for (const entry of configured) {
        try {
          results.push(await resolveOnChain(symbolOrAddr, entry, entry.rpc));
        } catch (err) {
          results.push({ chain: entry.name, chainId: entry.chainId, error: errMsg(err) });
        }
      }
      process.stdout.write(JSON.stringify(results, null, 2) + "\n");
      process.stderr.write(
        `\nResolved "${symbolOrAddr}" on ${configured.length} configured chains:\n` +
          results
            .map((r) =>
              r.error
                ? `  ${r.chain} (${r.chainId}): FAILED — ${r.error}`
                : `  ${r.chain} (${r.chainId}): ${r.address}  dec ${r.decimals}, ${r.swapReady ? `swap-ready fee ${r.feeTier}` : "no USDC V3 pool"}`,
            )
            .join("\n") +
          "\n  (JSON array — one entry per chain; pass --chain <name> for a single object, or --json for the venue map.)\n",
      );
      return;
    }
    // single configured chain (or generic RPC_URL / CHAIN_ID)
    const chain = resolveChain(null);
    const rpc = resolveRpc(chain, null);
    if (!rpc) throw new Error(rpcHint(chain));
    emitSingle(await resolveOnChain(symbolOrAddr, chain, rpc));
    return;
  }

  // ── rich mode: build the chain set we will map ────────────────────────────────
  let chainSet = [];
  if (chainFlag) {
    const c = resolveChain(chainFlag);
    chainSet = [{ ...c, rpc: resolveRpc(c, rpcFlag) }];
  } else {
    chainSet = configured.slice();
    if (chainSet.length === 0) {
      // single-chain project (generic RPC_URL / CHAIN_ID) — map that one chain.
      try {
        const c = resolveChain(null);
        const rpc = resolveRpc(c, null);
        if (rpc) chainSet = [{ ...c, rpc }];
      } catch {
        // no configured chain — only valid with --all-chains
      }
    }
  }
  if (allChains) {
    const env = readSailEnv();
    const have = new Set(chainSet.map((c) => c.name));
    for (const [name, cfg] of Object.entries(CHAINS)) {
      if (cfg.gecko && !have.has(name)) {
        // Only a chain-SPECIFIC RPC (named or chainId-keyed) — never the generic
        // RPC_URL, which would point this chain at the wrong network. No specific
        // var ⇒ GeckoTerminal-only (rpc null).
        const rpc = env[`${name.toUpperCase().replace("-", "_")}_RPC_URL`] ?? env[`RPC_URL_${cfg.chainId}`] ?? null;
        chainSet.push({ name, ...cfg, rpc });
      }
    }
  }
  if (chainSet.length === 0) {
    throw new Error(
      "No chain configured. Set RPC vars in .sail/.env.local, pass --chain <name>, or use --all-chains to scan every Sail mainnet via GeckoTerminal.",
    );
  }

  const scannedNames = chainSet.map((c) => c.name);
  process.stderr.write(
    `Mapping ${tokens.length} token(s) across ${scannedNames.length} chain(s): ${scannedNames.join(", ")}` +
      ` — GeckoTerminal calls are throttled (~${Math.round(60000 / GECKO_SPACING_MS)}/min), this may take a moment.\n`,
  );

  const resolved = [];
  for (const t of tokens) {
    resolved.push(await resolveToken(t, chainSet, configuredNames));
  }

  // single token + (--json/--all-chains) → the token wrapper; many tokens → portfolio.
  if (tokens.length === 1) {
    process.stdout.write(JSON.stringify(resolved[0], null, 2) + "\n");
    process.stderr.write(emitTokenHuman(resolved[0]) + "\n");
    return;
  }

  const summary = buildSummary(resolved, configuredNames, allChains);
  process.stdout.write(JSON.stringify({ tokens: resolved, summary }, null, 2) + "\n");
  process.stderr.write(resolved.map(emitTokenHuman).join("\n") + `\n\nSummary: ${summary.recommendation}\n`);
}

function rpcHint(chain) {
  return `No RPC for chain "${chain.name}". Pass --rpc <url> or set RPC_URL / ${chain.name.toUpperCase()}_RPC_URL / RPC_URL_${chain.chainId} in .sail/.env.local.`;
}

function errMsg(e) {
  return e && typeof e.message === "string" ? e.message : String(e);
}

main().catch((err) => {
  process.stderr.write(`\nresolve-token failed: ${errMsg(err)}\n`);
  process.exit(1);
});
