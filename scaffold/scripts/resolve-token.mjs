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
// Liquidity venues (chain + protocol + pool + depth) come from DexScreener (primary,
// keyless, ~300 req/min) with GeckoTerminal as a deep-coverage fallback (keyless,
// ~10–30 req/min). A venue is Sail-routable if the shared SwapPermission can route it
// (Uniswap V2/V3/V4, Aerodrome, Velodrome, PancakeSwap, SushiSwap). Swap-readiness is
// CONFIRMED on-chain only for Uniswap V3 (USDC→token via QuoterV2) — the one tier the
// resolver live-probes; every other routable venue is feed-reported, not live-quoted.
//
// Output: JSON on stdout (machine-readable); human notes on stderr.

import { readFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

// ── Curated registry (verified live June 2026). Always re-verify decimals on-chain. ──
// Per-chain Uniswap V3 infrastructure + the common tokens. Addresses are PER-CHAIN.
// `dex` is the DexScreener chain id (primary liquidity source, keyless, 300 req/min).
// `gecko` is the GeckoTerminal network id (deep-coverage fallback when DexScreener
// has nothing). `quoterV2`/`usdc`/`tokens` enable on-chain swap-readiness confirmation;
// a chain with none of them resolves via DexScreener/GeckoTerminal only (unverified).
const CHAINS = {
  ethereum: {
    chainId: 1,
    dex: "ethereum",
    gecko: "eth",
    quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    tokens: {
      USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
      WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
      UNI: { address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18 },
      LINK: { address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18 },
      WBTC: { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 },
      USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
      DAI: { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
    },
  },
  // Base also carries Coinbase tokenized stocks (B20 standard, Aug 2026). These are
  // B20 native precompiles — no per-address bytecode on Basescan — but standard ERC-20
  // symbol()/decimals() resolve on-chain. Addresses and 8 decimals verified against
  // docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base and live eth_call.
  // Curated here so they resolve offline without DexScreener.
  base: {
    chainId: 8453,
    dex: "base",
    gecko: "base",
    quoterV2: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    // Aerodrome Slipstream router + quoter — the Gauges V3 (newest) CL factory
    // 0xf8f2eB…, which is where cbHYPE and current Base CL liquidity live. The older
    // Slipstream router 0xBE6D…/quoter 0x254c… serve the LEGACY factory (0x5e7BB1…)
    // and cannot route this generation. Verified against Aerodrome's deployment
    // (CLFactory 0xf8f2eB…, SwapRouter 0x698Cb2…, MixedQuoterV3 0xCd2A7D…).
    aerodromeRouter: "0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F",
    aerodromeQuoter: "0xCd2A7D98e82D6107eac1828ce8DeAA6acB65b555",
    tokens: {
      USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
      DAI: { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
      // Coinbase tokenized stocks (B20, 8 decimals, settled in USDC, trade on Aerodrome).
      NVDAc: { address: "0xb20000000000000000000078ee7ce2fE4908108C", decimals: 8 },
      AAPLc: { address: "0xb200000000000000000000C2e324d24d7eEcd1fb", decimals: 8 },
      METAc: { address: "0xb2000000000000000000008bC8786B856E61707C", decimals: 8 },
      GOOGLc: { address: "0xb2000000000000000000002D0BA3164cc74f58B7", decimals: 8 },
      AMZNc: { address: "0xb200000000000000000000d9192b6B456483C2E8", decimals: 8 },
      COINc: { address: "0xb200000000000000000000c85a31389D71F3ecfb", decimals: 8 },
      CRCLc: { address: "0xB20000000000000000000019f6E7C675b73C2e4D", decimals: 8 },
      INTCc: { address: "0xB2000000000000000000004AFF16039bA04bdFBc", decimals: 8 },
      MSFTc: { address: "0xB200000000000000000000Ab99cFa739E253872B", decimals: 8 },
      MSTRc: { address: "0xb2000000000000000000004884b426556b92883d", decimals: 8 },
      SNDKc: { address: "0xb200000000000000000000397293Cb8cda9a10c5", decimals: 8 },
      SPCXc: { address: "0xb2000000000000000000007b9fcbd005511aCBd5", decimals: 8 },
      TSLAc: { address: "0xb2000000000000000000001e800a7f5189430cD0", decimals: 8 },
    },
  },
  arbitrum: {
    chainId: 42161,
    dex: "arbitrum",
    gecko: "arbitrum",
    quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    tokens: {
      USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
      USDC_E: { address: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", decimals: 6 },
      WETH: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
      ARB: { address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18 },
      LINK: { address: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", decimals: 18 },
      WBTC: { address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8 },
      DAI: { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 },
    },
  },
  optimism: {
    chainId: 10,
    dex: "optimism",
    gecko: "optimism",
    quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    tokens: {
      USDC: { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
      WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
      OP: { address: "0x4200000000000000000000000000000000000042", decimals: 18 },
      USDT: { address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 },
      WBTC: { address: "0x68f180fcCe6836688e9084f035309E29Bf0A2095", decimals: 8 },
      DAI: { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 },
    },
  },
  unichain: {
    chainId: 130,
    dex: "unichain",
    gecko: "unichain",
    quoterV2: "0x385a5cf5f83e99f7bb2852b6a19c3538b9fa7658",
    usdc: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
    tokens: {
      USDC: { address: "0x078D782b760474a361dDA0AF3839290b0EF57AD6", decimals: 6 },
      WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
      UNI: { address: "0x8f187aA05619a017077f5308904739877ce9eA21", decimals: 18 },
      LINK: { address: "0x5a53B6D19D8EDCb7923F0D840EeBB3f09BBeEfB7", decimals: 18 },
      MORPHO: { address: "0x6695a2692dCD2A53E7766492447B5254A56425aD", decimals: 18 },
      USDT: { address: "0x588CE4F028D8e7B53B687865d6A67b3A54C75518", decimals: 6 },
      WBTC: { address: "0x927B51f251480a681271180DA4de28D44EC4AfB8", decimals: 8 },
      DAI: { address: "0x20CAb320A855b39F724131C69424240519573f81", decimals: 18 },
    },
  },
  bsc: {
    chainId: 56,
    dex: "bsc",
    gecko: "bsc",
    quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
    usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    tokens: {
      USDC: { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
      WBNB: { address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18 },
      USDT: { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
      DAI: { address: "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3", decimals: 18 },
    },
  },
  worldchain: {
    chainId: 480,
    dex: "worldchain",
    gecko: null,
    quoterV2: null,
    usdc: null,
    tokens: {
      WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
      WBTC: { address: "0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3", decimals: 8 },
    },
  },
  hyperevm: {
    chainId: 999,
    dex: "hyperevm",
    gecko: null,
    quoterV2: null,
    usdc: null,
    tokens: {},
  },
  megaeth: {
    chainId: 4326,
    dex: "megaeth",
    gecko: null,
    quoterV2: null,
    usdc: null,
    tokens: {},
  },
  robinhood: {
    chainId: 4663,
    dex: "robinhood",
    gecko: null,
    quoterV2: null,
    usdc: null, // no USDC — USDG (Paxos) is the settlement currency; resolve its address at build time
    // Optional alternative for tokenized stocks — Base (USDC) is the default stock home now.
    settleSymbol: "USDG",
    tokens: {},
  },
};

// Coinbase tokenized stocks (B20) carry a lowercase "c" suffix in their on-chain
// symbol (COINc, CRCLc, NVDAc, …). Users name the plain ticker ("COIN", "NVDA") or
// the suffixed form ("COINc"); both must resolve to the curated registry key. The
// alias only fires when the suffixed key actually exists on this chain, so a real
// crypto token that shares a plain ticker is never shadowed.
const STOCK_SUFFIX_ALIASES = {
  NVDA: "NVDAc",
  AAPL: "AAPLc",
  META: "METAc",
  GOOGL: "GOOGLc",
  AMZN: "AMZNc",
  COIN: "COINc",
  CRCL: "CRCLc",
  INTC: "INTCc",
  MSFT: "MSFTc",
  MSTR: "MSTRc",
  SNDK: "SNDKc",
  SPCX: "SPCXc",
  TSLA: "TSLAc",
};

/** Canonical curated-registry key for a user-typed symbol, or null when not curated. */
function curatedKey(chain, wantSym) {
  const tokens = chain.tokens;
  if (tokens[wantSym]) return wantSym;
  // Plain ticker ("COIN") → "COINc". Or suffixed form ("COINc") which uppercase'd to
  // "COINC" — strip the trailing "C" to recover the ticker, then alias it.
  const alias =
    STOCK_SUFFIX_ALIASES[wantSym] ??
    (wantSym.endsWith("C") ? STOCK_SUFFIX_ALIASES[wantSym.slice(0, -1)] : null);
  if (alias && tokens[alias]) return alias;
  return null;
}

// Two-hop intermediates per chain: liquid, settlement-routable assets that a token can
// pair against when it has no direct settlement pool. Each is a real two-swap route
// (settlement → via → token), not a custom-mandate case, so long as the via itself has a
// deep settlement pool. The set is CLOSED and curated: every symbol MUST have a verified
// address in CHAINS[chain].tokens (identity is never guessed), and isViaPair additionally
// rejects a symbol match whose address differs from the registry — a planted "USDT"/"WETH"
// look-alike must never become the intermediate. Chains absent here (robinhood, hyperevm,
// megaeth) have no verified via and are not two-hop candidates.
const VIA_SYMBOLS = {
  ethereum: ["WETH", "USDT", "WBTC", "DAI"],
  base: ["WETH", "DAI"],
  arbitrum: ["WETH", "WBTC", "DAI"],
  optimism: ["WETH", "USDT", "WBTC", "DAI"],
  unichain: ["WETH", "USDT", "WBTC", "DAI"],
  bsc: ["WBNB", "USDT", "DAI"],
  worldchain: ["WETH", "WBTC"],
};

// A two-hop pool below this USD depth is dust — not a real route for a retail DCA.
// Below it, the token is treated as having no two-hop route (so the resolver keeps
// looking for a direct USDC pool or a deeper home), rather than surfacing a $41 pool
// as "swappable in two steps" and masking where the real liquidity lives.
const MIN_TWO_HOP_LIQUIDITY_USD = 10_000;

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
  aeroQuoteExactInputSingleV3: "0x891e50c6", // quoteExactInputSingleV3((address,address,uint256,int24,uint160)) — tagged tickSpacing
  tickSpacing: "0xd0c93a7c", // tickSpacing() (Aerodrome Slipstream pool)
};

// Aerodrome Slipstream's MixedQuoterV3 tags the tickSpacing with the CL factory it
// refers to: 0x80000 | tickSpacing = the newest ("Gauges V3") factory (0xf8f2eB…),
// 0x100000 | tickSpacing = the legacy factory, raw tickSpacing = legacyCLFactory2.
// The SwapRouter is single-factory and uses the RAW tickSpacing in its path; only the
// quoter needs the tag. Our probe reads the raw tickSpacing off the pool and tags it
// for the quote here.
const AERODROME_FACTORY_TAG = 0x80000;

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

function encodeAeroQuoteCall(tokenIn, tokenOut, amountIn, tickSpacing) {
  // Aerodrome Slipstream MixedQuoterV3 quoteExactInputSingleV3((address tokenIn,
  // address tokenOut, uint256 amountIn, int24 tickSpacing, uint160 sqrtPriceLimitX96))
  // — same 5-word layout as Uniswap V3, but the 4th field is the FACTORY-TAGGED
  // tickSpacing (0x80000 | tickSpacing for the newest factory) and the selector differs.
  return (
    SEL.aeroQuoteExactInputSingleV3 +
    pad32(tokenIn) +
    pad32(tokenOut) +
    uintToHex(amountIn) +
    uintToHex(BigInt(AERODROME_FACTORY_TAG | tickSpacing)) +
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
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429) {
        // Public endpoints rate-limit; a transient 429 must not be read as "no pool".
        lastErr = new Error(`eth_call HTTP 429 to ${to}`);
        await sleep(2500 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`eth_call HTTP ${res.status} to ${to}`);
      const json = await res.json();
      if (json.error) throw new Error(`eth_call reverted: ${JSON.stringify(json.error)}`);
      if (!json.result) throw new Error(`eth_call returned no result`);
      return json.result;
    } catch (e) {
      lastErr = e;
      // Distinguish a clean revert (a pool genuinely missing) from a transport/rate
      // error: only back off on the latter. A revert throws the same shape here, so
      // we retry a revert once before giving up, which is harmless for the quote probe.
      if (attempt < 2) await sleep(1200);
    }
  }
  throw lastErr || new Error(`eth_call failed to ${to}`);
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

// ── DexScreener (primary) + GeckoTerminal (fallback) liquidity sources ───────────
// DexScreener: keyless, ~300 req/min, flat response, covers all 12 Sail mainnets.
// GeckoTerminal: keyless, ~10–30 req/min, deeper token/DEX coverage for the long tail.
// Both are throttled + cached + retried; spacing widens adaptively on a 429.
const DEX_API = "https://api.dexscreener.com";
const DEX_SPACING_MS = Number(process.env.DEX_MIN_SPACING_MS || 350);
const DEX_SPACING_MAX_MS = Number(process.env.DEX_MAX_SPACING_MS || 5000);
const GECKO_API = "https://api.geckoterminal.com/api/v2";
const GECKO_SPACING_MS = Number(process.env.GECKO_MIN_SPACING_MS || 2500);
const GECKO_SPACING_MAX_MS = Number(process.env.GECKO_MAX_SPACING_MS || 15000);
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── liquidity map (optional offline cache) ─────────────────────────────────────
// scripts/liquidity-map.json is a DexScreener-derived cache of top assets → address +
// routable + depth per chain, refreshed offline by scripts/build-liquidity-map.mjs.
// It is STRICTLY additive: the curated registry wins, the map fills chains the registry
// lacks, and the live feed fills the rest. Map entries are never treated as on-chain
// verified — an RPC still re-verifies symbol()/decimals() when one is configured.
let liquidityMap = null;
function loadLiquidityMap(mapPath) {
  if (liquidityMap) return liquidityMap;
  const p = mapPath || resolvePath(process.cwd(), "scripts/liquidity-map.json");
  try {
    const m = JSON.parse(readFileSync(p, "utf8"));
    liquidityMap = m && m.tokens ? m : { tokens: {} };
  } catch {
    liquidityMap = { tokens: {} }; // no map / unreadable → behave as if absent
  }
  return liquidityMap;
}
function mapLookup(symbolUp, chainName) {
  if (!liquidityMap) return null;
  const t = liquidityMap.tokens[symbolUp];
  return (t && t[chainName]) || null;
}

// Whether a liquidity-map entry's address may be trusted as the token's identity.
// Trusted ONLY when it has a positive routing signal (routable, or a two-hop hub pool)
// AND actually trades (volume24hUsd > 0). A planted look-alike carries fake liquidity
// and zero volume, so even a positive hubDex signal is rejected and the resolver falls
// through to the live volume-ranked search — this is the SKY bug (the committed map
// recorded the planted $1.1B zero-volume copy as canonical). A pre-v5 map entry (no
// volume field) is not trusted either, so an old map can never pin a wrong address.
function shouldTrustMapEntry(mapped) {
  return !!(
    mapped &&
    mapped.address &&
    (mapped.routable || mapped.hubDex) &&
    (mapped.volume24hUsd ?? 0) > 0
  );
}

// The map's depth figures age; identity/addresses are re-verified on-chain and a
// stale map is a positive cache only (it can miss fresh liquidity, never return
// wrong data). After this many days the resolver nudges a refresh so depth
// screening isn't silently stale. Pure helper so it is unit-testable.
const MAP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
function isMapStale(generatedAt, nowMs = Date.now()) {
  if (!generatedAt) return false;
  const t = Date.parse(generatedAt);
  return !Number.isNaN(t) && nowMs - t > MAP_MAX_AGE_MS;
}

// ── token identity (disambiguation) ────────────────────────────────────────────
// scripts/token-identities.json is a curated catalog of what a symbol IS (stable):
// kind, name, and candidate tickers/meanings. Identity is the ONLY thing safe to
// cache permanently; liquidity is dynamic and resolved live. `identify` prints a
// disambiguation plan so the agent asks one cheap confirmation before searching.
let identities = null;
function loadIdentities(idPath) {
  if (identities) return identities;
  const p = idPath || resolvePath(process.cwd(), "scripts/token-identities.json");
  try {
    const m = JSON.parse(readFileSync(p, "utf8"));
    identities = m && m.tokens ? m.tokens : {};
  } catch {
    identities = {}; // no catalog / unreadable → behave as if absent
  }
  return identities;
}

/**
 * Build a disambiguation plan for a list of user-typed symbols. Returns
 * { identified, ambiguous, unknown }:
 *   - identified: single-candidate symbols (auto-proceed, with their canonical ticker)
 *   - ambiguous: multi-candidate symbols (ask one confirmation each)
 *   - unknown: not in the catalog (resolve live; the on-chain symbol() check is the authority)
 */
function identifySymbols(symbols, idPath) {
  const catalog = loadIdentities(idPath);
  const identified = [];
  const ambiguous = [];
  const unknown = [];
  for (const raw of symbols) {
    const isAddr = ADDR_RE.test(raw);
    const up = raw.toUpperCase();
    const entry = catalog[up];
    if (isAddr) {
      identified.push({ query: raw, ticker: null, note: "address input — resolved directly" });
    } else if (entry && entry.candidates.length === 1) {
      identified.push({ query: raw, ticker: entry.candidates[0].ticker, name: entry.name, kind: entry.kind });
    } else if (entry && entry.candidates.length > 1) {
      ambiguous.push({
        query: raw,
        name: entry.name,
        kind: entry.kind,
        question: `${raw} = ${entry.name}? Which one:`,
        candidates: entry.candidates.map((c) => ({ ticker: c.ticker, chain: c.chain || null, what: c.what, default: !!c.default })),
      });
    } else {
      unknown.push({ query: raw, note: "not in the identity catalog — resolve live" });
    }
  }
  return { identified, ambiguous, unknown };
}

const dexCache = new Map();
let dexLock = Promise.resolve();
let lastDexTs = 0;
let dexSpacingMs = DEX_SPACING_MS;

async function dexGet(url) {
  if (dexCache.has(url)) return dexCache.get(url);
  const task = dexLock.then(async () => {
    if (dexCache.has(url)) return dexCache.get(url); // filled while we queued
    const since = Date.now() - lastDexTs;
    if (since < dexSpacingMs) await sleep(dexSpacingMs - since);
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { accept: "application/json", "user-agent": "sailor-resolve-token" },
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 429) {
          lastErr = new Error("DexScreener 429 (rate-limited)");
          dexSpacingMs = Math.min(dexSpacingMs * 2, DEX_SPACING_MAX_MS);
          await sleep(dexSpacingMs);
          continue;
        }
        if (!res.ok) throw new Error(`DexScreener HTTP ${res.status} for ${url}`);
        const json = await res.json();
        dexCache.set(url, json);
        dexSpacingMs = Math.max(dexSpacingMs * 0.9, DEX_SPACING_MS);
        return json;
      } catch (e) {
        lastErr = e;
        await sleep(1200);
      }
    }
    throw lastErr || new Error("DexScreener request failed");
  });
  dexLock = task.then(
    () => {
      lastDexTs = Date.now();
    },
    () => {
      lastDexTs = Date.now();
    },
  );
  return task;
}

const geckoCache = new Map();
let geckoLock = Promise.resolve();
let lastGeckoTs = 0;
// Adaptive spacing. The free tier throttles unpredictably, so a fixed 2.5s gap can
// slide into repeated 429s, each costing an 8s backoff that stacks into a multi-minute
// stall. Instead we start at the minimum and, on a 429, widen the gap (up to a cap) so
// the next call is far less likely to rate-limit; on a clean success we decay back
// toward the minimum. This trades a little latency for never stalling the whole run.
let geckoSpacingMs = GECKO_SPACING_MS;

async function geckoGet(url) {
  if (geckoCache.has(url)) return geckoCache.get(url);
  const task = geckoLock.then(async () => {
    if (geckoCache.has(url)) return geckoCache.get(url); // filled while we queued
    const since = Date.now() - lastGeckoTs;
    if (since < geckoSpacingMs) await sleep(geckoSpacingMs - since);
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
          // Widen the gap on every 429 (honour retry-after when present) so we stop
          // hitting the limit on the very next call.
          geckoSpacingMs = Math.min(geckoSpacingMs * 2, GECKO_SPACING_MAX_MS);
          await sleep(ra > 0 ? ra * 1000 : geckoSpacingMs);
          continue;
        }
        if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status} for ${url}`);
        const json = await res.json();
        geckoCache.set(url, json);
        // Clean success: relax back toward the minimum spacing.
        geckoSpacingMs = Math.max(geckoSpacingMs * 0.9, GECKO_SPACING_MS);
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

// dexId → a canonical protocol family + whether Sail's shared SwapPermission can route
// it. The template takes an arbitrary `routers[]` allowlist + token allowlists + a
// slippage band against a Chainlink oracle, so it is DEX-agnostic: Uniswap V2/V3/V4,
// Aerodrome, Velodrome, PancakeSwap and SushiSwap are all routable once their router is
// allowlisted. `quoteVerified` stays the Uniswap V3 QuoterV2 on-chain confirmation — the
// only tier the resolver live-probes; the rest are routable-but-not-live-confirmed.
// Handles both source formats: GeckoTerminal's "uniswap-v3-base" and DexScreener's bare
// "uniswap" with the version in `labels` (["v3"]).
function classifyDex(dexId, labels, chainName) {
  const id = (dexId || "").toLowerCase();
  const tags = new Set((labels || []).map((l) => String(l).toLowerCase()));
  let protocol = "other";
  if (id === "uniswap" || id.startsWith("uniswap-v") || id.startsWith("uniswap_v")) {
    // Uniswap: DexScreener uses a bare "uniswap" dexId for V2/V3/V4 with the version in
    // `labels`, but on Arbitrum/Optimism/Base/Unichain it omits `labels` entirely (those
    // chains are V3-only). So a bare "uniswap" with no version label is V3 — V2 and V4 are
    // always explicitly labelled. GeckoTerminal ids ("uniswap-v3-base") carry the version.
    if (tags.has("v2")) protocol = "uniswap-v2";
    else if (tags.has("v4")) protocol = "uniswap-v4";
    else if (tags.has("v3")) protocol = "uniswap-v3";
    else if (id.includes("v2")) protocol = "uniswap-v2";
    else if (id.includes("v4")) protocol = "uniswap-v4";
    else protocol = "uniswap-v3"; // bare "uniswap", no label → V3
  } else if (id.includes("sushiswap")) {
    protocol = "sushiswap";
  } else if (id.includes("pancakeswap")) {
    protocol = "pancakeswap";
  } else if (id.includes("aerodrome")) {
    protocol = "aerodrome";
  } else if (id.includes("velodrome")) {
    protocol = "velodrome";
  }
  // Routable = the shared SwapPermission can route it (its router is allowlist-able).
  // V4 is Unichain-only (Universal Router); the others are routable on every chain.
  const ROUTABLE = new Set([
    "uniswap-v2",
    "uniswap-v3",
    "sushiswap",
    "pancakeswap",
    "aerodrome",
    "velodrome",
  ]);
  let sailRoutable = ROUTABLE.has(protocol);
  if (protocol === "uniswap-v4") sailRoutable = chainName === "unichain";
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
// protocol. DexScreener first (keyless, 300 req/min); GeckoTerminal as deep-coverage
// fallback when DexScreener has nothing.
async function fetchVenues(chain, tokenAddrLower, ourSymbolUp) {
  const venues = await fetchVenuesDex(chain, tokenAddrLower, ourSymbolUp);
  if (venues.length > 0) return venues;
  return fetchVenuesGecko(chain, tokenAddrLower, ourSymbolUp);
}

async function fetchVenuesDex(chain, tokenAddrLower, ourSymbolUp) {
  const chainId = chain.dex;
  if (!chainId) return [];
  let json;
  try {
    json = await dexGet(`${DEX_API}/token-pairs/v1/${chainId}/${tokenAddrLower}`);
  } catch {
    return []; // DexScreener failed → fall through to GeckoTerminal
  }
  const pairs = Array.isArray(json) ? json : [];
  const venues = [];
  for (const p of pairs) {
    const base = p.baseToken || {};
    const quote = p.quoteToken || {};
    const baseAddr = (base.address || "").toLowerCase();
    const quoteAddr = (quote.address || "").toLowerCase();
    let pairedToken = null;
    let pairedSymbol = null;
    if (baseAddr === tokenAddrLower) {
      pairedToken = quoteAddr || null;
      pairedSymbol = (quote.symbol || "").toUpperCase() || null;
    } else if (quoteAddr === tokenAddrLower) {
      pairedToken = baseAddr || null;
      pairedSymbol = (base.symbol || "").toUpperCase() || null;
    } else {
      continue; // our token isn't actually base/quote of this pool
    }
    const { protocol, sailRoutable } = classifyDex(p.dexId, p.labels, chain.name);
    venues.push({
      protocol,
      dexId: p.dexId || "",
      pool: p.pairAddress || null,
      feeTier: null, // DexScreener does not expose the pool fee; the on-chain probe fills it
      pairedSymbol,
      pairedToken,
      liquidityUsd: Math.round(Number((p.liquidity && p.liquidity.usd) || 0)),
      volume24hUsd: Math.round(Number((p.volume && p.volume.h24) || 0)),
      sailRoutable,
      quoteVerified: false,
    });
  }
  venues.sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  return venues;
}

async function fetchVenuesGecko(chain, tokenAddrLower, ourSymbolUp) {
  const geckoNet = chain.gecko;
  if (!geckoNet) return [];
  const url = `${GECKO_API}/networks/${geckoNet}/tokens/${tokenAddrLower}/pools?page=1`;
  const json = await geckoGet(url);
  const pools = Array.isArray(json.data) ? json.data : [];
  const venues = [];
  for (const p of pools) {
    const at = p.attributes || {};
    const rel = p.relationships || {};
    const dexId = (((rel.dex || {}).data) || {}).id || "";
    const { protocol, sailRoutable } = classifyDex(dexId, undefined, chain.name);
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
  if (!geckoNet) return { symbol: null, decimals: null };
  const url = `${GECKO_API}/networks/${geckoNet}/tokens/${tokenAddrLower}`;
  const json = await geckoGet(url);
  const at = ((json.data || {}).attributes) || {};
  return { symbol: at.symbol || null, decimals: at.decimals != null ? Number(at.decimals) : null };
}

// Rank symbol→address candidates so the REAL token wins. A contract that actually
// trades (real 24h volume) is the canonical token; a contract whose only pools are
// deep-but-silent (planted liquidity, zero volume) is a look-alike and must NOT be
// selected over one that trades. Falls back to deepest liquidity when nothing trades
// (a genuinely quiet but real token). This is what keeps the resolver from resolving
// "ZAMA" to a planted $150M zero-volume copy instead of the real token.
function rankCandidateAddresses(candidates) {
  const scored = candidates.map((c) => ({
    address: c.address,
    liquidityUsd: Number(c.liquidityUsd) || 0,
    volume24hUsd: Number(c.volume24hUsd) || 0,
  }));
  scored.sort((a, b) => {
    const aReal = a.volume24hUsd > 0;
    const bReal = b.volume24hUsd > 0;
    if (aReal !== bReal) return aReal ? -1 : 1; // real volume first
    if (aReal) return b.volume24hUsd - a.volume24hUsd; // then by volume
    return b.liquidityUsd - a.liquidityUsd; // both silent → deepest first
  });
  return scored.map((c) => c.address);
}

// symbol → address via GeckoTerminal search (fallback when not in the curated
// registry). Ranks candidate addresses by real volume first (deepest otherwise); the
// on-chain symbol() check in resolveOnChain is the final authority.
async function resolveSymbolViaGeckoTerminal(symbolUp, geckoNet) {
  if (!geckoNet) return [];
  const url = `${GECKO_API}/search/pools?query=${encodeURIComponent(symbolUp)}&network=${encodeURIComponent(geckoNet)}`;
  const json = await geckoGet(url);
  const pools = Array.isArray(json.data) ? json.data : [];
  const byAddr = new Map(); // address -> { liq, vol }
  const bump = (a, liq, vol) => {
    const prev = byAddr.get(a);
    if (prev) {
      if (liq > prev.liq) prev.liq = liq;
      if (vol > prev.vol) prev.vol = vol;
    } else {
      byAddr.set(a, { liq, vol });
    }
  };
  for (const p of pools) {
    const name = (p.attributes && p.attributes.name) || "";
    const parts = name.split("/").map((s) => s.trim().split(/\s+/)[0].toUpperCase());
    const rel = p.relationships || {};
    const baseAddr = addrFromGeckoId((((rel.base_token || {}).data) || {}).id || "");
    const quoteAddr = addrFromGeckoId((((rel.quote_token || {}).data) || {}).id || "");
    const liq = Number((p.attributes && p.attributes.reserve_in_usd) || 0);
    const vol = Number(((p.attributes && p.attributes.volume_usd) || {}).h24 || 0);
    if (parts[0] === symbolUp && ADDR_RE.test(baseAddr)) bump(baseAddr, liq, vol);
    if (parts[1] === symbolUp && ADDR_RE.test(quoteAddr)) bump(quoteAddr, liq, vol);
  }
  return rankCandidateAddresses(
    [...byAddr.entries()].map(([address, v]) => ({
      address,
      liquidityUsd: v.liq,
      volume24hUsd: v.vol,
    })),
  );
}

// symbol → address via DexScreener search (primary fallback when not in the curated
// registry). Ranks candidate addresses by real volume first (deepest otherwise); the
// on-chain symbol() check in resolveOnChain is the final authority.
async function resolveSymbolViaDexScreener(symbolUp, chain) {
  const chainId = chain.dex;
  if (!chainId) return [];
  let json;
  try {
    json = await dexGet(`${DEX_API}/latest/dex/search?q=${encodeURIComponent(symbolUp)}`);
  } catch {
    return [];
  }
  const pairs = Array.isArray(json.pairs) ? json.pairs : [];
  const byAddr = new Map(); // address -> { liq, vol }
  const bump = (a, liq, vol) => {
    const prev = byAddr.get(a);
    if (prev) {
      if (liq > prev.liq) prev.liq = liq;
      if (vol > prev.vol) prev.vol = vol;
    } else {
      byAddr.set(a, { liq, vol });
    }
  };
  for (const p of pairs) {
    if ((p.chainId || "").toLowerCase() !== chainId) continue; // this chain only
    const base = p.baseToken || {};
    const quote = p.quoteToken || {};
    const liq = Number((p.liquidity && p.liquidity.usd) || 0);
    const vol = Number((p.volume && p.volume.h24) || 0);
    if ((base.symbol || "").toUpperCase() === symbolUp && ADDR_RE.test(base.address || "")) {
      bump(base.address.toLowerCase(), liq, vol);
    }
    if ((quote.symbol || "").toUpperCase() === symbolUp && ADDR_RE.test(quote.address || "")) {
      bump(quote.address.toLowerCase(), liq, vol);
    }
  }
  return rankCandidateAddresses(
    [...byAddr.entries()].map(([address, v]) => ({
      address,
      liquidityUsd: v.liq,
      volume24hUsd: v.vol,
    })),
  );
}

// symbol → candidate addresses: DexScreener first, GeckoTerminal as deep fallback.
// Returns { addresses, via } so the caller can record which source found the token.
async function resolveSymbol(symbolUp, chain) {
  const dex = await resolveSymbolViaDexScreener(symbolUp, chain);
  if (dex.length > 0) return { addresses: dex, via: "dexscreener" };
  const gecko = await resolveSymbolViaGeckoTerminal(symbolUp, chain.gecko || null);
  return { addresses: gecko, via: "geckoterminal" };
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

// Probe a tokenIn→tokenOut swap across the standard fee tiers and return the best
// (highest amountOut) live quote, or null when no tier has a pool. Generalised from
// the direct USDC→token probe so two-hop legs (USDC→hub, hub→token) reuse it too.
async function probeBestFee(rpc, quoter, tokenIn, tokenOut, amountIn) {
  let best = null;
  for (const fee of FEE_TIERS) {
    const data = encodeQuoteCall(tokenIn, tokenOut, amountIn, fee);
    try {
      const ret = await ethCall(rpc, quoter, data);
      const amountOut = decodeUint256Return(ret);
      if (amountOut > 0n && (!best || amountOut > best.amountOut)) {
        best = { fee, amountOut };
      }
    } catch {
      // revert = no pool at this tier
    }
  }
  return best;
}

function isUsdcPair(venue, chain) {
  if (!venue) return false;
  // The chain's settlement currency symbol: "USDC" almost everywhere, but "USDG" on
  // Robinhood and "USDT" on BNB. A token paired against the settlement currency is the
  // swap-readiness signal (what a USDC DCA would route through on a USDC chain).
  const settle = chain.settleSymbol || "USDC";
  if (venue.pairedSymbol === settle) return true;
  if (settle === "USDC" && venue.pairedSymbol === "USDC.E") return true;
  return !!(chain.usdc && venue.pairedToken && venue.pairedToken.toLowerCase() === chain.usdc.toLowerCase());
}

// A Sail-routable pool paired with a curated two-hop intermediate (WETH/WBNB/USDT/WBTC/
// DAI). Not a DIRECT settlement-currency pool, but a real two-swap route: settlement →
// via → token. This needs no custom mandate — the same swap template can do both hops —
// so it is a normal route, just with one extra leg. Returns the venue, or null when the
// pool is dust (below MIN_TWO_HOP_LIQUIDITY_USD), not paired with a curated via, a suspect
// look-alike (huge TVL with zero 24h volume — a planted pool, not a real route), or a
// symbol whose address differs from the verified registry (a planted "USDT"/"WETH"
// look-alike must not become the intermediate).
function isViaPair(venue, chain) {
  if (!venue || !venue.sailRoutable) return null;
  const vias = VIA_SYMBOLS[chain.name];
  if (!vias || !vias.includes(venue.pairedSymbol)) return null;
  const reg = chain.tokens && chain.tokens[venue.pairedSymbol];
  if (reg && venue.pairedToken && venue.pairedToken.toLowerCase() !== reg.address.toLowerCase()) {
    return null; // symbol matches but the address is a look-alike — reject
  }
  if ((venue.liquidityUsd ?? 0) < MIN_TWO_HOP_LIQUIDITY_USD) return null;
  if (isSuspectVolume(venue)) return null;
  return venue;
}

// The single venue that best represents swap-readiness FROM USDC (Sail's DCA sell
// leg): deepest Sail-routable USDC pool, else deepest routable pool, else deepest
// pool overall. Drives the cross-chain depth ranking, so it must be USDC-relevant —
// not, say, a huge WETH/BEAT pool that we'd never route a USDC DCA through.
function pickBestVenue(venues, chain) {
  const routableUsdc = venues.filter((v) => v.sailRoutable && isUsdcPair(v, chain));
  const routable = venues.filter((v) => v.sailRoutable);
  // Prefer a venue that actually fits the trade size and has real volume; fall back
  // to the deepest routable venue (still reported, but flagged by the caller).
  const good = (v) => v.fitsSize !== false && !v.suspectVolume;
  const top = (routableUsdc.find(good) || routableUsdc[0]) || (routable.find(good) || routable[0]) || venues[0] || null;
  if (!top) return null;
  return {
    protocol: top.protocol,
    feeTier: top.feeTier,
    liquidityUsd: top.liquidityUsd,
    pool: top.pool,
    pairedSymbol: top.pairedSymbol,
    sailRoutable: top.sailRoutable,
    volume24hUsd: top.volume24hUsd ?? 0,
    estImpactPct: top.estImpactPct ?? null,
    fitsSize: top.fitsSize ?? null,
    suspectVolume: top.suspectVolume ?? false,
  };
}

// ── size-aware liquidity screening ──────────────────────────────────────────────
// Whether a pool can absorb a swap of `sizeUsd` without excessive price impact.
// Defaults to a $1K retail leg; pass --size to evaluate a different amount. Impact is
// estimated as 2·size/TVL (constant-product), which is an UPPER bound for concentrated
// V3 pools — the live on-chain quote is always the authority for the real number.
const DEFAULT_SIZE_USD = 1000;
const MAX_IMPACT_PCT = 3; // retail cap: reject as "too thin" above this
const SUSPECT_VOLUME_TVL = 100_000; // a pool this big with zero 24h volume is seeded/look-alike

function estimateImpactPct(sizeUsd, liquidityUsd) {
  if (!liquidityUsd || liquidityUsd <= 0) return null;
  return (2 * sizeUsd / liquidityUsd) * 100;
}

function isSuspectVolume(venue) {
  return (venue.liquidityUsd ?? 0) > SUSPECT_VOLUME_TVL && (venue.volume24hUsd ?? 0) === 0;
}

/** Annotate every venue with size-aware + volume signals, in place. */
function annotateVenues(venues, sizeUsd) {
  for (const v of venues) {
    const impact = estimateImpactPct(sizeUsd, v.liquidityUsd);
    v.estImpactPct = impact == null ? null : Math.round(impact * 100) / 100;
    v.fitsSize = impact != null && impact <= MAX_IMPACT_PCT;
    v.suspectVolume = isSuspectVolume(v);
  }
}

// ── per-chain resolution (shared by single-, multi-chain and portfolio modes) ──
// Resolves symbolOrAddr on ONE chain. With an RPC it is the authority: on-chain
// symbol()/decimals() + a live Uniswap V3 USDC→token QuoterV2 probe. Without an RPC
// (an --all-chains scan of an unconfigured chain) it falls back to the DEX feed
// (DexScreener, then GeckoTerminal) and treats a deep Sail-routable venue as
// swap-ready (unverified).
async function resolveOnChain(symbolOrAddr, chain, rpc, sizeUsd = DEFAULT_SIZE_USD) {
  const onchain = !!rpc;
  const isAddrInput = ADDR_RE.test(symbolOrAddr);
  const wantSym = isAddrInput ? null : symbolOrAddr.toUpperCase();
  let address, verifiedSymbol, decimals, source, decimalsSource;

  if (isAddrInput) {
    address = symbolOrAddr;
    source = "address-input";
  } else {
    const regKey = curatedKey(chain, wantSym);
    const entry = regKey ? chain.tokens[regKey] : null;
    if (entry) {
      address = entry.address;
      // The registry carries verified decimals — use them instead of a rate-limited
      // GeckoTerminal metadata call in the no-RPC path.
      decimals = entry.decimals;
      decimalsSource = "registry";
      source = "registry";
      // Resolve to the on-chain symbol (e.g. "COINc"), not the plain ticker the user
      // typed ("COIN"), so the address/decimals are unambiguously the stock token.
      verifiedSymbol = regKey;
    } else {
      // Offline liquidity map (additive): a cached address + routable flag for this
      // chain, cheaper than a live lookup. Only fills chains the curated registry
      // lacks; never treated as on-chain verified. The address is trusted ONLY when
      // the entry has a positive signal (routable, or a two-hop hub pool) AND actually
      // trades (volume24hUsd > 0). A look-alike carries fake liquidity and zero volume,
      // so even a positive hubDex signal is rejected and the resolver falls through to
      // the live volume-ranked search — the SKY bug (the map recorded the planted
      // $1.1B zero-volume copy as canonical).
      const mapped = mapLookup(wantSym, chain.name);
      if (shouldTrustMapEntry(mapped)) {
        address = mapped.address;
        source = "liquidity-map";
        if (mapped.decimals != null) {
          decimals = mapped.decimals;
          decimalsSource = "liquidity-map";
        }
      } else {
        // Fallback: resolve symbol → address via DexScreener (then GeckoTerminal).
        const { addresses: candidates, via } = await resolveSymbol(wantSym, chain);
        if (candidates.length === 0) {
          throw new Error(
            `"${symbolOrAddr}" is not in the curated ${chain.name} registry and no DEX source found a pool for it on ${chain.name}. ` +
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
              `The DEX search returned ${candidates.length} candidate address(es) for "${symbolOrAddr}" on ${chain.name}, but none verified on-chain with symbol() == "${wantSym}" ` +
                `(tried: ${tried.map((t) => `${t.address}→${t.symbol || "no-contract"}`).join(", ")}). ` +
                `Pass the token's 0x address directly: node scripts/resolve-token.mjs 0x... --chain ${chain.name}`,
            );
          }
          address = resolved.address;
          verifiedSymbol = resolved.symbol;
          decimals = resolved.decimals;
          source = via;
          decimalsSource = "onchain";
        } else {
          // No RPC: candidates are ranked by pool depth, but depth alone can't tell two
          // different contracts sharing a ticker apart (a collision). Cross-check each
          // candidate's own token metadata — independent of the pool-name parsing used to
          // build the candidate list — and prefer the first whose symbol actually matches,
          // rather than blindly trusting the deepest pool.
          let verified = null;
          for (const cand of candidates) {
            try {
              const m = await fetchTokenMeta(chain.gecko || null, cand.toLowerCase());
              if (m.symbol && m.symbol.toUpperCase() === wantSym) {
                verified = cand;
                break;
              }
            } catch {
              // metadata lookup failed for this candidate — try the next
            }
          }
          address = verified || candidates[0];
          source = verified ? `${via}-unverified` : `${via}-unverified-collision`;
        }
      }
    }
  }

  // Metadata: on-chain symbol()+decimals() is the source of truth when we have an RPC.
  if (onchain && source !== "dexscreener" && source !== "geckoterminal") {
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
    // no-RPC path: best-effort metadata from the DEX feed (may be null on chains
    // without GeckoTerminal coverage).
    try {
      const m = await fetchTokenMeta(chain.gecko || null, address.toLowerCase());
      if (m.symbol) verifiedSymbol = m.symbol;
      decimals = m.decimals;
    } catch {
      decimals = null;
    }
    decimalsSource = "unverified";
  }
  if (verifiedSymbol === undefined) verifiedSymbol = wantSym || null;
  if (decimals === undefined) decimals = null;

  const isUsdc = !!chain.usdc && address.toLowerCase() === chain.usdc.toLowerCase();

  // Liquidity venue map. When the token came from the offline liquidity map and there's
  // no RPC to confirm on-chain, synthesize a single Sail-routable USDC venue from the
  // cached flag instead of a live feed scan — that's the map's whole speedup. A live scan
  // still runs whenever an RPC is present (to on-chain-confirm) or the map has no positive
  // signal for this chain (to keep full fidelity for the long tail / negative cases).
  // USDC itself (the quote asset) needs no venue map — its swap-readiness is definitional.
  let venues = [];
  let venuesError = null;
  const mapped = source === "liquidity-map" ? mapLookup(wantSym, chain.name) : null;
  if (isUsdc && !onchain) {
    venues = []; // quote asset — no venue scan needed in the no-RPC path
  } else if (!onchain && mapped && (mapped.routable || mapped.hubDex)) {
    // The map is a POSITIVE cache: routable → synthesize a USDC venue; hub-paired →
    // synthesize a two-hop (WETH) venue. A negative entry (routable:false, no hubDex)
    // is NOT trusted as a complete answer — a stale map predating two-hop recording
    // would otherwise hide real WETH/other-pair liquidity, so those fall through to
    // the live scan below.
    if (mapped.routable) {
      venues = [
        {
          protocol: mapped.dex || "uniswap-v3",
          dexId: "liquidity-map",
          pool: null,
          feeTier: null,
          pairedSymbol: "USDC",
          pairedToken: chain.usdc || null,
          liquidityUsd: mapped.liquidityUsd ?? 0,
          volume24hUsd: 0,
          sailRoutable: true,
          quoteVerified: false,
        },
      ];
    } else if (mapped.hubDex && mapped.hubSymbol) {
      // Two-hop: the map found no direct USDC pool but did find a Sail-routable pool
      // against a curated via asset (WETH/USDT/WBTC/DAI…). Synthesize that as a two-hop
      // venue so the token surfaces as swappable (settlement → via → token) instead of
      // "no pool". isViaPair() picks this up for the twoHop flag below.
      const viaSym = mapped.hubSymbol;
      venues = [
        {
          protocol: mapped.hubDex,
          dexId: "liquidity-map",
          pool: null,
          feeTier: null,
          pairedSymbol: viaSym,
          pairedToken: (chain.tokens[viaSym] && chain.tokens[viaSym].address) || null,
          liquidityUsd: mapped.hubLiquidityUsd ?? mapped.liquidityUsd ?? 0,
          volume24hUsd: 0,
          sailRoutable: true,
          quoteVerified: false,
        },
      ];
    }
  } else if (chain.dex || chain.gecko) {
    try {
      venues = await fetchVenues(chain, address.toLowerCase(), (verifiedSymbol || wantSym || "").toUpperCase());
    } catch (e) {
      venuesError = errMsg(e);
    }
  }

  // Size-aware + volume flags on every venue (used by pickBestVenue + the report).
  annotateVenues(venues, sizeUsd);

  // Swap-readiness. On-chain: a live Uniswap V3 USDC→token QuoterV2 quote across fee
  // tiers (Sail's executable route). Off-chain (--all-chains scan): a deep Sail-routable
  // venue exists, but is NOT live-quoted (quoteVerified stays false).
  let best = null; // { dex, fee, tickSpacing, amountOut }
  const tried = [];
  let swapReady;
  let quote = null;

  if (isUsdc) {
    swapReady = true; // USDC is the quote asset itself
  } else if (onchain && chain.quoterV2 && chain.usdc) {
    const tokenIn = chain.usdc;
    // Uniswap V3: probe across the standard fee tiers.
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
      tried.push({ dex: "uniswap-v3", fee, amountOut: amountOut.toString(), ok });
      if (ok && amountOut > 0n && (!best || amountOut > best.amountOut)) {
        best = { dex: "uniswap-v3", fee, tickSpacing: null, amountOut };
      }
    }
    // Aerodrome Slipstream: probe each USDC-paired aerodrome pool by its tickSpacing.
    if (chain.aerodromeQuoter) {
      for (const v of venues) {
        if (v.protocol !== "aerodrome" || !isUsdcPair(v, chain) || !v.pool) continue;
        let ts;
        try {
          ts = Number(decodeUint256Return(await ethCall(rpc, v.pool, SEL.tickSpacing)));
        } catch {
          continue; // not a Slipstream pool (no tickSpacing) — skip
        }
        if (!ts) continue;
        const data = encodeAeroQuoteCall(tokenIn, address, PROBE_AMOUNT_USDC, ts);
        let amountOut = 0n;
        let ok = true;
        try {
          const ret = await ethCall(rpc, chain.aerodromeQuoter, data);
          amountOut = decodeUint256Return(ret);
        } catch {
          ok = false;
        }
        tried.push({ dex: "aerodrome", tickSpacing: ts, amountOut: amountOut.toString(), ok });
        if (ok && amountOut > 0n && (!best || amountOut > best.amountOut)) {
          best = { dex: "aerodrome", fee: null, tickSpacing: ts, amountOut };
        }
      }
    }
    swapReady = best !== null;
    if (best) {
      // Flag the matching venue in the map as live-quoted.
      const m = venues.find(
        best.dex === "aerodrome"
          ? (v) => v.protocol === "aerodrome" && v.pool && isUsdcPair(v, chain)
          : (v) => v.protocol === "uniswap-v3" && v.feeTier === best.fee && isUsdcPair(v, chain),
      );
      if (m) m.quoteVerified = true;
      const hopNote =
        best.dex === "aerodrome"
          ? `tickSpacing ${best.tickSpacing}`
          : `fee ${best.fee}`;
      quote = {
        tokenIn: "USDC",
        tokenInAddress: tokenIn,
        amountIn: PROBE_AMOUNT_USDC.toString(),
        amountOut: best.amountOut.toString(),
        dex: best.dex,
        note:
          `${hopNote} was chosen using this small probe amount. A thin low-fee pool that wins ` +
          "at this size can be the worst tier for a much larger trade — for large amounts, " +
          "re-quote at the actual trade size via quote-swap.mjs before dispatch.",
      };
    }
  } else {
    // no on-chain probe (no RPC, or no QuoterV2/USDC for this chain): a Sail-routable
    // USDC-paired venue ⇒ swap-ready (unverified).
    const r = venues.find((v) => v.sailRoutable && isUsdcPair(v, chain));
    swapReady = !!r;
    if (r) {
      best = {
        dex: r.protocol === "aerodrome" ? "aerodrome" : "uniswap-v3",
        fee: r.protocol === "aerodrome" ? null : r.feeTier,
        tickSpacing: null,
        amountOut: null,
      };
    }
  }

  // Best venue (USDC-relevant) computed from the FULL list, then cap the exposed
  // list so portfolio JSON stays readable.
  const bestVenue = pickBestVenue(venues, chain);
  const venuesTotal = venues.length;
  const topVenues = venues.slice(0, MAX_VENUES);

  // Two-hop swap: no DIRECT settlement-currency pool, but a Sail-routable pool against
  // a curated via asset (WETH/WBNB/USDT/WBTC/DAI). That is a real route — settlement →
  // via → token, two swaps — not a custom-mandate special case, so we surface it as
  // swappable and note the extra leg rather than calling it "no pool". Only meaningful
  // when the token is not already swap-ready and is not itself the quote asset.
  const twoHopVenue = !isUsdc && !swapReady ? venues.find((v) => isViaPair(v, chain)) || null : null;
  const twoHop = !!twoHopVenue;

  // Executable two-hop parameters. `twoHopRoute` carries everything the runtime needs to
  // actually build the two-swap path (settlement → via → token): the via's address and
  // the fee tier of EACH leg. When an RPC is present, both fee tiers are live-probed
  // on-chain (settlement→via and via→token) so the route is executable, not just
  // "described"; without an RPC the fee tiers fall back to the feed-reported pool fee
  // (or null, which the caller treats as "re-resolve before executing").
  let twoHopRoute = null;
  if (twoHop) {
    const viaSym = twoHopVenue.pairedSymbol;
    const viaAddress = (chain.tokens[viaSym] && chain.tokens[viaSym].address) || twoHopVenue.pairedToken || null;
    let viaFeeTier = twoHopVenue.feeTier ?? null; // feed-reported via→token fee as a fallback
    let tokenFeeTier = twoHopVenue.feeTier ?? null;
    let leg1 = null;
    let leg2 = null;
    if (onchain && chain.quoterV2 && chain.usdc && viaAddress) {
      // Leg 1: settlement (USDC) → via. Leg 2: via → token.
      leg1 = await probeBestFee(rpc, chain.quoterV2, chain.usdc, viaAddress, PROBE_AMOUNT_USDC);
      leg2 = await probeBestFee(rpc, chain.quoterV2, viaAddress, address, PROBE_AMOUNT_USDC);
      viaFeeTier = leg1 ? leg1.fee : viaFeeTier;
      tokenFeeTier = leg2 ? leg2.fee : tokenFeeTier;
    }
    twoHopRoute = {
      viaAddress,
      viaSymbol: viaSym || null,
      viaFeeTier,
      feeTier: tokenFeeTier,
      probedOnChain: !!(leg1 && leg2),
    };
  }

  return {
    symbol: verifiedSymbol,
    address,
    decimals,
    source, // registry | dexscreener | geckoterminal | <provider>-unverified | <provider>-unverified-collision | address-input
    decimalsSource, // onchain | unverified
    chain: chain.name,
    chainId: chain.chainId,
    onchainVerified: onchain,
    swapReady,
    twoHop,
    twoHopVia: twoHopVenue ? twoHopVenue.pairedSymbol : null,
    twoHopRoute,
    feeTier: best ? best.fee : null,
    dex: best ? best.dex : null,
    tickSpacing: best ? best.tickSpacing : null,
    quote,
    probedTiers: tried,
    venues: topVenues,
    venuesTotal,
    venuesError,
    bestVenue,
    sizeUsd,
    recommendation: perChainRecommendation({
      symbol: verifiedSymbol,
      chain,
      swapReady,
      twoHop,
      twoHopVia: twoHopVenue ? twoHopVenue.pairedSymbol : null,
      twoHopVenue,
      twoHopRoute,
      best,
      bestVenue,
      onchain,
      isUsdc,
      decimalsSource,
      source,
      sizeUsd,
    }),
  };
}

