import fs from "node:fs";
import path from "node:path";

/**
 * Directory containing the executing CLI bundle (packages/cli/dist/).
 *
 * Uses fs.realpathSync to resolve bin symlinks before computing the directory.
 * On macOS/Linux, `npx sailor` executes the bin symlink and process.argv[1]
 * holds the symlink path (node_modules/.bin/sailor), not the real file.
 * On Windows, Node resolves symlinks before setting process.argv[1].
 */
export function cliDistDir(): string {
  try {
    return path.dirname(fs.realpathSync(process.argv[1]));
  } catch {
    return path.dirname(path.resolve(process.argv[1]));
  }
}

/**
 * Sailor package root — the directory whose package.json declares the sailor bin.
 *
 * Walks up from cliDistDir() until it finds a package.json with
 * `bin.sailor` defined. This is resilient to any package scope or org name
 * (@sailagent/sailor, @sail/sailor, sailor, etc.) and does not rely on
 * directory names like `templates/`.
 *
 * Monorepo checkout:  .../sailor/packages/cli/dist → .../sailor/
 * npm install:        .../node_modules/@org/sailor/packages/cli/dist → .../node_modules/@org/sailor/
 * tsx dev invocation: .../sailor/packages/cli/src → walks up to .../sailor/
 */
export function packageRoot(): string {
  let dir = cliDistDir();
  for (let depth = 0; depth < 6; depth++) {
    const pkgFile = path.join(dir, "package.json");
    if (fs.existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf-8")) as { bin?: Record<string, string> };
        if (pkg.bin?.sailor) return dir;
      } catch { /* keep walking */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(cliDistDir(), "../../..");
}
