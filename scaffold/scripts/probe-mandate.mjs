#!/usr/bin/env node
// probe-mandate.mjs — GENERATE the lean safety-probe set for a SHARED template
// from its config blob, so the agent doesn't compose probes with inference.
//
// The mandate's safety gate is `sailor mandate simulate`: prove the configured
// bounds REJECT what they must reject (over-cap, off-allowlist, wrong recipient,
// zero floor) and ACCEPT a representative good call. Writing those probes by hand
// is slow and token-heavy; this derives them mechanically from the same config
// blob you configure with, then hands you the exact `sailor mandate simulate`
// command (or runs it with --run).
//
//   node scripts/probe-mandate.mjs --template TransferPermission \
//        --params 0x… --sma 0xYourSMA --address 0xPermissionSingleton [--chain base]
//   node scripts/probe-mandate.mjs --template SwapPermissionNoOracle --params 0x… --run
//
// Output: writes ./mandate-probes.<template>.json (the calls.json `simulate`
// consumes) and prints a compact plan on stderr + the ready command on stdout.
//
// SCOPE: shared templates whose probe calldata is fully derivable from the blob —
// Transfer, Withdraw, Deposit, SwapPermission, SwapPermissionNoOracle. NOT covered:
//   • BorrowPermission — the borrow calldata depends on which lending-protocol
//     family (Aave / Morpho / Compound) the target is; the blob lists protocols
//     but not their family, so the probe needs an extra input. (seam for a follow-up)
//   • ApproveAndCallBatchPermission — enforced by evaluateBatch(); `mandate
//     simulate` only exercises single-call evaluate(). Probe it with `cast call
//     evaluateBatch(...)` pass/fail sequences instead.
//   • Bespoke permissions — no known config schema; probes stay agent-derived.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { decodeAbiParameters, encodeFunctionData, getAddress } from "viem";

// Sentinels that are, by construction, NOT in any user allowlist — used to prove
// the off-allowlist / wrong-recipient rejections fire.
const OFF_ALLOWLIST = getAddress("0x000000000000000000000000000000000000dEaD");
const WRONG_RECIPIENT = getAddress("0x000000000000000000000000000000000000bEEF");
const A_FEE = 3000; // a nominal Uniswap V3 fee tier for the swap probe calldata

// ── F15: pick the swap calldata shape that ACTUALLY routes on the configured
// router, so the probe's selector matches the router's bytecode instead of
// emitting the bogus "selector not in bytecode" warning. Uniswap SwapRouter02
// (no per-call deadline) decodes exactInputSingle 0x04e45aaf; the classic
// SwapRouter (with deadline) decodes 0x414bf389; V2-style AMM routers decode
// swapExactTokensForTokens 0x38ed1739. Keyed by known router addresses; unknown
// routers default to SwapRouter02 (the prevalent Sail deployment) with a note.
const SWAP_ROUTER_02 = new Set(
  [
    "0x2626664c2603336E57B271c5C0b26F421741e481", // Base
    "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", // Arbitrum / Optimism / Ethereum / Polygon
    "0xE592427A0AEce92De3Edee1F18E0157C05861564", // (classic SwapRouter — overridden below)
  ].map((a) => a.toLowerCase()),
);
const SWAP_ROUTER_V1 = new Set(["0xE592427A0AEce92De3Edee1F18E0157C05861564".toLowerCase()]);

/** Which exactInputSingle/AMM shape a router speaks. */
function routerFamily(router) {
  const a = router.toLowerCase();
  if (SWAP_ROUTER_V1.has(a)) return "v3-v1"; // exactInputSingle WITH deadline
  if (SWAP_ROUTER_02.has(a)) return "v3-v2"; // exactInputSingle WITHOUT deadline
  return "v3-v2"; // default: SwapRouter02 shape (documented in notes)
}

// ── Config blob layouts (verified against Protocol/contracts/templates/*.sol
// `_applyConfig` decode @ d5bc27a). Field order is load-bearing. We decode only
// the LEADING fields the probes need (allowlists + cap, all before any trailing
// dynamic field), so the ReferencePool[] tail of the no-oracle blob is skipped —
// its head slots stay valid and it never has to be decoded.
const CONFIG_LAYOUT = {
  TransferPermission: ["address[]", "address[]", "uint256"], // recipients, tokens, cap
  WithdrawPermission: ["address[]", "address", "uint256"], //   tokens, recipient, cap
  DepositPermission: ["address[]", "address[]", "uint256"], //  targets, tokens, cap
  SwapPermissionNoOracle: ["address[]", "address[]", "address[]", "uint256"], // routers, tokensIn, tokensOut, cap, [pools…]
  SwapPermission: ["address[]", "address[]", "address[]", "uint256", "uint256", "address", "uint256"],
};