function perChainRecommendation({ symbol, chain, swapReady, twoHop, twoHopVia, twoHopVenue, twoHopRoute, best, bestVenue, onchain, isUsdc, decimalsSource, source, sizeUsd }) {
  const unverified =
    typeof source === "string" && source.endsWith("-unverified-collision")
      ? ` NOTE: multiple "${symbol}" contracts were found on ${chain.name} and none matched the symbol on-chain — this address is the deepest pool, NOT a verified match. Confirm the address before signing.`
      : decimalsSource === "unverified"
        ? ` NOTE: address/decimals are NOT on-chain verified on ${chain.name} — confirm before signing.`
        : "";
  // A venue with huge TVL but zero 24h volume is the seeded/look-alike trap (e.g.
  // Robinhood's multi-billion bStocks pools). Surface it in the prose, not just the
  // JSON flag — the agent reads this note to decide where to route real money.
  const suspect = (venue) =>
    venue && venue.suspectVolume
      ? ` WARNING: this pool reports ~${fmtUsd(venue.liquidityUsd)} TVL but ZERO 24h volume — likely seeded/look-alike liquidity, not a real market. Treat its depth as unverified.`
      : "";
  if (isUsdc) {
    return `${symbol} is the USDC quote asset on ${chain.name} — no swap needed to source it.`;
  }
  if (swapReady && onchain) {
    const hop = best && best.dex === "aerodrome" ? `tickSpacing ${best.tickSpacing}` : best ? `fee ${best.fee}` : "";
    return `Swap-ready on ${chain.name} (live ${best && best.dex === "aerodrome" ? "Aerodrome" : "Uniswap V3"} USDC quote${best ? `, ${hop}` : ""}). Hand to quote-swap.mjs for an exact quote + amountOutMinimum.${unverified}`;
  }
  if (swapReady && !onchain) {
    const thin = bestVenue && bestVenue.fitsSize === false
      ? ` — note: ~${fmtUsd(bestVenue.liquidityUsd)} is thin for a ${fmtUsd(sizeUsd)} trade (est. impact ${bestVenue.estImpactPct}%), re-check at execution`
      : "";
    return `${chain.name} has a Sail-routable ${bestVenue ? bestVenue.protocol : "Uniswap"} pool (~${fmtUsd(bestVenue ? bestVenue.liquidityUsd : 0)}), but it was not live-quoted on-chain (no RPC / verify failed). Configure an RPC or SMA on ${chain.name} to confirm.${suspect(bestVenue)}${thin}${unverified}`;
  }
  if (twoHop) {
    // Not a problem: the token trades against the hub asset, so it is reachable in two
    // swaps (settlement → hub → token). Surface it as a normal route with the extra leg
    // noted, never as "custom mandate or held leg". When the fee tiers were probed
    // on-chain the route is executable end to end; otherwise note it needs a re-resolve
    // with an RPC before executing.
    const executable =
      twoHopRoute && twoHopRoute.probedOnChain
        ? ` Executable two-step route: USDC → ${twoHopVia} (fee ${twoHopRoute.viaFeeTier}) → ${symbol} (fee ${twoHopRoute.feeTier}).`
        : ` The two fee tiers were not on-chain confirmed — re-resolve with an RPC before executing.`;
    return `No direct USDC pool for ${symbol} on ${chain.name}, but it trades against ${twoHopVia} (~${fmtUsd(twoHopVenue ? twoHopVenue.liquidityUsd : 0)} via ${twoHopVenue ? twoHopVenue.protocol : "a routable DEX"}) — swappable in two steps (USDC → ${twoHopVia} → ${symbol}).${executable}${suspect(twoHopVenue)}${unverified}`;
  }
  if (bestVenue) {
    return `No USDC-paired pool for ${symbol} on ${chain.name} via a Sail-routable DEX, though ${bestVenue.protocol} has ~${fmtUsd(bestVenue.liquidityUsd)} in ${bestVenue.pairedSymbol || "other"} pairs. A USDC route here needs a custom mandate or a held leg.${suspect(bestVenue)}${unverified}`;
  }
  return `No pool for ${symbol} on ${chain.name}. If liquidity is on another Sail chain, deploy/scan there; otherwise configure as a held leg.`;
}

