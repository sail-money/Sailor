#!/usr/bin/env node
// build-top-assets-seed.mjs — offline helper: build the trusted per-chain address seed
// that build-liquidity-map.mjs consumes.
//
//   node scripts/build-top-assets-seed.mjs                  # → scripts/top-assets-seed.json
//   node scripts/build-top-assets-seed.mjs --out path.json
//   node scripts/build-top-assets-seed.mjs --list-url <url>
//
// Identity comes from the Uniswap default token list (https://tokens.uniswap.org): a
// curated, human-reviewed catalog of real contracts that Uniswap's own frontend trusts.
// A planted look-alike (a copied ticker with fake liquidity) cannot enter a curated list
// — that is exactly how the SKY bug happened when identity was instead guessed from a
// DexScreener "deepest pool" search. Identity must NEVER be a search result.
//
// Keyless + free: one static fetch, no API key, no rate limit. The list is read only at
// seed-build time (offline); the shipped JSON is what resolve-token.mjs reads, so the
// runtime never touches Uniswap or any external endpoint for identity.

import { writeFileSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = resolvePath(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_LIST_URL = "https://tokens.uniswap.org";

// Uniswap chainId → Sail chain name. Only Sail mainnets present in the list are mapped;
// hyperevm (999) and megaeth (4326) are absent and resolve live. Testnets are omitted.
const CHAIN_BY_ID = {
  1: "ethereum",
  10: "optimism",
  56: "bsc",
  130: "unichain",
  480: "worldchain",
  8453: "base",
  42161: "arbitrum",
  4663: "robinhood",
};

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

async function fetchList(url) {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "sailor-top-assets-seed" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function main() {
  const args = process.argv.slice(2);
  let outPath = resolvePath(SCRIPT_DIR, "top-assets-seed.json");
  let listUrl = DEFAULT_LIST_URL;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") outPath = resolvePath(args[++i]);
    else if (args[i] === "--list-url") listUrl = args[++i];
  }

  return fetchList(listUrl)
    .then((list) => {
      const tokens = Array.isArray(list.tokens) ? list.tokens : [];
      if (tokens.length === 0) throw new Error("token list returned no tokens");

      const seed = {};
      // Track (chainName, symbol) → address so a second token with the same symbol on the
      // SAME chain is dropped rather than guessed (collisions are rare but real — e.g.
      // LIT on ethereum, JUP/SOL on unichain).
      const seen = new Set();
      let skippedCollisions = 0;

      for (const t of tokens) {
        const chainName = CHAIN_BY_ID[t.chainId];
        const addr = typeof t.address === "string" ? t.address.toLowerCase() : "";
        const sym = typeof t.symbol === "string" ? t.symbol.toUpperCase().trim() : "";
        if (!chainName || !sym || !ADDR_RE.test(addr)) continue;

        const key = `${chainName}:${sym}`;
        if (seen.has(key)) {
          skippedCollisions++;
          continue; // duplicate symbol on this chain — drop, never guess
        }
        seen.add(key);

        const decimals = Number.isInteger(t.decimals) ? t.decimals : 18;
        if (!seed[sym]) seed[sym] = {};
        seed[sym][chainName] = { address: addr, decimals };
      }

      const symbols = Object.keys(seed);
      writeFileSync(outPath, JSON.stringify(seed, null, 2) + "\n");
      process.stderr.write(
        `Wrote ${symbols.length} symbol(s) from the Uniswap default token list` +
          ` (${skippedCollisions} same-chain collision(s) dropped) → ${outPath}\n`,
      );
    })
    .catch((err) => {
      process.stderr.write(
        `\nbuild-top-assets-seed failed: ${err && err.message ? err.message : err}\n`,
      );
      process.exit(1);
    });
}

main();
