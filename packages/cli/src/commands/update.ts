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
// Note: UPDATE_PATHS re-sync (copyDirSync) only copies files that exist in the current
// template — it never deletes a destination file/dir that the template no longer ships.
// So a path removed from templates/default (even one under .agents/) needs an explicit
// entry here, or it lingers in already-scaffolded projects forever.
const STALE_PATHS = [
  ".agents/skills/sail-ci", // renamed to sail-automation
  ".agents/skills/sail-mandates/references/examples-index.md", // retired with examples/permissions/
  "examples/permissions", // retired per-protocol gallery — see sail-mandates/references/authoring-patterns.md
  "test/BoundedCallPermission.t.sol", // moved to examples/custom-mandate/test/BoundedCallPermission.t.sol
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

  // Re-detect install mode and update config.json if it changed.
  const configPath = path.join(dest, ".sail", "config.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
      installMode?: string;
      containerName?: string;
      [key: string]: unknown;
    };
    const newMode = process.env.SAILOR_INSTALL_MODE === "docker" ? "docker" : "local";
    const _rawContainerName = process.env.SAILOR_CONTAINER_NAME ?? "agent";
    const containerName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(_rawContainerName) ? _rawContainerName : "agent";
    if (config.installMode !== newMode) {
      const previousMode = config.installMode;
      const previousContainer = config.containerName as string | undefined;
      config.installMode = newMode;
      if (newMode === "docker") {
        config.containerName = containerName;
      } else {
        delete config.containerName;
      }
      fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
      if (previousMode === "docker" && newMode === "local") {
        const prev = previousContainer ?? "agent";
        console.log(`\nSwitched to local install. If the Docker container is still running:`);
        console.log(`  docker stop ${prev}`);
        console.log(`You can restart it anytime with the standard docker run command.`);
      } else if (newMode === "docker") {
        console.log(`\nSwitched to Docker install (container: ${containerName}).`);
      }
    } else if (newMode === "docker" && config.containerName !== containerName) {
      config.containerName = containerName;
      fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
    }
  } catch {
    console.warn("Warning: could not update install mode in .sail/config.json");
  }

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
