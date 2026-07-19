// NOTE: this package's test files must run serially (--test-concurrency=1 in
// the test script): the real-anvil tests here and in fund.test.ts all fork
// chains on the same deterministic per-chain ports, so parallel files adopt —
// and then kill — each other's forks.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPublicClient, createTestClient, http } from "viem";
import { anvilStateFilePath, isPidAlive, probePort, startFork, stopFork } from "./fork.js";
import { readManifest, writeManifest } from "./manifest.js";
import {
  MAX_SANDBOX_CHAINS,
  TooManySandboxChainsError,
  dumpSandboxState,
  refreshSandboxForks,
  resetSandbox,
  resolveChainName,
  restartSandboxFork,
  startSandboxForks,
  stopSandboxFork,
} from "./sandbox.js";

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

/** A bare RPC stub that only answers eth_chainId — enough to exercise
 *  startFork's port-probe without needing a real anvil process. */
function stubRpcServer(chainId: number): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${chainId.toString(16)}` }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as any).port;
      resolve({ server, port });
    });
  });
}

test("startFork adopts an already-listening port serving the right chain, instead of spawning a duplicate", async () => {
  const dir = tmpSandboxDir();
  const { server, port } = await stubRpcServer(8453);
  try {
    const fork = await startFork({ sandboxDir: dir, chain: "base", port, repoint: false });
    assert.equal(fork.adopted, true);
    assert.equal(fork.pid, undefined);
    assert.equal(fork.ready, true);
    assert.equal(fork.status, "ready");

    const env = readFileSync(join(dir, ".env.local"), "utf8");
    assert.match(env, new RegExp(`RPC_URL_8453=http://127\\.0\\.0\\.1:${port}`));
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("startFork refuses to guess when the port already serves a different chain", async () => {
  const dir = tmpSandboxDir();
  const { server, port } = await stubRpcServer(42161); // arbitrum, but we ask for base
  try {
    await assert.rejects(
      startFork({ sandboxDir: dir, chain: "base", port, repoint: false }),
      /already serving chain 42161/,
    );
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stopSandboxFork throws for an untracked chain", async () => {
  const dir = tmpSandboxDir();
  try {
    await assert.rejects(stopSandboxFork(dir, 8453), /No sandbox fork tracked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stopSandboxFork and restartSandboxFork both refuse on an adopted fork that's still actually alive", async () => {
  const dir = tmpSandboxDir();
  const { server, port } = await stubRpcServer(8453);
  try {
    writeManifest(dir, {
      "8453": {
        chainId: 8453,
        chain: "base",
        ready: true,
        status: "ready",
        adopted: true,
        rpcUrl: `http://127.0.0.1:${port}`,
        port,
      },
    });
    await assert.rejects(stopSandboxFork(dir, 8453), /still running/);
    await assert.rejects(restartSandboxFork(dir, 8453), /still running/);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stopSandboxFork allows stopping an adopted fork whose process has since died — nothing left to protect", async () => {
  const dir = tmpSandboxDir();
  // A stub that's already closed before the manifest entry is even written —
  // nothing is listening on this port, standing in for "the thing this
  // sandbox adopted has since gone away."
  const { server, port } = await stubRpcServer(8453);
  server.close();
  try {
    writeManifest(dir, {
      "8453": { chainId: 8453, chain: "base", ready: true, status: "ready", adopted: true, rpcUrl: `http://127.0.0.1:${port}`, port },
    });
    const stopped = await stopSandboxFork(dir, 8453);
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.adopted, false); // stale adoption marker cleared — safe to take over from here on
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A pid that can't be a live process (macOS/Linux pid ranges top out far
// below this) — stands in for "the fork's anvil died at some point".
const DEAD_PID = 999_999_999;

test("resetSandbox settles a dead fork's entry into stopped, with its dump target recorded", async () => {
  const dir = tmpSandboxDir();
  try {
    writeManifest(dir, {
      "8453": { chainId: 8453, chain: "base", ready: true, status: "ready", pid: DEAD_PID, rpcUrl: "http://127.0.0.1:59999", port: 59999 },
    });
    await resetSandbox(dir);
    const entry = readManifest(dir)["8453"];
    assert.equal(entry.status, "stopped");
    assert.equal(entry.ready, false);
    assert.equal(entry.pid, undefined);
    assert.equal(entry.stateFile, anvilStateFilePath(dir, "base"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resetSandbox leaves an adopted fork that's still alive untouched — not ours to stop", async () => {
  const dir = tmpSandboxDir();
  const { server, port } = await stubRpcServer(8453);
  try {
    writeManifest(dir, {
      "8453": { chainId: 8453, chain: "base", ready: true, status: "ready", adopted: true, rpcUrl: `http://127.0.0.1:${port}`, port },
    });
    await resetSandbox(dir);
    const entry = readManifest(dir)["8453"];
    assert.equal(entry.status, "ready");
    assert.equal(entry.adopted, true);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dumpSandboxState skips forks that aren't up, and writes nothing for them", async () => {
  const dir = tmpSandboxDir();
  try {
    writeManifest(dir, {
      "8453": { chainId: 8453, chain: "base", ready: true, status: "ready", pid: DEAD_PID, rpcUrl: "http://127.0.0.1:59999", port: 59999 },
      "42161": { chainId: 42161, chain: "arbitrum", ready: false, status: "stopped" },
    });
    const result = await dumpSandboxState(dir);
    assert.deepEqual(result.dumped, []);
    assert.deepEqual(result.failed, {});
    assert.equal(result.skipped.length, 2);
    assert.equal(existsSync(anvilStateFilePath(dir, "base")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dumpSandboxState never dumps over a state file whose world was not loaded yet (pendingStateLoad guard)", async () => {
  const dir = tmpSandboxDir();
  const { server, port } = await stubRpcServer(84532);
  try {
    const stateFile = join(dir, "anvil-state-base-sepolia.json");
    writeFileSync(stateFile, "0xtheworld"); // the only copy of a saved world
    writeManifest(dir, {
      "84532": {
        chainId: 84532,
        chain: "base-sepolia",
        ready: true,
        status: "ready",
        rpcUrl: `http://127.0.0.1:${port}`,
        port,
        stateFile,
        pendingStateLoad: stateFile, // its load into this fork never succeeded
      },
    });
    const result = await dumpSandboxState(dir);
    assert.deepEqual(result.dumped, []);
    assert.deepEqual(result.skipped, [84532]);
    assert.equal(readFileSync(stateFile, "utf8"), "0xtheworld", "the unloaded world's file must remain untouched");
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refreshSandboxForks settles a spawning fork whose process died into failed — not 'Starting…' forever", async () => {
  const dir = tmpSandboxDir();
  // Nothing listening on this port: the stub is closed before the entry is
  // written, standing in for an anvil that crashed during boot.
  const { server, port } = await stubRpcServer(84532);
  server.close();
  try {
    writeManifest(dir, {
      "84532": { chainId: 84532, chain: "base-sepolia", ready: false, status: "spawning", pid: DEAD_PID, rpcUrl: `http://127.0.0.1:${port}`, port },
    });
    const manifest = await refreshSandboxForks(dir);
    assert.equal(manifest["84532"].status, "failed");
    assert.equal(manifest["84532"].ready, false);
    assert.equal(manifest["84532"].pid, undefined);
    assert.match(manifest["84532"].error ?? "", /exited during startup/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refreshSandboxForks settles a pending state load when a slow-booting fork finally turns ready", async () => {
  const dir = tmpSandboxDir();
  const { server, port } = await stubRpcServer(84532);
  try {
    const pendingFile = join(dir, "anvil-state-base-sepolia.json");
    writeFileSync(pendingFile, "0x00");
    writeManifest(dir, {
      "84532": {
        chainId: 84532,
        chain: "base-sepolia",
        ready: false,
        status: "spawning",
        pid: process.pid, // "still alive" — the boot was just slow
        rpcUrl: `http://127.0.0.1:${port}`,
        port,
        pendingStateLoad: pendingFile,
      },
    });
    const manifest = await refreshSandboxForks(dir);
    assert.equal(manifest["84532"].status, "ready");
    assert.equal(manifest["84532"].pendingStateLoad, undefined, "the load debt must be settled, not carried forever");
  } finally {
    server.close();
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

test(
  "stopSandboxFork then restartSandboxFork: a real fork stops, comes back on a new pid, and keeps repointing the sandbox's primary RPC",
  { skip: !anvilAvailable() },
  async () => {
    const dir = tmpSandboxDir();
    try {
      const { forks } = await startSandboxForks({ sandboxDir: dir, chains: ["base-sepolia"] });
      const started = forks["84532"];
      assert.equal(started.status, "ready");
      assert.ok(started.pid);
      const firstPid = started.pid;

      const stopped = await stopSandboxFork(dir, 84532);
      assert.equal(stopped.status, "stopped");
      assert.equal(stopped.pid, undefined);
      assert.equal(isPidAlive(firstPid), false);

      const restarted = await restartSandboxFork(dir, 84532);
      assert.equal(restarted.status, "ready");
      assert.ok(restarted.pid);
      assert.notEqual(restarted.pid, firstPid);
      assert.equal(isPidAlive(restarted.pid), true);
      assert.equal(restarted.primary, true); // sole chain in this sandbox — stays primary across restart

      const env = readFileSync(join(dir, ".env.local"), "utf8");
      assert.match(env, /CHAIN_ID=84532/);

      await stopSandboxFork(dir, 84532);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "stopSandboxFork dumps state even for a manifest entry that predates the stateFile field, so a restart doesn't silently discard local chain state",
  { skip: !anvilAvailable() },
  async () => {
    const dir = tmpSandboxDir();
    try {
      const { forks } = await startSandboxForks({ sandboxDir: dir, chains: ["base-sepolia"] });
      const started = forks["84532"];
      assert.ok(started.pid);

      // Simulate a manifest entry written before `stateFile` was tracked (or
      // one that was always "already alive" and so never went through
      // startFork's own write) — the exact shape that let a stop silently
      // skip dumping state.
      const manifest = readManifest(dir);
      delete manifest["84532"].stateFile;
      writeManifest(dir, manifest);
      assert.equal(readManifest(dir)["84532"].stateFile, undefined);

      const testAddress = "0x000000000000000000000000000000000000dEaD";
      const testClient = createTestClient({ mode: "anvil", transport: http(started.rpcUrl) });
      const readClient = createPublicClient({ transport: http(started.rpcUrl) });
      await testClient.setBalance({ address: testAddress, value: 123_456_789_000_000_000n });
      assert.equal(await readClient.getBalance({ address: testAddress }), 123_456_789_000_000_000n);

      await stopSandboxFork(dir, 84532);
      const restarted = await restartSandboxFork(dir, 84532);
      assert.equal(restarted.status, "ready");

      const restartedReadClient = createPublicClient({ transport: http(restarted.rpcUrl) });
      assert.equal(
        await restartedReadClient.getBalance({ address: testAddress }),
        123_456_789_000_000_000n,
        "balance set before stop should survive the restart via the dumped/loaded state file",
      );

      await stopSandboxFork(dir, 84532);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

/** After a SIGKILL there's a beat before the OS releases the port; starting a
 *  new fork inside that window would adopt the corpse. Poll until it's free. */
async function waitForPortFree(rpcUrl: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probePort(rpcUrl, 400)) === null) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Port behind ${rpcUrl} never freed up after kill`);
}

test(
  "session persistence: startSandboxForks → mutate chain → resetSandbox (graceful stop-all) → startSandboxForks resumes the same world",
  { skip: !anvilAvailable() },
  async () => {
    const dir = tmpSandboxDir();
    try {
      const { forks } = await startSandboxForks({ sandboxDir: dir, chains: ["base-sepolia"] });
      const started = forks["84532"];
      assert.equal(started.status, "ready");
      assert.ok(started.pid);

      // Local-only state standing in for "a mandate deployed last session".
      const testAddress = "0x000000000000000000000000000000000000bEEF";
      const testClient = createTestClient({ mode: "anvil", transport: http(started.rpcUrl) });
      await testClient.setBalance({ address: testAddress, value: 42_000_000_000_000_000n });

      // The whole-session stop `sailor sandbox stop` now performs.
      await resetSandbox(dir);
      const stopped = readManifest(dir)["84532"];
      assert.equal(stopped.status, "stopped");
      assert.equal(stopped.pid, undefined);
      assert.equal(isPidAlive(started.pid), false);
      assert.ok(stopped.stateFile && existsSync(stopped.stateFile), "graceful stop must leave a state dump on disk");

      // Next session: same selection through the same entry point.
      const resumed = (await startSandboxForks({ sandboxDir: dir, chains: ["base-sepolia"] })).forks["84532"];
      assert.equal(resumed.status, "ready");
      assert.equal(resumed.port, started.port, "resume must land on the same deterministic port");

      const readClient = createPublicClient({ transport: http(resumed.rpcUrl) });
      assert.equal(
        await readClient.getBalance({ address: testAddress }),
        42_000_000_000_000_000n,
        "state deployed before the stop must survive into the next session",
      );

      await resetSandbox(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "crash recovery: dumpSandboxState's periodic dump lets a SIGKILLed fork (no graceful stop, no dump-on-exit) resume its world",
  { skip: !anvilAvailable() },
  async () => {
    const dir = tmpSandboxDir();
    try {
      const { forks } = await startSandboxForks({ sandboxDir: dir, chains: ["base-sepolia"] });
      const started = forks["84532"];
      assert.ok(started.pid);

      const testAddress = "0x000000000000000000000000000000000000Fee1";
      const testClient = createTestClient({ mode: "anvil", transport: http(started.rpcUrl) });
      await testClient.setBalance({ address: testAddress, value: 7_000_000_000_000_000n });

      // What the sandbox server's interval does.
      const dump = await dumpSandboxState(dir);
      assert.deepEqual(dump.dumped, [84532]);
      assert.deepEqual(dump.failed, {});
      assert.ok(existsSync(anvilStateFilePath(dir, "base-sepolia")));

      // The crash: no SIGTERM, no dump-on-stop — the in-memory world is gone.
      process.kill(started.pid!, "SIGKILL");
      await waitForPortFree(started.rpcUrl!);

      const revived = (await startSandboxForks({ sandboxDir: dir, chains: ["base-sepolia"] })).forks["84532"];
      assert.equal(revived.status, "ready");

      const readClient = createPublicClient({ transport: http(revived.rpcUrl) });
      assert.equal(
        await readClient.getBalance({ address: testAddress }),
        7_000_000_000_000_000n,
        "state from the last periodic dump must survive a hard crash",
      );

      await resetSandbox(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "large worlds survive stop→restart: a state dump past anvil's default 2MB request cap still loads (--no-request-size-limit)",
  { skip: !anvilAvailable() },
  async () => {
    const dir = tmpSandboxDir();
    try {
      const { forks } = await startSandboxForks({ sandboxDir: dir, chains: ["base-sepolia"] });
      const started = forks["84532"];
      assert.equal(started.status, "ready");

      // Inflate the world past 2MB of *dumped* state. Dumps are gzipped, so
      // the padding must be incompressible — random bytes, not zeros.
      const testClient = createTestClient({ mode: "anvil", transport: http(started.rpcUrl) });
      const chunk = 24 * 1024; // per-account code blob
      const accounts = 120; // ~2.9MB of raw entropy → >2MB gzipped
      const markers: `0x${string}`[] = [];
      for (let i = 0; i < accounts; i++) {
        const address = `0x${String(i + 1).padStart(40, "0")}` as `0x${string}`;
        markers.push(address);
        const code = `0x${randomBytes(chunk).toString("hex")}` as `0x${string}`;
        await testClient.setCode({ address, bytecode: code });
      }

      await resetSandbox(dir); // graceful stop-all: dumps state
      const entry = readManifest(dir)["84532"];
      assert.ok(entry.stateFile && existsSync(entry.stateFile));
      const dumpBytes = statSync(entry.stateFile!).size;
      assert.ok(dumpBytes > 2 * 1024 * 1024, `dump must exceed anvil's 2MB request cap to prove anything (got ${dumpBytes} bytes)`);

      const resumed = (await startSandboxForks({ sandboxDir: dir, chains: ["base-sepolia"] })).forks["84532"];
      assert.equal(resumed.status, "ready");

      const readClient = createPublicClient({ transport: http(resumed.rpcUrl) });
      const code = await readClient.getCode({ address: markers[markers.length - 1] });
      assert.ok(code && code.length > 2, "large world's state must load after restart — anvil's default request cap would have rejected it");

      await resetSandbox(dir);
    } finally {
      await resetSandbox(dir).catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "restartSandboxFork revives a fork that was adopted from an external process which has since died — the exact stuck state a permanent adopted flag would cause",
  { skip: !anvilAvailable() },
  async () => {
    const dir = tmpSandboxDir();
    // A real anvil, standing in for "some other tool's fork this sandbox
    // adopted rather than spawned" — started independently of startFork's
    // own adoption path, then killed out from under the manifest entry to
    // simulate it dying later (machine sleep, `pool down`, a crash).
    const external = await startFork({ sandboxDir: mkdtempSync(join(tmpdir(), "sail-external-")), chain: "base-sepolia", repoint: false });
    try {
      writeManifest(dir, {
        "84532": {
          chainId: 84532,
          chain: "base-sepolia",
          ready: true,
          status: "ready",
          adopted: true,
          rpcUrl: external.rpcUrl,
          port: external.port,
        },
      });

      // Still alive — must refuse, same as the process-not-yet-dead cases above.
      await assert.rejects(restartSandboxFork(dir, 84532), /still running/);

      await stopFork(external);
      assert.equal(isPidAlive(external.pid), false);

      // Now dead — restart should take over and actually bring the chain back.
      const revived = await restartSandboxFork(dir, 84532);
      assert.equal(revived.status, "ready");
      assert.ok(revived.pid);
      assert.equal(revived.adopted, false);
      assert.equal(isPidAlive(revived.pid), true);

      await stopSandboxFork(dir, 84532);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
