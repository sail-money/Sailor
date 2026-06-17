import fs from "node:fs";
import path from "node:path";
import { packageRoot } from "../lib/packagePaths.js";
import { copyDirSync } from "../lib/template.js";

// Files and directories from templates/default that are always re-synced on update.
// Everything else in the template (src/, package.json, tsconfig.json, mandates/,
// test/, .sail/, .gitignore) is user-space and is never touched.
const UPDATE_PATHS = [
  ".agents",     // all sail-* skills; user skills absent from the template are preserved
  ".cursor",     // cursor IDE rules
  "AGENTS.md",
  "CLAUDE.md",
  "Dockerfile",
  ".env.example",
];

export async function updateCommand(): Promise<void> {
  const dest = process.cwd();

  if (!fs.existsSync(path.join(dest, ".sail", "config.json"))) {
    throw new Error("Not a sailor project — .sail/config.json not found. Run `sailor init` first.");
  }

  const templateSrc = path.join(packageRoot(), "templates", "default");

  if (!fs.existsSync(templateSrc)) {
    throw new Error(`Template directory not found at ${templateSrc}`);
  }

  const updated: string[] = [];

  for (const p of UPDATE_PATHS) {
    const src = path.join(templateSrc, p);
    const dst = path.join(dest, p);
    if (!fs.existsSync(src)) continue;

    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      copyDirSync(src, dst);
    } else {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
    updated.push(p);
  }

  if (updated.length === 0) {
    console.log("Nothing to update.");
    return;
  }

  console.log(`\nUpdated from template:`);
  for (const p of updated) console.log(`  ${p}`);
  console.log();
}
