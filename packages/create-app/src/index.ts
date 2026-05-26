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

const name = process.argv[2] ?? "my-sailor-agent";

const result = spawnSync("sailor", ["init", name], { stdio: "inherit", shell: true });

process.exit(result.status ?? 0);
