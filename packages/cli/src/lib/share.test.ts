import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  RPC_PLACEHOLDER,
  type ShareManifest,
  ZERO_ADDRESS,
  autoRedact,
  buildCleanCopy,
  collectSensitiveValues,
  findMissingRequiredFiles,
  isCoreReusablePath,
  isSensitivePath,
  sanitizeConfig,
  scanForSecrets,
  slugify,
  validateManifest,
} from "./share.js";

// Run with: npx tsx --test packages/cli/src/lib/share.test.ts

test("slugify produces kebab-case", () => {
  assert.equal(slugify("DCA Rebalancer v2!"), "dca-rebalancer-v2");
  assert.equal(slugify("  Trim  Me  "), "trim-me");
});

test("validateManifest flags missing required fields", () => {
  const errs = validateManifest({ name: "x" });
  assert.ok(errs.some((e) => e.includes("summary")));
  assert.ok(errs.some((e) => e.includes("strategy")));
  assert.ok(errs.some((e) => e.includes("mandate")));
  assert.ok(errs.some((e) => e.includes("chains")));
});

test("validateManifest passes a complete manifest", () => {
  const m: ShareManifest = {
    name: "X",
    slug: "x",
    summary: "s",
    description: "d",
    strategy: "does things",
    mandate: "needs approve",
    chains: [8453],
    tags: [],
    author: "me",
    sailorVersion: "1.0.0",
    sharedAt: "2026-01-01T00:00:00Z",
  };
  assert.deepEqual(validateManifest(m), []);
});

test("isSensitivePath catches secrets and identity, keeps .env.example", () => {
  assert.equal(isSensitivePath(".sail/keys/manager.json"), true);
  assert.equal(isSensitivePath(".sail/account.json"), true);
  assert.equal(isSensitivePath(".sail/.env.local"), true);
  assert.equal(isSensitivePath("ci-keystore.json"), true);
  assert.equal(isSensitivePath(".env"), true);
  assert.equal(isSensitivePath(".env.production"), true);
  assert.equal(isSensitivePath(".env.example"), false);
  assert.equal(isSensitivePath("src/agent.ts"), false);
});

test("sanitizeConfig blanks contracts and drops createdAt", () => {
  const out = JSON.parse(
    sanitizeConfig(
      JSON.stringify({
        version: 1,
        name: "p",
        chainId: 8453,
        createdAt: "2026-01-01",
        contracts: { kernel: "0xabc", mandateFactory: "0xdef" },
      }),
    ),
  );
  assert.equal(out.createdAt, undefined);
  assert.deepEqual(out.contracts, { kernel: "", mandateFactory: "" });
  assert.equal(out.chainId, 8453);
});

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-test-"));
  fs.mkdirSync(path.join(root, ".sail", "keys"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "mandates"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".sail", "config.json"),
    JSON.stringify({
      version: 1,
      name: "p",
      chainId: 8453,
      contracts: { kernel: "0x1", mandateFactory: "0x2" },
    }),
  );
  fs.writeFileSync(path.join(root, ".sail", "keys", "manager.json"), "{secret-keystore}");
  fs.writeFileSync(path.join(root, ".sail", "account.json"), JSON.stringify({ safe: "0xSMA" }));
  fs.writeFileSync(
    path.join(root, ".sail", ".env.local"),
    "RPC_URL=https://base-mainnet.alchemy.io/v2/SECRET123KEY456",
  );
  fs.writeFileSync(path.join(root, "ci-keystore.json"), "{enc}");
  fs.writeFileSync(path.join(root, ".env.example"), "RPC_URL=https://your-rpc-endpoint");
  fs.writeFileSync(path.join(root, "src", "agent.ts"), "export const agent = {};");
  fs.writeFileSync(path.join(root, "src", "mandate.ts"), "export const params = {};");
  fs.writeFileSync(path.join(root, "mandates", "Perm.sol"), "contract Perm {}");
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# guide");
  // core reusable material that init injects into every project
  fs.mkdirSync(path.join(root, "examples", "permissions"), { recursive: true });
  fs.writeFileSync(path.join(root, "examples", "permissions", "Bounded.sol"), "contract B {}");
  fs.mkdirSync(path.join(root, ".agents", "skills"), { recursive: true });
  fs.writeFileSync(path.join(root, ".agents", "skills", "x.md"), "# skill");
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "# claude");
  return root;
}

test("isCoreReusablePath matches reusable core, not operator work", () => {
  assert.equal(isCoreReusablePath("examples/permissions/Bounded.sol"), true);
  assert.equal(isCoreReusablePath(".agents/skills/x.md"), true);
  assert.equal(isCoreReusablePath("AGENTS.md"), true);
  assert.equal(isCoreReusablePath("docs/PERMISSION_MODEL.md"), true);
  assert.equal(isCoreReusablePath("src/agent.ts"), false);
  assert.equal(isCoreReusablePath("mandates/Perm.sol"), false);
});

