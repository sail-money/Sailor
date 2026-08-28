import assert from "node:assert/strict";
import { test } from "node:test";
import type { Hex } from "viem";
import { checkSelectorRoutes } from "./contract-check.js";

// Run with: npx tsx --test packages/cli/src/lib/contract-check.test.ts
//
// Covers the selector-routing check, specifically the proxy handling that
// `sailor mandate simulate` uses to decide whether to warn about an unknown
// selector (issue #227). The core invariant: a MISSING selector must not be
// reported as "would revert" when the bytecode looks like a proxy.

// ERC-4626 `deposit(uint256,address)` selector.
const DEPOSIT = "0x6e553f65" as Hex;

/** A long (non-proxy) bytecode with a fake dispatch table containing `sel`. */
function implBytecode(sel: string, len = 6000): Hex {
  const selHex = sel.slice(2).toLowerCase();
  // pad out to len hex chars with a harmless repeated byte
  const filler = "00".repeat(Math.max(0, Math.ceil((len - selHex.length) / 2)));
  return (`0x${selHex}${filler}`.slice(0, len + 2) as string) as Hex;
}

test("selector present in a large bytecode → routes true", () => {
  const r = checkSelectorRoutes(DEPOSIT, implBytecode(DEPOSIT));
  assert.equal(r.routes, true);
});

test("selector missing from a large bytecode → routes false (real 'would revert')", () => {
  // big bytecode without the selector: a genuine implementation contract that
  // lacks the function. This must stay a hard "NOT found".
  const r = checkSelectorRoutes(DEPOSIT, implBytecode("0xffffffff", 6000));
  assert.equal(r.routes, false);
  assert.equal(r.selector, "6e553f65");
});

test("selector missing from a short bytecode → routes null (likely proxy)", () => {
  // A ~360-byte proxy like the Euler vault in #227: no dispatch table, no
  // EIP-1967 slot, just delegatecall plumbing. Must NOT warn "would revert".
  const shortProxy = `0x${"36".repeat(720)}` as Hex;
  const r = checkSelectorRoutes(DEPOSIT, shortProxy);
  assert.equal(r.routes, null);
  assert.ok(r.reason, "a null result carries a human-readable reason");
});

test("EIP-1967 implementation proxy → routes null regardless of size", () => {
  const proxy = `0x${"00".repeat(800)}360894a13ba1a321${"00".repeat(800)}` as Hex;
  const r = checkSelectorRoutes(DEPOSIT, proxy);
  assert.equal(r.routes, null);
  assert.ok(r.reason!.includes("EIP-1967"));
});

test("calldata shorter than 4 bytes → routes null", () => {
  const r = checkSelectorRoutes("0x6e55" as Hex, implBytecode(DEPOSIT));
  assert.equal(r.routes, null);
  assert.equal(r.selector, "");
});
