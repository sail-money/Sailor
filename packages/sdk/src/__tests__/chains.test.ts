import assert from "node:assert/strict";
import { test } from "node:test";
import { getNativeCurrencySymbol } from "../chains.js";

test("getNativeCurrencySymbol: BSC pays its registration fee in BNB, not ETH", () => {
  assert.equal(getNativeCurrencySymbol(56), "BNB");
});

test("getNativeCurrencySymbol: HyperEVM pays its registration fee in HYPE, not ETH", () => {
  assert.equal(getNativeCurrencySymbol(999), "HYPE");
});

test("getNativeCurrencySymbol: most chains use ETH", () => {
  for (const chainId of [1, 8453, 42161, 10, 130, 480, 4326, 84532, 11155111]) {
    assert.equal(getNativeCurrencySymbol(chainId), "ETH");
  }
});

test("getNativeCurrencySymbol: unsupported chainId falls back to ETH instead of throwing", () => {
  assert.equal(getNativeCurrencySymbol(999999), "ETH");
});
