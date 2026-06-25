import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openPullRequest, resolveToken } from "../lib/github.js";
import { confirm, prompt, readJsonFile, sailPath, writeJsonFile } from "../lib/io.js";
import { emit } from "../lib/output.js";
import { packageRoot } from "../lib/packagePaths.js";
import {
  type ShareManifest,
  autoRedact,
  buildCleanCopy,
  collectSensitiveValues,
  findMissingRequiredFiles,
  renderPrBody,
  reviewSurface,
  scanForSecrets,
  slugify,
  validateManifest,
} from "../lib/share.js";

/**
 * `sailor share` — publish a sanitized copy of the current project. By default
 * it opens a PR into the community registry; with `--local` it instead writes a
 * portable .tar.gz so the project can be shared directly (no GitHub, no token)
 * and cloned with `sailor clone <file>`. Either way it strips all secrets +
 * sharer identity and enforces the compulsory metadata/contents gate.
 *
 * The GitHub token (PR mode only) is read from the environment only
 * (SAIL_GH_TOKEN / GITHUB_TOKEN) — same contract as `sailor trigger github`.
 */

const DEFAULT_REGISTRY = "sail-money/Dock";

export interface ShareOptions {
  repo?: string;
  base?: string;
  local?: boolean;
  out?: string;
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function cliVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot(), "package.json"), "utf-8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Load `.sail/share.json`, completing any missing compulsory fields by prompting
 * (unless --yes/--json, where incompleteness is a hard error). Writes the
 * completed manifest back so the next share is one step.
 */
async function resolveManifest(projectName: string, interactive: boolean): Promise<ShareManifest> {
  const manifestPath = sailPath("share.json");
  const existing = readJsonFile<Partial<ShareManifest>>(manifestPath) ?? {};

  const m: Partial<ShareManifest> = { ...existing };
  let errors = validateManifest(m);

  if (errors.length > 0 && interactive) {
    console.log("\nLet's complete the share manifest (.sail/share.json):\n");
    m.name = await prompt("Project title", m.name || projectName);
    m.summary = await prompt("One-line summary", m.summary);
    m.strategy = await prompt("Strategy — what does it do?", m.strategy);
    m.mandate = await prompt("Mandate — what permissions does it need, and why?", m.mandate);
    m.author = await prompt("Author (gh handle or email)", m.author);
    if (!m.chains || m.chains.length === 0) {
      const raw = await prompt("Target chain ids (comma-separated)", "8453");
      m.chains = raw
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
    }
    if (!m.tags) {
      const raw = await prompt("Tags (comma-separated, optional)", "");
      m.tags = raw
        ? raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    }
    m.description = await prompt("Longer description (optional)", m.description || m.summary);
    errors = validateManifest(m);
  }

  if (errors.length > 0) {
    throw new Error(
      `share.json is incomplete:\n  - ${errors.join("\n  - ")}\nFill .sail/share.json, or run without --yes/--json to be prompted.`,
    );
  }

  const manifest: ShareManifest = {
    name: (m.name ?? projectName).trim(),
    slug: m.slug && m.slug !== "" ? slugify(m.slug) : slugify(m.name ?? projectName),
    summary: (m.summary ?? "").trim(),
    description: (m.description ?? m.summary ?? "").trim(),
    strategy: (m.strategy ?? "").trim(),
    mandate: (m.mandate ?? "").trim(),
    chains: m.chains ?? [],
    tags: m.tags ?? [],
    author: (m.author ?? "").trim(),
    sailorVersion: cliVersion(),
    sharedAt: new Date().toISOString(),
  };

  writeJsonFile(manifestPath, manifest);
  return manifest;
}

