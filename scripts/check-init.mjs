#!/usr/bin/env node
/**
 * `sailor init` smoke test.
 *
 * Scaffolds a fresh project from the in-tree CLI bundle into a temp dir and
 * asserts the scaffold succeeded. This exists to catch the class of regression
 * the doc-drift gate structurally cannot — e.g. `packageRoot()` resolving to a
 * `bin.sailor` package that ships no `templates/`, which made `init` fail from a
 * monorepo checkout with "Template ... not found. Available: none".
 *
 * It runs the REAL built bundle from a monorepo layout, which is exactly the
 * in-tree path that broke before. Pure Node + child_process; the only build
 * dependency is the CLI bundle (`pnpm --filter sailor build`).
 *
 * Run:  node scripts/check-init.mjs   (CI builds the CLI first)
 * Exit: 0 = scaffold OK, 1 = failure (prints what was missing).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = path.join(ROOT, "packages/cli/dist/index.cjs");
const PROJECT = "smoke-agent";

function fail(msg) {
  console.error(`✗ init smoke test FAILED: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(BUNDLE)) {
  fail(`CLI bundle not found at ${BUNDLE}.\n  Build it first: pnpm --filter sailor build`);
}

// Scaffold into a temp dir. `init` requires the destination to live inside the
// process cwd, so we run the bundle with cwd set to a fresh temp root.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-init-smoke-"));
const dest = path.join(tmpRoot, PROJECT);

try {
  let stdout = "";
  try {
    stdout = execFileSync(process.execPath, [BUNDLE, "init", PROJECT], {
      cwd: tmpRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    fail(`\`sailor init ${PROJECT}\` exited non-zero.\n  ${out || err.message}`);
  }

  // A successful fresh init prints the AGENTS.md onboarding banner.
  if (!/AGENTS\.md/i.test(stdout)) {
    fail(`init did not report success.\n  stdout: ${stdout.trim()}`);
  }

  // Assert the scaffold landed.
  const mustExist = [
    ".sail/config.json",
    "package.json",
    "foundry.toml",
    "mandates",
    "AGENTS.md",
    ".sail/contracts/interfaces/IPermission.sol",
    ".sail/contracts/interfaces/IBatchPermission.sol",
    "test/BoundedCallPermission.t.sol",
    "examples/custom-mandate/README.md",
    ".agents/skills/sail-onboarding/SKILL.md",
    ".agents/skills/sail-project-info/SKILL.md",
    ".agents/skills/sail-servers/SKILL.md",
    ".agents/skills/sail-transactions/SKILL.md",
    ".agents/skills/sail-mandates/SKILL.md",
    ".agents/skills/sail-mandates/references/approvals.md",
    ".agents/skills/sail-ci/SKILL.md",
    ".agents/skills/sail-extend/SKILL.md",
  ];
  for (const rel of mustExist) {
    if (!fs.existsSync(path.join(dest, rel))) fail(`expected scaffolded "${rel}" — not found`);
  }

  // config.json is valid JSON named after the project.
  const config = JSON.parse(fs.readFileSync(path.join(dest, ".sail/config.json"), "utf-8"));
  if (config.name !== PROJECT) fail(`config.json name is "${config.name}", expected "${PROJECT}"`);

  // package.json is valid, renamed, and the workspace protocol was resolved away
  // (a leftover "workspace:*" would make the scaffold un-installable for users).
  const pkg = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf-8"));
  if (pkg.name !== PROJECT) fail(`package.json name is "${pkg.name}", expected "${PROJECT}"`);
  if (pkg.dependencies?.["@sail/sdk"] === "workspace:*") {
    fail(`package.json still has "@sail/sdk": "workspace:*" — init did not resolve it`);
  }

  // Regression guard: an absolute path outside the cwd must be REJECTED, not
  // silently nested into `<cwd>/<abs path>`. (Pre-fix, `path.join` swallowed the
  // leading slash and scaffolded a bogus nested tree while printing success.)
  const outside = path.join(os.tmpdir(), "sailor-init-outside", "agent");
  let rejected = false;
  try {
    execFileSync(process.execPath, [BUNDLE, "init", outside], {
      cwd: tmpRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    rejected = true; // non-zero exit = correctly refused
  }
  if (!rejected) fail(`an absolute path outside cwd ("${outside}") was accepted — should be rejected`);
  if (fs.existsSync(path.join(outside, ".sail/config.json"))) {
    fail(`init scaffolded into an out-of-cwd absolute path "${outside}"`);
  }

  console.log(`✓ init smoke test passed — scaffolded ${PROJECT}/ from the in-tree bundle`);
  console.log("✓ init guard passed — absolute path outside cwd rejected, not silently nested");
} finally {
  fs.rmSync(path.join(os.tmpdir(), "sailor-init-outside"), { recursive: true, force: true });
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
