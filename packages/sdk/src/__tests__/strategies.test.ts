import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getAddress } from "viem";
import { persistAccount } from "../accounts.js";
import {
  DEFAULT_EXECUTABLE,
  createStrategy,
  createStrategyExecutable,
  deleteStrategy,
  getStrategy,
  isValidExecutableName,
  listStrategies,
  migrateLegacyDefaultStrategy,
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

test("createStrategy: writes strategies.json to disk in the flat v2 shape", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453, 42161]);
  createStrategy("dcaBase", { sma: SAFE, executable: "agent", chains: [8453] }, sailDir);

  const file = path.join(sailDir, "strategies", "strategies.json");
  assert.ok(fs.existsSync(file), "strategies.json must be written to disk");
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  assert.equal(raw.version, 2);
  assert.equal(raw.strategies[0].sma, getAddress(SAFE));
});

test("createStrategy: active by default (opt out with active:false), checksums the SMA, rejects duplicates", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453]);
  const s = createStrategy("dcaBase", { sma: SAFE, executable: "agent", chains: [8453] }, sailDir);
  assert.equal(s.active, true);
  assert.equal(s.sma, getAddress(SAFE));
  assert.equal(s.executable, "agent");
  assert.deepEqual(s.chains, [8453]);
  const inactive = createStrategy("rebalance", { sma: SAFE, executable: "agent", active: false }, sailDir);
  assert.equal(inactive.active, false);
  assert.throws(() => createStrategy("dcaBase", { sma: SAFE, executable: "agent" }, sailDir), /already exists/i);
});

test("createStrategy: filters chains to the SMA's deployed set and rejects when none valid", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453, 42161]);
  const s = createStrategy("dcaBase", { sma: SAFE, executable: "agent", chains: [42161, 10, 8453] }, sailDir);
  assert.deepEqual(s.chains, [42161, 8453]); // 10 (not deployed) dropped
  assert.throws(
    () => createStrategy("rebalance", { sma: SAFE, executable: "agent", chains: [10] }, sailDir),
    /deployed set/i,
  );
});

test("createStrategy: omitting chains stores no key (executable-driven / cross-chain)", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453, 42161]);
  const s = createStrategy("crossChain", { sma: SAFE, executable: "agent" }, sailDir);
  assert.equal(s.chains, undefined);
  assert.equal(getStrategy("crossChain", sailDir)?.chains, undefined);
});

test("createStrategy: defaults the executable to the agent when omitted", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453]);
  const s = createStrategy("dcaBase", { sma: SAFE }, sailDir);
  assert.equal(s.executable, DEFAULT_EXECUTABLE);
  assert.equal(getStrategy("dcaBase", sailDir)?.executable, DEFAULT_EXECUTABLE);
});

test("migrateLegacyDefaultStrategy: creates one active default for a pre-strategy project", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453, 42161]);

  const migrated = migrateLegacyDefaultStrategy(sailDir);

  assert.deepEqual(migrated, {
    name: "default",
    active: true,
    sma: getAddress(SAFE),
    executable: DEFAULT_EXECUTABLE,
    chains: [8453],
  });
  assert.equal(migrateLegacyDefaultStrategy(sailDir), null, "migration must be idempotent");
  assert.equal(listStrategies(sailDir).length, 1);
});

test("migrateLegacyDefaultStrategy: respects an existing empty strategy configuration", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453]);
  const file = path.join(sailDir, "strategies", "strategies.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ version: 2, strategies: [] })}\n`);

  assert.equal(migrateLegacyDefaultStrategy(sailDir), null);
  assert.deepEqual(listStrategies(sailDir), []);
});

test("createStrategy: strategy names must be camelCase (the spec filename + --strategy selector)", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453]);
  assert.throws(() => createStrategy("DCA daily", { sma: SAFE }, sailDir), /camelCase/i);
  assert.throws(() => createStrategy("with-space", { sma: SAFE }, sailDir), /camelCase/i);
  assert.throws(() => createStrategy("", { sma: SAFE }, sailDir), /camelCase/i);
  const ok = createStrategy("dcaDaily", { sma: SAFE }, sailDir);
  assert.equal(ok.name, "dcaDaily");
});

test("createStrategy: rejects unknown SMA and bad executable name", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453]);
  assert.throws(
    () => createStrategy("dcaBase", { sma: "0x00000000000000000000000000000000000000BB", executable: "agent", chains: [8453] }, sailDir),
    /not a known account/i,
  );
  assert.throws(
    () => createStrategy("rebalance", { sma: SAFE, executable: "bad_name", chains: [8453] }, sailDir),
    /Invalid executable/i,
  );
});

test("setStrategyChains: sets a replay set and clears it to executable-driven", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453, 42161]);
  createStrategy("dcaBase", { sma: SAFE, executable: "agent", chains: [8453] }, sailDir);

  const cleared = setStrategyChains("dcaBase", null, sailDir);
  assert.equal(cleared?.chains, undefined);

  const set = setStrategyChains("dcaBase", [8453, 42161], sailDir);
  assert.deepEqual(set?.chains, [8453, 42161]);
});

test("readActiveStrategies + setStrategyActive + deleteStrategy", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453]);
  createStrategy("dcaBase", { sma: SAFE, executable: "agent" }, sailDir);
  assert.equal(readActiveStrategies(sailDir).length, 1); // active by default
  setStrategyActive("dcaBase", false, sailDir);
  assert.deepEqual(readActiveStrategies(sailDir), []);
  setStrategyActive("dcaBase", true, sailDir);
  assert.equal(readActiveStrategies(sailDir).length, 1);
  assert.ok(deleteStrategy("dcaBase", sailDir));
  assert.equal(getStrategy("dcaBase", sailDir), undefined);
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
