import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getAddress } from "viem";
import { persistAccount } from "../accounts.js";
import {
  createStrategyExecutable,
  createStrategy,
  deleteStrategy,
  ensureDefaultStrategy,
  getStrategy,
  isValidExecutableName,
  listStrategies,
  readActiveStrategies,
  readChainEnv,
  renderExecutableTemplate,
  setStrategyActive,
  setStrategyChains,
} from "../strategies.js";

function tmpSailDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sail-strat-"));
  return path.join(dir, ".sail");
}

const SAFE = "0x00000000000000000000000000000000000000AA";

function seedSma(sailDir: string, chainId: number, deployedChains: number[]): void {
  persistAccount(
    {
      safe: SAFE,
      owner: "0x0000000000000000000000000000000000000001",
      permissionSigner: "0x0000000000000000000000000000000000000001",
      manager: "0x0000000000000000000000000000000000000002",
      chainId,
      createdAtBlock: "0",
      deployedChains,
      name: "SMA 1",
      addedAt: null,
    },
    sailDir,
  );
}

test("isValidExecutableName: camelCase only", () => {
  assert.ok(isValidExecutableName("agent"));
  assert.ok(isValidExecutableName("checkData"));
  assert.ok(!isValidExecutableName("check_data"));
  assert.ok(!isValidExecutableName("Check"));
  assert.ok(!isValidExecutableName("1check"));
  assert.ok(!isValidExecutableName("with-dash"));
});

test("createStrategyExecutable: scaffolds the shared executable template and rejects duplicates", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sail-project-"));
  const file = createStrategyExecutable("checkData", projectRoot);
  assert.equal(file, path.join(projectRoot, "src", "strategy", "checkData.ts"));
  assert.equal(fs.readFileSync(file, "utf-8"), renderExecutableTemplate("checkData"));
  assert.throws(() => createStrategyExecutable("checkData", projectRoot), /already exists/i);
  assert.throws(() => createStrategyExecutable("bad_name", projectRoot), /Invalid executable name/i);
});

test("ensureDefaultStrategy: no account → null", () => {
  const sailDir = tmpSailDir();
  assert.equal(ensureDefaultStrategy(null, sailDir), null);
  assert.deepEqual(listStrategies(sailDir), []);
});

test("ensureDefaultStrategy: seeds an active Default (agent on the SMA's first chain)", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453, 42161]);
  const def = ensureDefaultStrategy({ safe: SAFE, chainId: 8453 } as never, sailDir);
  assert.ok(def);
  assert.equal(def?.name, "Default");
  assert.equal(def?.active, true);
  assert.equal(def?.executable, "agent");
  assert.equal(def?.sma, getAddress(SAFE));
  assert.deepEqual(def?.chains, [8453]);
});

test("ensureDefaultStrategy: writes strategies.json to disk in the flat v2 shape", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453, 42161]);
  ensureDefaultStrategy({ safe: SAFE, chainId: 8453 } as never, sailDir);

  const file = path.join(sailDir, "strategies", "strategies.json");
  assert.ok(fs.existsSync(file), "strategies.json must be written to disk");

  const [s] = listStrategies(sailDir);
  assert.deepEqual(s, {
    name: "Default",
    active: true,
    sma: getAddress(SAFE),
    executable: "agent",
    chains: [8453],
  });
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  assert.equal(raw.version, 2);
  assert.equal(raw.strategies[0].sma, getAddress(SAFE));
  assert.equal(raw.strategies[0].pipeline, undefined);
});

test("ensureDefaultStrategy: no-op when a strategy already exists", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453]);
  createStrategy("Mine", { sma: SAFE, executable: "agent" }, sailDir);
  const before = listStrategies(sailDir).length;
  ensureDefaultStrategy({ safe: SAFE, chainId: 8453 } as never, sailDir);
  assert.equal(listStrategies(sailDir).length, before); // did not add a Default
});

