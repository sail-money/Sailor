#!/usr/bin/env node
// sailor-templates / catalog.mjs
// Tracks the shared permission templates that live in
//   Protocol/contracts/templates/*.sol
// These are configurable singletons (extend ConfigurablePermission): deploy once
// per chain, then every SMA reuses that address via REGISTER + CONFIGURE (register only
// registers on the kernel; configure writes the per-account bounds — see SKILL.md).
// All seven are deployed (2026-07-01, CREATE2 global salt) — same address on every chain.
// Deployment status is read from deployed.json next to this file.
//
// The template LIST is auto-detected from source (so it tracks additions/removals),
// the rich per-template detail is curated below, and deployment status is read from
// deployed.json.
//
// Usage (run from the scaffolded project root):
//   node .agents/skills/sailor-templates/catalog.mjs                # human view, all detected templates
//   node .agents/skills/sailor-templates/catalog.mjs --json         # machine-readable
//   node .agents/skills/sailor-templates/catalog.mjs --chain 8453   # deployment status for one chain
//   node .agents/skills/sailor-templates/catalog.mjs --protocol /path/to/Protocol   # override Protocol dir

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const CHAIN_NAMES = {
  1: "Ethereum", 8453: "Base", 42161: "Arbitrum", 10: "Optimism", 130: "Unichain",
  56: "BSC", 480: "World Chain", 999: "HyperEVM", 4326: "MegaETH",
  84532: "Base Sepolia", 11155111: "Sepolia",
};

// Curated detail, keyed by the Solidity contract name. Config blobs are the
// authoritative abi.encode tuples taken from each contract's `_applyConfig`.
const META = {
  SwapPermission: {
    primitive: "DEX swaps (Uniswap V3 / V3-02 / V2)",
    skill: "sailor-template-swap",
    config: "(address[] routers, address[] tokensIn, address[] tokensOut, uint256 maxAmountPerTx, uint256 maxSlippageBps, address priceOracle, uint256 maxPriceAgeSec)",
  },
  SwapPermissionNoOracle: {
    primitive: "DEX swaps for tokens with NO oracle — live-pool hallucination band (NOT manipulation-resistant)",
    skill: "sailor-template-swap-no-oracle",
    config: "(address[] routers, address[] tokensIn, address[] tokensOut, uint256 maxAmountPerTx, ReferencePool[] referencePools) — ReferencePool{address tokenIn, address tokenOut, address pool, PoolKind kind (0=V2,1=V3), uint256 toleranceBps}",
  },
  BorrowPermission: {
    primitive: "Lending borrows (Aave / Morpho / Compound) with LTV check",
    skill: "sailor-template-borrow",
    config: "(address[] protocols, address[] assets, uint256 maxAmountPerTx, uint256 maxLtvBps, address collateralOracle, address borrowOracle, uint256 maxPriceAgeSec)",
  },
  TransferPermission: {
    primitive: "ERC-20 transfers to a recipient allowlist (from == account)",
    skill: "sailor-template-transfer",
    config: "(address[] allowedRecipients, address[] allowedTokens, uint256 maxAmountPerTx)",
  },
  DepositPermission: {
    primitive: "Vault / lending deposits (ERC-4626 + Aave v2/v3)",
    skill: "sailor-template-deposit",
    config: "(address[] targets, address[] tokens, uint256 maxAmountPerTx)",
  },
  WithdrawPermission: {
    primitive: "ERC-20 withdrawals to a single fixed recipient",
    skill: "sailor-template-withdraw",
    config: "(address[] tokens, address allowedRecipient, uint256 maxAmountPerTx)",
  },
  ApproveAndCallBatchPermission: {
    primitive: "Atomic approve / consuming-call / reset-to-zero batch",
    skill: "sailor-template-approve-batch",
    config: "Config{ address[] tokens, address[] spenders, ConsumingPair[] consumingPairs /* (address target, bytes4 selector) */, uint256[] maxApprovalAmounts, bool requireAmountMatch, bool allowUnconstrainedRecipient /* default false = recipient pinned to account; true = opt out */ }",
  },
};

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
const hasFlag = (flag) => process.argv.includes(flag);

function findProtocolDir() {
  const fromArg = argValue("--protocol");
  if (fromArg) return resolve(fromArg);
  if (process.env.SAIL_PROTOCOL_DIR) return resolve(process.env.SAIL_PROTOCOL_DIR);
  for (const start of [process.cwd(), HERE]) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, "Protocol", "contracts", "templates"))) return join(dir, "Protocol");
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