const ERC20_TRANSFER = [{ type: "function", name: "transfer", inputs: [{ type: "address" }, { type: "uint256" }] }];
const ERC4626_DEPOSIT = [{ type: "function", name: "deposit", inputs: [{ type: "uint256" }, { type: "address" }] }];
const EXACT_INPUT_SINGLE_V2 = [{
  type: "function", name: "exactInputSingle",
  inputs: [{ type: "tuple", components: [
    { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "fee", type: "uint24" },
    { name: "recipient", type: "address" }, { name: "amountIn", type: "uint256" },
    { name: "amountOutMinimum", type: "uint256" }, { name: "sqrtPriceLimitX96", type: "uint160" },
  ] }],
}];
const EXACT_INPUT_SINGLE_V1 = [{
  type: "function", name: "exactInputSingle",
  inputs: [{ type: "tuple", components: [
    { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "fee", type: "uint24" },
    { name: "recipient", type: "address" }, { name: "deadline", type: "uint256" }, { name: "amountIn", type: "uint256" },
    { name: "amountOutMinimum", type: "uint256" }, { name: "sqrtPriceLimitX96", type: "uint160" },
  ] }],
}];

function erc20Transfer(to, amount) {
  return encodeFunctionData({ abi: ERC20_TRANSFER, functionName: "transfer", args: [to, amount] });
}
function swapCalldata(family, { tokenIn, tokenOut, recipient, amountIn, amountOutMinimum }) {
  if (family === "v3-v1") {
    return encodeFunctionData({ abi: EXACT_INPUT_SINGLE_V1, functionName: "exactInputSingle",
      args: [{ tokenIn, tokenOut, fee: A_FEE, recipient, deadline: 2n ** 40n, amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n }] });
  }
  return encodeFunctionData({ abi: EXACT_INPUT_SINGLE_V2, functionName: "exactInputSingle",
    args: [{ tokenIn, tokenOut, fee: A_FEE, recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n }] });
}

/**
 * Derive the lean probe set for `template` from its DECODED config + the SMA.
 * Pure: no network, no fs. Returns { probes, notes }. Each probe is a calls.json
 * entry { label, target, calldata, value, expect }.
 */
export function generateProbes(template, config, account) {
  const acct = getAddress(account);
  switch (template) {
    case "TransferPermission": {
      const { recipients, tokens, cap } = config;
      const token = getAddress(tokens[0]);
      const to = getAddress(recipients[0]);
      return {
        notes: [],
        probes: [
          { label: "in-bounds transfer (allowed token+recipient, amount = cap)", target: token, calldata: erc20Transfer(to, cap), value: "0", expect: "pass" },
          { label: "OVER-CAP transfer (cap + 1) must reject", target: token, calldata: erc20Transfer(to, cap + 1n), value: "0", expect: "fail" },
          { label: "OFF-ALLOWLIST token must reject", target: OFF_ALLOWLIST, calldata: erc20Transfer(to, cap), value: "0", expect: "fail" },
          { label: "WRONG recipient (not allowlisted) must reject", target: token, calldata: erc20Transfer(WRONG_RECIPIENT, cap), value: "0", expect: "fail" },
        ],
      };
    }
    case "WithdrawPermission": {
      const { tokens, recipient, cap } = config;
      const token = getAddress(tokens[0]);
      const pinned = getAddress(recipient);
      return {
        notes: [],
        probes: [
          { label: "in-bounds withdraw (allowed token → pinned recipient, amount = cap)", target: token, calldata: erc20Transfer(pinned, cap), value: "0", expect: "pass" },
          { label: "OVER-CAP withdraw (cap + 1) must reject", target: token, calldata: erc20Transfer(pinned, cap + 1n), value: "0", expect: "fail" },
          { label: "OFF-ALLOWLIST token must reject", target: OFF_ALLOWLIST, calldata: erc20Transfer(pinned, cap), value: "0", expect: "fail" },
          { label: "WRONG recipient (≠ pinned) must reject", target: token, calldata: erc20Transfer(WRONG_RECIPIENT, cap), value: "0", expect: "fail" },
        ],
      };
    }
    case "DepositPermission": {
      const { targets, cap } = config;
      const target = getAddress(targets[0]);
      const dep = (amount, receiver) => encodeFunctionData({ abi: ERC4626_DEPOSIT, functionName: "deposit", args: [amount, receiver] });
      return {
        notes: [
          "Deposit probes use the ERC-4626 deposit(assets,receiver) shape. For an Aave-style pool (deposit/supply(asset,amount,onBehalfOf,referral)) the calldata differs — probe that path with `cast call` for now.",
        ],
        probes: [
          { label: "in-bounds deposit (allowed vault, receiver = SMA, amount = cap)", target, calldata: dep(cap, acct), value: "0", expect: "pass" },
          { label: "OVER-CAP deposit (cap + 1) must reject", target, calldata: dep(cap + 1n, acct), value: "0", expect: "fail" },
          { label: "OFF-ALLOWLIST vault must reject", target: OFF_ALLOWLIST, calldata: dep(cap, acct), value: "0", expect: "fail" },
          { label: "WRONG receiver (≠ SMA) must reject", target, calldata: dep(cap, WRONG_RECIPIENT), value: "0", expect: "fail" },
        ],
      };
    }
    case "SwapPermission":
    case "SwapPermissionNoOracle": {
      const { routers, tokensIn, tokensOut, cap } = config;
      const router = getAddress(routers[0]);
      const family = routerFamily(router);
      const tokenIn = getAddress(tokensIn[0]);
      const tokenOut = getAddress(tokensOut[0]);
      const mk = (over, recipient, minOut) => swapCalldata(family, { tokenIn, tokenOut, recipient, amountIn: over ? cap + 1n : cap, amountOutMinimum: minOut });
      const notes = [];
      if (family === "v3-v2" && !SWAP_ROUTER_02.has(router.toLowerCase())) {
        notes.push(`Router ${router} is not a known SwapRouter02 — probes default to the SwapRouter02 exactInputSingle shape (0x04e45aaf). If it is the classic SwapRouter or a V2 AMM router, the selector differs; confirm the router family.`);
      }
      const minOut = 1n; // non-zero floor (SwapPermissionNoOracle requires minOut > 0)
      const probes = [
        { label: "in-bounds swap (allowed router+tokens, recipient = SMA, amountIn = cap)", target: router, calldata: mk(false, acct, minOut), value: "0", expect: "pass" },
        { label: "OVER-CAP swap (amountIn = cap + 1) must reject", target: router, calldata: mk(true, acct, minOut), value: "0", expect: "fail" },
        { label: "OFF-ALLOWLIST router must reject", target: OFF_ALLOWLIST, calldata: mk(false, acct, minOut), value: "0", expect: "fail" },
        { label: "WRONG recipient (≠ SMA) must reject", target: router, calldata: mk(false, WRONG_RECIPIENT, minOut), value: "0", expect: "fail" },
      ];
      if (template === "SwapPermissionNoOracle") {
        probes.push({ label: "ZERO min-out (no slippage floor) must reject", target: router, calldata: mk(false, acct, 0n), value: "0", expect: "fail" });
      }
      return { notes, probes };
    }
    default:
      throw new Error(
        `probe-mandate does not cover "${template}". Covered: Transfer, Withdraw, Deposit, SwapPermission, SwapPermissionNoOracle. ` +
          `BorrowPermission (needs the lending-protocol family) and ApproveAndCallBatchPermission (evaluateBatch — probe with cast call) are not derivable here.`,
      );
  }
}