test("createStrategy: inactive by default, checksums the SMA, rejects duplicates", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453]);
  const s = createStrategy("Alpha", { sma: SAFE, executable: "agent", chains: [8453] }, sailDir);
  assert.equal(s.active, false);
  assert.equal(s.sma, getAddress(SAFE));
  assert.equal(s.executable, "agent");
  assert.deepEqual(s.chains, [8453]);
  assert.throws(() => createStrategy("alpha", { sma: SAFE, executable: "agent" }, sailDir), /already exists/i);
});

test("createStrategy: filters chains to the SMA's deployed set and rejects when none valid", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453, 42161]);
  const s = createStrategy("Alpha", { sma: SAFE, executable: "agent", chains: [42161, 10, 8453] }, sailDir);
  assert.deepEqual(s.chains, [42161, 8453]); // 10 (not deployed) dropped
  assert.throws(
    () => createStrategy("Beta", { sma: SAFE, executable: "agent", chains: [10] }, sailDir),
    /deployed set/i,
  );
});

test("createStrategy: omitting chains stores no key (executable-driven / multichain)", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453, 42161]);
  const s = createStrategy("Multi", { sma: SAFE, executable: "agent" }, sailDir);
  assert.equal(s.chains, undefined);
  assert.equal(getStrategy("Multi", sailDir)?.chains, undefined);
});

test("createStrategy: rejects unknown SMA and bad executable name", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453]);
  assert.throws(
    () => createStrategy("Alpha", { sma: "0x00000000000000000000000000000000000000BB", executable: "agent", chains: [8453] }, sailDir),
    /not a known account/i,
  );
  assert.throws(
    () => createStrategy("Beta", { sma: SAFE, executable: "bad_name", chains: [8453] }, sailDir),
    /Invalid executable/i,
  );
});

test("setStrategyChains: sets a replay set and clears it to executable-driven", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453, 42161]);
  createStrategy("Alpha", { sma: SAFE, executable: "agent", chains: [8453] }, sailDir);

  const cleared = setStrategyChains("Alpha", null, sailDir);
  assert.equal(cleared?.chains, undefined);

  const set = setStrategyChains("Alpha", [8453, 42161], sailDir);
  assert.deepEqual(set?.chains, [8453, 42161]);
});

test("readActiveStrategies + setStrategyActive + deleteStrategy", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453]);
  createStrategy("Alpha", { sma: SAFE, executable: "agent" }, sailDir);
  assert.deepEqual(readActiveStrategies(sailDir), []);
  setStrategyActive("Alpha", true, sailDir);
  assert.equal(readActiveStrategies(sailDir).length, 1);
  assert.ok(deleteStrategy("Alpha", sailDir));
  assert.equal(getStrategy("Alpha", sailDir), undefined);
});

test("migration: a v1 pipeline strategies.json flattens to one strategy per step on load", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453]);
  const file = path.join(sailDir, "strategies", "strategies.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      strategies: [
        { name: "Old", active: true, pipeline: { type: "sequential", steps: [{ executable: "agent", sma: SAFE, chains: [8453] }] } },
      ],
    }),
  );

  const [s] = listStrategies(sailDir);
  assert.ok(s, "migrated strategy exists");
  assert.equal(s.executable, "agent");
  assert.equal(s.active, true);
  assert.equal(s.sma.toLowerCase(), SAFE.toLowerCase());
  assert.deepEqual(s.chains, [8453]);
  assert.equal((s as { pipeline?: unknown }).pipeline, undefined);
});

test("readChainEnv: reads .sail/env/<slug>.json, {} when missing", () => {
  const sailDir = tmpSailDir();
  assert.deepEqual(readChainEnv(8453, sailDir), {}); // no file yet
  fs.mkdirSync(path.join(sailDir, "env"), { recursive: true });
  fs.writeFileSync(path.join(sailDir, "env", "base.json"), JSON.stringify({ MORPHO_TOKEN_ADDR: "0xabc", N: 5 }));
  const env = readChainEnv(8453, sailDir); // 8453 → slug "base"
  assert.equal(env.MORPHO_TOKEN_ADDR, "0xabc");
  assert.equal(env.N, "5"); // coerced to string
});
