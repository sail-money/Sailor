import assert from "node:assert/strict";
import { test } from "node:test";
import { chains as sailChains } from "@sail/sdk/chains";
import { CHAIN_IDS, CHAIN_PORTS, SANDBOX_CHAINS_CEILING, resolveChainName } from "@sail/sandbox";

// Run with: npx tsx --test packages/cli/src/lib/sandbox-chains.test.ts
//
// Two hand-maintained chain lists have to agree, and nothing else makes them:
//
//   - the SDK chain registry (packages/sdk chains.ts), which the dashboard's
//     network picker is built from via mainnetChains();
//   - the sandbox fork engine's own tables (packages/sandbox fork.ts), which
//     deliberately do NOT import the SDK so the fork engine stays dependency-free.
//
// This test lives in the CLI package because it is the only one that depends on
// both. It exists because they DID drift: Robinhood Chain (4663) shipped in the
// SDK registry, the picker offered it, and provisioning it threw "Unsupported
// sandbox chain id: 4663" on the user's first run.
//
// Join on chain id, never on slug. The two sides disagree on spelling for at
// least two chains today (the engine says "sepolia"/"worldchain" where the
// registry says "eth-sepolia"/"world"), and that is fine: the id is the identity,
// the slug is a local label.

/** What the dashboard's network picker offers, mirroring packages/ui lib/chains.js:
 *  `Object.values(chains).filter((c) => !c.testnet)`. */
const offeredByPicker = Object.values(sailChains).filter((c) => !c.testnet);

const forkableIds = new Set(Object.values(CHAIN_IDS));
const registryIds = new Set(Object.values(sailChains).map((c) => c.chainId));

test("every chain the picker offers can actually be forked", () => {
  // The direction that broke. A chain offered in onboarding that the engine
  // cannot provision is a dead end the user only discovers after selecting it.
  const unforkable = offeredByPicker.filter((c) => !forkableIds.has(c.chainId));
  assert.deepEqual(
    unforkable.map((c) => `${c.chainId} (${c.slug})`),
    [],
    "the network picker offers chain(s) the sandbox fork engine cannot provision. " +
      "Selecting one throws \"Unsupported sandbox chain id\" at fork time. " +
      "Add each to CHAIN_IDS, CHAIN_PORTS, UPSTREAM_ENV_CANDIDATES and " +
      "PUBLIC_UPSTREAM_FALLBACKS in packages/sandbox/src/fork.ts (and to the Chain union).",
  );
});

test("every chain the fork engine knows exists in the SDK registry", () => {
  // The opposite drift: an engine entry the registry has never heard of. Less
  // damaging (nothing offers it, so nobody selects it) but it means a stale
  // table, and its port is reserved against a chain that may never ship.
  const unknown = Object.entries(CHAIN_IDS).filter(([, id]) => !registryIds.has(id));
  assert.deepEqual(
    unknown.map(([slug, id]) => `${id} (${slug})`),
    [],
    "the sandbox fork engine lists chain(s) absent from the SDK chain registry. " +
      "Either the chain was removed from the registry and should be dropped from " +
      "packages/sandbox/src/fork.ts, or its id is wrong.",
  );
});

test("resolveChainName accepts every offered chain id", () => {
  // The assertions above compare tables. This one walks the real code path the
  // UI server takes (startSandboxForks -> resolveChainName), so a table that
  // looks right but resolves wrong still fails.
  for (const c of offeredByPicker) {
    assert.doesNotThrow(
      () => resolveChainName(c.chainId),
      `resolveChainName(${c.chainId}) threw for "${c.slug}", which the picker offers`,
    );
  }
});

test("testnets are deliberately not required to be forkable", () => {
  // Scope note, asserted rather than left as a comment. The picker filters
  // testnets out, so a testnet in the registry with no fork-engine entry is
  // correct, not drift. The engine happens to support base-sepolia and sepolia;
  // that is extra capability, not an obligation. If the picker ever stops
  // filtering testnets, this test fails and the scope decision gets revisited.
  const testnets = Object.values(sailChains).filter((c) => c.testnet);
  assert.ok(testnets.length > 0, "expected the registry to contain testnets");
  for (const t of testnets) {
    assert.equal(
      offeredByPicker.some((c) => c.chainId === t.chainId),
      false,
      `testnet ${t.chainId} (${t.slug}) is being offered by the picker — ` +
        "testnets are now user-selectable, so they must be forkable too.",
    );
  }
});

test("every forkable chain has its own port, and the ceiling counts them", () => {
  // SANDBOX_CHAINS_CEILING is derived from CHAIN_PORTS' length, so a chain added
  // without a port would silently cap concurrency one lower than the table implies.
  const idSlugs = Object.keys(CHAIN_IDS).sort();
  const portSlugs = Object.keys(CHAIN_PORTS).sort();
  assert.deepEqual(portSlugs, idSlugs, "CHAIN_IDS and CHAIN_PORTS cover different chains");

  const ports = Object.values(CHAIN_PORTS);
  assert.equal(new Set(ports).size, ports.length, "two chains share a fork port");
  assert.equal(SANDBOX_CHAINS_CEILING, idSlugs.length);
});
