// publish-harbor.mjs — republish the portfolio blueprint to the harbor registry in
// one command. The harbor tarball and the npm dev package are two halves of the same
// release and must stay in sync: whenever the blueprint's skills/src/soul change,
// republish the tarball in the same breath as the npm dev publish.
//
//   pnpm run publish:harbor             # build the CLI + release portfolio-v<n>
//   pnpm run publish:harbor -- --local  # write the tarball to /tmp, no GitHub
//
// Token: SAIL_GH_TOKEN or GITHUB_TOKEN for the private sail-money/harbor registry;
// otherwise falls back to `gh auth token` (the machine's authenticated token).

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const blueprintDir = path.join(repoRoot, "blueprints", "portfolio-agent");
const cliBin = path.join(repoRoot, "packages", "cli", "dist", "index.cjs");

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: "inherit", env: process.env });
}

function token() {
  if (process.env.SAIL_GH_TOKEN) return process.env.SAIL_GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execSync("gh auth token", { encoding: "utf8" }).trim();
  } catch {
    throw new Error(
      "No token for the private sail-money/harbor registry. Set SAIL_GH_TOKEN, GITHUB_TOKEN, or run `gh auth login`.",
    );
  }
}

const local = process.argv.includes("--local");

if (!existsSync(path.join(blueprintDir, ".sail", "share.json"))) {
  throw new Error(`Missing ${blueprintDir}/.sail/share.json — is the blueprint factory intact?`);
}

// 1. Build the CLI so the release uses the current code (including the
//    uploads.github.com fix in lib/github.ts).
run("pnpm --filter ./packages/cli build", repoRoot);

// 2. Release from the blueprint factory. harborPublish packs process.cwd(), so the
//    CLI must run with the blueprint directory as its working directory.
const env = { ...process.env, SAIL_GH_TOKEN: token() };
const args = local ? "harbor publish --local --out /tmp/portfolio-blueprint.tar.gz" : "harbor publish --release";
execSync(`node ${cliBin} ${args}`, { cwd: blueprintDir, stdio: "inherit", env });

if (local) {
  const dest = path.join(tmpdir(), "portfolio-blueprint.tar.gz");
  // harbor publish --local already wrote to the requested --out path.
  console.log(`\nWrote ${dest}`);
}
