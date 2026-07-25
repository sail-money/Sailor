import assert from "node:assert/strict";
import { test } from "node:test";
import { chains, chainBySlug, getNativeCurrencySymbol } from "../chains.js";

test("every chain has a unique, non-empty slug", () => {
  const slugs = Object.values(chains).map((c) => c.slug);
  for (const s of slugs) assert.ok(s && s === s.toLowerCase(), `bad slug: ${JSON.stringify(s)}`);
  assert.equal(new Set(slugs).size, slugs.length, "duplicate slug in chain registry");
});

test("chainBySlug round-trips and is case-insensitive", () => {
  assert.equal(chainBySlug("base")?.chainId, 8453);
  assert.equal(chainBySlug("BSC")?.chainId, 56);
  assert.equal(chainBySlug("nope"), undefined);
});

test("getNativeCurrencySymbol: BSC pays its registration fee in BNB, not ETH", () => {
  assert.equal(getNativeCurrencySymbol(56), "BNB");
});

test("getNativeCurrencySymbol: HyperEVM pays its registration fee in HYPE, not ETH", () => {
  assert.equal(getNativeCurrencySymbol(999), "HYPE");
});

test("getNativeCurrencySymbol: most chains use ETH", () => {
  for (const chainId of [1, 8453, 42161, 10, 130, 480, 4326, 4663, 84532, 11155111]) {
    assert.equal(getNativeCurrencySymbol(chainId), "ETH");
  }
});

test("getNativeCurrencySymbol: unsupported chainId falls back to ETH instead of throwing", () => {
  assert.equal(getNativeCurrencySymbol(999999), "ETH");
});
