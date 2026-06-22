import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type ReleaseAsset,
  downloadAsset,
  getReleaseByTag,
  parseReleaseRef,
} from "../lib/github.js";
import { prompt, readJsonFile } from "../lib/io.js";
import { emit } from "../lib/output.js";
import { scaffoldProjectWorkspace } from "../lib/project-scaffold.js";
import type { ShareManifest } from "../lib/share.js";

/**
 * `sailor replicate <release-url|owner/repo@tag> [dir]` — pull a published
 * project's release asset, extract it, and rebuild the local secret-bearing
 * workspace the template deliberately omits. It never injects secrets: it sets
 * up empty `.sail/{keys,runtime,state}` + env templates and points the user at
 * `sailor keys generate` / `sailor onboard` to supply their own.
 */

export interface ReplicateOptions {
  rpcUrl?: string;
  chain?: string;
  force?: boolean;
  yes?: boolean;
  json?: boolean;
}

/** Pick the project archive asset: an explicitly named one, else first tar.gz/zip. */
function pickAsset(assets: ReleaseAsset[], named?: string): ReleaseAsset {
  if (named) {
    const hit = assets.find((a) => a.name === named);
    if (!hit) throw new Error(`Release has no asset named "${named}".`);
    return hit;
  }
  const archive = assets.find((a) => a.name.endsWith(".tar.gz") || a.name.endsWith(".zip"));
  if (!archive) throw new Error("Release has no .tar.gz or .zip asset to replicate.");
  return archive;
}

/** Extract an archive into `dest` using the platform `tar`/`unzip`. */
function extractArchive(archivePath: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  if (archivePath.endsWith(".zip")) {
    execFileSync("unzip", ["-q", archivePath, "-d", dest], { stdio: "inherit" });
  } else {
    execFileSync("tar", ["-xzf", archivePath, "-C", dest], { stdio: "inherit" });
  }
}

/**
 * The archive may contain the project at its root or nested in a single top
 * folder (some zippers wrap). Resolve to the actual project root by finding the
 * directory that holds `.sail/`.
 */
function findProjectRoot(extractDir: string): string {
  if (fs.existsSync(path.join(extractDir, ".sail"))) return extractDir;
  const entries = fs
    .readdirSync(extractDir, { withFileTypes: true })
    .filter((e) => e.isDirectory());
  for (const e of entries) {
    const candidate = path.join(extractDir, e.name);
    if (fs.existsSync(path.join(candidate, ".sail"))) return candidate;
  }
  throw new Error("Downloaded archive does not look like a Sailor project (no .sail/ found).");
}

export async function replicate(
  input: string | undefined,
  dir: string | undefined,
  options: ReplicateOptions = {},
): Promise<void> {
  if (!input) {
    throw new Error("Usage: sailor replicate <release-url|owner/repo@tag> [dir]");
  }
  const interactive = !options.yes && !options.json;

  // 1. Resolve the release + asset.
  const ref = parseReleaseRef(input);
  const release = await getReleaseByTag(ref.repo, ref.tag);
  const asset = pickAsset(release.assets, ref.asset);

  // 2. Decide the target dir. Default = slug derived from the tag.
  const slug = ref.tag.replace(/-v\d+$/i, "");
  const target = path.resolve(process.cwd(), dir ?? slug);
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0 && !options.force) {
    throw new Error(
      `Target "${target}" exists and is not empty. Pass --force to replicate into it.`,
    );
  }

  // 3. Download + extract into a temp dir, then move the project root to target.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-replicate-"));
  try {
    // Prefer the public browser_download_url — those hits increment the asset's
    // download_count (the per-project metric). Fall back to the asset API URL,
    // which works on private repos but does NOT increment the counter.
    let buf: Buffer;
    try {
      buf = await downloadAsset(asset.downloadUrl);
    } catch {
      buf = await downloadAsset(asset.apiUrl);
    }
    const archivePath = path.join(tmp, asset.name);
    fs.writeFileSync(archivePath, buf);

    const extractDir = path.join(tmp, "x");
    extractArchive(archivePath, extractDir);
    const projectRoot = findProjectRoot(extractDir);

    // 4. Validate it's a shared project.
    const manifest = readJsonFile<ShareManifest>(path.join(projectRoot, ".sail", "share.json"));
    if (!manifest) throw new Error("Archive is missing .sail/share.json — not a shared project.");

    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(projectRoot, target, { recursive: true, force: true });

    // 5. Rebuild the local workspace (keys/runtime/state + env templates).
    let chain = options.chain;
    let rpcUrl = options.rpcUrl;
    if (interactive && !chain && Array.isArray(manifest.chains) && manifest.chains.length > 0) {
      chain = await prompt("Chain id to run on", String(manifest.chains[0]));
    }
    if (interactive && !rpcUrl) {
      const r = await prompt("RPC URL (leave blank to set later in .sail/.env.local)", "");
      rpcUrl = r || undefined;
    }
    scaffoldProjectWorkspace(
      target,
      path.basename(target),
      { chain, rpcUrl },
      /* preserveConfig */ true,
    );

    emit(
      options.json,
      () => {
        console.log(
          `\n✓ Replicated "${manifest.name}" into ${path.relative(process.cwd(), target) || "."}/`,
        );
        console.log(`  source: ${ref.repo}@${release.tag} (${asset.name}, ${asset.downloadUrl})`);
        console.log("\nNext — supply your own secrets (none were copied):");
        console.log(`  1. cd ${path.relative(process.cwd(), target) || "."}`);
        console.log("  2. Set RPC in .sail/.env.local (if not set above)");
        console.log("  3. sailor keys generate");
        console.log("  4. sailor onboard");
      },
      {
        status: "ok",
        repo: ref.repo,
        tag: release.tag,
        asset: asset.name,
        target,
        manifest,
      },
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