/** Decode a config blob into the named fields for `template`. */
export function decodeConfig(template, blobHex) {
  const layout = CONFIG_LAYOUT[template];
  if (!layout) throw new Error(`Unknown/uncovered template "${template}".`);
  const d = decodeAbiParameters(layout.map((type) => ({ type })), blobHex);
  switch (template) {
    case "TransferPermission": return { recipients: d[0], tokens: d[1], cap: d[2] };
    case "WithdrawPermission": return { tokens: d[0], recipient: d[1], cap: d[2] };
    case "DepositPermission": return { targets: d[0], tokens: d[1], cap: d[2] };
    case "SwapPermissionNoOracle": return { routers: d[0], tokensIn: d[1], tokensOut: d[2], cap: d[3] };
    case "SwapPermission": return { routers: d[0], tokensIn: d[1], tokensOut: d[2], cap: d[3], slippageBps: d[4], oracle: d[5], maxPriceAge: d[6] };
    default: throw new Error(`Unknown template "${template}".`);
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function readAccountJson() {
  const p = resolvePath(process.cwd(), ".sail", "account.json");
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; }
}

function main() {
  const template = arg("template");
  const params = arg("params");
  const sma = arg("sma") ?? readAccountJson().safe;
  const address = arg("address");
  if (!template || !params) {
    console.error("Usage: node scripts/probe-mandate.mjs --template <Name> --params <0x-config-blob> --sma <SMA> --address <singleton> [--chain <id>] [--out <file>] [--run]");
    process.exit(2);
  }
  if (!sma) { console.error("No SMA. Pass --sma <address> (or create .sail/account.json)."); process.exit(2); }

  const config = decodeConfig(template, params);
  const { probes, notes } = generateProbes(template, config, sma);

  const out = arg("out") ?? resolvePath(process.cwd(), `mandate-probes.${template}.json`);
  writeFileSync(out, `${JSON.stringify(probes, null, 2)}\n`);

  // Compact plan → stderr (human), the ready command → stdout (machine/agent).
  const fails = probes.filter((p) => p.expect === "fail").length;
  console.error(`\n${template} — ${probes.length} probes (${fails} must-REJECT proofs, ${probes.length - fails} must-ACCEPT):`);
  for (const p of probes) console.error(`  [${p.expect === "fail" ? "must-fail" : "must-pass"}] ${p.label}`);
  for (const n of notes) console.error(`  note: ${n}`);
  console.error(`\nWrote ${out}. Run the safety gate:`);

  const cmd = `sailor mandate simulate --address ${address ?? "<SINGLETON>"} --sma ${sma} --calls ${out} --json`;
  console.log(cmd);
}

// Run only as a CLI, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) main();
