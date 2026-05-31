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
 * Sailor package root — two directories above packages/cli/dist/.
 *
 * Monorepo checkout:  .../sailor/packages/cli/dist → .../sailor/
 * npm install:        .../node_modules/sailor/packages/cli/dist → .../node_modules/sailor/
 */
export function packageRoot(): string {
  return path.resolve(cliDistDir(), "../../..");
}