export async function share(options: ShareOptions = {}): Promise<void> {
  const projectRoot = process.cwd();
  if (!fs.existsSync(path.join(projectRoot, ".sail", "config.json"))) {
    throw new Error("Not a Sailor project (no .sail/config.json). Run this from a project root.");
  }
  const interactive = !options.yes && !options.json;
  const repo = options.repo ?? DEFAULT_REGISTRY;
  const base = options.base ?? "main";
  const projectName = path.basename(projectRoot);

  // 1. Compulsory metadata + files gate (before any network/git work).
  const manifest = await resolveManifest(projectName, interactive);
  const missing = findMissingRequiredFiles(projectRoot);
  if (missing.length > 0) {
    throw new Error(`Project is missing compulsory contents:\n  - ${missing.join("\n  - ")}`);
  }

  // 2. Build the sanitized copy in a temp dir.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-share-"));
  const cleanDir = path.join(tmp, "clean");
  const files = buildCleanCopy(projectRoot, cleanDir);
  // Carry the manifest into the published folder.
  writeJsonFile(path.join(cleanDir, ".sail", "share.json"), manifest);

  // 3. Auto-redact identity + private endpoints from the files that ARE kept
  //    (src, docs, comments): the sharer's SMA/owner/manager addresses become the
  //    zero address, private RPC URLs become a placeholder, stray private-key hex
  //    is zeroed. The secret-bearing files were already dropped in step 2.
  const sensitive = collectSensitiveValues(projectRoot);
  const redactions = autoRedact(cleanDir, sensitive);
  const redactedCount = redactions.reduce((n, r) => n + r.count, 0);

  // 4. Residual scan — catch anything the redactor couldn't classify (e.g. a
  //    mnemonic). Only abort if something genuinely remains.
  const findings = scanForSecrets(cleanDir);
  if (findings.length > 0) {
    fs.rmSync(tmp, { recursive: true, force: true });
    const lines = findings.map((f) => `  ${f.file}:${f.line} — ${f.kind}`);
    throw new Error(
      `Refusing to share: possible secrets remain after auto-redaction:\n${lines.join("\n")}\nRemove or redact these manually, then try again.`,
    );
  }

  // 4b. Human review surface — the things only the operator can clear: addresses
  //     that survived (a public protocol contract and a personal payout address
  //     look identical to us) and binary files we can't scan (a screenshot could
  //     show an SMA). Shown always; confirmed interactively before publishing.
  const surface = reviewSurface(cleanDir);
  const printSurface = (): void => {
    if (surface.addresses.length > 0) {
      console.log(`\n⚠ ${surface.addresses.length} address(es) remain — confirm each is a PUBLIC`);
      console.log("  contract (token/router/pool), NOT a personal wallet/payout address:");
      for (const a of surface.addresses) console.log(`    ${a}`);
    }
    if (surface.binaries.length > 0) {
      console.log(`\n⚠ ${surface.binaries.length} binary/unscannable file(s) — review by hand`);
      console.log("  (an image/db can leak an SMA or balances the scanner can't see):");
      for (const b of surface.binaries) console.log(`    ${b}`);
    }
  };

  // 4c. Interactive sign-off on the review surface before any publish/write.
  if (
    interactive &&
    !options.dryRun &&
    (surface.addresses.length > 0 || surface.binaries.length > 0)
  ) {
    printSurface();
    const ok = await confirm("\nProceed? Confirm none of the above is sensitive");
    if (!ok) {
      fs.rmSync(tmp, { recursive: true, force: true });
      console.log("Aborted.");
      return;
    }
  }

  // 5a. Local mode — write a portable archive, no GitHub/token needed.
  if (options.local) {
    const out = path.resolve(process.cwd(), options.out ?? `${manifest.slug}.tar.gz`);
    if (options.dryRun) {
      fs.rmSync(tmp, { recursive: true, force: true });
      emit(
        options.json,
        () => {
          console.log(`\nDry run — would write ${files.length} files to ${out}\n`);
          for (const f of files) console.log(`  ${f}`);
          if (redactions.length > 0) console.log(`\nAuto-redacted ${redactedCount} value(s).`);
          printSurface();
        },
        {
          status: "dry-run",
          mode: "local",
          out,
          fileCount: files.length,
          files,
          redactions,
          review: surface,
          manifest,
        },
      );
      return;
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFileSync("tar", ["-czf", out, "-C", cleanDir, "."], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    fs.rmSync(tmp, { recursive: true, force: true });
    emit(
      options.json,
      () => {
        console.log(`\n✓ Wrote ${manifest.name} → ${path.relative(process.cwd(), out) || out}`);
        console.log(`  ${files.length} files, auto-redacted ${redactedCount} sensitive value(s)`);
        console.log(
          `\nShare this file directly. Clone it with:\n  sailor clone ${path.basename(out)}`,
        );
      },
      {
        status: "ok",
        mode: "local",
        out,
        slug: manifest.slug,
        fileCount: files.length,
        redacted: redactedCount,
      },
    );
    return;
  }

  if (options.dryRun) {
    fs.rmSync(tmp, { recursive: true, force: true });
    emit(
      options.json,
      () => {
        console.log(
          `\nDry run — would publish ${files.length} files to ${repo}:projects/${manifest.slug}/\n`,
        );
        for (const f of files) console.log(`  ${f}`);
        if (redactions.length > 0) {
          console.log(`\nAuto-redacted ${redactedCount} sensitive value(s):`);
          for (const r of redactions) console.log(`  ${r.file} — ${r.kind} ×${r.count}`);
        }
        console.log("\nNo secrets remain. No PR opened (--dry-run).");
        printSurface();
      },
      {
        status: "dry-run",
        repo,
        slug: manifest.slug,
        fileCount: files.length,
        files,
        redactions,
        review: surface,
        manifest,
      },
    );
    return;
  }

  if (interactive) {
    const ok = await confirm(
      `Open a PR adding "${manifest.slug}" (${files.length} files) to ${repo}?`,
    );
    if (!ok) {
      fs.rmSync(tmp, { recursive: true, force: true });
      console.log("Aborted.");
      return;
    }
  }

  // 4. Clone registry, stage the project folder on a fresh branch, push, open PR.
  const token = resolveToken();
  const branch = `share/${manifest.slug}`;
  const registryDir = path.join(tmp, "registry");
  const authUrl = `https://x-access-token:${token}@github.com/${repo}.git`;

  try {
    git(["clone", "--depth", "1", "--branch", base, authUrl, registryDir], tmp);
  } catch {
    git(["clone", "--depth", "1", authUrl, registryDir], tmp);
  }
  git(["checkout", "-b", branch], registryDir);

  const projectDest = path.join(registryDir, "projects", manifest.slug);
  fs.rmSync(projectDest, { recursive: true, force: true });
  fs.cpSync(cleanDir, projectDest, { recursive: true });

  git(["add", "-A"], registryDir);
  git(
    [
      "-c",
      "user.name=sailor-cli",
      "-c",
      "user.email=cli@sail.money",
      "commit",
      "-m",
      `feat(${manifest.slug}): share project`,
    ],
    registryDir,
  );
  git(["push", "-u", "origin", branch], registryDir);

  const pr = await openPullRequest({
    repo,
    title: manifest.summary || `Share ${manifest.name}`,
    body: renderPrBody(manifest),
    head: branch,
    base,
  });

  fs.rmSync(tmp, { recursive: true, force: true });

  emit(
    options.json,
    () => {
      console.log(`\n✓ Opened PR #${pr.number} on ${repo}`);
      console.log(`  ${pr.htmlUrl}`);
      console.log(`  project: projects/${manifest.slug}/ (${files.length} files)`);
      console.log(`  auto-redacted ${redactedCount} sensitive value(s) before publishing`);
      console.log("\nOn merge, registry CI publishes the tagged release for downloads + metrics.");
    },
    {
      status: "ok",
      repo,
      slug: manifest.slug,
      pr: pr.number,
      url: pr.htmlUrl,
      fileCount: files.length,
      redacted: redactedCount,
    },
  );
}
