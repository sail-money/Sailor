import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { persistAccount } from "../accounts.js";
import {
  addStep,
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

test("ensureDefaultStrategy: seeds an active Default agent step on the SMA's first chain", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453, 42161]);
  const account = { safe: SAFE, chainId: 8453 } as never;
  const def = ensureDefaultStrategy(account, sailDir);
  assert.ok(def);
  assert.equal(def?.name, "Default");
  assert.equal(def?.active, true);
  assert.equal(def?.pipeline.type, "sequential");
  assert.equal(def?.pipeline.steps.length, 1);
  assert.equal(def?.pipeline.steps[0].executable, "agent");
  assert.deepEqual(def?.pipeline.steps[0].chains, [8453]);
});

test("ensureDefaultStrategy: writes strategies.json to disk in the exact expected shape", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453, 42161]);
  ensureDefaultStrategy({ safe: SAFE, chainId: 8453 } as never, sailDir);

  // File is actually persisted (the onboarding gap the user hit).
  const file = path.join(sailDir, "strategies", "strategies.json");
  assert.ok(fs.existsSync(file), "strategies.json must be written to disk");

  // Re-reads through the store, and the raw JSON matches the documented structure.
  const [s] = listStrategies(sailDir);
  assert.deepEqual(s, {
    name: "Default",
    active: true,
    pipeline: { type: "sequential", steps: [{ executable: "agent", sma: SAFE, chains: [8453] }] },
  });
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  assert.equal(raw.version, 1);
  assert.equal(raw.strategies[0].pipeline.steps[0].sma, SAFE);
});

test("ensureDefaultStrategy: no-op when a strategy already exists", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453]);
  createStrategy("Mine", sailDir);
  const before = listStrategies(sailDir).length;
  ensureDefaultStrategy({ safe: SAFE, chainId: 8453 } as never, sailDir);
  assert.equal(listStrategies(sailDir).length, before); // did not add a Default
});

test("createStrategy: inactive by default, rejects duplicates", () => {
  const sailDir = tmpSailDir();
  const s = createStrategy("Alpha", sailDir);
  assert.equal(s.active, false);
  assert.throws(() => createStrategy("alpha", sailDir), /already exists/i);
});

test("addStep: filters chains to the SMA's deployed set and rejects when none valid", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453, 42161]);
  createStrategy("Alpha", sailDir);
  const s = addStep("Alpha", { executable: "agent", sma: SAFE, chains: [42161, 10, 8453] }, sailDir);
  assert.deepEqual(s.pipeline.steps[0].chains, [42161, 8453]); // 10 (not deployed) dropped
  assert.throws(() => addStep("Alpha", { executable: "agent", sma: SAFE, chains: [10] }, sailDir), /no valid chains/i);
});

test("addStep: rejects unknown SMA and bad executable name", () => {
  const sailDir = tmpSailDir();
  seedSma(sailDir, 8453, [8453]);
  createStrategy("Alpha", sailDir);
  assert.throws(
    () => addStep("Alpha", { executable: "agent", sma: "0x00000000000000000000000000000000000000BB", chains: [8453] }, sailDir),
    /not a known account/i,
  );
  assert.throws(() => addStep("Alpha", { executable: "bad_name", sma: SAFE, chains: [8453] }, sailDir), /Invalid executable/i);
});

test("readActiveStrategies + setStrategyActive + deleteStrategy", () => {
  const sailDir = tmpSailDir();
  createStrategy("Alpha", sailDir);
  assert.deepEqual(readActiveStrategies(sailDir), []);
  setStrategyActive("Alpha", true, sailDir);
  assert.equal(readActiveStrategies(sailDir).length, 1);
  assert.ok(deleteStrategy("Alpha", sailDir));
  assert.equal(getStrategy("Alpha", sailDir), undefined);
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
