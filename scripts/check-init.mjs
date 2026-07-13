#!/usr/bin/env node
/**
 * `sailor init` smoke test.
 *
 * PASS 1 — fresh init: scaffolds a new project and asserts expected files exist.
 *
 * Template files are read live from disk (not bundled), so no rebuild is needed
 * between runs — the in-tree scaffold/ IS the "latest version".
 *
 * Run:  node scripts/check-init.mjs   (CI builds the CLI first)
 * Exit: 0 = all passes OK, 1 = failure (prints what went wrong).
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
    "AGENTS.md",
    "soul.md",
    "CLAUDE.md",
    "Dockerfile",
    ".dockerignore",
    // contracts/ is the ONE Foundry workspace a project gets (no root-level twin —
    // `sailor mandate deploy --build` builds and reads artifacts from here).
    "contracts/foundry.toml",
    "contracts/mandates",
    "contracts/.sail/contracts/interfaces/IPermission.sol",
    "contracts/.sail/contracts/interfaces/IBatchPermission.sol",
    "contracts/test/BoundedCallPermission.t.sol",
    "contracts/README.md",
    ".agents/skills/sailor-onboarding/SKILL.md",
    ".agents/skills/sailor-project-info/SKILL.md",
    ".agents/skills/sailor-servers/SKILL.md",
    ".agents/skills/sailor-transactions/SKILL.md",
    ".agents/skills/sailor-agent-build/SKILL.md",
    ".agents/skills/sailor-mandates/SKILL.md",
    ".agents/skills/sailor-mandates/references/approvals.md",
    ".agents/skills/sailor-automation/SKILL.md",
    ".agents/skills/sailor-automation/references/docker-vm.md",
    ".agents/skills/sailor-automation/references/github-actions.md",
    ".agents/skills/sailor-automation/references/local-daemon.md",
    ".agents/skills/sailor-automation/references/self-hosted-runner.md",
    ".agents/skills/sailor-operate/SKILL.md",
    ".agents/skills/sailor-extend/SKILL.md",
  ];
  for (const rel of mustExist) {
    if (!fs.existsSync(path.join(dest, rel))) fail(`expected scaffolded "${rel}" — not found`);
  }

  // Regression guard: exactly ONE Foundry workspace. A second, root-level twin
  // used to be scaffolded here — `mandate deploy --build` compiled THAT one while
  // every skill sent users to author and test in contracts/, so a tested edit
  // could be silently deployed as a stale root copy. Assert the twin never comes back.
  const mustNotExist = ["foundry.toml", "mandates"];
  for (const rel of mustNotExist) {
    if (fs.existsSync(path.join(dest, rel))) {
      fail(`found root-level "${rel}" — a second Foundry workspace was scaffolded alongside contracts/`);
    }
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

  // ── Regression guard: absolute path outside cwd ───────────────────────────
  // An absolute path outside the cwd must be REJECTED, not silently nested into
  // `<cwd>/<abs path>`. (Pre-fix, `path.join` swallowed the leading slash and
  // scaffolded a bogus nested tree while printing success.)
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
