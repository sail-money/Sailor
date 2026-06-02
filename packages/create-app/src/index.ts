#!/usr/bin/env node

/**
 * create-sailor-agent — scaffolds a new Sail Protocol agent.
 *
 * Usage: npx create-sailor-agent [name]
 *   name  Directory to create (default: "my-sailor-agent")
 *
 * Delegates to `sailor init` which must be installed (or available via pnpm workspace).
 */

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const initArgs = args.length > 0 ? args : ["my-sailor-agent"];
const bin = process.platform === "win32" ? "sailor.cmd" : "sailor";

const result = spawnSync(bin, ["init", ...initArgs], {
  stdio: "inherit",
  shell: false,
});

if (result.status === 0) {
  console.log("\n─────────────────────────────────────────────");
  console.log("  Project ready. You're already in the right place.");
  console.log("");
  console.log('  Say: "start"');
  console.log("─────────────────────────────────────────────");
}

process.exit(result.status ?? 0);
