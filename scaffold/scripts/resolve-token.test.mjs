// resolve-token.test.mjs — unit tests for the resolver's pure, money-critical
// functions. No network, no RPC, no filesystem: these run anywhere and are the
// regression guard for the rules that decide which contract address receives USDC.
//
// Run with:  node --test scaffold/scripts/resolve-token.test.mjs
//
// The resolver is a single .mjs with no dependencies. We import it directly and
// exercise the exported pure helpers (curatedKey, identifySymbols, classifyDex,
// isUsdcPair, isHubPair, the size/suspect screening, and the ABI codecs). The
// async network paths (DexScreener/GeckoTerminal/eth_call) are deliberately NOT
// tested here — they need live feeds and belong to a live smoke test, not a unit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  CHAINS,
  STOCK_SUFFIX_ALIASES,
  HUB_SYMBOLS,
  MIN_TWO_HOP_LIQUIDITY_USD,
  MAX_IMPACT_PCT,
  SUSPECT_VOLUME_TVL,
  DEFAULT_SIZE_USD,
  ADDR_RE,
  curatedKey,
  identifySymbols,
  classifyDex,
  parseFeeBps,
  addrFromGeckoId,
  rankCandidateAddresses,
  shouldTrustMapEntry,
  isUsdcPair,
  isHubPair,
  estimateImpactPct,
  isSuspectVolume,
  annotateVenues,
  pickBestVenue,
  perChainRecommendation,
  CHAIN_GAS_TIER,
  gasAdjustedDepth,
  chainChoiceNote,
  recommendCrossChain,
  optimizeChainSet,
  isMapStale,
  pad32,
  uintToHex,
  encodeQuoteCall,
  decodeUint256Return,
  decodeStringReturn,
  resolveChain,
  resolveRpc,
} from "./resolve-token.mjs";

const IDENTITIES = fileURLToPath(new URL("./token-identities.json", import.meta.url));

// ── curatedKey: stock-ticker alias + no-shadowing ──────────────────────────────

test("curatedKey maps the plain Coinbase ticker to its suffixed registry key", () => {
  assert.equal(curatedKey(CHAINS.base, "COIN"), "COINc");
  assert.equal(curatedKey(CHAINS.base, "NVDA"), "NVDAc");
  assert.equal(curatedKey(CHAINS.base, "AAPL"), "AAPLc");
  assert.equal(curatedKey(CHAINS.base, "CRCL"), "CRCLc");
});

test("curatedKey accepts the suffixed form (uppercased 'COINC') too", () => {
  // resolveOnChain uppercases input, so the user-typed "COINc" arrives as "COINC".
  assert.equal(curatedKey(CHAINS.base, "COINC"), "COINc");
  assert.equal(curatedKey(CHAINS.base, "NVDAC"), "NVDAc");
});

test("curatedKey does not alias when the suffixed key is absent on this chain", () => {
  // COINc exists only on Base, so asking for "COIN" on ethereum must NOT resolve.
  assert.equal(curatedKey(CHAINS.ethereum, "COIN"), null);
  assert.equal(curatedKey(CHAINS.ethereum, "NVDA"), null);
});

test("curatedKey returns a direct registry hit unchanged (and never shadows a real token)", () => {
  assert.equal(curatedKey(CHAINS.ethereum, "WETH"), "WETH");
  assert.equal(curatedKey(CHAINS.base, "USDC"), "USDC");
  // A chain with BOTH a plain "COIN" token and "COINc" returns the direct hit first.
  const synthetic = { tokens: { COIN: { address: "0xabc" }, COINc: { address: "0xdef" } } };
  assert.equal(curatedKey(synthetic, "COIN"), "COIN");
});

test("curatedKey returns null for uncurated symbols", () => {
  assert.equal(curatedKey(CHAINS.base, "DOGECOIN"), null);
  assert.equal(curatedKey(CHAINS.base, "UNI"), null); // UNI isn't in the base registry
});

// ── identifySymbols: confident / ambiguous / unknown split ─────────────────────