// ── cross-chain recommendation across the chains we mapped for one token ────────
function fmtUsd(n) {
  return "$" + (Math.round(Number(n) || 0)).toLocaleString("en-US");
}

// Relative swap cost per chain, used to break near-ties in the cross-chain ranking.
// Only Ethereum mainnet is materially more expensive among Sail's chains (L1 gas);
// every L2 and BSC settles swaps for cents. 2 = expensive L1, 1 = cheap.
const CHAIN_GAS_TIER = {
  ethereum: 2,
  base: 1,
  arbitrum: 1,
  optimism: 1,
  unichain: 1,
  bsc: 1,
  worldchain: 1,
  hyperevm: 1,
  megaeth: 1,
  robinhood: 1,
};

// Effective depth for ranking: an expensive chain's liquidity counts for half, so a
// cheaper chain with >= half the depth ranks equal-or-better. A screen, not a price
// oracle — the live quote at execution is the real number.
function gasAdjustedDepth(depthUsd, chainName) {
  const tier = CHAIN_GAS_TIER[chainName] ?? 1;
  return tier === 1 ? depthUsd : depthUsd / 2;
}

// A one-line explanation for when an expensive chain beat a cheaper one on depth, so
// the user understands the choice rather than assuming a cost mistake. Fires only
// when the winner is pricier than an available alternative (the sort only lets an
// expensive chain win when it is meaningfully deeper than the cheaper option).
function chainChoiceNote(sortedChains) {
  const best = sortedChains[0];
  if (!best) return "";
  const cheaper = sortedChains.find(
    (c) => c !== best && (CHAIN_GAS_TIER[c.name] ?? 1) < (CHAIN_GAS_TIER[best.name] ?? 1),
  );
  if (!cheaper) return ""; // best is already the cheapest available — nothing to explain
  return ` ${best.name} costs more per swap than ${cheaper.name}, but its liquidity is much deeper, so it still ranks first.`;
}

