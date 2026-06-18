import fs from "node:fs";
import path from "node:path";
import { packageRoot } from "../lib/packagePaths.js";
import { copyDirSync, copyDirSyncIfMissing } from "../lib/template.js";

// Files and directories from templates/default that are always re-synced on update.
// User-space files (AGENTS.md, CLAUDE.md, Dockerfile, src/, package.json, etc.) are
// never overwritten — they are seeded once via copyDirSyncIfMissing if missing.
const UPDATE_PATHS = [
  ".agents",       // all sail-* skills
  ".cursor",       // cursor IDE rules
  ".env.example",  // documents env vars; not meant to be edited directly
];

// Paths removed or renamed in past template versions. Deleted on update if present.
const STALE_PATHS = [
  ".agents/skills/sail-ci", // renamed to sail-automation
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

  // Prune stale paths from past template versions.
  const removed: string[] = [];
  for (const p of STALE_PATHS) {
    const target = path.join(dest, p);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(p);
    }
  }

  // Always re-sync template-owned paths.
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

  // Seed any template files that are missing from the project (user-space files).
  const added: string[] = [];
  copyDirSyncIfMissing(templateSrc, dest, added);

  if (removed.length === 0 && updated.length === 0 && added.length === 0) {
    console.log("Nothing to update.");
    return;
  }

  if (removed.length > 0) {
    console.log(`\nRemoved stale files:`);
    for (const p of removed) console.log(`  ${p}`);
  }

  if (updated.length > 0) {
    console.log(`\nUpdated from template:`);
    for (const p of updated) console.log(`  ${p}`);
  }

  if (added.length > 0) {
    console.log(`\nAdded (new in template):`);
    for (const p of added) console.log(`  ${p}`);
  }

  console.log();
}
