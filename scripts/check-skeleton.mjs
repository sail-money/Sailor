#!/usr/bin/env node
/**
 * Skeleton typecheck gate.
 *
 * The agent-loop skeleton lives INSIDE a skill (`sailor-agent-build`) as a fenced
 * code block, not as a scaffolded file — so nothing typechecks it by default and it
 * could silently rot against the SDK. This gate is the companion to that decision:
 * it extracts every fenced block marked `// @sailor-skeleton` from the scaffold's
 * skills and typechecks each against the REAL SDK types, exactly as a user adapting
 * it into src/agent.ts would resolve them.
 *
 * Extraction: a ```ts (or ```typescript) fence whose FIRST line is `// @sailor-skeleton`.
 * Typecheck: each block is written to a temp dir inside scaffold/ (so viem + @types/node
 * resolve via scaffold/node_modules) with a generated tsconfig that maps
 * `@sail.money/sailor/sdk` at packages/sdk/src — mirroring scaffold/tsconfig.json —
 * then `tsc --noEmit` must pass. Fails loudly on any error.
 *
 * Run: `node scripts/check-skeleton.mjs` (or `pnpm skeleton:check`). Exit 1 on any miss.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => relative(ROOT, p);
const SKILLS_DIR = join(ROOT, "scaffold", ".agents", "skills");
const MARKER = "// @sailor-skeleton";

// ── 1. Collect every SKILL.md under the scaffold ────────────────────────────
function walkSkillFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkSkillFiles(p, out);
    else if (entry.name === "SKILL.md") out.push(p);
  }
  return out;
}

// ── 2. Extract marked ```ts / ```typescript blocks ──────────────────────────
function extractSkeletons(file) {
  const lines = readFileSync(file, "utf-8").split(/\r?\n/);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(/^```(ts|typescript)\s*$/);
    if (open) {
      const body = [];
      let j = i + 1;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) body.push(lines[j++]);
      if (body.length && body[0].trim() === MARKER) {
        blocks.push({ file, startLine: i + 1, code: body.join("\n") });
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return blocks;
}

// ── 3. Typecheck each block against the real SDK ────────────────────────────
function main() {
  if (!existsSync(SKILLS_DIR)) {
    console.error(`skeleton check: ${rel(SKILLS_DIR)} not found`);
    process.exit(1);
  }

  const blocks = walkSkillFiles(SKILLS_DIR).flatMap(extractSkeletons);
  if (blocks.length === 0) {
    console.error("skeleton check: no `// @sailor-skeleton` blocks found — expected at least one");
    process.exit(1);
  }

  const workDir = join(ROOT, "scaffold", ".skeleton-check");
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  // tsconfig mirrors scaffold/tsconfig.json; SDK path is relative to workDir.
  writeFileSync(
    join(workDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          esModuleInterop: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          noEmit: true,
          baseUrl: ".",
          paths: { "@sail.money/sailor/sdk": ["../../packages/sdk/src/index.ts"] },
        },
        include: ["*.ts"],
      },
      null,
      2,
    ),
  );

  const written = [];
  blocks.forEach((b, n) => {
    const name = `skeleton-${n}.ts`;
    writeFileSync(join(workDir, name), `${b.code}\n`);
    written.push({ name, ...b });
  });

  const tsc = join(ROOT, "node_modules", ".bin", "tsc");
  try {
    execFileSync(tsc, ["-p", join(workDir, "tsconfig.json"), "--noEmit"], {
      cwd: ROOT,
      stdio: "pipe",
    });
    console.log(
      `Skeleton check: ${blocks.length} \`${MARKER}\` block(s) typecheck against the SDK.`,
    );
    for (const w of written) console.log(`  ✓ ${rel(w.file)}:${w.startLine}`);
  } catch (err) {
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    console.error("Skeleton check FAILED — a `// @sailor-skeleton` block does not typecheck:\n");
    // Map tsc's temp-file errors back to the source SKILL.md for the reader.
    console.error(out);
    console.error("\nBlocks checked:");
    for (const w of written) console.error(`  ${w.name} ← ${rel(w.file)}:${w.startLine}`);
    process.exitCode = 1;
    return;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main();
