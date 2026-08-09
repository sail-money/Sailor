import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { ANVIL_MISSING_MESSAGE } from "@sail/sandbox";
import { anvilOnPath } from "../lib/process.js";
import { assertSandboxPrerequisites } from "./ui.js";

// Run with: npx tsx --test packages/cli/src/commands/ui.test.ts
// (requires `pnpm --filter @sail/sandbox build` first so @sail/sandbox resolves.)
//
// The binary lookup is injected in every case below — whether the host running
// these tests actually has Foundry installed must never change the outcome.

const NO_ANVIL = (): boolean => false;
const HAS_ANVIL = (): boolean => true;

test("sandbox mode with anvil missing throws before anything is spawned", () => {
  assert.throws(
    () => assertSandboxPrerequisites("sandbox", NO_ANVIL),
    (err: Error) => {
      assert.equal(err.message, ANVIL_MISSING_MESSAGE);
      return true;
    },
  );
});

test("the preflight message names Foundry and the install URL", () => {
  // The point of the check is telling the user what to do, not just that
  // something is missing.
  assert.match(ANVIL_MISSING_MESSAGE, /Foundry/);
  assert.match(ANVIL_MISSING_MESSAGE, /https:\/\/getfoundry\.sh/);
});

test("sandbox mode with anvil present does not throw", () => {
  assert.doesNotThrow(() => assertSandboxPrerequisites("sandbox", HAS_ANVIL));
});

test("live mode is unaffected when anvil is missing — Foundry is not a Sailor requirement", () => {
  assert.doesNotThrow(() => assertSandboxPrerequisites("live", NO_ANVIL));
});

test("live mode never even consults the lookup", () => {
  let consulted = false;
  assertSandboxPrerequisites("live", () => {
    consulted = true;
    return false;
  });
  assert.equal(consulted, false, "live mode must not probe for anvil at all");
});

test("anvilOnPath: finds the binary in any PATH entry", () => {
  const dirs = ["/usr/bin", "/opt/foundry/bin", "/usr/local/bin"];
  const pathEnv = dirs.join(path.delimiter);
  const exists = (p: string): boolean => p === path.join("/opt/foundry/bin", "anvil");
  assert.equal(anvilOnPath(pathEnv, exists), true);
});

test("anvilOnPath: finds anvil.exe in PATH entry on Windows", () => {
  const dirs = ["C:\\Windows", "C:\\Users\\user\\.foundry\\bin"];
  const pathEnv = dirs.join(path.delimiter);
  const exists = (p: string): boolean => p === path.join("C:\\Users\\user\\.foundry\\bin", "anvil.exe");
  assert.equal(anvilOnPath(pathEnv, exists), true);
});

test("anvilOnPath: false when no PATH entry holds it", () => {
  const pathEnv = ["/usr/bin", "/usr/local/bin"].join(path.delimiter);
  assert.equal(anvilOnPath(pathEnv, () => false), false);
});

test("anvilOnPath: an empty PATH is false, not a crash", () => {
  assert.equal(anvilOnPath("", () => true), false);
});

test("anvilOnPath: an unset PATH is false, not a crash", () => {
  // NB: passing `undefined` explicitly would trigger the default parameter and
  // read the real process.env.PATH, so the only way to exercise "no PATH" is to
  // unset it for the duration of the call.
  const saved = process.env["PATH"];
  delete process.env["PATH"];
  try {
    assert.equal(anvilOnPath(undefined, () => true), false);
  } finally {
    if (saved === undefined) delete process.env["PATH"];
    else process.env["PATH"] = saved;
  }
  assert.equal(process.env["PATH"], saved, "PATH must be restored");
});

test("anvilOnPath: skips empty PATH segments rather than probing the cwd", () => {
  // A trailing or doubled delimiter yields "" segments; joining those with
  // "anvil" would probe a relative path and could pick up a local file.
  const probed: string[] = [];
  anvilOnPath(`::${path.delimiter}`.replace(/::/, ""), (p) => {
    probed.push(p);
    return false;
  });
  assert.deepEqual(probed, [], "no empty segment should be probed");
});