function recommendCrossChain(chains, configuredNames) {
  const entries = Object.entries(chains).filter(([, o]) => !o.error);
  // Routable = swap-ready (direct USDC pool) OR two-hop (pool against the hub asset).
  // Both are executable by the swap template, so both drive route/suggest-sma.
  const routable = entries
    .filter(([, o]) => o.swapReady || o.twoHop)
    .map(([name, o]) => ({
      name,
      // A suspect (planted, zero-volume) best venue must not drive the ranking —
      // treat its depth as 0 so a real pool elsewhere wins.
      depth:
        o.bestVenue && o.bestVenue.sailRoutable && !o.bestVenue.suspectVolume
          ? o.bestVenue.liquidityUsd
          : 0,
      twoHop: !!o.twoHop && !o.swapReady,
      configured: configuredNames.includes(name),
      o,
    }));
  const liqChains = entries.filter(([, o]) => o.venues && o.venues.length).map(([name]) => name);

  const hopLabel = (c) => (c.twoHop ? `two-step (USDC → ${c.o && c.o.twoHopVia ? c.o.twoHopVia : "WETH"} → token)` : "swap-ready");
  // Gas-aware: rank by effective depth, tie-break toward the cheaper chain.
  const byRank = (a, b) => {
    const da = gasAdjustedDepth(a.depth, a.name);
    const db = gasAdjustedDepth(b.depth, b.name);
    if (db !== da) return db - da;
    return (CHAIN_GAS_TIER[a.name] ?? 1) - (CHAIN_GAS_TIER[b.name] ?? 1);
  };

  const configuredRoutable = routable.filter((c) => c.configured).sort(byRank);
  if (configuredRoutable.length) {
    const t = configuredRoutable[0];
    return {
      action: "route",
      deepestChain: t.name,
      routableChains: configuredRoutable.map((c) => c.name),
      note:
        `Routable on your configured chain(s): ${configuredRoutable.map((c) => `${c.name} (${hopLabel(c)})`).join(", ")}. ` +
        `Best: ${t.name}${t.o.bestVenue ? ` (${t.o.bestVenue.protocol}, ${fmtUsd(t.o.bestVenue.liquidityUsd)})` : ""}.` +
        chainChoiceNote(configuredRoutable) +
        (configuredRoutable.length > 1
          ? " Liquidity on more than one configured chain — I ranked by depth and gas cost; say so if you'd rather use a specific chain."
          : ""),
    };
  }

  const anyRoutable = routable.slice().sort(byRank);
  if (anyRoutable.length) {
    const t = anyRoutable[0];
    return {
      action: "suggest-sma",
      deepestChain: t.name,
      routableChains: anyRoutable.map((c) => c.name),
      note:
        `No routable pool on your configured chain(s). Best liquidity is on ${t.name}` +
        `${t.o.bestVenue ? ` (${t.o.bestVenue.protocol}, ${fmtUsd(t.o.bestVenue.liquidityUsd)})` : ""} ` +
        `${hopLabel(t)}${chainChoiceNote(anyRoutable)} — deploy an SMA on ${t.name} to trade this leg.`,
    };
  }

  if (liqChains.length) {
    const detail = entries
      .filter(([, o]) => o.bestVenue)
      .map(([name, o]) => `${name}: ${o.bestVenue.protocol} (${fmtUsd(o.bestVenue.liquidityUsd)})`)
      .join("; ");
    return {
      action: "manual-address",
      note: `Liquidity exists but not in a USDC pair on a Sail-routable DEX (${detail}). Build a custom mandate against that pool/router, or hold the leg.`,
    };
  }

  return {
    action: "hold-skip",
    note: `No pool found on any scanned Sail chain. The token may live on a chain this project isn't configured for. Configure it as a held leg or drop it from the strategy.`,
  };
}

