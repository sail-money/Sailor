import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { writeManifest } from "@sail/sandbox";
import { assertSafeRpcUrl } from "./rpc-guard.js";

function withEnv<T>(key: string, value: string | undefined, fn: () => T): T {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

test("assertSafeRpcUrl allows public https", () => {
  withEnv("SAILOR_ALLOW_LOCAL_RPC", undefined, () => {
    assert.doesNotThrow(() => assertSafeRpcUrl("https://mainnet.base.org"));
  });
});

test("assertSafeRpcUrl blocks loopback unless allowed", () => {
  withEnv("SAILOR_ALLOW_LOCAL_RPC", undefined, () => {
    assert.throws(() => assertSafeRpcUrl("http://127.0.0.1:8545"), /private or link-local/);
    assert.throws(() => assertSafeRpcUrl("http://localhost:8545"), /private or link-local/);
  });
});

test("assertSafeRpcUrl still blocks IMDS even when a fork is recorded", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rpc-guard-"));
  writeManifest(dir, {
    "8453": { chainId: 8453, chain: "base", rpcUrl: "http://127.0.0.1:18546", ready: true },
  });
  withEnv("SAIL_DIR", dir, () => {
    withEnv("SAILOR_ALLOW_LOCAL_RPC", undefined, () => {
      assert.throws(() => assertSafeRpcUrl("http://169.254.169.254/latest"), /private or link-local/);
    });
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("assertSafeRpcUrl allows a URL recorded in the sandbox forks.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rpc-guard-"));
  writeManifest(dir, {
    "8453": { chainId: 8453, chain: "base", rpcUrl: "http://127.0.0.1:18546", ready: true },
  });
  withEnv("SAIL_DIR", dir, () => {
    withEnv("SAILOR_ALLOW_LOCAL_RPC", undefined, () => {
      assert.doesNotThrow(() => assertSafeRpcUrl("http://127.0.0.1:18546"));
      assert.doesNotThrow(() => assertSafeRpcUrl("http://localhost:18546"));
      assert.throws(() => assertSafeRpcUrl("http://127.0.0.1:9999"), /private or link-local/);
    });
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("assertSafeRpcUrl honors SAILOR_ALLOW_LOCAL_RPC", () => {
  withEnv("SAILOR_ALLOW_LOCAL_RPC", "1", () => {
    assert.doesNotThrow(() => assertSafeRpcUrl("http://127.0.0.1:8545"));
  });
});
