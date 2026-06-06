// @ts-check
/**
 * Post-install script for the Sailor package.
 *
 * Runs automatically after `npm install` / `pnpm add`. Does two things:
 *   1. sailor init — scaffold the .sail/ workspace (skipped if already done)
 *   2. Print the one-line handoff banner directing the user to their AI assistant
 *
 * The UI and browser launch that previously ran here have been removed.
 * The chat (AGENTS.md) owns the welcome — the terminal just directs traffic.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// Directory where the user ran `npm install` / `pnpm add`
const initCwd = process.env.INIT_CWD || process.cwd();
const TAG = "[sailor]";

// ── Skip conditions ──────────────────────────────────────────────────────────

// Never run inside the Sailor monorepo itself
if (fs.existsSync(path.join(initCwd, "pnpm-workspace.yaml"))) process.exit(0);

// Opt-out env var
if (process.env.SAILOR_SKIP_INIT === "1") process.exit(0);

const cliBundle = path.join(__dirname, "..", "packages", "cli", "dist", "index.cjs");

if (!fs.existsSync(cliBundle)) {
  console.warn(`${TAG} CLI bundle not found — skipping postinstall.`);
  process.exit(0);
}

// ── Step 1: scaffold — run sailor init if not already done ───────────────────

const configExists = fs.existsSync(path.join(initCwd, ".sail", "config.json"));

if (!configExists) {
  try {
    execFileSync(process.execPath, [cliBundle, "init"], {
      cwd: initCwd,
      stdio: "inherit",
    });
  } catch {
    // sailor init failed or was interrupted — user can run it manually
    console.warn(`${TAG} sailor init exited with an error. Run \`sailor init\` manually to complete setup.`);
  }
}

// ── Done — direct the user to their AI assistant ─────────────────────────────

console.log("\nYour Sail agent project is ready. Open your AI coding assistant in this folder and say start.");