test("buildCleanCopy strips sensitive files, keeps strategy, sanitizes config", () => {
  const root = makeProject();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-clean-"));
  const files = buildCleanCopy(root, dest);

  assert.ok(files.includes("src/agent.ts"));
  assert.ok(files.includes("mandates/Perm.sol"));
  assert.ok(files.includes(".sail/config.json"));
  assert.ok(files.includes(".env.example"));
  // core reusable material is stripped (re-injected by replicate)
  assert.ok(!files.some((f) => f.startsWith("examples/")));
  assert.ok(!files.some((f) => f.startsWith(".agents/")));
  assert.ok(!files.includes("AGENTS.md"));
  assert.ok(!files.includes("CLAUDE.md"));
  assert.ok(!files.some((f) => f.startsWith(".sail/keys")));
  assert.ok(!files.includes(".sail/account.json"));
  assert.ok(!files.includes(".sail/.env.local"));
  assert.ok(!files.includes("ci-keystore.json"));

  const cfg = JSON.parse(fs.readFileSync(path.join(dest, ".sail", "config.json"), "utf-8"));
  assert.deepEqual(cfg.contracts, { kernel: "", mandateFactory: "" });

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dest, { recursive: true, force: true });
});

test("findMissingRequiredFiles passes a complete project and flags an empty one", () => {
  const root = makeProject();
  assert.deepEqual(findMissingRequiredFiles(root), []);
  fs.rmSync(root, { recursive: true, force: true });

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-empty-"));
  const missing = findMissingRequiredFiles(empty);
  assert.ok(missing.some((m) => m.includes("agent.ts")));
  assert.ok(missing.some((m) => m.includes(".sol")));
  fs.rmSync(empty, { recursive: true, force: true });
});

test("collectSensitiveValues gathers identity addresses and rpc urls", () => {
  const root = makeProject();
  // enrich account.json with the full identity set
  fs.writeFileSync(
    path.join(root, ".sail", "account.json"),
    JSON.stringify({
      safe: "0x1111111111111111111111111111111111111111",
      owner: "0x2222222222222222222222222222222222222222",
      manager: "0x3333333333333333333333333333333333333333",
      managers: ["0x4444444444444444444444444444444444444444"],
    }),
  );
  const v = collectSensitiveValues(root);
  assert.ok(v.addresses.includes("0x1111111111111111111111111111111111111111"));
  assert.ok(v.addresses.includes("0x4444444444444444444444444444444444444444"));
  assert.ok(v.rpcUrls.some((u) => u.includes("alchemy.io")));
  fs.rmSync(root, { recursive: true, force: true });
});

test("autoRedact zeroes the project's own addresses + private rpc in kept files", () => {
  const root = makeProject();
  const sma = "0x1111111111111111111111111111111111111111";
  fs.writeFileSync(
    path.join(root, ".sail", "account.json"),
    JSON.stringify({ safe: sma, manager: "0x3333333333333333333333333333333333333333" }),
  );
  // The SMA + a private RPC leak into a kept source file.
  fs.writeFileSync(
    path.join(root, "src", "agent.ts"),
    `const SMA = "${sma}";\nconst RPC = "https://base-mainnet.alchemy.io/v2/SECRET123KEY456";\n`,
  );

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-redact-"));
  buildCleanCopy(root, dest);
  const values = collectSensitiveValues(root);
  const redactions = autoRedact(dest, values);

  const out = fs.readFileSync(path.join(dest, "src", "agent.ts"), "utf-8");
  assert.ok(out.includes(ZERO_ADDRESS), "SMA address replaced with zero address");
  assert.ok(!out.includes(sma), "original SMA gone");
  assert.ok(out.includes(RPC_PLACEHOLDER), "rpc replaced with placeholder");
  assert.ok(redactions.some((r) => r.file === "src/agent.ts"));
  assert.deepEqual(scanForSecrets(dest), [], "no residual secrets after redaction");

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dest, { recursive: true, force: true });
});

test("scanForSecrets catches a planted private key, ignores placeholders", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-scan-"));
  fs.writeFileSync(path.join(dir, "leak.txt"), `key=0x${"a".repeat(64)}`);
  fs.writeFileSync(path.join(dir, ".env.example"), "RPC_URL=https://your-rpc-endpoint");
  const findings = scanForSecrets(dir);
  assert.ok(findings.some((f) => f.file === "leak.txt" && f.kind.includes("private-key")));
  assert.ok(!findings.some((f) => f.file === ".env.example"));
  fs.rmSync(dir, { recursive: true, force: true });
});
