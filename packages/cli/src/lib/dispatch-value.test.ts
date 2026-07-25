import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, parseAbi } from "viem";
import { decodeTokenMove, formatTokenAmount, isUnlimitedAmount } from "./dispatch-value.js";

// Run with: npx tsx --test packages/cli/src/lib/dispatch-value.test.ts

const ERC20 = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function transfer(address to, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amount)",
]);
const SPENDER = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";

test("decodeTokenMove: approve → allowance amount", () => {
  const data = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [SPENDER, 5_000_000n] });
  assert.deepEqual(decodeTokenMove(data), { fn: "approve", amount: 5_000_000n });
});

test("decodeTokenMove: transfer → amount is the 2nd arg", () => {
  const data = encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [TO, 1_234n] });
  assert.deepEqual(decodeTokenMove(data), { fn: "transfer", amount: 1_234n });
});

test("decodeTokenMove: transferFrom → amount is the 3rd arg", () => {
  const data = encodeFunctionData({ abi: ERC20, functionName: "transferFrom", args: [SPENDER, TO, 99n] });
  assert.deepEqual(decodeTokenMove(data), { fn: "transferFrom", amount: 99n });
});

test("decodeTokenMove: undecodable calldata (e.g. a router swap) → null", () => {
  assert.equal(decodeTokenMove("0xdeadbeef00000000000000000000000000000000"), null);
});

test("decodeTokenMove: empty / too-short calldata → null (never throws)", () => {
  assert.equal(decodeTokenMove("0x"), null);
  assert.equal(decodeTokenMove(undefined), null);
});

test("formatTokenAmount: trims trailing zeros", () => {
  assert.equal(formatTokenAmount(5_000_000n, 6), "5"); // 5 USDC
  assert.equal(formatTokenAmount(2_940_000_000_000_000n, 18), "0.00294"); // ~WETH fill
  assert.equal(formatTokenAmount(0n, 6), "0");
});

test("isUnlimitedAmount: max-uint and near-max approvals are unlimited", () => {
  const MAX_UINT256 = (1n << 256n) - 1n;
  assert.equal(isUnlimitedAmount(MAX_UINT256), true); // classic infinite approval
  assert.equal(isUnlimitedAmount(1n << 255n), true); // threshold boundary
});

test("isUnlimitedAmount: real balances are not unlimited", () => {
  assert.equal(isUnlimitedAmount(5_000_000n), false); // 5 USDC
  assert.equal(isUnlimitedAmount(0n), false);
  // 1 trillion tokens at 18dp — a whale-sized but real approval, still far below 2^255.
  assert.equal(isUnlimitedAmount(1_000_000_000_000n * 10n ** 18n), false);
});
