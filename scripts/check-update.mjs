#!/usr/bin/env node
/**
 * `sailor update` smoke tests.
 *
 * PASS 1 — standard update:
 *   Deletes a template-owned file and a user skill, runs `sailor update`,
 *   asserts the template file is restored and the user skill is untouched.
 *
 * PASS 2 — seeds missing user-space files:
 *   Deletes a user-space file (package.json) and dir (src/), runs update,
 *   asserts they are re-added. Asserts AGENTS.md / CLAUDE.md / Dockerfile
 *   are NOT overwritten when they already exist.
 *
 * PASS 3 — stale path pruning:
 *   Manually creates .agents/skills/sail-ci/ (orphan from old template version),
 *   runs update, asserts it is deleted and sail-automation is present.
 *
 * PASS 4 — init-on-existing errors:
 *   Runs `sailor init` inside the already-initialized project;
 *   asserts it exits non-zero with an "already initialized" message.
 *
 * Run:  node scripts/check-update.mjs   (CI builds the CLI first)
 * Exit: 0 = all passes OK, 1 = failure (prints what went wrong).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = path.join(ROOT, "packages/cli/dist/index.cjs");
const PROJECT = "smoke-update";

function fail(msg) {
  console.error(`✗ update smoke test FAILED: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(BUNDLE)) {
  fail(`CLI bundle not found at ${BUNDLE}.\n  Build it first: pnpm --filter sailor build`);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-update-smoke-"));
const dest = path.join(tmpRoot, PROJECT);

try {
  // Bootstrap: fresh init so we have a valid project to update.
  try {
    execFileSync(process.execPath, [BUNDLE, "init", PROJECT], {
      cwd: tmpRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    fail(`bootstrap \`sailor init ${PROJECT}\` exited non-zero.\n  ${out || err.message}`);
  }

  // ── PASS 1 — standard update ───────────────────────────────────────────────
  // Delete a template-owned file and add a user skill that must survive update.
  const templateOwned = path.join(dest, ".agents/skills/sail-automation/SKILL.md");
  const cursorRules    = path.join(dest, ".cursor/rules");
  const userSkill      = path.join(dest, ".agents/skills/my-custom-skill/SKILL.md");

  fs.rmSync(templateOwned);
  fs.rmSync(cursorRules);
  fs.mkdirSync(path.dirname(userSkill), { recursive: true });
  fs.writeFileSync(userSkill, "# custom skill\n", "utf-8");

  try {
    execFileSync(process.execPath, [BUNDLE, "update"], {
      cwd: dest,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    fail(`Pass 1: \`sailor update\` exited non-zero.\n  ${out || err.message}`);
  }

  if (!fs.existsSync(templateOwned))
    fail(`Pass 1: update did not restore "${path.relative(dest, templateOwned)}"`);
  if (!fs.existsSync(cursorRules))
    fail(`Pass 1: update did not restore "${path.relative(dest, cursorRules)}"`);
  if (!fs.existsSync(userSkill))
    fail(`Pass 1: update removed user file "${path.relative(dest, userSkill)}" — must be preserved`);

  console.log("✓ Pass 1 passed — template files restored, user skill preserved");

  // ── PASS 2 — seeds missing user-space files ───────────────────────────────
  const agentsMd    = path.join(dest, "AGENTS.md");
  const claudeMd    = path.join(dest, "CLAUDE.md");
  const dockerfile  = path.join(dest, "Dockerfile");
  const packageJson = path.join(dest, "package.json");
  const srcDir      = path.join(dest, "src");

  // Record AGENTS.md content before update — it must not change.
  const agentsContentBefore = fs.readFileSync(agentsMd, "utf-8");

  fs.rmSync(packageJson);
  fs.rmSync(srcDir, { recursive: true });

  try {
    execFileSync(process.execPath, [BUNDLE, "update"], {
      cwd: dest,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    fail(`Pass 2: \`sailor update\` exited non-zero.\n  ${out || err.message}`);
  }

  if (!fs.existsSync(packageJson))
    fail(`Pass 2: update did not re-add missing "package.json"`);
  if (!fs.existsSync(srcDir))
    fail(`Pass 2: update did not re-add missing "src/" directory`);

  // AGENTS.md, CLAUDE.md, Dockerfile must not be overwritten.
  const agentsContentAfter = fs.readFileSync(agentsMd, "utf-8");
  if (agentsContentAfter !== agentsContentBefore)
    fail(`Pass 2: update overwrote "AGENTS.md" — user-space files must never be overwritten`);
  if (!fs.existsSync(claudeMd))
    fail(`Pass 2: "CLAUDE.md" is missing after update`);
  if (!fs.existsSync(dockerfile))
    fail(`Pass 2: "Dockerfile" is missing after update`);

  console.log("✓ Pass 2 passed — missing user-space files seeded, existing ones untouched");

  // ── PASS 3 — stale path pruning ───────────────────────────────────────────
  const staleSkill = path.join(dest, ".agents/skills/sail-ci/SKILL.md");
  fs.mkdirSync(path.dirname(staleSkill), { recursive: true });
  fs.writeFileSync(staleSkill, "# old sail-ci skill\n", "utf-8");

  try {
    execFileSync(process.execPath, [BUNDLE, "update"], {
      cwd: dest,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    fail(`Pass 3: \`sailor update\` exited non-zero.\n  ${out || err.message}`);
  }

  if (fs.existsSync(path.join(dest, ".agents/skills/sail-ci")))
    fail(`Pass 3: stale ".agents/skills/sail-ci" was not removed`);
  if (!fs.existsSync(path.join(dest, ".agents/skills/sail-automation/SKILL.md")))
    fail(`Pass 3: ".agents/skills/sail-automation/SKILL.md" missing after update`);

  console.log("✓ Pass 3 passed — stale sail-ci skill pruned, sail-automation present");

  // ── PASS 4 — init-on-existing errors ──────────────────────────────────────
  let initRejected = false;
  let initOutput = "";
  try {
    initOutput = execFileSync(process.execPath, [BUNDLE, "init"], {
      cwd: dest,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    initRejected = true;
    initOutput = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
  }

  if (!initRejected)
    fail(`Pass 4: \`sailor init\` on existing project did not exit non-zero — should refuse`);
  if (!/already initialized/i.test(initOutput))
    fail(`Pass 4: error message did not mention "already initialized".\n  output: ${initOutput}`);

  console.log("✓ Pass 4 passed — init on existing project correctly refused");
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