// Bounded-concurrency map. Per-chain resolution is independent (GeckoTerminal calls
// are serialized by the global lock; on-chain eth_calls can overlap), so a small pool
// cuts wall-clock time on multi-chain portfolios without breaking rate-limit safety.
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const CHAIN_RESOLVE_CONCURRENCY = 3;

// Resolve one token across a set of chains → the rich per-token wrapper.
// `deadline` (epoch ms, optional) bounds the whole token: chains that would start past
// it are skipped with a "timed out" error entry so one stubborn token can't overshoot
// the portfolio deadline by a full token's worth of work.
async function resolveToken(symbolOrAddr, chainSet, configuredNames, deadline = Infinity, sizeUsd = DEFAULT_SIZE_USD) {
  const chains = {};
  const entries = await mapPool(chainSet, CHAIN_RESOLVE_CONCURRENCY, async (c) => {
    if (Date.now() > deadline) {
      return { name: c.name, value: { chain: c.name, chainId: c.chainId, error: "timed out" } };
    }
    try {
      return { name: c.name, value: await resolveOnChain(symbolOrAddr, c, c.rpc || null, sizeUsd) };
    } catch (e) {
      // If the on-chain path failed (flaky RPC, etc.) but the chain has a GeckoTerminal
      // network, degrade to a GeckoTerminal-only map rather than dropping the chain.
      if (c.rpc && c.gecko) {
        try {
          const fallback = await resolveOnChain(symbolOrAddr, c, null, sizeUsd);
          fallback.onchainError = errMsg(e);
          return { name: c.name, value: fallback };
        } catch {
          // gecko-only also failed — fall through to the error entry
        }
      }
      return { name: c.name, value: { chain: c.name, chainId: c.chainId, error: errMsg(e) } };
    }
  });
  for (const e of entries) chains[e.name] = e.value;
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

// ── compact + basket optimization ──────────────────────────────────────────────
// Reduce one resolved token to the minimal fields an agent actually needs to decide
// where to build the portfolio. Drops the per-chain venue arrays, quotes, and
// provenance — the biggest token cost when an LLM reads this script's output.
function compactToken(t) {
  const swapReady = Object.values(t.chains)
    .filter((o) => o && !o.error && o.swapReady)
    .map((o) => o.chain);
  const twoHop = Object.values(t.chains)
    .filter((o) => o && !o.error && !o.swapReady && o.twoHop)
    .map((o) => o.chain);
  return {
    query: t.query,
    chainsWithLiquidity: t.chainsWithLiquidity,
    swapReadyChains: swapReady,
    twoHopChains: twoHop,
    deepestChain: t.crossChain.deepestChain || null,
    action: t.crossChain.action,
    note: t.crossChain.note,
  };
}

// Basket-level optimizer: given a resolved portfolio, choose the MINIMUM set of Sail
// chains that covers every token's liquidity, so the user funds/bridges as few chains
// as possible. Ties between equal-size covers are broken by quality — chains that are
// swap-ready (direct USDC pool) or the deepest chain for the most tokens win.
//
// Set cover is NP-hard in general, but Sail has ≤12 chains, so an exhaustive search
// over 2^n subsets (≤4096) is instant and always finds a true minimum.
function optimizeChainSet(tokens) {
  const coverable = tokens.filter((t) => t.chainsWithLiquidity.length > 0);
  if (coverable.length === 0) {
    return { covered: false, note: "No token has liquidity on any scanned Sail chain." };
  }
  const chainNames = [...new Set(tokens.flatMap((t) => t.chainsWithLiquidity))].sort();
  if (chainNames.length === 0) {
    return { covered: false, note: "No token has liquidity on any scanned Sail chain." };
  }

  const swapReadyCount = {};
  const deepestCount = {};
  for (const t of tokens) {
    for (const [name, o] of Object.entries(t.chains)) {
      if (o && !o.error && o.swapReady) swapReadyCount[name] = (swapReadyCount[name] || 0) + 1;
    }
    if (t.crossChain.deepestChain) deepestCount[t.crossChain.deepestChain] = (deepestCount[t.crossChain.deepestChain] || 0) + 1;
  }

  const n = chainNames.length;
  let best = null;
  for (let mask = 1; mask < 1 << n; mask++) {
    const chosen = new Set();
    for (let i = 0; i < n; i++) if (mask & (1 << i)) chosen.add(chainNames[i]);
    if (!coverable.every((t) => t.chainsWithLiquidity.some((c) => chosen.has(c)))) continue;
    const size = chosen.size;
    if (best && size > best.size) continue;
    let score = 0;
    for (const c of chosen) score += (swapReadyCount[c] || 0) * 1000 + (deepestCount[c] || 0) * 1;
    if (!best || size < best.size || score > best.score) best = { size, score, set: chosen };
  }

  const chosenChains = [...best.set].sort();
  // Assign each token to its best chain inside the chosen set: swap-ready first, then
  // the deepest chain, then first available.
  const assignments = {};
  for (const t of coverable) {
    const inSet = t.chainsWithLiquidity.filter((c) => best.set.has(c));
    const ready = inSet.filter((c) => t.chains[c] && !t.chains[c].error && t.chains[c].swapReady);
    assignments[t.query] = (ready.length ? ready : inSet)[0];
  }

  const uncovered = tokens.filter((t) => t.chainsWithLiquidity.length === 0).map((t) => t.query);

  return {
    covered: true,
    chosenChains,
    chainCount: chosenChains.length,
    assignments,
    uncovered,
    rationale: `Minimum chain set: ${chosenChains.join(", ")} — funds/bridges ${chosenChains.length} chain(s) to cover ${coverable.length}/${tokens.length} token(s).`,
  };
}

// ── emitters ────────────────────────────────────────────────────────────────────
function swapReadyLabel(o) {
  if (!o.swapReady) return "no USDC pool on this chain";
  return o.dex === "aerodrome"
    ? `yes — tickSpacing ${o.tickSpacing} (Aerodrome)`
    : `yes — fee ${o.feeTier} (Uniswap V3)`;
}

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
        : "none listed";
  process.stderr.write(
    `\n${out.symbol} on ${out.chain} (${out.chainId}):\n` +
      `  address:    ${out.address}  (source: ${out.source})\n` +
      `  decimals:   ${out.decimals} (${out.decimalsSource || "onchain"})\n` +
      `  swap-ready: ${swapReadyLabel(out)}\n` +
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
      `  ${name} (${o.chainId}): ${o.address}  dec ${o.decimals} [${o.decimalsSource}], ${swapReadyLabel(o)}`,
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
        "  --all-chains             → also scan every Sail mainnet via DexScreener\n" +
        "  --compact                → minimal JSON (query → chains + action only; for agent reads)\n" +
        "  --optimize               → append basket chain-set plan (minimum bridges/hops)\n" +
        "  --identify               → disambiguation plan only (no network): which symbols need a\n" +
        "                             \"did you mean X?\" confirmation before resolving\n" +
        "  --size <usd>             → trade size to screen liquidity against (default 1000)\n" +
        "  --identities <path>       → identity catalog (default scripts/token-identities.json)\n" +
        "  --map <path>             → offline liquidity map (default scripts/liquidity-map.json)\n",
    );
    process.exit(args.length === 0 ? 1 : 0);
  }

  const tokens = [];
  let chainFlag = null;
  let rpcFlag = null;
  let allChains = false;
  let jsonMode = false;
  let compactMode = false;
  let optimizeMode = false;
  let identifyMode = false;
  let sizeUsd = DEFAULT_SIZE_USD;
  let mapFlag = null;
  let identitiesFlag = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--chain") chainFlag = args[++i];
    else if (a === "--rpc") rpcFlag = args[++i];
    else if (a === "--map") mapFlag = args[++i];
    else if (a === "--identities") identitiesFlag = args[++i];
    else if (a === "--size") sizeUsd = Number(args[++i]) || DEFAULT_SIZE_USD;
    else if (a === "--all-chains") allChains = true;
    else if (a === "--json") jsonMode = true;
    else if (a === "--compact") compactMode = true;
    else if (a === "--optimize") optimizeMode = true;
    else if (a === "--identify") identifyMode = true;
    else if (!a.startsWith("--")) tokens.push(a);
  }
  if (tokens.length === 0) throw new Error("Pass at least one token symbol or address.");

  // ── --identify: disambiguation plan only, no network. ─────────────────────────
  if (identifyMode) {
    const plan = identifySymbols(tokens, identitiesFlag || undefined);
    const human = [
      plan.identified.length
        ? `Confident (${plan.identified.length}): ${plan.identified.map((t) => `${t.query} → ${t.ticker || t.note}`).join(", ")}`
        : "Confident: none",
      plan.ambiguous.length
        ? `Need confirmation (${plan.ambiguous.length}): ${plan.ambiguous.map((t) => `${t.question} [${t.candidates.map((c) => `${c.ticker}${c.default ? " (default)" : ""}`).join(" | ")}]`).join("; ")}`
        : "Need confirmation: none",
      plan.unknown.length
        ? `Unknown (${plan.unknown.length}): ${plan.unknown.map((t) => t.query).join(", ")}`
        : "Unknown: none",
    ];
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
    process.stderr.write(`\n${human.join("\n")}\n`);
    return;
  }

  // Load the offline liquidity map (if any) so resolveOnChain can short-circuit the
  // top assets instead of a live feed scan. Safe no-op when absent.
  const map = loadLiquidityMap(mapFlag);
  if (map.generatedAt && isMapStale(map.generatedAt)) {
    process.stderr.write(
      `Note: scripts/liquidity-map.json is over 30 days old (generated ${map.generatedAt}). Its depth figures may be stale; addresses/decimals are still re-verified on-chain. Refresh with: node scripts/build-liquidity-map.mjs\n`,
    );
  }

  const configured = configuredChains();
  let configuredNames = configured.map((c) => c.name);

  // ── legacy single-token path (back-compat with sailor-swap-quote / sailor-template-swap)
  // One token, no --json/--all-chains → today's bare object or array.
  const richMode = tokens.length >= 2 || jsonMode || allChains || compactMode || optimizeMode;
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
                : `  ${r.chain} (${r.chainId}): ${r.address}  dec ${r.decimals}, ${swapReadyLabel(r)}`,
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
        if (rpc) {
          chainSet = [{ ...c, rpc }];
          // This IS the project's configured chain for routing purposes — a
          // generic RPC_URL project has no chain-specific var so configuredNames
          // was empty, which made recommendCrossChain treat a routable token here
          // as "not configured" and wrongly suggest deploying an SMA elsewhere.
          configuredNames = [c.name];
        }
      } catch {
        // no configured chain — only valid with --all-chains
      }
    }
  }
  if (allChains) {
    const env = readSailEnv();
    const have = new Set(chainSet.map((c) => c.name));
    for (const [name, cfg] of Object.entries(CHAINS)) {
      if (cfg.dex && !have.has(name)) {
        // Only a chain-SPECIFIC RPC (named or chainId-keyed) — never the generic
        // RPC_URL, which would point this chain at the wrong network. No specific
        // var ⇒ DEX-feed-only (rpc null).
        const rpc = env[`${name.toUpperCase().replace("-", "_")}_RPC_URL`] ?? env[`RPC_URL_${cfg.chainId}`] ?? null;
        chainSet.push({ name, ...cfg, rpc });
      }
    }
  }
  if (chainSet.length === 0) {
    throw new Error(
      "No chain configured. Set RPC vars in .sail/.env.local, pass --chain <name>, or use --all-chains to scan every Sail mainnet via the DEX feed.",
    );
  }

  const scannedNames = chainSet.map((c) => c.name);
  process.stderr.write(
    `Mapping ${tokens.length} token(s) across ${scannedNames.length} chain(s): ${scannedNames.join(", ")}` +
      ` — DexScreener primary (throttled, adaptive spacing), GeckoTerminal fallback.\n`,
  );

  // Resolve tokens one at a time (each token already maps its chains with bounded
  // concurrency), printing a progress line per token so a long portfolio never looks
  // hung. A hard deadline returns whatever mapped so far instead of stalling forever.
  const deadlineMs = Number(process.env.RESOLVE_TIMEOUT_MS || 180000);
  const deadline = Date.now() + deadlineMs;
  const resolved = [];
  const unresolved = [];
  let timedOut = false;
  for (const t of tokens) {
    if (Date.now() > deadline) {
      timedOut = true;
      unresolved.push(...tokens.slice(resolved.length));
      break;
    }
    const r = await resolveToken(t, chainSet, configuredNames, deadline, sizeUsd);
    resolved.push(r);
    process.stderr.write(
      `  resolved ${t}: ${r.chainsWithLiquidity.length ? r.chainsWithLiquidity.join(", ") : "no routable liquidity"} [${r.crossChain.action}]\n`,
    );
  }
  if (timedOut) {
    process.stderr.write(
      `\nTimed out after ${Math.round(deadlineMs / 1000)}s — mapped ${resolved.length}/${tokens.length} token(s). Re-run the rest with a targeted --chain (or raise RESOLVE_TIMEOUT_MS): ${unresolved.join(", ")}\n`,
    );
  }

  // single token + (--json/--all-chains) → the token wrapper; many tokens → portfolio.
  if (tokens.length === 1) {
    if (resolved.length === 0) {
      throw new Error(
        `Timed out resolving "${tokens[0]}". Re-run with a targeted --chain or raise RESOLVE_TIMEOUT_MS.`,
      );
    }
    if (compactMode) {
      process.stdout.write(JSON.stringify(compactToken(resolved[0]), null, 2) + "\n");
    } else {
      process.stdout.write(JSON.stringify(resolved[0], null, 2) + "\n");
    }
    process.stderr.write(emitTokenHuman(resolved[0]) + "\n");
    return;
  }

  const summary = buildSummary(resolved, configuredNames, allChains);
  if (timedOut) {
    summary.timedOut = true;
    summary.unresolved = unresolved;
  }
  if (optimizeMode) {
    summary.basket = optimizeChainSet(resolved);
  }
  const outTokens = compactMode ? resolved.map(compactToken) : resolved;
  process.stdout.write(JSON.stringify({ tokens: outTokens, summary }, null, 2) + "\n");
  if (!compactMode) {
    process.stderr.write(resolved.map(emitTokenHuman).join("\n") + `\n\nSummary: ${summary.recommendation}\n`);
    if (summary.basket) {
      process.stderr.write(
        `\nBasket plan: ${summary.basket.rationale}\n` +
          Object.entries(summary.basket.assignments)
            .map(([q, c]) => `  ${q} → ${c}`)
            .join("\n") +
          (summary.basket.uncovered.length ? `\n  (not on Sail: ${summary.basket.uncovered.join(", ")})\n` : "\n"),
      );
    }
  }
}

