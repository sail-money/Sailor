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
  reviewSurface,
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

test("isSensitivePath whitelists .sail/, strips backups/logs/variants, keeps .env.example", () => {
  assert.equal(isSensitivePath(".sail/keys/manager.json"), true);
  assert.equal(isSensitivePath(".sail/account.json"), true);
  assert.equal(isSensitivePath(".sail/account.json.bak"), true); // backup must not leak
  assert.equal(isSensitivePath(".sail/cron-tick.log"), true); // logs must not leak
  assert.equal(isSensitivePath(".sail/state/accounts.json"), true);
  assert.equal(isSensitivePath(".sail/.env.local"), true);
  assert.equal(isSensitivePath("ci-keystore.json"), true);
  assert.equal(isSensitivePath(".env"), true);
  assert.equal(isSensitivePath(".env.production"), true);
  // Local config / OS junk / operational tx files:
  assert.equal(isSensitivePath(".claude/settings.local.json"), true);
  assert.equal(isSensitivePath(".vscode/launch.json"), true);
  assert.equal(isSensitivePath(".DS_Store"), true);
  assert.equal(isSensitivePath("ui/.DS_Store"), true);
  assert.equal(isSensitivePath("rotate-manager.json"), true);
  assert.equal(isSensitivePath("set-manager-new-sma.json"), true);
  assert.equal(isSensitivePath("move-usdc-to-new-sma.json"), true);
  assert.equal(isSensitivePath("withdraw-usdc.json"), true);
  // Only these three .sail/ files ship; normal project files stay:
  assert.equal(isSensitivePath(".sail/config.json"), false);
  assert.equal(isSensitivePath(".sail/share.json"), false);
  assert.equal(isSensitivePath(".sail/.gitkeep"), false);
  assert.equal(isSensitivePath(".env.example"), false);
  assert.equal(isSensitivePath("package.json"), false);
  assert.equal(isSensitivePath("src/agent.ts"), false);
});

test("buildCleanCopy strips Safe-tx JSON by shape, even with an innocent name", () => {
  const root = makeProject();
  // an operational tx batch named so it dodges the filename patterns
  fs.writeFileSync(
    path.join(root, "ops.json"),
    JSON.stringify({
      version: "1.0",
      chainId: "8453",
      meta: { name: "Rotate", createdFromSafeAddress: "0xabc" },
      transactions: [{ to: "0xdef", value: "0", data: "0x0177a6ec0000" }],
    }),
  );
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-tx-"));
  const files = buildCleanCopy(root, dest);
  assert.ok(!files.includes("ops.json"), "Safe-tx JSON stripped by content");
  assert.ok(files.includes("package.json") === false); // makeProject has none; sanity
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dest, { recursive: true, force: true });
});

test("scanForSecrets catches a prefixed passphrase env (SAIL_PASSPHRASE=...)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-pass-"));
  fs.writeFileSync(
    path.join(dir, "x.json"),
    '"Bash(SAIL_PASSPHRASE=LoopingBase2026 npx sailor *)"',
  );
  const f = scanForSecrets(dir);
  assert.ok(
    f.some((x) => x.kind.includes("passphrase")),
    "passphrase flagged",
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("isSensitivePath strips credential files but keeps source code", () => {
  for (const p of [
    ".npmrc",
    "deploy.pem",
    "id_rsa",
    "mnemonic.txt",
    "secrets.json",
    "wallet.json",
  ]) {
    assert.equal(isSensitivePath(p), true, `${p} should be stripped`);
  }
  for (const p of ["src/wallet-utils.ts", "mandates/SeedVault.sol", "src/secretSauce.ts"]) {
    assert.equal(isSensitivePath(p), false, `${p} should be kept`);
  }
});

test("scanForSecrets catches provider tokens, JWT, JSON-key secret, managed RPC", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-tok-"));
  fs.writeFileSync(path.join(dir, "a.txt"), `token=ghp_${"a".repeat(36)}`);
  fs.writeFileSync(path.join(dir, "b.json"), '{ "passphrase": "Sup3rSecretValue" }');
  fs.writeFileSync(
    path.join(dir, "c.ts"),
    'const u = "https://base-mainnet.g.alchemy.com/v2/abcd1234efgh5678ijkl";',
  );
  fs.writeFileSync(
    path.join(dir, "d.txt"),
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEFghiJKL",
  );
  const f = scanForSecrets(dir);
  const kinds = f.map((x) => x.kind).join("|");
  assert.ok(/GitHub token/.test(kinds), "gh token");
  assert.ok(/passphrase/.test(kinds), "json-key secret");
  assert.ok(/managed RPC/.test(kinds), "managed rpc");
  assert.ok(/JWT/.test(kinds), "jwt");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("reviewSurface lists surviving non-zero addresses and binaries", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-surf-"));
  fs.writeFileSync(
    path.join(dir, "m.ts"),
    `const T = "0x${"a".repeat(40)}"; const Z = "0x${"0".repeat(40)}";`,
  );
  fs.writeFileSync(path.join(dir, "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
  const s = reviewSurface(dir);
  assert.ok(s.addresses.includes(`0x${"a".repeat(40)}`), "non-zero addr surfaced");
  assert.ok(!s.addresses.includes(`0x${"0".repeat(40)}`), "zero addr ignored");
  assert.ok(s.binaries.includes("shot.png"), "binary surfaced");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("autoRedact strips local home paths (laptop username)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-home-"));
  fs.writeFileSync(path.join(dir, "tick-cron.sh"), "cd /Users/ryuk/Desktop/Test2 || exit 1\n");
  const r = autoRedact(dir, { addresses: [], rpcUrls: [] });
  const out = fs.readFileSync(path.join(dir, "tick-cron.sh"), "utf-8");
  assert.ok(!out.includes("/Users/ryuk"), "username path removed");
  assert.ok(out.includes("$HOME/Desktop/Test2"), "replaced with $HOME");
  assert.ok(r.some((x) => x.kind === "local home path"));
  fs.rmSync(dir, { recursive: true, force: true });
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
