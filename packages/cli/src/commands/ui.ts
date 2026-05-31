import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cliDistDir } from "../lib/packagePaths.js";

/**
 * `sailor ui` — serves the UI via the bundled Express server.
 *
 * Path layout (works in both the monorepo and an installed npm package):
 *   packages/cli/dist/index.cjs   ← this bundle
 *   packages/cli/dist/server.cjs  ← bundled UI server
 *   packages/ui/dist/             ← pre-built static UI assets
 */
export async function uiCommand(): Promise<void> {
  const distDir = cliDistDir();
  const uiDistDir = path.resolve(distDir, "../../ui/dist");
  const serverBundle = path.resolve(distDir, "server.cjs");
  const sailDir = path.join(process.cwd(), ".sail");

  if (!fs.existsSync(serverBundle)) {
    throw new Error(`Server bundle not found at ${serverBundle}. Re-run the sailor build.`);
  }
  if (!fs.existsSync(path.join(uiDistDir, "index.html"))) {
    throw new Error(`UI dist not found at ${uiDistDir}. Re-run the sailor build.`);
  }

  spawn("node", [serverBundle], {
    stdio: "inherit",
    env: { ...process.env, SAIL_DIR: sailDir, SERVE_DIST: "1", PORT: "3333", SAILOR_UI_DIST: uiDistDir },
  });

  console.log("Sailor UI running at http://localhost:3333");

  const shutdown = () => process.exit(0);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
