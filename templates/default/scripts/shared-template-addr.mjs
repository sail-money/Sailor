#!/usr/bin/env node
// shared-template-addr.mjs — resolve a deployed shared-template singleton
// address for the active chain. Reads the vendored registry next to the skill
// (deployed.json) and the chain from .sail/.env.local or .sail/config.json.
//
//   node scripts/shared-template-addr.mjs SwapPermission
//   node scripts/shared-template-addr.mjs TransferPermission --chain base
//   node scripts/shared-template-addr.mjs --list
//
// Prints the checksummed address (or "not deployed" with a non-zero exit).
// Pure JS, no dependencies.

import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

function readJson(p) {
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

function readChain() {
  // .sail/.env.local CHAIN_ID, then .sail/config.json chainId
  const envPath = resolvePath(process.cwd(), ".sail", ".env.local");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*CHAIN_ID\s*=\s*(\d+)/);
      if (m) return Number(m[1]);
    }
  }
  const cfg = readJson(resolvePath(process.cwd(), ".sail", "config.json"));
  return cfg?.chainId ?? null;
}

const REGISTRY = JSON.parse(
  readFileSync(
    resolvePath(
      resolvePath(new URL(".", import.meta.url).pathname),
      "..",
      ".agents",
      "skills",
      "sail-templates",
      "deployed.json",
    ),
    "utf8",
  ),
);

const args = process.argv.slice(2);
const list = args.includes("--list");
const name = args.find((a) => !a.startsWith("--"));
const chainFlagIdx = args.indexOf("--chain");
const chainOverride = chainFlagIdx !== -1 ? Number(args[chainFlagIdx + 1]) : null;
const chainId = chainOverride ?? readChain();

if (list) {
  process.stdout.write(
    "Deployed shared templates by chain (from .agents/skills/sail-templates/deployed.json):\n",
  );
  for (const [cid, templates] of Object.entries(REGISTRY.chains)) {
    const names = Object.keys(templates);
    process.stdout.write(`  chain ${cid}: ${names.length ? names.join(", ") : "(none)"}\n`);
  }
  process.exit(0);
}

if (!name) {
  process.stderr.write("Usage: shared-template-addr.mjs <TemplateName> [--chain <id>] [--list]\n");
  process.exit(1);
}
if (!chainId) {
  process.stderr.write(
    "Could not resolve chain. Pass --chain <id> or set CHAIN_ID in .sail/.env.local.\n",
  );
  process.exit(1);
}

const chainTemplates = REGISTRY.chains[String(chainId)] ?? {};
const addr = chainTemplates[name];
if (!addr) {
  process.stderr.write(
    `"${name}" is not deployed on chain ${chainId}.\n` +
      `Deployed here: ${Object.keys(chainTemplates).join(", ") || "(none)"}.\n` +
      `SwapPermissionNoOracle is source-only (not deployed on any chain) — use SwapPermission or author a bespoke permission.\n`,
  );
  process.exit(1);
}
process.stdout.write(addr + "\n");