function rpcHint(chain) {
  return `No RPC for chain "${chain.name}". Pass --rpc <url> or set RPC_URL / ${chain.name.toUpperCase()}_RPC_URL / RPC_URL_${chain.chainId} in .sail/.env.local.`;
}

function errMsg(e) {
  return e && typeof e.message === "string" ? e.message : String(e);
}

// ── exported surface (unit-testable pure functions + constants) ────────────────
// Exporting makes the resolver importable by resolve-token.test.mjs without running
// main(). Only pure, deterministic helpers are exported — no network/file IO happens
// at import time.
export {
  CHAINS,
  STOCK_SUFFIX_ALIASES,
  VIA_SYMBOLS,
  MIN_TWO_HOP_LIQUIDITY_USD,
  MAX_IMPACT_PCT,
  SUSPECT_VOLUME_TVL,
  DEFAULT_SIZE_USD,
  MAP_MAX_AGE_MS,
  ADDR_RE,
  curatedKey,
  identifySymbols,
  classifyDex,
  parseFeeBps,
  addrFromGeckoId,
  rankCandidateAddresses,
  shouldTrustMapEntry,
  isUsdcPair,
  isViaPair,
  estimateImpactPct,
  isSuspectVolume,
  annotateVenues,
  pickBestVenue,
  perChainRecommendation,
  CHAIN_GAS_TIER,
  gasAdjustedDepth,
  chainChoiceNote,
  recommendCrossChain,
  buildSummary,
  compactToken,
  optimizeChainSet,
  isMapStale,
  pad32,
  uintToHex,
  encodeQuoteCall,
  encodeAeroQuoteCall,
  decodeUint256Return,
  decodeStringReturn,
  resolveChain,
  resolveRpc,
};

// Only run the CLI when invoked directly (`node resolve-token.mjs …`), not when
// imported by a test or another script.
const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    process.stderr.write(`\nresolve-token failed: ${errMsg(err)}\n`);
    process.exit(1);
  });
}
