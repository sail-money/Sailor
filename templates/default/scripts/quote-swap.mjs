#!/usr/bin/env node
// quote-swap.mjs — live Uniswap V3 quote via QuoterV2 + an amountOutMinimum floor.
//
// Takes resolved tokens + an exact amount (from resolve-token.mjs), returns the
// expected output and a slippage-adjusted amountOutMinimum ready to embed in a
// swap dispatch. Pure JS, no dependencies.
//
//   node scripts/quote-swap.mjs \
//     --token-in  0x078D...AD6  --decimals-in  6 \
//     --token-out 0x4200...0006 --decimals-out 18 \
//     --amount 25000000 --fee 3000 --slippage-bps 100
//
// Output: one JSON object on stdout; human notes on stderr.

import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

const CHAINS = {
  unichain: { chainId: 130, quoterV2: "0x385a5cf5f83e99f7bb2852b6a19c3538b9fa7658" },
  base: { chainId: 8453, quoterV2: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" },
  arbitrum: { chainId: 42161, quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e" },
};

const SEL_QUOTE = "0xc6a5026a"; // quoteExactInputSingle((address,address,uint256,uint24,uint160))
const ADDR_ZERO = "0x" + "0".repeat(40);

// ── minimal ABI encode/decode (mirrors resolve-token.mjs) ───────────────────────
function pad32(h) {
  h = h.toLowerCase().replace(/^0x/, "");
  if (h.length < 64) h = "0".repeat(64 - h.length) + h;
  return h;
}
function uintToHex(n) {
  let h = n.toString(16);
  if (h.length % 2) h = "0" + h;
  return pad32(h);
}
function encodeQuoteCall(tokenIn, tokenOut, amountIn, fee) {
  return SEL_QUOTE + pad32(tokenIn) + pad32(tokenOut) + uintToHex(amountIn) + uintToHex(BigInt(fee)) + uintToHex(0n);
}
function decodeUint(hex, word = 0) {
  const h = hex.toLowerCase().replace(/^0x/, "");
  const w = h.slice(word * 64, word * 64 + 64);
  return w ? BigInt("0x" + w) : 0n;
}

async function ethCall(rpc, to, data, from = ADDR_ZERO) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data, from }, "latest"] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`eth_call HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`QuoterV2 reverted: ${JSON.stringify(json.error)}`);
  if (!json.result) throw new Error("eth_call returned no result");
  return json.result;
}

function readSailEnv() {
  const p = resolvePath(process.cwd(), ".sail", ".env.local");
  const out = {};
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}
function readSailConfig() {
  const p = resolvePath(process.cwd(), ".sail", "config.json");
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
    for (const [name, cfg] of Object.entries(CHAINS)) if (String(cfg.chainId) === String(chainFlag)) return { name, ...cfg };
    throw new Error(`Unknown chain "${chainFlag}". Known: ${Object.keys(CHAINS).join(", ")}`);
  }
  const env = readSailEnv();
  const cfg = readSailConfig();
  const id = env.CHAIN_ID ?? cfg.chainId;
  if (id) for (const [name, c] of Object.entries(CHAINS)) if (String(c.chainId) === String(id)) return { name, ...c };
  throw new Error(`Could not resolve chain. Pass --chain <${Object.keys(CHAINS).join("|")}>.`);
}
function resolveRpc(chainName, rpcFlag) {
  if (rpcFlag) return rpcFlag;
  const env = readSailEnv();
  return env[`${chainName.toUpperCase().replace("-", "_")}_RPC_URL`] ?? env.RPC_URL ?? null;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      out[key] = argv[++i];
    }
  }
  return out;
}

function fmtUnits(valueBI, decimals) {
  // bigint base units → human string, preserving precision
  const neg = valueBI < 0n;
  let s = (neg ? -valueBI : valueBI).toString().padStart(decimals + 1, "0");
  const intPart = s.slice(0, s.length - decimals);
  const fracPart = decimals > 0 ? s.slice(s.length - decimals) : "";
  const trimmedFrac = fracPart.replace(/0+$/, "");
  let out = trimmedFrac.length ? `${intPart}.${trimmedFrac}` : intPart;
  if (decimals > 0 && !trimmedFrac) out = `${intPart}.0`;
  return (neg ? "-" : "") + out;
}

function errMsg(e) {
  return e && typeof e.message === "string" ? e.message : String(e);
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (process.argv.length <= 2 || a.help) {
    process.stderr.write(
      "Usage: quote-swap.mjs --token-in <addr> --token-out <addr> --amount <baseUnits>\n" +
        "  --decimals-in <n> --decimals-out <n> --fee <tier> [--slippage-bps <n>] [--chain <>] [--rpc URL]\n",
    );
    process.exit(process.argv.length <= 2 ? 1 : 0);
  }

  const need = ["tokenIn", "tokenOut", "amount", "decimalsIn", "decimalsOut", "fee"];
  for (const k of need) if (a[k] === undefined) throw new Error(`Missing --${k.replace(/([A-Z])/g, "-$1").toLowerCase()}`);

  const chain = resolveChain(a.chain);
  const rpc = resolveRpc(chain.name, a.rpc);
  if (!rpc) throw new Error(`No RPC for ${chain.name}. Pass --rpc or set RPC_URL in .sail/.env.local.`);

  const tokenIn = a.tokenIn;
  const tokenOut = a.tokenOut;
  const amountIn = BigInt(a.amount);
  const fee = Number(a.fee);
  const decimalsIn = Number(a.decimalsIn);
  const decimalsOut = Number(a.decimalsOut);
  const slippageBps = a.slippageBps !== undefined ? Number(a.slippageBps) : 100; // default 1%

  const data = encodeQuoteCall(tokenIn, tokenOut, amountIn, fee);
  const ret = await ethCall(rpc, chain.quoterV2, data);
  const amountOut = decodeUint(ret, 0); // word 0
  const gasEstimate = decodeUint(ret, 3); // word 3

  if (amountOut === 0n) {
    throw new Error(
      `QuoterV2 returned 0 for ${amountIn} (tokenIn) → tokenOut at fee ${fee}. The pool is empty or does not exist at this tier.`,
    );
  }

  const amountOutMinimum = (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
  // price = (amountOut / 10^decOut) / (amountIn / 10^decIn) → units of tokenOut per tokenIn
  const humanIn = fmtUnits(amountIn, decimalsIn);
  const humanOut = fmtUnits(amountOut, decimalsOut);
  const humanMin = fmtUnits(amountOutMinimum, decimalsOut);

  const out = {
    tokenIn,
    tokenOut,
    decimalsIn,
    decimalsOut,
    amountIn: amountIn.toString(),
    amountOut: amountOut.toString(),
    amountOutMinimum: amountOutMinimum.toString(),
    slippageBps,
    fee,
    chain: chain.name,
    chainId: chain.chainId,
    gasEstimate: gasEstimate.toString(),
    human: {
      amountIn: humanIn,
      amountOut: humanOut,
      amountOutMinimum: humanMin,
      price: `${humanOut} out per ${humanIn} in`,
    },
    note: "amountOutMinimum is the slippage floor — embed it in the swap calldata the agent dispatches.",
  };

  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  process.stderr.write(
    `\nQuote: ${humanIn} in → ${humanOut} out  (fee ${fee})\n` +
      `  amountOutMinimum (${slippageBps / 100}% slip): ${humanMin}\n` +
      `  gas estimate: ${gasEstimate}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`\nquote-swap failed: ${errMsg(err)}\n`);
  process.exit(1);
});
