import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isPidAlive, startFork, stopFork } from "./fork.js";
import { readManifest, writeManifest } from "./manifest.js";
import { MAX_SANDBOX_CHAINS, TooManySandboxChainsError, resolveChainName, startSandboxForks } from "./sandbox.js";

function tmpSandboxDir(): string {
  return mkdtempSync(join(tmpdir(), "sail-sandbox-test-"));
}

test("resolveChainName accepts a chain name", () => {
  assert.equal(resolveChainName("base"), "base");
});

test("resolveChainName accepts a numeric chainId", () => {
  assert.equal(resolveChainName(8453), "base");
  assert.equal(resolveChainName("42161"), "arbitrum");
});

test("resolveChainName rejects an unsupported chain", () => {
  assert.throws(() => resolveChainName(999999), /Unsupported sandbox chain/);
});

test("startSandboxForks rejects more than MAX_SANDBOX_CHAINS before spawning anything", async () => {
  const dir = tmpSandboxDir();
  try {
    const tooMany = Array.from({ length: MAX_SANDBOX_CHAINS + 1 }, (_, i) => 8453 + i);
    await assert.rejects(
      startSandboxForks({ sandboxDir: dir, chains: tooMany }),
      TooManySandboxChainsError,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("startSandboxForks rejects an empty selection", async () => {
  const dir = tmpSandboxDir();
  try {
    await assert.rejects(startSandboxForks({ sandboxDir: dir, chains: [] }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("manifest round-trips through disk, and reads as {} when absent", () => {
  const dir = tmpSandboxDir();
  try {
    assert.deepEqual(readManifest(dir), {});
    const entry = { chainId: 8453, chain: "base", ready: true, status: "ready" as const };
    writeManifest(dir, { "8453": entry });
    assert.deepEqual(readManifest(dir), { "8453": entry });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function anvilAvailable(): boolean {
  try {
    execFileSync("anvil", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Real process lifecycle — skipped (not failed) where Foundry isn't installed,
// matching this repo's convention of no test suite requiring external binaries
// by default. Forks a real chain, so it's slower; keep it to the one test that
// actually needs a live anvil process.
test("startFork/stopFork: a real anvil process comes up, preserves the chain id, and dies on stop", { skip: !anvilAvailable() }, async () => {
  const dir = tmpSandboxDir();
  try {
    const fork = await startFork({ sandboxDir: dir, chain: "base-sepolia", repoint: false });
    assert.equal(fork.chainId, 84532);
    assert.ok(fork.pid);
    assert.equal(isPidAlive(fork.pid), true);

    await stopFork(fork);
    assert.equal(isPidAlive(fork.pid), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
