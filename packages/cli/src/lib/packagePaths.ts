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
 * Sailor package root — the directory that declares the sailor bin AND ships the
 * scaffolding assets (`templates/`).
 *
 * Walks up from cliDistDir() collecting every package.json with `bin.sailor`
 * (resilient to any scope/org: @sailagent/sailor, @sail/sailor, sailor, …) and
 * returns the first one that ALSO contains a `templates/` directory — because
 * that is the root the scaffolder reads from. In a monorepo checkout the inner
 * `packages/cli/package.json` also declares `bin.sailor` but ships no templates,
 * so we must keep walking past it to the repo root; a published install collapses
 * to a single package root that has both. Falls back to the first bin match (then
 * the conventional ../../.. ) when no candidate ships templates.
 *
 * Monorepo checkout:  .../sailor/packages/cli/dist → .../sailor/        (skips packages/cli — no templates/)
 * npm install:        .../node_modules/@org/sailor/packages/cli/dist → .../node_modules/@org/sailor/
 * tsx dev invocation: .../sailor/packages/cli/src → walks up to .../sailor/
 */
export function packageRoot(): string {
  let dir = cliDistDir();
  let firstBinMatch: string | null = null;
  for (let depth = 0; depth < 6; depth++) {
    const pkgFile = path.join(dir, "package.json");
    if (fs.existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf-8")) as { bin?: Record<string, string> };
        if (pkg.bin?.sailor) {
          if (firstBinMatch === null) firstBinMatch = dir;
          // Prefer the package root that actually ships the scaffolding templates.
          if (fs.existsSync(path.join(dir, "templates"))) return dir;
        }
      } catch { /* keep walking */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return firstBinMatch ?? path.resolve(cliDistDir(), "../../..");
}
