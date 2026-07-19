// NOTE: runs serially with the other test files (--test-concurrency=1 in the
// test script) — the real-anvil test forks base-sepolia on its deterministic
// port, shared with sandbox.test.ts / fund.test.ts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { createPublicClient, createTestClient, http } from "viem";
import { activateSandboxBackup, listSandboxBackups } from "./backups.js";
import { anvilStateFilePath, probePort } from "./fork.js";
import { readManifest, writeManifest } from "./manifest.js";
import { resetSandbox, resetSandboxProject, startSandboxForks } from "./sandbox.js";

function tmpSandboxDir(): string {
  return mkdtempSync(join(tmpdir(), "sail-backups-test-"));
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

test("listSandboxBackups reads world metadata, newest first, ignoring non-backup entries", () => {
  const dir = tmpSandboxDir();
  try {
    const older = join(dir, "_reset-backup-20260101T000000Z");
    mkdirSync(older);
    writeFileSync(join(older, "anvil-state-base-sepolia.json"), "0x");

    const newer = join(dir, "_reset-backup-20260301T120000Z");
    mkdirSync(newer);
    writeJson(join(newer, "account.json"), { name: "SMA 1", safe: "0x8233c473A289B7D6b1d35b43986Ee61Af13Bb185" });
    writeJson(join(newer, "mandate.json"), []);
    writeFileSync(join(newer, "activity.jsonl"), '{"a":1}\n{"a":2}\n{"a":3}\n');
    writeFileSync(join(newer, "anvil-state-base.json"), "0x");
    writeManifest(newer, { "130": { chainId: 130, chain: "unichain", ready: false, status: "stopped" } });

    // Noise that must not be listed: a name that doesn't match the stamp
    // shape, and ordinary sandbox dirs.
    mkdirSync(join(dir, "_reset-backup-garbage"));
    mkdirSync(join(dir, "runtime"));

    const backups = listSandboxBackups(dir);
    assert.equal(backups.length, 2);

    assert.equal(backups[0].name, basename(newer));
    assert.equal(backups[0].savedAt, "2026-03-01T12:00:00Z");
    assert.equal(backups[0].smaName, "SMA 1");
    assert.equal(backups[0].safe, "0x8233c473A289B7D6b1d35b43986Ee61Af13Bb185");
    assert.deepEqual(backups[0].chains, ["base", "unichain"]); // dump ∪ manifest
    assert.equal(backups[0].hasMandate, true);
    assert.equal(backups[0].activityEvents, 3);

    assert.equal(backups[1].name, basename(older));
    assert.equal(backups[1].smaName, undefined);
    assert.deepEqual(backups[1].chains, ["base-sepolia"]);
    assert.equal(backups[1].hasMandate, false);
    assert.equal(backups[1].activityEvents, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("activateSandboxBackup rejects names that aren't backup stamps (path traversal shapes included)", async () => {
  const dir = tmpSandboxDir();
  try {
    await assert.rejects(activateSandboxBackup(dir, "../../.sail"), /Not a sandbox backup name/);
    await assert.rejects(activateSandboxBackup(dir, "_reset-backup-evil"), /Not a sandbox backup name/);
    await assert.rejects(activateSandboxBackup(dir, "_reset-backup-20990101T000000Z"), /No sandbox backup named/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("activateSandboxBackup swaps worlds on disk: current archived, backup restored, manifest rebuilt — legacy backups synthesized", async () => {
  const dir = tmpSandboxDir();
  try {
    // Current world: onboarded on base-sepolia, with manifest, config, env.
    writeJson(join(dir, "account.json"), { name: "World A", safe: "0xAAA0000000000000000000000000000000000aaa" });
    writeJson(join(dir, "config.json"), { chainId: 84532 });
    writeFileSync(anvilStateFilePath(dir, "base-sepolia"), "0xdumpA");
    writeFileSync(join(dir, ".env.local"), "RPC_URL=http://127.0.0.1:18545\nCHAIN_ID=84532\nSAIL_PASSPHRASE=hunter2\n");
    writeManifest(dir, {
      "84532": { chainId: 84532, chain: "base-sepolia", rpcUrl: "http://127.0.0.1:18545", port: 18545, pid: 999_999_999, ready: true, status: "ready", primary: true },
    });

    // A legacy backup: account + one dump, no forks.json / config / env —
    // exactly what resets created before those were captured.
    const legacy = join(dir, "_reset-backup-20260101T000000Z");
    mkdirSync(legacy);
    writeJson(join(legacy, "account.json"), { name: "World B", safe: "0xBBB0000000000000000000000000000000000bbb" });
    writeFileSync(join(legacy, "anvil-state-base.json"), "0xdumpB");

    const result = await activateSandboxBackup(dir, basename(legacy), { resume: false });

    // The outgoing world is fully archived — including manifest, config, and
    // an .env.local snapshot — so it's restorable later.
    assert.ok(result.archivedTo);
    const archived = result.archivedTo!;
    assert.equal(JSON.parse(readFileSync(join(archived, "account.json"), "utf8")).name, "World A");
    assert.equal(readFileSync(join(archived, "anvil-state-base-sepolia.json"), "utf8"), "0xdumpA");
    assert.ok(existsSync(join(archived, "config.json")));
    assert.ok(existsSync(join(archived, "forks.json")));
    assert.match(readFileSync(join(archived, ".env.local"), "utf8"), /SAIL_PASSPHRASE=hunter2/);

    // The legacy world is now live, and its backup folder was consumed.
    assert.equal(JSON.parse(readFileSync(join(dir, "account.json"), "utf8")).name, "World B");
    assert.equal(readFileSync(anvilStateFilePath(dir, "base"), "utf8"), "0xdumpB");
    assert.equal(existsSync(anvilStateFilePath(dir, "base-sepolia")), false);
    assert.equal(existsSync(legacy), false);

    // No .env.local in the legacy backup → the live one stays (its passphrase
    // unlocks the restored keystores).
    assert.match(readFileSync(join(dir, ".env.local"), "utf8"), /SAIL_PASSPHRASE=hunter2/);

    // Manifest synthesized from the dump: right chain, deterministic port,
    // stopped, primary (sole chain).
    const manifest = readManifest(dir);
    assert.deepEqual(Object.keys(manifest), ["8453"]);
    assert.equal(manifest["8453"].chain, "base");
    assert.equal(manifest["8453"].port, 18546);
    assert.equal(manifest["8453"].status, "stopped");
    assert.equal(manifest["8453"].pid, undefined);
    assert.equal(manifest["8453"].primary, true);
    assert.equal(manifest["8453"].stateFile, anvilStateFilePath(dir, "base"));

    // Switch back to World A: its archived manifest is restored (not
    // synthesized), stale pid cleared, and its .env.local snapshot replaces
    // the live file.
    const back = await activateSandboxBackup(dir, basename(archived), { resume: false });
    assert.equal(JSON.parse(readFileSync(join(dir, "account.json"), "utf8")).name, "World A");
    assert.equal(readFileSync(anvilStateFilePath(dir, "base-sepolia"), "utf8"), "0xdumpA");
    const manifestA = readManifest(dir);
    assert.deepEqual(Object.keys(manifestA), ["84532"]);
    assert.equal(manifestA["84532"].status, "stopped");
    assert.equal(manifestA["84532"].pid, undefined);
    assert.equal(manifestA["84532"].primary, true);
    assert.match(readFileSync(join(dir, ".env.local"), "utf8"), /CHAIN_ID=84532/);
    // ...and World B got archived in turn, ready to switch back again.
    assert.ok(back.archivedTo && existsSync(back.archivedTo));
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

test(
  "world navigation round trip: two worlds on the same chain, switching between them restores each one's own chain state",
  { skip: !anvilAvailable() },
  async () => {
    const dir = tmpSandboxDir();
    // Full-entropy addresses — a low vanity address (0x...00Aa) actually
    // holds dust on real base-sepolia, which a fresh fork faithfully shows.
    const ADDR_A = "0xa11cea11cea11cea11cea11cea11cea11cea11ce";
    const ADDR_B = "0xb0bb0bb0bb0bb0bb0bb0bb0bb0bb0bb0bb0bb0bb";
    const balanceOn = async (rpcUrl: string, address: `0x${string}`) =>
      createPublicClient({ transport: http(rpcUrl) }).getBalance({ address });

    try {
      // Precondition, not a discovery: if something already listens on
      // base-sepolia's deterministic port, startSandboxForks would *adopt* it
      // — a fork this test doesn't own and can't stop — and every assertion
      // below would be about the wrong world. Fail loudly instead.
      assert.equal(
        await probePort("http://127.0.0.1:18545", 500),
        null,
        "port 18545 is already in use — kill the leftover fork before running this test",
      );

      // World A: fork, leave a marker, reset (world A → backup).
      const a = (await startSandboxForks({ sandboxDir: dir, chains: ["base-sepolia"] })).forks["84532"];
      assert.equal(a.status, "ready");
      await createTestClient({ mode: "anvil", transport: http(a.rpcUrl) }).setBalance({ address: ADDR_A, value: 111n });
      const { backupDir } = await resetSandboxProject(dir);
      assert.ok(backupDir);
      const backupA = basename(backupDir!);

      // World B: fresh fork on the same chain, different marker.
      const b = (await startSandboxForks({ sandboxDir: dir, chains: ["base-sepolia"] })).forks["84532"];
      assert.equal(b.status, "ready");
      await createTestClient({ mode: "anvil", transport: http(b.rpcUrl) }).setBalance({ address: ADDR_B, value: 222n });
      assert.equal(await balanceOn(b.rpcUrl!, ADDR_A), 0n, "world B must not see world A's marker");

      // Switch to world A — its fork comes back with its saved state.
      const toA = await activateSandboxBackup(dir, backupA);
      assert.deepEqual(toA.resume?.resumed, [84532]);
      const worldA = readManifest(dir)["84532"];
      assert.equal(worldA.status, "ready");
      assert.equal(await balanceOn(worldA.rpcUrl!, ADDR_A), 111n, "world A's marker must survive the switch");
      assert.equal(await balanceOn(worldA.rpcUrl!, ADDR_B), 0n, "world B's marker must not leak into world A");

      // World B was archived by that switch — find it and switch back.
      assert.ok(toA.archivedTo);
      const toB = await activateSandboxBackup(dir, basename(toA.archivedTo!));
      assert.deepEqual(toB.resume?.resumed, [84532]);
      const worldB = readManifest(dir)["84532"];
      assert.equal(worldB.status, "ready");
      assert.equal(await balanceOn(worldB.rpcUrl!, ADDR_B), 222n, "world B's marker must survive the round trip");
      assert.equal(await balanceOn(worldB.rpcUrl!, ADDR_A), 0n);
    } finally {
      // Always stop whatever fork is currently live — a failed assertion
      // otherwise leaks a detached anvil that poisons the next run (it gets
      // adopted, and adopted forks are deliberately never stopped).
      await resetSandbox(dir).catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
