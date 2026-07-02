import fs from "node:fs";
import path from "node:path";

import { sailCoreAddresses, sailDeployments } from "@sail/sdk";

/**
 * Universal, non-secret addresses that are identical for every user — Sail core
 * contracts, per-chain deployment addresses, shared permission-template logic,
 * and well-known token/protocol addresses.
 *
 * These are KEPT (never redacted) when a project is shared publicly, so cloned
 * templates retain the context a cloner needs. Only user-specific identity
 * — the SMA, owner, manager, and signer addresses — is stripped; the cloning
 * agent fills those back in during onboarding.
 *
 * A sharer can extend the keep-list for their strategy by committing
 * `.sail/public-addresses.json` (a JSON array of `0x…` addresses): tokens,
 * routers, pools, oracles — anything that is the same for every user of the
 * strategy and safe to publish.
 */

/** Well-known token/protocol addresses, the same for every user. Extend freely. */
export const COMMON_TOKEN_ADDRESSES: readonly string[] = [
  // ── Ethereum (1) ──
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
  "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
  "0x6B175474E89094C44Da98b954EedeAC495271d0F", // DAI
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
  // ── Base (8453) ──
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
  "0x4200000000000000000000000000000000000006", // WETH
  // ── Arbitrum (42161) ──
  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC
  "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH
];

/**
 * Every address the SDK knows to be a Sail protocol constant: the CREATE2 core
 * (kernel/factory/governance/…) plus each chain's deployment addresses and
 * shared standalone-template logic. Derived, so new chains/templates are picked
 * up automatically with no edits here.
 */
function sdkPublicAddresses(): string[] {
  const out: string[] = Object.values(sailCoreAddresses);
  for (const dep of Object.values(sailDeployments)) {
    out.push(
      dep.deployer,
      dep.governance,
      dep.timelock,
      dep.kernel,
      dep.mandateFactory,
      dep.standardFeePolicy,
      dep.safeModuleEnabler,
      dep.treasury,
    );
    for (const impl of Object.values(dep.standaloneTemplates ?? {})) out.push(impl);
  }
  return out;
}

/** Read the sharer-declared keep-list from `.sail/public-addresses.json`, if present. */
function projectPublicAddresses(projectRoot: string): string[] {
  const file = path.join(projectRoot, ".sail", "public-addresses.json");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return []; // absent is the common case — no keep-list beyond the built-ins.
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return []; // malformed: fall back to built-ins rather than crash the share.
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((a): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a));
}

/**
 * The full set of addresses to preserve during share redaction, lowercased:
 * SDK protocol constants + common tokens + the sharer's own keep-list. Anything
 * NOT in this set that looks like the sharer's identity is zeroed.
 */
export function publicConstantAddresses(projectRoot: string): Set<string> {
  return new Set(
    [...sdkPublicAddresses(), ...COMMON_TOKEN_ADDRESSES, ...projectPublicAddresses(projectRoot)].map(
      (a) => a.toLowerCase(),
    ),
  );
}
