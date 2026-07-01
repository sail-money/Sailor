import { rmSync } from "node:fs";

const targets = [
  "node_modules",
  "packages/sdk/node_modules",
  "packages/sdk/dist",
  "packages/sdk/tsconfig.tsbuildinfo",
  "packages/cli/node_modules",
  "packages/cli/dist",
  "packages/ui/node_modules",
  "packages/ui/dist",
];

for (const p of targets) {
  rmSync(p, { recursive: true, force: true });
  console.log(`  removed ${p}`);
}
