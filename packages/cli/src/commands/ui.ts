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
 * `sailor ui` — starts the local data server and the Vite dev server.
 *
 * The Express server (packages/ui/server.js) reads project state from the
 * current working directory's `.sail/` folder and serves it on :3334.
 * Vite serves the UI on :3333 and proxies /api → :3334.
 */
export async function uiCommand(): Promise<void> {
  const packageDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = findWorkspaceRoot(packageDir);
  const uiDir = path.join(workspaceRoot, "packages", "ui");
  const sailDir = path.join(process.cwd(), ".sail");

  if (!fs.existsSync(uiDir)) {
    throw new Error(`UI package not found at ${uiDir}`);
  }

  const children: ChildProcess[] = [];

  // Local data server — reads the project's .sail/ directory.
  children.push(
    spawn("node", ["server.js"], {
      cwd: uiDir,
      stdio: "inherit",
      env: { ...process.env, SAIL_DIR: sailDir },
    }),
  );

  // Vite dev server on port 3333 (proxies /api to the data server).
  children.push(
    spawn("npx", ["vite", "--port", "3333"], {
      cwd: uiDir,
      stdio: "inherit",
    }),
  );

  console.log("Sailor UI running at http://localhost:3333");

  const shutdown = () => {
    for (const child of children) child.kill();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
