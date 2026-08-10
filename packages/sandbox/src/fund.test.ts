import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPublicClient, getAddress, http } from "viem";
import { startFork, stopFork } from "./fork.js";
import { fundErc20, fundNative, usdcAddressFor, USDC_ADDRESSES } from "./fund.js";

// Valid 20-byte test addresses (getAddress both checksums and enforces length
// — catches an accidentally truncated/padded literal at test-collection time
// instead of failing deep inside a live-anvil test with a confusing RPC error).
const TEST_ADDR_1 = getAddress(`0x${"f1".padStart(40, "0")}`);
const TEST_ADDR_2 = getAddress(`0x${"f2".padStart(40, "0")}`);
const TEST_ADDR_3 = getAddress(`0x${"f3".padStart(40, "0")}`);
const TEST_ADDR_4 = getAddress(`0x${"f4".padStart(40, "0")}`);

function anvilAvailable(): boolean {
  try {
    execFileSync("anvil", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test("usdcAddressFor returns the known address for a listed chain", () => {
  assert.equal(usdcAddressFor(8453), USDC_ADDRESSES[8453]);
  assert.equal(usdcAddressFor(42161), USDC_ADDRESSES[42161]);
});

test("usdcAddressFor returns null for a chain with no known USDC deployment", () => {
  assert.equal(usdcAddressFor(999999), null);
});

test(
  "fundNative sets an address's native balance on a live fork",
  { skip: !anvilAvailable() },
  async () => {
    const sandboxDir = mkdtempSync(join(tmpdir(), "sail-fund-test-"));
    const fork = await startFork({ sandboxDir, chain: "base-sepolia", repoint: false });
    try {
      const address = TEST_ADDR_1;
      const { balanceWei } = await fundNative(fork.rpcUrl, address, "5");
      assert.equal(balanceWei, (5n * 10n ** 18n).toString());

      const publicClient = createPublicClient({ transport: http(fork.rpcUrl) });
      assert.equal(await publicClient.getBalance({ address }), 5n * 10n ** 18n);
    } finally {
      await stopFork(fork);
      rmSync(sandboxDir, { recursive: true, force: true });
    }
  },
);

test(
  "fundNative preserves full 18-decimal precision — a plain Number can't safely round-trip this",
  { skip: !anvilAvailable() },
  async () => {
    const sandboxDir = mkdtempSync(join(tmpdir(), "sail-fund-precision-test-"));
    const fork = await startFork({ sandboxDir, chain: "base-sepolia", repoint: false });
    try {
      // 0.1 ETH — the common case a naive Number(amount) round-trip still gets
      // right, so a regression here would be an obvious, not a subtle, break.
      const tenthEth = await fundNative(fork.rpcUrl, TEST_ADDR_1, "0.1");
      assert.equal(tenthEth.balanceWei, (10n ** 17n).toString());

      // 18 significant decimal digits — beyond a JS double's ~15-17 digit
      // round-trip safety. Passing this string straight to parseUnits (rather
      // than via `Number(amount)` first) is what keeps it exact.
      const precise = await fundNative(fork.rpcUrl, TEST_ADDR_2, "1.123456789012345678");
      assert.equal(precise.balanceWei, "1123456789012345678");
    } finally {
      await stopFork(fork);
      rmSync(sandboxDir, { recursive: true, force: true });
    }
  },
);

test(
  "fundErc20 writes a token balance via storage slot and it reads back through balanceOf",
  { skip: !anvilAvailable() },
  async () => {
    const sandboxDir = mkdtempSync(join(tmpdir(), "sail-fund-erc20-test-"));
    // Base's real USDC deployment exists in this fork's bytecode (forked from
    // live chain state) even though no local RPC key/whale funded it here.
    const fork = await startFork({ sandboxDir, chain: "base", repoint: false });
    try {
      const usdc = usdcAddressFor(8453)!;
      const to = TEST_ADDR_2;
      const { balanceWei, decimals } = await fundErc20(fork.rpcUrl, usdc, to, "1000");
      assert.equal(decimals, 6);
      assert.equal(balanceWei, (1000n * 10n ** 6n).toString());
    } finally {
      await stopFork(fork);
      rmSync(sandboxDir, { recursive: true, force: true });
    }
  },
);

test(
  "fundErc20 rejects a token address with no balanceOf slot found",
  { skip: !anvilAvailable() },
  async () => {
    const sandboxDir = mkdtempSync(join(tmpdir(), "sail-fund-erc20-fail-test-"));
    const fork = await startFork({ sandboxDir, chain: "base-sepolia", repoint: false });
    try {
      // An EOA, not a token contract — no balanceOf slot exists to find.
      const notAToken = TEST_ADDR_3;
      await assert.rejects(
        fundErc20(fork.rpcUrl, notAToken, TEST_ADDR_4, "10"),
        /could not locate|balanceOf/i,
      );
    } finally {
      await stopFork(fork);
      rmSync(sandboxDir, { recursive: true, force: true });
    }
  },
);