test("identify splits a basket into confident, ambiguous, and unknown", () => {
  const plan = identifySymbols(["UNI", "COIN", "CRCL", "HYPE", "DOGECOIN"], IDENTITIES);
  assert.deepEqual(
    plan.identified.map((t) => t.query).sort(),
    ["HYPE", "UNI"],
  );
  assert.deepEqual(plan.ambiguous.map((t) => t.query), ["COIN", "CRCL"]);
  assert.deepEqual(plan.unknown.map((t) => t.query), ["DOGECOIN"]);
});

test("identify flags the Coinbase B20 candidate as the default", () => {
  const plan = identifySymbols(["COIN"], IDENTITIES);
  assert.equal(plan.ambiguous.length, 1);
  const coin = plan.ambiguous[0];
  const defaults = coin.candidates.filter((c) => c.default).map((c) => c.ticker);
  assert.deepEqual(defaults, ["COINc"]);
  assert.ok(coin.question.includes("Which one"));
});

test("identify treats a 0x address as already-resolved (no confirmation needed)", () => {
  const addr = "0x" + "a".repeat(40);
  const plan = identifySymbols([addr], IDENTITIES);
  assert.equal(plan.ambiguous.length, 0);
  assert.equal(plan.unknown.length, 0);
  assert.equal(plan.identified.length, 1);
  assert.equal(plan.identified[0].ticker, null);
});

test("identify is case-insensitive on the symbol", () => {
  const plan = identifySymbols(["uni", "Coin"], IDENTITIES);
  assert.deepEqual(plan.identified.map((t) => t.ticker), ["UNI"]);
  assert.deepEqual(plan.ambiguous.map((t) => t.query), ["Coin"]);
});

// ── classifyDex: DEX family → Sail-routable? ──────────────────────────────────

test("classifyDex treats a bare 'uniswap' dexId as V3 (Arbitrum/Base/Unichain omit labels)", () => {
  assert.deepEqual(classifyDex("uniswap", undefined, "base"), { protocol: "uniswap-v3", sailRoutable: true });
  assert.deepEqual(classifyDex("uniswap", ["v3"], "arbitrum"), { protocol: "uniswap-v3", sailRoutable: true });
  assert.deepEqual(classifyDex("uniswap-v3-base", undefined, "base"), { protocol: "uniswap-v3", sailRoutable: true });
});

test("classifyDex recognizes the other Sail-routable DEX families", () => {
  assert.equal(classifyDex("aerodrome", [], "base").protocol, "aerodrome");
  assert.equal(classifyDex("aerodrome", [], "base").sailRoutable, true);
  assert.equal(classifyDex("pancakeswap-v3", [], "bsc").protocol, "pancakeswap");
  assert.equal(classifyDex("sushiswap", [], "arbitrum").protocol, "sushiswap");
  assert.equal(classifyDex("velodrome", [], "optimism").protocol, "velodrome");
  assert.equal(classifyDex("uniswap", ["v2"], "ethereum").protocol, "uniswap-v2");
});

test("classifyDex is routable for V4 only on Unichain", () => {
  assert.deepEqual(classifyDex("uniswap-v4", ["v4"], "unichain"), { protocol: "uniswap-v4", sailRoutable: true });
  assert.deepEqual(classifyDex("uniswap-v4", ["v4"], "base"), { protocol: "uniswap-v4", sailRoutable: false });
});

test("classifyDex marks unknown DEXes non-routable", () => {
  assert.deepEqual(classifyDex("curve", [], "ethereum"), { protocol: "other", sailRoutable: false });
});

// ── parseFeeBps + addrFromGeckoId ──────────────────────────────────────────────

test("parseFeeBps converts a percentage fee to basis points", () => {
  assert.equal(parseFeeBps("WETH / USDC 0.3%"), 3000);
  assert.equal(parseFeeBps("WETH / USDC 1%"), 10000);
  assert.equal(parseFeeBps("WETH / USDC 0.05%"), 500);
  assert.equal(parseFeeBps("WETH / USDC"), null);
});

