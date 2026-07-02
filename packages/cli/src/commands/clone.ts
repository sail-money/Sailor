import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type ReleaseAsset,
  downloadAsset,
  getReleaseByTag,
  parseReleaseRef,
} from "../lib/github.js";
import { auditClonedProject, safeExtract } from "../lib/clone-safety.js";
import { confirm, prompt, readJsonFile } from "../lib/io.js";
import { emit } from "../lib/output.js";
import { scaffoldProjectWorkspace } from "../lib/project-scaffold.js";
import { injectCoreReferenceAssets } from "../lib/reference-assets.js";
import type { ShareManifest } from "../lib/share.js";

/**
 * `sailor clone <source> [dir]` — recreate a shared project locally. `source`
 * is either a release reference (owner/repo@tag, release/asset URL) or a path to
 * a local archive produced by `sailor share --local`. The project is extracted,
 * the secret-bearing workspace the template omits is rebuilt, and the core Sailor
 * reference material `share` strips is re-injected from the installed package.
 *
 * It never injects secrets: it sets up empty `.sail/{keys,runtime,state}` + env
 * templates and points the user at `sailor keys generate` / `sailor onboard`.
 */

export interface CloneOptions {
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
  if (!archive) throw new Error("Release has no .tar.gz or .zip asset to clone.");
  return archive;
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
  throw new Error("Archive does not look like a Sailor project (no .sail/ found).");
}

/** True if `input` points at an existing local archive file rather than a release ref. */
function isLocalArchive(input: string): boolean {
  return /\.(tar\.gz|tgz|zip)$/i.test(input) && fs.existsSync(input) && fs.statSync(input).isFile();
}

export async function clone(
  input: string | undefined,
  dir: string | undefined,
  options: CloneOptions = {},
): Promise<void> {
  if (!input) {
    throw new Error("Usage: sailor clone <release-url|owner/repo@tag|local-archive> [dir]");
  }
  const interactive = !options.yes && !options.json;
  const local = isLocalArchive(input);

  // Resolve the archive: a local file, or a downloaded release asset.
  let assetName: string;
  let sourceLabel: string;
  let release: Awaited<ReturnType<typeof getReleaseByTag>> | null = null;
  let asset: ReleaseAsset | null = null;
  let slug: string;

  if (local) {
    assetName = path.basename(input);
    sourceLabel = path.resolve(input);
    slug = assetName.replace(/\.(tar\.gz|tgz|zip)$/i, "").replace(/-v\d+$/i, "");
  } else {
    const ref = parseReleaseRef(input);
    release = await getReleaseByTag(ref.repo, ref.tag);
    asset = pickAsset(release.assets, ref.asset);
    assetName = asset.name;
    sourceLabel = `${ref.repo}@${release.tag}`;
    slug = ref.tag.replace(/-v\d+$/i, "");
  }

  const target = path.resolve(process.cwd(), dir ?? slug);
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0 && !options.force) {
    throw new Error(`Target "${target}" exists and is not empty. Pass --force to clone into it.`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-clone-"));
  try {
    const archivePath = path.join(tmp, assetName);
    if (local) {
      fs.copyFileSync(input, archivePath);
    } else if (asset) {
      // Prefer the public browser_download_url — those hits increment the asset's
      // download_count (the per-project metric). Fall back to the asset API URL,
      // which works on private repos but does NOT increment the counter.
      let buf: Buffer;
      try {
        buf = await downloadAsset(asset.downloadUrl);
      } catch {
        buf = await downloadAsset(asset.apiUrl);
      }
      fs.writeFileSync(archivePath, buf);
    }

    const extractDir = path.join(tmp, "x");
    safeExtract(archivePath, extractDir); // zip-slip / symlink / size guards
    const projectRoot = findProjectRoot(extractDir);

    const manifest = readJsonFile<ShareManifest>(path.join(projectRoot, ".sail", "share.json"));
    if (!manifest) throw new Error("Archive is missing .sail/share.json — not a shared project.");

    // Untrusted-code review: a shared project is a stranger's code that, once
    // onboarded, can move YOUR funds. Surface hardcoded addresses (a hostile
    // mandate routes funds to the attacker) and npm lifecycle scripts (auto-run
    // on `npm install`), and require sign-off before writing it to disk.
    const audit = auditClonedProject(projectRoot);
    const warn = (): void => {
      console.log("\n⚠  This is UNTRUSTED code. Review before you onboard/run — it can move funds.");
      if (audit.lifecycleScripts.length > 0) {
        console.log(`\n  npm lifecycle scripts (run on \`npm install\`):`);
        for (const s of audit.lifecycleScripts) console.log(`    ${s.script}: ${s.command}`);
      }
      if (audit.addresses.length > 0) {
        console.log(`\n  ${audit.addresses.length} hardcoded address(es) in mandates/src/test —`);
        console.log("  verify NONE redirects funds to a stranger (recipient/spender/router):");
        for (const a of audit.addresses) console.log(`    ${a}`);
      }
      if (!audit.lifecycleScripts.length && !audit.addresses.length) {
        console.log("  No lifecycle scripts or hardcoded addresses found (still review the strategy).");
      }
    };
    if (interactive) {
      warn();
      const ok = await confirm("\nClone this project to disk?");
      if (!ok) {
        console.log("Aborted.");
        return;
      }
    }

    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(projectRoot, target, { recursive: true, force: true });

    // Rebuild the local workspace (keys/runtime/state + env templates).
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

    // Re-inject the core Sailor reference material that `share` strips, from the
    // installed package, so the cloned project is complete. Operator files win.
    const reAdded = injectCoreReferenceAssets(target);

    emit(
      options.json,
      () => {
        console.log(
          `\n✓ Cloned "${manifest.name}" into ${path.relative(process.cwd(), target) || "."}/`,
        );
        console.log(`  source: ${sourceLabel} (${assetName})`);
        console.log(`  restored ${reAdded.length} core Sailor reference file(s) from the package`);
        console.log("\nNext — supply your own secrets (none were copied):");
        console.log(`  1. cd ${path.relative(process.cwd(), target) || "."}`);
        console.log("  2. Set RPC in .sail/.env.local (if not set above)");
        console.log("  3. sailor keys generate");
        console.log("  4. sailor onboard");
      },
      {
        status: "ok",
        source: sourceLabel,
        local,
        asset: assetName,
        target,
        restored: reAdded.length,
        audit,
        manifest,
      },
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
