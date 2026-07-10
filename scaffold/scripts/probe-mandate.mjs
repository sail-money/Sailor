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
//   node scripts/probe-mandate.mjs --template BorrowPermission --params 0x… --protocol aave --sma 0x… --address 0x…
//   node scripts/probe-mandate.mjs --template ApproveAndCallBatchPermission --params 0x… --sma 0x… --address 0x…
//
// Output for single-call templates: writes ./mandate-probes.<template>.json (the
// calls.json `sailor mandate simulate` consumes) and prints the ready command.
// ApproveAndCallBatchPermission is enforced by evaluateBatch(), which single-call
// `simulate` cannot exercise — its probes are BATCH arrays; the script emits them
// and shows the direct evaluateBatch() staticcall mechanism.
//
// SCOPE: ALL SEVEN shared templates — Transfer, Withdraw, Deposit, SwapPermission,
// SwapPermissionNoOracle, BorrowPermission (needs --protocol <aave|morpho|compound>,
// since the borrow calldata shape is per-family and not in the blob), and
// ApproveAndCallBatchPermission (batch/evaluateBatch). Bespoke permissions have no
// known config schema — their probes stay agent-derived (the other path, by design).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { decodeAbiParameters, encodeFunctionData, getAddress } from "viem";

// Sentinels that are, by construction, NOT in any user allowlist — used to prove
// the off-allowlist / wrong-recipient rejections fire.
const OFF_ALLOWLIST = getAddress("0x000000000000000000000000000000000000dEaD");
const WRONG_RECIPIENT = getAddress("0x000000000000000000000000000000000000bEEF");
const ZERO = "0x0000000000000000000000000000000000000000";
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
  BorrowPermission: ["address[]", "address[]", "uint256", "uint256", "address", "address", "uint256"], // protocols, assets, cap, maxLtvBps, collateralOracle, borrowOracle, maxPriceAgeSec
  // ApproveAndCallBatchPermission is a single wrapped struct — decoded specially below.
};

// The ApproveAndCallBatch config is one wrapped struct (not flat params), so it
// needs a structured tuple decoder rather than a list of leading types.
const APPROVE_BATCH_CONFIG = [{
  type: "tuple",
  components: [
    { name: "tokens", type: "address[]" },
    { name: "spenders", type: "address[]" },
    { name: "consumingPairs", type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "selector", type: "bytes4" }] },
    { name: "maxApprovalAmounts", type: "uint256[]" },
    { name: "requireAmountMatch", type: "bool" },
    { name: "allowUnconstrainedRecipient", type: "bool" },
  ],
}];

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

