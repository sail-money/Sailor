import fs from "node:fs";
import path from "node:path";

/**
 * Directory containing the executing CLI bundle (packages/cli/dist/).
 *
 * In an esbuild CJS bundle import.meta.url is undefined, so we rely on
 * process.argv[1] which always holds the absolute path to the running script
 * regardless of how it was invoked (node, npx, pnpm exec, global bin).
 */
export function cliDistDir(): string {
  return path.dirname(path.resolve(process.argv[1]));
}

/**
 * Sailor package root — the directory that contains `templates/` and `packages/`.
 *
 * Walks up from cliDistDir() until it finds a directory with a `templates/`
 * subdirectory, falling back to three levels up (the layout used in both the
 * monorepo checkout and the published npm package).
 *
 * Monorepo checkout:  .../sailor/packages/cli/dist → .../sailor/
 * npm install:        .../node_modules/sailor/packages/cli/dist → .../node_modules/sailor/
 * tsx dev invocation: .../sailor/packages/cli/src → walks up to .../sailor/
 */
export function packageRoot(): string {
  let dir = cliDistDir();
  for (let depth = 0; depth < 6; depth++) {
    if (fs.existsSync(path.join(dir, "templates"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(cliDistDir(), "../../..");
}
