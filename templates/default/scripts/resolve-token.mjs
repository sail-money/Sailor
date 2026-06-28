#!/usr/bin/env node
// resolve-token.mjs — resolve a token symbol/address to on-chain metadata and
// determine WHERE it is swap-ready (live Uniswap V3 pool via QuoterV2).
//
// Pure JS, no dependencies (works in a fresh project before Foundry is set up).
// Reads RPC + chain from .sail/.env.local or .sail/config.json, or --rpc/--chain.
//
//   node scripts/resolve-token.mjs WETH
//   node scripts/resolve-token.mjs LINK --chain unichain
//   node scripts/resolve-token.mjs 0x4200...0006 --chain base
//
// Output: one JSON object on stdout (machine-readable); human notes on stderr.

import { readFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

// ── Curated registry (verified live June 2026). Always re-verify decimals on-chain. ──
// Per-chain Uniswap V3 infrastructure + the common tokens. Addresses are PER-CHAIN.
const CHAINS = {
  unichain: {
    chainId: 130,
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
    quoterV2: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokens: {
      USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    },
  },
  arbitrum: {
    chainId: 42161,
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

// ── Minimal ABI encoding (no deps) ──────────────────────────────────────────────
// selector(string) → first 4 bytes of keccak256. We only call two functions, so
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
  const json = (await res.json());
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

function resolveRpc(chainName, rpcFlag) {
  if (rpcFlag) return rpcFlag;
  const env = readSailEnv();
  const chainVar = `${chainName.toUpperCase().replace("-", "_")}_RPC_URL`;
  return env[chainVar] ?? env.RPC_URL ?? null;
}

// ── main ────────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    process.stderr.write(
      "Usage: node scripts/resolve-token.mjs <SYMBOL|ADDRESS> [--chain unichain|base|arbitrum] [--rpc URL]\n",
    );
    process.exit(args.length === 0 ? 1 : 0);
  }

  let symbolOrAddr = null;
  let chainFlag = null;
  let rpcFlag = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--chain") chainFlag = args[++i];
    else if (a === "--rpc") rpcFlag = args[++i];
    else if (!symbolOrAddr) symbolOrAddr = a;
  }
  if (!symbolOrAddr) throw new Error("Pass a token symbol or address as the first argument.");

  const chain = resolveChain(chainFlag);
  const rpc = resolveRpc(chain.name, rpcFlag);
  if (!rpc) {
    throw new Error(
      `No RPC for chain "${chain.name}". Pass --rpc <url> or set RPC_URL / ${chain.name.toUpperCase()}_RPC_URL in .sail/.env.local.`,
    );
  }

  const isAddrInput = /^0x[a-fA-F0-9]{40}$/.test(symbolOrAddr);
  let symbol, address, assumedDecimals;
  if (isAddrInput) {
    address = symbolOrAddr;
    symbol = null; // verified on-chain below
  } else {
    const up = symbolOrAddr.toUpperCase();
    const entry = chain.tokens[up];
    if (!entry) {
      throw new Error(
        `"${symbolOrAddr}" is not in the curated ${chain.name} registry. Pass its 0x address, or add it to scripts/resolve-token.mjs.`,
      );
    }
    address = entry.address;
    assumedDecimals = entry.decimals;
    symbol = up;
  }

  // 1. Verify on-chain: symbol() + decimals(). Source of truth — never trust the registry blindly.
  let verifiedSymbol = symbol;
  let decimals = assumedDecimals;
  try {
    const symHex = await ethCall(rpc, address, SEL.symbol);
    const decHex = await ethCall(rpc, address, SEL.decimals);
    const onChainSymbol = decodeStringReturn(symHex);
    const onChainDecimals = Number(decodeUint256Return(decHex));
    if (onChainSymbol) verifiedSymbol = onChainSymbol;
    decimals = onChainDecimals;
  } catch (err) {
    throw new Error(
      `On-chain verify failed for ${address} on ${chain.name}: ${errMsg(err)}. The contract may not exist on this chain.`,
    );
  }

  // 2. Liquidity probe: quote USDC -> token across fee tiers via QuoterV2.
  // Non-zero amountOut = swap-ready. USDC is tokenIn (the DCA sell leg).
  const tokenIn = chain.usdc;
  const tokenOut = address;
  let best = null; // { fee, amountOut }
  let tried = [];
  for (const fee of FEE_TIERS) {
    const data = encodeQuoteCall(tokenIn, tokenOut, PROBE_AMOUNT_USDC, fee);
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

  const swapReady = best !== null;
  const out = {
    symbol: verifiedSymbol,
    address,
    decimals,
    chain: chain.name,
    chainId: chain.chainId,
    swapReady,
    feeTier: best ? best.fee : null,
    quote: best
      ? {
          tokenIn: "USDC",
          tokenInAddress: tokenIn,
          amountIn: PROBE_AMOUNT_USDC.toString(),
          amountOut: best.amountOut.toString(),
        }
      : null,
    probedTiers: tried,
    recommendation: swapReady
      ? `Swap-ready on ${chain.name} (deepest pool fee ${best.fee}). Hand to quote-swap.mjs for an exact quote + amountOutMinimum.`
      : `No USDC V3 pool on ${chain.name} for ${verifiedSymbol}. If the token exists on another Sail chain, re-run with --chain <base|arbitrum> to locate liquidity; otherwise configure as a held leg.`,
  };

  process.stdout.write(JSON.stringify(out, null, 2) + "\n");

  // Human notes on stderr (so stdout stays machine-clean).
  process.stderr.write(
    `\n${verifiedSymbol} on ${chain.name} (${chain.chainId}):\n` +
      `  address:   ${address}\n` +
      `  decimals:  ${decimals} (verified on-chain)\n` +
      `  swap-ready: ${swapReady ? `yes — fee ${best.fee} (deepest)` : "NO USDC V3 pool on this chain"}\n` +
      `  ${out.recommendation}\n`,
  );
}

function errMsg(e) {
  return e && typeof e.message === "string" ? e.message : String(e);
}

main().catch((err) => {
  process.stderr.write(`\nresolve-token failed: ${errMsg(err)}\n`);
  process.exit(1);
});