// Detect concrete templates from source: `contract X is ... ConfigurablePermission ...`
// (skips `abstract contract`, e.g. the ConfigurablePermission base itself).
function detectTemplates(protocolDir) {
  const dir = join(protocolDir, "contracts", "templates");
  const out = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sol"))) {
    const src = readFileSync(join(dir, file), "utf8");
    const m = src.match(/^\s*contract\s+(\w+)\s+is\s+([^{]+)\{/m);
    if (!m) continue;
    if (!/ConfigurablePermission/.test(m[2])) continue;
    out.push({ name: m[1], file: `contracts/templates/${file}` });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function loadDeployed() {
  const path = join(HERE, "deployed.json");
  if (!existsSync(path)) return { chains: {} };
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { chains: {} };
  }
}

function statusFor(deployed, name) {
  const rows = [];
  for (const [chainId, map] of Object.entries(deployed.chains ?? {})) {
    const addr = map?.[name];
    rows.push({ chainId: Number(chainId), name: CHAIN_NAMES[chainId] ?? `chain ${chainId}`, address: addr ?? null });
  }
  return rows.sort((a, b) => a.chainId - b.chainId);
}

function main() {
  const protocolDir = findProtocolDir();
  if (!protocolDir) {
    console.error("Could not locate Protocol/contracts/templates. Pass --protocol <path> or set SAIL_PROTOCOL_DIR.");
    process.exit(1);
  }
  const templates = detectTemplates(protocolDir);
  const deployed = loadDeployed();
  const onlyChain = argValue("--chain");

  const catalog = templates.map((t) => ({
    ...t,
    ...(META[t.name] ?? { primitive: "(uncurated — see source)", skill: null, config: "(see source)" }),
    deployments: statusFor(deployed, t.name).filter((r) => !onlyChain || r.chainId === Number(onlyChain)),
  }));

  // IOracle adapters usable as `priceOracle` in SwapPermission config (deployed.json `oracles`).
  const oracles = [];
  for (const [chainId, byLabel] of Object.entries(deployed.oracles ?? {})) {
    if (onlyChain && Number(chainId) !== Number(onlyChain)) continue;
    for (const [label, o] of Object.entries(byLabel ?? {})) {
      oracles.push({ chainId: Number(chainId), name: CHAIN_NAMES[chainId] ?? `chain ${chainId}`, label, ...o });
    }
  }

  if (hasFlag("--json")) {
    console.log(JSON.stringify({ protocolDir, templates: catalog, oracles }, null, 2));
    return;
  }

  console.log("Sail shared permission templates — source: Protocol/contracts/templates\n");
  console.log("Model: configurable singletons. Deploy ONCE per chain, then every SMA reuses the");
  console.log("address via register (`sailor mandate register`) + configure (no per-SMA deploy).");
  console.log("NOTE: `sailor mandate register` registers ONLY — you must also configure per-account");
  console.log("(configureDirect today); see SKILL.md / references/reuse-flow.md.\n");
  const anyUncurated = catalog.some((t) => !META[t.name]);
  for (const t of catalog) {
    const flag = META[t.name] ? "" : "  ⚠️ NEW/uncurated — add to META + write a skill";
    console.log(`━━ ${t.name}${flag} ━━`);
    console.log(`   primitive: ${t.primitive}`);
    console.log(`   source:    ${t.file}`);
    if (t.skill) console.log(`   skill:     ${t.skill}`);
    console.log(`   config:    ${t.config}`);
    const live = t.deployments.filter((d) => d.address);
    if (live.length) {
      console.log("   deployed:");
      for (const d of t.deployments) {
        console.log(`     ${d.name} (${d.chainId}): ${d.address ?? "— not yet deployed"}`);
      }
    } else {
      console.log("   deployed:  not yet on any tracked chain (record in deployed.json once deployed)");
    }
    console.log("");
  }
  if (oracles.length) {
    console.log("━━ IOracle adapters (usable as SwapPermission `priceOracle`) ━━");
    for (const o of oracles) {
      const pairs = (o.pairs ?? []).map((p) => p.label ?? `${p.base}/${p.quote}`).join(", ");
      console.log(`   ${o.label} (${o.name} ${o.chainId}): ${o.address}${o.default ? "  [default]" : ""}`);
      console.log(`     kind: ${o.kind ?? "?"}${o.twapWindowSec ? `, twap=${o.twapWindowSec}s` : ""}, decimals: ${o.priceDecimals ?? "?"}, pairs: ${pairs || "?"}`);
      if (o.note) console.log(`     ↳ ${o.note}`);
    }
    console.log("");
  }
  if (anyUncurated) {
    console.log("⚠️  A source template has no curated metadata above — the source folder changed.");
  }
  console.log("⚠️  Shared templates are UNAUDITED EXAMPLES — not part of the trusted core.");
  console.log("   Always `sailor mandate simulate` against your SMA before authorizing on-chain.");
}

main();