// ── BorrowPermission: the three families evaluate() decodes (verified against the
// contract's AAVE_BORROW/MORPHO_BORROW/COMPOUND_BORROW constants @ d5bc27a). Aave
// requires variable rate (mode 2) and onBehalfOf == account; Morpho pins both
// onBehalf and receiver to the account; Compound's target is the cToken and the
// call carries only the amount (asset resolved on-chain via cToken.underlying()).
const AAVE_VARIABLE_RATE = 2n;
const BORROW_ABI = {
  aave: [{ type: "function", name: "borrow", inputs: [
    { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint16" }, { type: "address" }] }],
  morpho: [{ type: "function", name: "borrow", inputs: [
    { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "address" }] }],
  compound: [{ type: "function", name: "borrow", inputs: [{ type: "uint256" }] }],
};
export const BORROW_FAMILIES = Object.keys(BORROW_ABI);

function borrowCalldata(family, { asset, amount, account }) {
  if (family === "aave")
    return encodeFunctionData({ abi: BORROW_ABI.aave, functionName: "borrow", args: [asset, amount, AAVE_VARIABLE_RATE, 0, account] });
  if (family === "morpho")
    return encodeFunctionData({ abi: BORROW_ABI.morpho, functionName: "borrow", args: [asset, amount, account, account] });
  return encodeFunctionData({ abi: BORROW_ABI.compound, functionName: "borrow", args: [amount] }); // compound: amount only
}
/** Build a borrow call with the WRONG recipient (Aave onBehalfOf / Morpho receiver). Compound has none. */
function borrowWrongRecipient(family, { asset, amount, account }) {
  if (family === "aave")
    return encodeFunctionData({ abi: BORROW_ABI.aave, functionName: "borrow", args: [asset, amount, AAVE_VARIABLE_RATE, 0, WRONG_RECIPIENT] });
  if (family === "morpho")
    return encodeFunctionData({ abi: BORROW_ABI.morpho, functionName: "borrow", args: [asset, amount, account, WRONG_RECIPIENT] });
  return null; // compound borrow(uint256) has no recipient to misdirect
}

// ── ApproveAndCallBatchPermission: the 3-call approve→consume→reset bracket that
// evaluateBatch() authorises. The consuming call (calls[1]) must use a selector in
// the contract's decodable set (below) so its consumed asset + recipient bind; we
// build it to consume `token`, deliver to `account`, and pull `amount`.
const ERC20_APPROVE = [{ type: "function", name: "approve", inputs: [{ type: "address" }, { type: "uint256" }] }];
const CONSUMING_ABI = {
  "0x38ed1739": [{ type: "function", name: "swapExactTokensForTokens", inputs: [
    { type: "uint256" }, { type: "uint256" }, { type: "address[]" }, { type: "address" }, { type: "uint256" }] }],
  "0x04e45aaf": EXACT_INPUT_SINGLE_V2,
  "0x414bf389": EXACT_INPUT_SINGLE_V1,
  "0x617ba037": [{ type: "function", name: "supply", inputs: [
    { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "uint16" }] }], // Aave V3
  "0xe8eda9df": [{ type: "function", name: "deposit", inputs: [
    { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "uint16" }] }], // Aave V2
  "0x6e553f65": ERC4626_DEPOSIT, // deposit(assets, receiver) — asset bound on-chain via vault.asset()
};
function approveCalldata(spender, amount) {
  return encodeFunctionData({ abi: ERC20_APPROVE, functionName: "approve", args: [spender, amount] });
}
/** Build the consuming call for `selector`, pulling `token`/`amount`, delivering to `recipient`. */
function consumingCalldata(selector, { token, tokenOut, recipient, amount }) {
  switch (selector.toLowerCase()) {
    case "0x38ed1739":
      return encodeFunctionData({ abi: CONSUMING_ABI["0x38ed1739"], functionName: "swapExactTokensForTokens",
        args: [amount, 0n, [token, tokenOut], recipient, 2n ** 40n] });
    case "0x04e45aaf":
      return encodeFunctionData({ abi: CONSUMING_ABI["0x04e45aaf"], functionName: "exactInputSingle",
        args: [{ tokenIn: token, tokenOut, fee: A_FEE, recipient, amountIn: amount, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] });
    case "0x414bf389":
      return encodeFunctionData({ abi: CONSUMING_ABI["0x414bf389"], functionName: "exactInputSingle",
        args: [{ tokenIn: token, tokenOut, fee: A_FEE, recipient, deadline: 2n ** 40n, amountIn: amount, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] });
    case "0x617ba037":
      return encodeFunctionData({ abi: CONSUMING_ABI["0x617ba037"], functionName: "supply", args: [token, amount, recipient, 0] });
    case "0xe8eda9df":
      return encodeFunctionData({ abi: CONSUMING_ABI["0xe8eda9df"], functionName: "deposit", args: [token, amount, recipient, 0] });
    case "0x6e553f65":
      return encodeFunctionData({ abi: CONSUMING_ABI["0x6e553f65"], functionName: "deposit", args: [amount, recipient] });
    default:
      return null; // selector outside the decodable set — construct calls[1] manually
  }
}
export const CONSUMING_SELECTORS = Object.keys(CONSUMING_ABI);

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
    case "BorrowPermission": {
      const { protocols, assets, cap, collateralOracle, borrowOracle, family } = config;
      if (!family || !BORROW_FAMILIES.includes(family)) {
        throw new Error(
          `BorrowPermission requires --protocol <${BORROW_FAMILIES.join("|")}>: the borrow calldata shape differs per lending family and is not in the config blob. Never guessed — a wrong-family probe reverts for structural reasons and misleads.`,
        );
      }
      const protocol = getAddress(protocols[0]);
      const asset = getAddress(assets[0]);
      const bothOracles =
        collateralOracle && getAddress(collateralOracle) !== ZERO && borrowOracle && getAddress(borrowOracle) !== ZERO;
      const bc = (amount, useAsset) => borrowCalldata(family, { asset: useAsset ?? asset, amount, account: acct });
      const notes = [`Borrow family: ${family}.`];
      // Structural must-fail proofs — deterministic (each fails a check BEFORE the LTV path).
      const probes = [
        { label: "OVER-CAP borrow (cap + 1) must reject", target: protocol, calldata: bc(cap + 1n), value: "0", expect: "fail" },
        { label: "OFF-ALLOWLIST protocol target must reject", target: OFF_ALLOWLIST, calldata: bc(cap), value: "0", expect: "fail" },
      ];
      if (family === "compound") {
        notes.push(
          "Compound borrow(uint256) carries no asset/recipient in calldata — the asset is resolved on-chain via cToken.underlying() and the position is the caller's. Off-allowlist-asset and wrong-recipient are therefore covered by the off-allowlist-protocol proof and the on-chain underlying() binding.",
        );
      } else {
        probes.push({ label: "OFF-ALLOWLIST asset must reject", target: protocol, calldata: bc(cap, OFF_ALLOWLIST), value: "0", expect: "fail" });
        probes.push({ label: "WRONG recipient (≠ SMA) must reject", target: protocol, calldata: borrowWrongRecipient(family, { asset, amount: cap, account: acct }), value: "0", expect: "fail" });
      }
      if (bothOracles) {
        // LTV is enforced LIVE against the account's collateral + oracle prices. A deterministic
        // offline LTV-breach amount can't be constructed (it depends on live collateral), so this
        // asserts the honest pre-go-live case: with no collateral supplied yet, LTV rejects any borrow.
        probes.push({ label: "LTV ceiling: an in-bounds borrow the account's collateral can't cover must reject", target: protocol, calldata: bc(cap), value: "0", expect: "fail" });
        notes.push(
          "Both oracles set → an LTV ceiling is enforced LIVE. The LTV probe expects rejection because the SMA has not supplied collateral yet (pre-go-live); once it holds covering collateral, an in-LTV borrow passes. No deterministic offline must-PASS exists for a both-oracle borrow — the accept is collateral-dependent; verify it live after supplying collateral.",
        );
      } else {
        probes.unshift({ label: "in-bounds borrow (allowed protocol+asset, amount = cap)", target: protocol, calldata: bc(cap), value: "0", expect: "pass" });
        notes.push("No LTV ceiling on this config (both oracles unset) — only the per-tx cap and allowlists bound borrows.");
      }
      return { notes, probes };
    }
    case "ApproveAndCallBatchPermission": {
      const { tokens, consumingPairs, maxApprovalAmounts, allowUnconstrainedRecipient } = config;
      const token = getAddress(tokens[0]);
      const cap = maxApprovalAmounts[0];
      const pair = consumingPairs[0]; // { target, selector } — c1.target must equal the approved spender
      const spender = getAddress(pair.target);
      const sel = pair.selector;
      const notes = [
        "Probed via evaluateBatch() directly (the batch entrypoint) — `sailor mandate simulate` only exercises single-call evaluate(), so these are batch arrays, not a --calls file.",
      ];
      const consuming = (recipient, amount) => consumingCalldata(sel, { token, tokenOut: token, recipient, amount });
      if (consuming(acct, cap) === null) {
        notes.push(`Consuming selector ${sel} is outside the auto-buildable decodable set (${CONSUMING_SELECTORS.join(", ")}) — build calls[1] manually for this config.`);
      }
      const approve = (spenderAddr, amt) => ({ target: token, value: "0", data: approveCalldata(spenderAddr, amt) });
      const consume = (target, recipient, amount) => ({ target, value: "0", data: consuming(recipient, amount) });
      const batch = (calls, label, expect) => ({ label, kind: "batch", calls, expect });
      const probes = [
        batch([approve(spender, cap), consume(spender, acct, cap), approve(spender, 0n)], "compliant bracket (approve cap → consume → reset to 0)", "pass"),
        batch([approve(spender, cap), consume(spender, acct, cap), approve(spender, 1n)], "MISSING reset (calls[2] ≠ 0) must reject", "fail"),
        batch([approve(spender, cap + 1n), consume(spender, acct, cap + 1n), approve(spender, 0n)], "OVER-CAP approval (cap + 1) must reject", "fail"),
        batch([approve(OFF_ALLOWLIST, cap), consume(OFF_ALLOWLIST, acct, cap), approve(OFF_ALLOWLIST, 0n)], "OFF-ALLOWLIST spender must reject", "fail"),
      ];
      if (!allowUnconstrainedRecipient) {
        probes.push(batch([approve(spender, cap), consume(spender, WRONG_RECIPIENT, cap), approve(spender, 0n)], "WRONG recipient (≠ SMA, recipient pinned) must reject", "fail"));
      } else {
        notes.push("allowUnconstrainedRecipient = true → the output recipient is unconstrained by design; no recipient probe applies (c21 notEnforced).");
      }
      return { notes, probes };
    }
    default:
      throw new Error(
        `probe-mandate does not cover "${template}". Covered: Transfer, Withdraw, Deposit, SwapPermission, SwapPermissionNoOracle, BorrowPermission, ApproveAndCallBatchPermission (all seven shared templates). Bespoke permissions have no config schema — their probes stay agent-derived.`,
      );
  }
}

/** Decode a config blob into the named fields for `template`. */
export function decodeConfig(template, blobHex) {
  if (template === "ApproveAndCallBatchPermission") {
    const [cfg] = decodeAbiParameters(APPROVE_BATCH_CONFIG, blobHex);
    return {
      tokens: cfg.tokens,
      spenders: cfg.spenders,
      consumingPairs: cfg.consumingPairs,
      maxApprovalAmounts: cfg.maxApprovalAmounts,
      requireAmountMatch: cfg.requireAmountMatch,
      allowUnconstrainedRecipient: cfg.allowUnconstrainedRecipient,
    };
  }
  const layout = CONFIG_LAYOUT[template];
  if (!layout) throw new Error(`Unknown/uncovered template "${template}".`);
  const d = decodeAbiParameters(layout.map((type) => ({ type })), blobHex);
  switch (template) {
    case "TransferPermission": return { recipients: d[0], tokens: d[1], cap: d[2] };
    case "WithdrawPermission": return { tokens: d[0], recipient: d[1], cap: d[2] };
    case "DepositPermission": return { targets: d[0], tokens: d[1], cap: d[2] };
    case "SwapPermissionNoOracle": return { routers: d[0], tokensIn: d[1], tokensOut: d[2], cap: d[3] };
    case "SwapPermission": return { routers: d[0], tokensIn: d[1], tokensOut: d[2], cap: d[3], slippageBps: d[4], oracle: d[5], maxPriceAge: d[6] };
    case "BorrowPermission": return { protocols: d[0], assets: d[1], cap: d[2], maxLtvBps: d[3], collateralOracle: d[4], borrowOracle: d[5], maxPriceAgeSec: d[6] };
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
  const family = arg("protocol"); // BorrowPermission only
  if (!template || !params) {
    console.error("Usage: node scripts/probe-mandate.mjs --template <Name> --params <0x-config-blob> --sma <SMA> --address <singleton> [--protocol <aave|morpho|compound>] [--out <file>]");
    process.exit(2);
  }
  if (!sma) { console.error("No SMA. Pass --sma <address> (or create .sail/account.json)."); process.exit(2); }

  const config = decodeConfig(template, params);
  if (template === "BorrowPermission") config.family = family; // generateProbes errors if missing/invalid
  const { probes, notes } = generateProbes(template, config, sma);

  const out = arg("out") ?? resolvePath(process.cwd(), `mandate-probes.${template}.json`);
  writeFileSync(out, `${JSON.stringify(probes, null, 2)}\n`);

  // Compact plan → stderr (human), the ready command / mechanism → stdout.
  const fails = probes.filter((p) => p.expect === "fail").length;
  console.error(`\n${template} — ${probes.length} probes (${fails} must-REJECT proofs, ${probes.length - fails} must-ACCEPT):`);
  for (const p of probes) console.error(`  [${p.expect === "fail" ? "must-fail" : "must-pass"}] ${p.label}`);
  for (const n of notes) console.error(`  note: ${n}`);

  if (probes.some((p) => p.kind === "batch")) {
    // Batch template: probes are Call[] arrays for evaluateBatch(), which single-call
    // `sailor mandate simulate` cannot run. Show the direct staticcall mechanism.
    console.error(`\nWrote ${out} (batch arrays). Probe each via a read-only staticcall to evaluateBatch:`);
    console.log(
      `# no gas, no signing — staticcall the batch entrypoint (build BatchContext with the account's live\n` +
        `# registrationEpoch as configEpoch, batchHash = keccak256(abi.encode(calls))):\n` +
        `cast call ${address ?? "<SINGLETON>"} 'evaluateBatch((address,uint256,bytes)[],(address,address,address,address,bytes32,uint256,uint256,uint256))' <calls> <ctx> --rpc-url $RPC`,
    );
    return;
  }

  console.error(`\nWrote ${out}. Run the safety gate:`);
  console.log(`sailor mandate simulate --address ${address ?? "<SINGLETON>"} --sma ${sma} --calls ${out} --json`);
}

// Run only as a CLI, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) main();
