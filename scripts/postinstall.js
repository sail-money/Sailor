// @ts-check
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// Directory where the user ran `npm install` / `pnpm add`
const initCwd = process.env.INIT_CWD || process.cwd();

// Skip inside the Sailor monorepo itself (dev installs)
if (fs.existsSync(path.join(initCwd, "pnpm-workspace.yaml"))) process.exit(0);

// Skip if the user opted out
if (process.env.SAILOR_SKIP_INIT === "1") process.exit(0);

// Skip if the project is already initialized
if (fs.existsSync(path.join(initCwd, ".sail", "config.json"))) process.exit(0);

// __dirname = node_modules/sailor/scripts/ → go up one level to reach the package root
const cliBundle = path.join(__dirname, "..", "packages", "cli", "dist", "index.cjs");

if (!fs.existsSync(cliBundle)) {
  console.warn("[sailor] CLI bundle not found — skipping postinstall init.");
  process.exit(0);
}

console.log("[sailor] Running sailor init in", initCwd);
try {
  execFileSync(process.execPath, [cliBundle, "init"], {
    cwd: initCwd,
    stdio: "inherit",
  });
} catch {
  // Non-zero exit from init is not fatal — user can run sailor init manually
  console.warn("[sailor] sailor init exited with an error. Run `sailor init` manually to set up.");
  process.exit(0);
}