test("addrFromGeckoId extracts the address part", () => {
  assert.equal(addrFromGeckoId("base_0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"), "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  assert.equal(addrFromGeckoId("noUnderscore"), "");
});

// ── isUsdcPair: settlement-currency detection ─────────────────────────────────

test("isUsdcPair matches the settlement symbol and USDC.E", () => {
  assert.equal(isUsdcPair({ pairedSymbol: "USDC" }, CHAINS.base), true);
  assert.equal(isUsdcPair({ pairedSymbol: "USDC.E" }, CHAINS.arbitrum), true);
  assert.equal(isUsdcPair({ pairedSymbol: "WETH" }, CHAINS.base), false);
});

test("isUsdcPair matches the on-chain USDC address even without a symbol", () => {
  const venue = { pairedSymbol: "USDC", pairedToken: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" };
  assert.equal(isUsdcPair(venue, CHAINS.base), true);
});

test("isUsdcPair uses USDG as the settlement currency on Robinhood", () => {
  assert.equal(isUsdcPair({ pairedSymbol: "USDG" }, CHAINS.robinhood), true);
  assert.equal(isUsdcPair({ pairedSymbol: "USDC" }, CHAINS.robinhood), false);
});

// ── isHubPair: two-hop route with the $10k dust floor ─────────────────────────
// The resolver's constructed chain objects carry a `name` (the CHAINS key); the raw
// CHAINS.<key> config does not. isHubPair looks up HUB_SYMBOLS[chain.name], so tests
// pass a named chain, exactly as resolveOnChain does.
const named = (key) => ({ ...CHAINS[key], name: key });

const hubVenue = (chain, liquidityUsd, sailRoutable = true) => ({
  sailRoutable,
  pairedSymbol: HUB_SYMBOLS[chain.name],
  liquidityUsd,
});

test("isHubPair accepts a deep hub-paired pool as a two-hop route", () => {
  const base = named("base");
  const v = hubVenue(base, 50_000);
  assert.equal(isHubPair(v, base), v);
  // exactly at the floor counts (>=)
  assert.equal(isHubPair(hubVenue(base, MIN_TWO_HOP_LIQUIDITY_USD), base) !== null, true);
});

test("isHubPair rejects dust pools below the $10k floor", () => {
  const base = named("base");
  assert.equal(isHubPair(hubVenue(base, 41), base), null); // the HYPE $41 trap
  assert.equal(isHubPair(hubVenue(base, MIN_TWO_HOP_LIQUIDITY_USD - 1), base), null);
});

test("isHubPair rejects non-hub pairs and non-routable venues", () => {
  const base = named("base");
  assert.equal(isHubPair({ sailRoutable: true, pairedSymbol: "USDC", liquidityUsd: 1_000_000 }, base), null);
  assert.equal(isHubPair(hubVenue(base, 50_000, false), base), null);
  // Robinhood has no hub asset → never two-hop
  assert.equal(isHubPair({ sailRoutable: true, pairedSymbol: "WETH", liquidityUsd: 1_000_000 }, named("robinhood")), null);
});

test("isHubPair rejects a suspect (planted, zero-volume) hub pool", () => {
  const base = named("base");
  // The ZAMA trap: a look-alike with a huge WETH pool and zero real volume is not a
  // real two-hop route, no matter how deep it is.
  const planted = { sailRoutable: true, pairedSymbol: "WETH", liquidityUsd: 150_000_000, volume24hUsd: 0 };
  assert.equal(isHubPair(planted, base), null);
  // Same depth WITH real volume is a legitimate route.
  const real = { sailRoutable: true, pairedSymbol: "WETH", liquidityUsd: 150_000_000, volume24hUsd: 2_000_000 };
  assert.equal(isHubPair(real, base), real);
});

// ── rankCandidateAddresses: the real token wins over a planted look-alike ───────

test("rankCandidateAddresses prefers a real-volume candidate over a planted look-alike", () => {
  const planted = { address: "0x" + "f".repeat(40), liquidityUsd: 150_000_000, volume24hUsd: 0 };
  const real = { address: "0x" + "a".repeat(40), liquidityUsd: 531_000, volume24hUsd: 406_000 };
  // The planted fake is 300x deeper but silent; the real token trades. Real wins.
  assert.deepEqual(rankCandidateAddresses([planted, real]), [real.address, planted.address]);
});

test("rankCandidateAddresses ranks by volume when several candidates trade", () => {
  const lo = { address: "0x" + "1".repeat(40), liquidityUsd: 10_000_000, volume24hUsd: 50_000 };
  const hi = { address: "0x" + "2".repeat(40), liquidityUsd: 1_000_000, volume24hUsd: 400_000 };
  assert.deepEqual(rankCandidateAddresses([lo, hi]), [hi.address, lo.address]);
});

test("rankCandidateAddresses falls back to deepest liquidity when nothing trades", () => {
  const shallow = { address: "0x" + "3".repeat(40), liquidityUsd: 50_000, volume24hUsd: 0 };
  const deep = { address: "0x" + "4".repeat(40), liquidityUsd: 1_000_000, volume24hUsd: 0 };
  assert.deepEqual(rankCandidateAddresses([shallow, deep]), [deep.address, shallow.address]);
});

// ── gas-aware cross-chain ranking ───────────────────────────────────────────────

test("gasAdjustedDepth halves expensive L1 liquidity", () => {
  assert.equal(gasAdjustedDepth(1_000_000, "ethereum"), 500_000);
  assert.equal(gasAdjustedDepth(1_000_000, "base"), 1_000_000);
  assert.equal(gasAdjustedDepth(1_000_000, "bsc"), 1_000_000);
  assert.equal(gasAdjustedDepth(1_000_000, "unknown"), 1_000_000);
});

const routableChain = (name, chainId, depth, suspect = false) => ({
  chain: name,
  chainId,
  error: null,
  swapReady: true,
  twoHop: false,
  bestVenue: {
    sailRoutable: true,
    liquidityUsd: depth,
    protocol: "uniswap-v3",
    suspectVolume: suspect,
  },
  venues: [{ sailRoutable: true, liquidityUsd: depth, suspectVolume: suspect }],
});

test("recommendCrossChain prefers a cheaper chain with comparable liquidity", () => {
  // Ethereum $1M vs Base $600K: gas-adjusted, Base (600K) beats Ethereum (500K).
  const chains = {
    ethereum: routableChain("ethereum", 1, 1_000_000),
    base: routableChain("base", 8453, 600_000),
  };
  const r = recommendCrossChain(chains, ["ethereum", "base"]);
  assert.equal(r.action, "route");
  assert.equal(r.deepestChain, "base");
});

test("recommendCrossChain keeps a much deeper L1 over a cheaper chain", () => {
  // Ethereum $3M vs Base $600K: gas-adjusted Ethereum (1.5M) still beats Base.
  const chains = {
    ethereum: routableChain("ethereum", 1, 3_000_000),
    base: routableChain("base", 8453, 600_000),
  };
  const r = recommendCrossChain(chains, ["ethereum", "base"]);
  assert.equal(r.deepestChain, "ethereum");
  assert.ok(r.note.includes("costs more per swap than base"), r.note);
});

test("recommendCrossChain zeroes out a suspect (fake) best-venue depth", () => {
  // A planted look-alike on Ethereum (swapReady true but bestVenue suspect) must not
  // rank above a real pool on Base.
  const fakeEth = routableChain("ethereum", 1, 150_000_000, true);
  const realBase = routableChain("base", 8453, 600_000, false);
  const r = recommendCrossChain({ ethereum: fakeEth, base: realBase }, ["ethereum", "base"]);
  assert.equal(r.deepestChain, "base");
});

test("chainChoiceNote stays silent when the winner is already the cheapest", () => {
  assert.equal(chainChoiceNote([routableChain("base", 8453, 1_000_000)]), "");
});

test("CHAIN_GAS_TIER marks only ethereum as the expensive L1", () => {
  assert.equal(CHAIN_GAS_TIER.ethereum, 2);
  for (const [name, tier] of Object.entries(CHAIN_GAS_TIER)) {
    if (name === "ethereum") continue;
    assert.equal(tier, 1, name);
  }
});

// ── size-aware screening: estimateImpactPct / isSuspectVolume / annotateVenues ─

test("shouldTrustMapEntry accepts a routable, trading entry", () => {
  const real = { address: "0x5607", routable: true, volume24hUsd: 381_000, liquidityUsd: 2_570_000 };
  assert.equal(shouldTrustMapEntry(real), true);
});

test("shouldTrustMapEntry rejects a planted look-alike even with a hubDex signal", () => {
  // The SKY bug: the map recorded the planted $1.1B zero-volume copy as canonical with
  // a hubDex (two-hop) signal. Zero volume must reject it regardless of depth or signal.
  const fake = { address: "0x1615", routable: false, hubDex: "uniswap-v3", hubLiquidityUsd: 1_146_410, liquidityUsd: 880_000_000, volume24hUsd: 0 };
  assert.equal(shouldTrustMapEntry(fake), false);
});

test("shouldTrustMapEntry rejects a pre-v5 entry with no volume field", () => {
  // A legacy map entry (no volume24hUsd) cannot prove it trades, so it is never trusted.
  const legacy = { address: "0xabc", routable: true, liquidityUsd: 5_000_000 };
  assert.equal(shouldTrustMapEntry(legacy), false);
});

test("shouldTrustMapEntry accepts a two-hop entry that actually trades", () => {
  const real = { address: "0x5607", routable: false, hubDex: "uniswap-v3", hubLiquidityUsd: 1_168_740, volume24hUsd: 137_492 };
  assert.equal(shouldTrustMapEntry(real), true);
});

test("shouldTrustMapEntry rejects null / empty entries", () => {
  assert.equal(shouldTrustMapEntry(null), false);
  assert.equal(shouldTrustMapEntry({ address: "0xabc", routable: false }), false);
});

test("estimateImpactPct uses the constant-product upper bound (2·size/TVL)", () => {
  assert.equal(estimateImpactPct(1000, 100_000), 2);
  assert.equal(estimateImpactPct(1000, 0), null);
  assert.equal(estimateImpactPct(1000, null), null);
  // NVDA on Base ~$1.78M: $1K ≈ 0.112%, $100K ≈ 11.2%
  const small = estimateImpactPct(1000, 1_780_000);
  const big = estimateImpactPct(100_000, 1_780_000);
  assert.ok(small > 0.1 && small < 0.12);
  assert.ok(big > 11 && big < 11.3);
});

test("isSuspectVolume flags big TVL with zero 24h volume", () => {
  assert.equal(isSuspectVolume({ liquidityUsd: 100_000_000, volume24hUsd: 0 }), true);
  assert.equal(isSuspectVolume({ liquidityUsd: 50_000, volume24hUsd: 0 }), false); // below threshold
  assert.equal(isSuspectVolume({ liquidityUsd: 100_000_000, volume24hUsd: 1000 }), false);
});

test("annotateVenues stamps estImpactPct / fitsSize / suspectVolume in place", () => {
  const venues = [
    { liquidityUsd: 1_000_000, volume24hUsd: 50_000 },
    { liquidityUsd: 10_000, volume24hUsd: 1000 },
    { liquidityUsd: 5_000_000, volume24hUsd: 0 },
  ];
  annotateVenues(venues, 1000);
  assert.equal(venues[0].fitsSize, true);
  assert.equal(venues[0].suspectVolume, false);
  assert.equal(venues[0].estImpactPct, 0.2);
  assert.equal(venues[1].fitsSize, false); // 2*1000/10000 = 20% > 3%
  assert.equal(venues[2].suspectVolume, true); // $5M TVL, zero volume
});

// ── pickBestVenue: USDC-relevant, size-aware, flag-propagating ────────────────

test("pickBestVenue prefers a fitting real USDC venue over a deeper WETH venue", () => {
  const usdc = { sailRoutable: true, pairedSymbol: "USDC", protocol: "uniswap-v3", liquidityUsd: 1_000_000, volume24hUsd: 50_000, fitsSize: true, suspectVolume: false, estImpactPct: 0.2 };
  const weth = { sailRoutable: true, pairedSymbol: "WETH", protocol: "uniswap-v3", liquidityUsd: 5_000_000, volume24hUsd: 100_000, fitsSize: true, suspectVolume: false, estImpactPct: 0.04 };
  const best = pickBestVenue([weth, usdc], CHAINS.base);
  assert.equal(best.pairedSymbol, "USDC");
  assert.equal(best.liquidityUsd, 1_000_000);
});

test("pickBestVenue falls back to a routable hub venue when no USDC pair exists", () => {
  const weth = { sailRoutable: true, pairedSymbol: "WETH", protocol: "uniswap-v3", liquidityUsd: 5_000_000, volume24hUsd: 100_000, fitsSize: true, suspectVolume: false, estImpactPct: 0.04 };
  const best = pickBestVenue([weth], CHAINS.base);
  assert.equal(best.pairedSymbol, "WETH");
});

test("pickBestVenue propagates the suspect-volume flag (never drops it)", () => {
  const fake = { sailRoutable: true, pairedSymbol: "USDC", protocol: "uniswap-v3", liquidityUsd: 100_000_000, volume24hUsd: 0, fitsSize: true, suspectVolume: true, estImpactPct: 0.002 };
  const best = pickBestVenue([fake], CHAINS.base);
  assert.equal(best.suspectVolume, true);
});

// ── perChainRecommendation: prose surfaces the money-critical warnings ────────

const baseRec = (over = {}) => ({
  symbol: "COINc",
  chain: CHAINS.base,
  swapReady: false,
  twoHop: false,
  twoHopVia: null,
  twoHopVenue: null,
  best: null,
  bestVenue: null,
  onchain: false,
  isUsdc: false,
  decimalsSource: "registry",
  source: "registry",
  sizeUsd: 1000,
  ...over,
});

test("recommendation surfaces a seeded/look-alike pool warning in the prose", () => {
  const bestVenue = { protocol: "uniswap-v3", liquidityUsd: 100_000_000, volume24hUsd: 0, suspectVolume: true, fitsSize: true, estImpactPct: 0.002, sailRoutable: true };
  const note = perChainRecommendation(baseRec({ swapReady: true, bestVenue }));
  assert.ok(note.includes("ZERO 24h volume"), note);
  assert.ok(note.includes("look-alike"), note);
});

test("recommendation flags a too-thin pool for the trade size", () => {
  const bestVenue = { protocol: "uniswap-v3", liquidityUsd: 10_000, volume24hUsd: 1000, suspectVolume: false, fitsSize: false, estImpactPct: 20, sailRoutable: true };
  const note = perChainRecommendation(baseRec({ swapReady: true, bestVenue }));
  assert.ok(note.includes("thin for a $1,000 trade"), note);
});

test("recommendation names the live on-chain quote as the authority when RPC is present", () => {
  const note = perChainRecommendation(baseRec({ swapReady: true, onchain: true, best: { fee: 3000 } }));
  assert.ok(note.includes("live Uniswap V3 USDC quote"), note);
});

test("recommendation phrases a two-hop route as swappable, not a special case", () => {
  const note = perChainRecommendation(baseRec({ twoHop: true, twoHopVia: "WETH", twoHopVenue: { protocol: "uniswap-v3", liquidityUsd: 500_000, sailRoutable: true } }));
  assert.ok(note.includes("swappable in two steps"), note);
});

test("recommendation recognizes USDC itself needs no swap", () => {
  const note = perChainRecommendation(baseRec({ isUsdc: true, symbol: "USDC" }));
  assert.ok(note.includes("no swap needed"), note);
});

// ── optimizeChainSet: minimum set cover for the basket ────────────────────────

const tok = (query, chainsWithLiquidity, swapReadyChains = [], deepestChain = null) => ({
  query,
  chainsWithLiquidity,
  crossChain: { deepestChain },
  chains: Object.fromEntries(
    chainsWithLiquidity.map((c) => [c, { error: null, swapReady: swapReadyChains.includes(c) }]),
  ),
});

test("optimizeChainSet picks a single chain that covers every token", () => {
  const tokens = [
    tok("A", ["base", "ethereum"], ["base"], "base"),
    tok("B", ["base"], ["base"], "base"),
  ];
  const plan = optimizeChainSet(tokens);
  assert.equal(plan.covered, true);
  assert.deepEqual(plan.chosenChains, ["base"]);
  assert.equal(plan.chainCount, 1);
  assert.deepEqual(plan.uncovered, []);
});

test("optimizeChainSet returns the minimum set when tokens force multiple chains", () => {
  const tokens = [
    tok("A", ["ethereum"], ["ethereum"], "ethereum"),
    tok("B", ["base"], ["base"], "base"),
  ];
  const plan = optimizeChainSet(tokens);
  assert.equal(plan.covered, true);
  assert.equal(plan.chainCount, 2);
  assert.deepEqual([...plan.chosenChains].sort(), ["base", "ethereum"]);
});

test("optimizeChainSet reports tokens with no liquidity as uncovered", () => {
  const tokens = [tok("A", []), tok("B", ["base"], ["base"], "base")];
  const plan = optimizeChainSet(tokens);
  assert.equal(plan.covered, true);
  assert.deepEqual(plan.uncovered, ["A"]);
});

test("optimizeChainSet returns covered:false when nothing has liquidity", () => {
  const plan = optimizeChainSet([tok("A", [])]);
  assert.equal(plan.covered, false);
});

// ── isMapStale: 30-day freshness gate ─────────────────────────────────────────

test("isMapStale flags a map older than 30 days", () => {
  const now = Date.now();
  assert.equal(isMapStale(new Date(now - 31 * 86_400_000).toISOString(), now), true);
  assert.equal(isMapStale(new Date(now - 10 * 86_400_000).toISOString(), now), false);
  assert.equal(isMapStale(null, now), false);
  assert.equal(isMapStale("not-a-date", now), false);
});

// ── ABI codecs (no deps) ──────────────────────────────────────────────────────

test("pad32 left-pads to 64 hex chars", () => {
  const out = pad32("0xAbC");
  assert.equal(out.length, 64);
  assert.ok(out.endsWith("abc"));
});

test("uintToHex encodes a bigint as a 32-byte word", () => {
  assert.equal(uintToHex(0n), "0".repeat(64));
  assert.equal(uintToHex(1n), "0".repeat(63) + "1");
});

test("encodeQuoteCall builds the QuoterV2 single-tuple call", () => {
  const out = encodeQuoteCall("0x" + "1".repeat(40), "0x" + "2".repeat(40), 25n * 10n ** 6n, 3000);
  assert.ok(out.startsWith("0xc6a5026a"));
  assert.equal(out.length, 8 + 2 + 5 * 64); // selector(0x+8) + 5 words
});

test("decodeUint256Return reads the first word as a bigint", () => {
  const hex = "0x" + "00".repeat(31) + "2a"; // 42
  assert.equal(decodeUint256Return(hex), 42n);
});

test("decodeStringReturn decodes a UTF-8 symbol() return", () => {
  // string return: offset(0x20) + length(5) + "HELLO"
  const data = Buffer.from("HELLO", "utf8").toString("hex");
  const hex = "0x" + uintToHex(0x20n) + uintToHex(5n) + data;
  assert.equal(decodeStringReturn(hex), "HELLO");
});

// ── chain / rpc resolution (flag paths are pure) ──────────────────────────────

test("resolveChain resolves by name and numeric id, case-insensitive", () => {
  assert.equal(resolveChain("base").chainId, 8453);
  assert.equal(resolveChain("Base").name, "base");
  assert.equal(resolveChain("8453").name, "base");
  assert.equal(resolveChain("ethereum").chainId, 1);
});

test("resolveChain rejects unknown chains", () => {
  assert.throws(() => resolveChain("not-a-chain"), /Unknown chain/);
});

test("resolveRpc honors an explicit --rpc flag", () => {
  assert.equal(resolveRpc(CHAINS.base, "http://localhost:8545"), "http://localhost:8545");
});

// ── constant sanity (guard the values the whole screen depends on) ────────────

test("the two-hop dust floor is $10,000", () => {
  assert.equal(MIN_TWO_HOP_LIQUIDITY_USD, 10_000);
});

test("the retail impact cap is 3% and the suspect-volume TVL floor is $100k", () => {
  assert.equal(MAX_IMPACT_PCT, 3);
  assert.equal(SUSPECT_VOLUME_TVL, 100_000);
  assert.equal(DEFAULT_SIZE_USD, 1000);
});

test("every Coinbase B20 stock ticker has a matching alias entry", () => {
  // If a B20 stock is added to CHAINS.base.tokens but the alias map is missed, the
  // plain ticker ("COIN") would silently stop resolving to the curated address.
  const b20 = Object.keys(CHAINS.base.tokens).filter((k) => k.endsWith("c") && k.length > 1);
  for (const key of b20) {
    const plain = key.slice(0, -1); // "COINc" → "COIN"
    assert.ok(STOCK_SUFFIX_ALIASES[plain], `missing alias for ${plain} (→ ${key})`);
    assert.equal(STOCK_SUFFIX_ALIASES[plain], key);
  }
});
