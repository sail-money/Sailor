import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  type ServiceConfig,
  buildLaunchdPlist,
  buildSystemdUnit,
  buildWindowsTaskXml,
  isTccProtected,
  passphraseReadiness,
  resolveProjectDir,
  sanitizeName,
} from "./service.js";

// Run with: npx tsx --test packages/cli/src/commands/service.test.ts
// (the CLI has no wired `test` script — same convention as the SDK's colocated tests.)

const SAMPLE: ServiceConfig = {
  projectName: "my-agent",
  projectDir: "/home/op/sail/my-agent",
  nodePath: "/usr/local/bin/node",
  cliEntry: "/usr/local/lib/node_modules/@sail.money/sailor/packages/cli/dist/index.cjs",
  logPath: "/home/op/sail/my-agent/.sail/agent.log",
  interval: 120,
  chain: 8453,
  restartSec: 30,
};

test("sanitizeName: safe tokens, never empty", () => {
  assert.equal(sanitizeName("My Agent!"), "my-agent");
  assert.equal(sanitizeName("a/b\\c"), "a-b-c");
  assert.equal(sanitizeName("***"), "agent");
});

test("launchd plist: absolute node+cli, workdir, logs, restart-on-crash, NO passphrase", () => {
  const plist = buildLaunchdPlist(SAMPLE);
  assert.ok(plist.includes("<string>/usr/local/bin/node</string>"), "absolute node path embedded");
  assert.ok(plist.includes(SAMPLE.cliEntry), "absolute CLI entry embedded");
  assert.ok(!plist.includes("npx"), "must not rely on npx");
  assert.ok(plist.includes(`<string>${SAMPLE.projectDir}</string>`), "working directory set");
  assert.ok(plist.includes(`<string>${SAMPLE.logPath}</string>`), "log path set");
  assert.ok(plist.includes("KeepAlive") && plist.includes("SuccessfulExit"), "restart-on-crash");
  assert.ok(plist.includes("SAILOR_INTERVAL") && plist.includes("<string>120</string>"), "interval env");
  // The secret must never be baked in.
  assert.ok(!plist.includes("SAIL_PASSPHRASE"), "passphrase NOT in unit file");
});

test("systemd unit: absolute ExecStart, workdir, on-failure restart, NO passphrase", () => {
  const unit = buildSystemdUnit(SAMPLE);
  assert.ok(unit.includes(`ExecStart=/usr/local/bin/node ${SAMPLE.cliEntry} run --chain 8453`));
  assert.ok(!unit.includes("npx"));
  assert.ok(unit.includes(`WorkingDirectory=${SAMPLE.projectDir}`));
  assert.ok(unit.includes("Restart=on-failure"));
  assert.ok(unit.includes(`append:${SAMPLE.logPath}`));
  assert.ok(unit.includes("Environment=SAILOR_INTERVAL=120"));
  assert.ok(!unit.includes("SAIL_PASSPHRASE"), "passphrase NOT in unit file");
});

test("windows task XML: absolute node, workdir, restart-on-failure, NO passphrase", () => {
  const xml = buildWindowsTaskXml(SAMPLE);
  assert.ok(xml.includes("/usr/local/bin/node"), "absolute node embedded");
  assert.ok(xml.includes(SAMPLE.cliEntry));
  assert.ok(xml.includes("<RestartOnFailure>"));
  assert.ok(xml.includes(SAMPLE.projectDir));
  assert.ok(xml.includes("set SAILOR_INTERVAL=120"));
  assert.ok(!xml.includes("SAIL_PASSPHRASE"), "passphrase NOT in task file");
});

test("interval omitted → no SAILOR_INTERVAL in any unit", () => {
  const { interval, ...rest } = SAMPLE;
  void interval;
  const cfg = rest as ServiceConfig;
  assert.ok(!buildLaunchdPlist(cfg).includes("SAILOR_INTERVAL"));
  assert.ok(!buildSystemdUnit(cfg).includes("SAILOR_INTERVAL"));
  assert.ok(!buildWindowsTaskXml(cfg).includes("SAILOR_INTERVAL"));
});

test("isTccProtected: Desktop/Documents/Downloads under home → true; elsewhere → false", () => {
  const home = "/Users/op";
  assert.equal(isTccProtected("/Users/op/Desktop/my-agent", home), true);
  assert.equal(isTccProtected("/Users/op/Documents/x", home), true);
  assert.equal(isTccProtected("/Users/op/Downloads/x", home), true);
  assert.equal(isTccProtected("/Users/op/sail/my-agent", home), false);
  assert.equal(isTccProtected("/opt/agents/my-agent", home), false);
});

test("resolveProjectDir: requires .sail/ and does NOT walk upward", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-svc-"));
  try {
    fs.mkdirSync(path.join(root, ".sail"));
    const nested = path.join(root, "sub", "dir");
    fs.mkdirSync(nested, { recursive: true });
    // explicit project with .sail → ok
    assert.equal(resolveProjectDir(root), root);
    // nested dir has no .sail and we must NOT latch onto the parent
    assert.throws(() => resolveProjectDir(nested), /No \.sail\/ found/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("passphraseReadiness: needs keystore AND SAIL_PASSPHRASE in .env.local", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-pp-"));
  try {
    fs.mkdirSync(path.join(root, ".sail", "keys"), { recursive: true });
    // No keystore, no env → not ready
    assert.equal(passphraseReadiness(root).ready, false);
    // Keystore present but no passphrase → not ready
    fs.writeFileSync(path.join(root, ".sail", "keys", "manager.json"), JSON.stringify({ address: "x" }));
    let r = passphraseReadiness(root);
    assert.equal(r.keystorePresent, true);
    assert.equal(r.ready, false);
    // Add SAIL_PASSPHRASE to .env.local → ready
    fs.writeFileSync(path.join(root, ".sail", ".env.local"), "SAIL_PASSPHRASE=secret\n");
    r = passphraseReadiness(root);
    assert.equal(r.passphraseInEnvFile, true);
    assert.equal(r.ready, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
