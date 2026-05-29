import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function findWorkspaceRoot(from: string): string {
  let dir = from;
  for (let depth = 0; depth < 20; depth++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate pnpm-workspace.yaml — is this a Sailor monorepo checkout?");
}

/**
 * `sailor ui` — builds (if needed) and serves the UI via the Express server.
 *
 * The Express server (packages/ui/server.js) reads project state from the
 * current working directory's `.sail/` folder, serves the API on /api, and
 * serves the built UI from packages/ui/dist on /.
 */
export async function uiCommand(): Promise<void> {
  const packageDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = findWorkspaceRoot(packageDir);
  const uiDir = path.join(workspaceRoot, "packages", "ui");
  const sailDir = path.join(process.cwd(), ".sail");
  const distDir = path.join(uiDir, "dist");

  if (!fs.existsSync(uiDir)) {
    throw new Error(`UI package not found at ${uiDir}`);
  }

  // Build the UI if dist is missing or stale (src newer than dist/index.html).
  const distIndex = path.join(distDir, "index.html");
  const needsBuild = !fs.existsSync(distIndex) || (() => {
    try {
      const distMtime = fs.statSync(distIndex).mtimeMs;
      const srcMtime = fs.statSync(path.join(uiDir, "src")).mtimeMs;
      return srcMtime > distMtime;
    } catch { return true }
  })();

  if (needsBuild) {
    console.log("Building Sailor UI…");
    await new Promise<void>((resolve, reject) => {
      const build = spawn("npx", ["vite", "build"], { cwd: uiDir, stdio: "inherit" });
      build.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Build failed (exit ${code})`)));
    });
  }

  // Single server: API + static UI on port 3333.
  spawn("node", ["server.js"], {
    cwd: uiDir,
    stdio: "inherit",
    env: { ...process.env, SAIL_DIR: sailDir, SERVE_DIST: "1", PORT: "3333" },
  });

  console.log("Sailor UI running at http://localhost:3333");

  const shutdown = () => process.exit(0);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
