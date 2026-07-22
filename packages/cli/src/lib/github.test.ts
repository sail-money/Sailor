import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReleaseRef } from "./github.js";

// Run with: npx tsx --test packages/cli/src/lib/github.test.ts

test("parseReleaseRef accepts owner/repo@tag shorthand", () => {
  assert.deepEqual(parseReleaseRef("sail-money/Dock@dca-rebalancer-v3"), {
    repo: "sail-money/Dock",
    tag: "dca-rebalancer-v3",
  });
});

test("parseReleaseRef accepts a release page URL", () => {
  assert.deepEqual(
    parseReleaseRef("https://github.com/sail-money/Dock/releases/tag/dca-rebalancer"),
    { repo: "sail-money/Dock", tag: "dca-rebalancer" },
  );
});

test("parseReleaseRef accepts an asset download URL and captures the filename", () => {
  assert.deepEqual(
    parseReleaseRef(
      "https://github.com/sail-money/Dock/releases/download/dca-rebalancer/dca-rebalancer.tar.gz",
    ),
    { repo: "sail-money/Dock", tag: "dca-rebalancer", asset: "dca-rebalancer.tar.gz" },
  );
});

test("parseReleaseRef decodes url-encoded tag/asset", () => {
  const r = parseReleaseRef("https://github.com/o/r/releases/tag/v1%2E0%20beta");
  assert.equal(r.repo, "o/r");
  assert.equal(r.tag, "v1.0 beta");
});

test("parseReleaseRef throws on an unrecognizable ref", () => {
  assert.throws(() => parseReleaseRef("not a release ref"), /Could not parse/);
});
