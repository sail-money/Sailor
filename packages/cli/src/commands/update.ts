import fs from "node:fs";
import path from "node:path";
import { packageRoot } from "../lib/packagePaths.js";
import { BLUEPRINT_MARKER } from "../lib/project-scaffold.js";
import { copyDirSync, copyDirSyncIfMissing } from "../lib/template.js";

// Files and directories from the shipped scaffold/ that are always re-synced on update.
// User-space files (AGENTS.md, CLAUDE.md, Dockerfile, src/, package.json, etc.) are
// never overwritten — they are seeded once via copyDirSyncIfMissing if missing.
const UPDATE_PATHS = [
  ".agents",       // all sailor-* skills
  ".cursor",       // cursor IDE rules
  ".env.example",  // documents env vars; not meant to be edited directly
  "soul.md",       // identity/voice — shipped, not user-tunable
];

// The subset of UPDATE_PATHS that is the *agent surface*: the blueprint's own skills and
// voice. A Harbor agent (marked by .sail/.blueprint) owns these, so `update` must not
// re-copy the stock scaffold over them. The rest (.cursor, .env.example) are tooling/env
// and still re-sync.
const AGENT_SURFACE_PATHS = new Set([".agents", "soul.md"]);

// Paths removed or renamed in past template versions. Deleted on update if present.
// Note: UPDATE_PATHS re-sync (copyDirSync) only copies files that exist in the current
// template — it never deletes a destination file/dir that the template no longer ships.
// So a path removed from the scaffold (even one under .agents/) needs an explicit
// entry here, or it lingers in already-scaffolded projects forever.
const STALE_PATHS = [
  ".agents/skills/sail-ci", // renamed to sailor-automation
  "examples/permissions", // retired per-protocol gallery — see sailor-mandates/references/authoring-patterns.md
  "examples/dca", // retired — the canonical agent loop now lives inline in the sailor-agent-build skill
  "test/BoundedCallPermission.t.sol", // moved to contracts/test/BoundedCallPermission.t.sol
  // A second, root-level Foundry workspace used to be scaffolded alongside contracts/ —
  // `sailor mandate deploy --build` compiled and read artifacts from THIS one, not the
  // one every skill told users to author and test in, so a tested edit in contracts/
  // could be silently deployed as its stale root copy. contracts/ is now the only
  // workspace; these are the retired root-level twin (foundry.toml, the pristine
  // example, and its vendored interfaces) — framework-owned files, never hand-authored.
  "foundry.toml",
  "mandates",
  ".sail/contracts",
  // All 19 skills renamed sail-* → sailor-*. Remove the whole old-named dir from existing
  // projects (this also removes the retired sail-mandates/references/examples-index.md).
  ".agents/skills/sail-onboarding",
  ".agents/skills/sail-project-info",
  ".agents/skills/sail-servers",
  ".agents/skills/sail-token-resolve",
  ".agents/skills/sail-swap-quote",
  ".agents/skills/sail-templates",
  ".agents/skills/sail-template-swap",
  ".agents/skills/sail-template-swap-no-oracle",
  ".agents/skills/sail-template-transfer",
  ".agents/skills/sail-template-withdraw",
  ".agents/skills/sail-template-deposit",
  ".agents/skills/sail-template-borrow",
  ".agents/skills/sail-template-approve-batch",
  ".agents/skills/sail-transactions",
  ".agents/skills/sail-mandates",
  ".agents/skills/sail-automation",
  ".agents/skills/sail-extend",
  ".agents/skills/sail-strategy",
  ".agents/skills/sail-mandate-planner",
];


export async function updateCommand(): Promise<void> {
  const dest = process.cwd();

  if (!fs.existsSync(path.join(dest, ".sail", "config.json"))) {
    throw new Error("Not a sailor project — .sail/config.json not found. Run `sailor init` first.");
  }

  const templateSrc = path.join(packageRoot(), "scaffold");

  if (!fs.existsSync(templateSrc)) {
    throw new Error(`Scaffold directory not found at ${templateSrc}`);
  }

  // One-time migration: the bespoke-permission Foundry workspace moved from
  // examples/custom-mandate/ to contracts/. It is user-editable and seed-once, so
  // never delete or overwrite it — move it, preserving every user edit. If the
  // project predates the move and has no contracts/ yet, rename it; if both exist,
  // leave both and warn. (examples/dca/ is pruned via STALE_PATHS below; the empty
  // examples/ directory is then removed by the empty-dir prune after pruning.)
  const migrated: string[] = [];
  const oldWorkspace = path.join(dest, "examples", "custom-mandate");
  const newWorkspace = path.join(dest, "contracts");
  if (fs.existsSync(oldWorkspace)) {
    if (fs.existsSync(newWorkspace)) {
      console.log(
        "\nWarning: both examples/custom-mandate/ and contracts/ exist — leaving both in place.\n" +
          "  The permission workspace now lives at contracts/; migrate any custom work manually.",
      );
    } else {
      fs.renameSync(oldWorkspace, newWorkspace);
      migrated.push("examples/custom-mandate → contracts");
    }
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

  // examples/ no longer ships (custom-mandate → contracts, dca → inline skeleton). Once its
  // contents are gone, remove the empty directory so migrated projects shed it entirely.
  const examplesDir = path.join(dest, "examples");
  if (fs.existsSync(examplesDir) && fs.readdirSync(examplesDir).length === 0) {
    fs.rmdirSync(examplesDir);
    removed.push("examples (empty)");
  }

  // A Harbor agent's surface (skills + voice) came from a blueprint, not the scaffold. When
  // the marker is present, `update` must not re-copy the stock scaffold over it.
  const isBlueprint = fs.existsSync(path.join(dest, BLUEPRINT_MARKER));
  const updatePaths = isBlueprint
    ? UPDATE_PATHS.filter((p) => !AGENT_SURFACE_PATHS.has(p))
    : UPDATE_PATHS;

  // Always re-sync template-owned paths.
  const updated: string[] = [];
  for (const p of updatePaths) {
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

  if (removed.length === 0 && updated.length === 0 && added.length === 0 && migrated.length === 0) {
    if (!isBlueprint) {
      console.log("Nothing to update.");
      return;
    }
    console.log("\nHarbor agent (.sail/.blueprint) — left the agent surface (.agents/, soul.md) as the blueprint shipped it.");
    console.log();
    return;
  }

  if (isBlueprint) {
    console.log("\nHarbor agent (.sail/.blueprint) — left the agent surface (.agents/, soul.md) as the blueprint shipped it.");
  }

  if (migrated.length > 0) {
    console.log(`\nMigrated:`);
    for (const p of migrated) console.log(`  ${p}`);
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
