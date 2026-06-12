#!/usr/bin/env node
/**
 * Doc-drift gate.
 *
 * The agent-facing docs (CLAUDE.md, AGENTS.md, AGENT_PLAYBOOK.md, the scaffolded
 * template, package READMEs) tell an LLM agent which `sailor` commands and which
 * `client.<ns>.<method>(...)` SDK calls to use. If a doc names a command or method
 * that no longer exists, the agent confidently does the wrong thing. This script
 * is the regression net: it derives the *real* surface from source and fails if a
 * doc references something that isn't there.
 *
 *   - CLI commands  ← parsed from packages/cli/src/index.ts (commander tree)
 *   - SDK methods   ← parsed from packages/sdk/src/client.ts (namespace classes)
 *
 * Only `sailor …` is validated, never the SailFramework `sail …` binary that some
 * docs reference. Only references inside `inline code` or ```fenced``` blocks are
 * checked, so prose ("the sailor CLI") never trips it.
 *
 * Run: `node scripts/check-docs.mjs` (or `pnpm docs:check`). Exit 1 on any miss.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => relative(ROOT, p);

// ── 1. Derive the real CLI command surface ──────────────────────────────────

/**
 * Parse the commander tree from index.ts into:
 *   leaves  — Set of full top-level invocations ("init", "doctor", "dispatch preview")
 *   groups  — Map<groupName, Set<subcommand>>  (e.g. "mandate" → {prepare, sign, …})
 */
function parseCliSurface() {
  const src = readFileSync(join(ROOT, "packages/cli/src/index.ts"), "utf-8");
  const leaves = new Set();
  const groups = new Map();
  const varToGroup = new Map(); // commander variable name → group command name

  // `const ui = program.command("ui")` — a group declared on a variable.
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*program\s*\.command\(\s*"([^"]+)"/g)) {
    const groupName = m[2].split(/\s+/)[0];
    varToGroup.set(m[1], groupName);
    if (!groups.has(groupName)) groups.set(groupName, new Set());
  }

  // `program.command("init [dir]")` — a top-level leaf (not assigned to a var).
  for (const m of src.matchAll(/program\s*\.command\(\s*"([^"]+)"/g)) {
    const name = m[1].split(/\s+/)[0];
    // Multi-word leaf names (e.g. the "dispatch preview" stub) keep their full form too.
    const full = m[1]
      .replace(/\s*\[.*$/, "")
      .replace(/\s*<.*$/, "")
      .trim();
    if (!groups.has(name)) {
      leaves.add(name);
      if (full.includes(" ")) leaves.add(full);
    }
  }

  // `stub("setup", …)` / `stub("dispatch preview", …)` — registered top-level commands.
  for (const m of src.matchAll(/\bstub\(\s*"([^"]+)"/g)) {
    leaves.add(m[1]);
    leaves.add(m[1].split(/\s+/)[0]);
  }

  // `ui.command("start")` / `mandate.command("prepare")` — subcommands of a group.
  for (const m of src.matchAll(/(\w+)\s*\.command\(\s*"([^"]+)"/g)) {
    const groupName = varToGroup.get(m[1]);
    if (!groupName) continue; // not a known group variable (e.g. program.command handled above)
    const sub = m[2].split(/\s+/)[0];
    groups.get(groupName).add(sub);
  }

  return { leaves, groups };
}

// ── 2. Derive the real SDK surface ───────────────────────────────────────────

/**
 * Parse client.ts into:
 *   namespaces  — Map<propertyName, Set<methodName>>  (account → {create, get, …})
 *   clientMethods — Set of direct SailorClient methods (capabilities, withSigner, …)
 */
function parseSdkSurface() {
  const src = readFileSync(join(ROOT, "packages/sdk/src/client.ts"), "utf-8");
  const lines = src.split("\n");

  // Map namespace *class* → set of method names, by slicing each class body.
  const classMethods = new Map();
  let current = null;
  let depth = 0;
  const reserved = new Set([
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "return",
    "super",
    "constructor",
    "function",
    "await",
    "typeof",
    "new",
  ]);
  for (const line of lines) {
    const classMatch = line.match(/^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/);
    if (classMatch) {
      current = classMatch[1];
      classMethods.set(current, new Set());
      depth = 0;
    }
    if (current) {
      // Method declarations live at class-body depth 1.
      const methodMatch = line.match(
        /^\s{2}(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(?:get\s+)?(\w+)\s*[(<]/,
      );
      if (methodMatch && !reserved.has(methodMatch[1])) {
        classMethods.get(current).add(methodMatch[1]);
      }
      depth += (line.match(/{/g)?.length ?? 0) - (line.match(/}/g)?.length ?? 0);
      if (depth <= 0 && line.includes("}")) current = null;
    }
  }

  // Map runtime property name → class: `this.account = new AccountNamespace(`
  const namespaces = new Map();
  for (const m of src.matchAll(/this\.(\w+)\s*=\s*new\s+(\w+)\s*\(/g)) {
    const [, prop, cls] = m;
    if (classMethods.has(cls)) namespaces.set(prop, classMethods.get(cls));
  }
  // `this.dispatch = dispatch;` — assigned from a local built earlier in the ctor.
  for (const m of src.matchAll(/this\.(\w+)\s*=\s*(\w+);/g)) {
    const [, prop, localVar] = m;
    if (namespaces.has(prop)) continue;
    // Resolve the local: `const dispatch = new DispatchNamespace(`
    const localDecl = new RegExp(`(?:const|let)\\s+${localVar}\\s*=\\s*new\\s+(\\w+)\\s*\\(`);
    const lm = src.match(localDecl);
    if (lm && classMethods.has(lm[1])) namespaces.set(prop, classMethods.get(lm[1]));
  }

  // Direct methods on the SailorClient class itself.
  const clientMethods = classMethods.get("SailorClient") ?? new Set();

  return { namespaces, clientMethods };
}

// ── 3. Collect doc files + extract code references ───────────────────────────

const DOC_GLOBS = [
  "CLAUDE.md",
  "AGENTS.md",
  "AGENT_PLAYBOOK.md",
  "README.md",
  "docs",
  "templates",
  "packages/cli/README.md",
  "packages/sdk/README.md",
];

function collectDocs() {
  const files = [];
  const walk = (p) => {
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) return;
    if (st.isDirectory()) {
      for (const e of readdirSync(p)) {
        if (e === "node_modules" || e === "dist" || e.startsWith(".git")) continue;
        walk(join(p, e));
      }
    } else if (p.endsWith(".md")) {
      files.push(p);
    }
  };
  for (const g of DOC_GLOBS) walk(join(ROOT, g));
  return [...new Set(files)];
}

/** Pull the text of every `inline` and ```fenced``` code region from markdown. */
function codeRegions(md) {
  const regions = [];
  // Fenced blocks first, then strip them so inline matching doesn't double-count.
  const rest = md.replace(/```[\s\S]*?```/g, (block) => {
    regions.push(block.replace(/```/g, ""));
    return "\n";
  });
  for (const m of rest.matchAll(/`([^`\n]+)`/g)) regions.push(m[1]);
  return regions;
}

// ── 4. Skills consistency ─────────────────────────────────────────────────────
//
// The scaffolded template ships agent skills under .agents/skills/. AGENTS.md is
// the routing layer: it must point at every skill that exists, and every skill it
// points at must exist with valid frontmatter — otherwise an agent either never
// discovers a workflow or follows a dangling pointer.

function checkSkills(errors) {
  const skillsRoot = join(ROOT, "templates/default/.agents/skills");
  const agentsPath = join(ROOT, "templates/default/AGENTS.md");
  if (!existsSync(skillsRoot)) {
    errors.push("templates/default/.agents/skills: directory missing");
    return;
  }
  const agentsMd = readFileSync(agentsPath, "utf-8");
  const dirs = readdirSync(skillsRoot).filter((d) =>
    statSync(join(skillsRoot, d)).isDirectory(),
  );
  if (dirs.length === 0) errors.push("templates/default/.agents/skills: no skills found");

  for (const d of dirs) {
    const skillFile = join(skillsRoot, d, "SKILL.md");
    if (!existsSync(skillFile)) {
      errors.push(`templates/default/.agents/skills/${d}: missing SKILL.md`);
      continue;
    }
    const fm = readFileSync(skillFile, "utf-8").match(/^---\n([\s\S]*?)\n---/);
    if (!fm) {
      errors.push(`${rel(skillFile)}: missing YAML frontmatter`);
      continue;
    }
    const name = fm[1].match(/^name:\s*(\S+)\s*$/m)?.[1];
    const description = fm[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
    if (name !== d) errors.push(`${rel(skillFile)}: frontmatter name "${name}" ≠ directory "${d}"`);
    if (!description) errors.push(`${rel(skillFile)}: frontmatter description missing or empty`);
    if (!agentsMd.includes(`.agents/skills/${d}/SKILL.md`)) {
      errors.push(`templates/default/AGENTS.md: routing table does not reference .agents/skills/${d}/SKILL.md`);
    }
  }

  for (const m of agentsMd.matchAll(/\.agents\/skills\/([\w-]+)\/SKILL\.md/g)) {
    if (!dirs.includes(m[1])) {
      errors.push(`templates/default/AGENTS.md: references .agents/skills/${m[1]}/SKILL.md which does not exist`);
    }
  }
}

// ── 5. Validate ──────────────────────────────────────────────────────────────

function main() {
  const cli = parseCliSurface();
  const sdk = parseSdkSurface();
  const docs = collectDocs();
  const errors = [];

  for (const file of docs) {
    const md = readFileSync(file, "utf-8");
    for (const code of codeRegions(md)) {
      for (const lineRaw of code.split("\n")) {
        const line = lineRaw.trim();

        // ── CLI: `sailor <word1> [<word2>]` ──────────────────────────────────
        for (const m of line.matchAll(/\bsailor\s+([a-z][\w-]*)(?:\s+([a-z][\w-]*))?/g)) {
          const [, w1, w2] = m;
          const two = w2 ? `${w1} ${w2}` : null;
          if (cli.leaves.has(w1) || (two && cli.leaves.has(two))) continue; // top-level leaf
          if (cli.groups.has(w1)) {
            // Group: if a subcommand word follows (and isn't a flag), it must exist.
            if (!w2 || w2.startsWith("-")) continue; // bare group invocation, or a flag
            if (cli.groups.get(w1).has(w2)) continue;
            errors.push(
              `${rel(file)}: \`sailor ${w1} ${w2}\` — "${w2}" is not a subcommand of "${w1}" (have: ${[...cli.groups.get(w1)].join(", ")})`,
            );
            continue;
          }
          errors.push(`${rel(file)}: \`sailor ${w1}\` — unknown command`);
        }

        // ── SDK: `client.<ns>[.<method>]` ────────────────────────────────────
        for (const m of line.matchAll(/\bclient\.(\w+)(?:\.(\w+))?/g)) {
          const [, ns, method] = m;
          if (sdk.namespaces.has(ns)) {
            if (!method) continue;
            if (sdk.namespaces.get(ns).has(method)) continue;
            errors.push(
              `${rel(file)}: \`client.${ns}.${method}\` — "${method}" is not a method of the "${ns}" namespace (have: ${[...sdk.namespaces.get(ns)].join(", ")})`,
            );
            continue;
          }
          if (sdk.clientMethods.has(ns)) continue; // direct client method, e.g. capabilities/withSigner
          errors.push(`${rel(file)}: \`client.${ns}\` — unknown SDK namespace or method`);
        }
      }
    }
  }

  checkSkills(errors);

  // ── Report ───────────────────────────────────────────────────────────────
  const cliCount = cli.leaves.size + [...cli.groups.values()].reduce((n, s) => n + s.size, 0);
  const sdkCount =
    [...sdk.namespaces.values()].reduce((n, s) => n + s.size, 0) + sdk.clientMethods.size;
  console.log(
    `Doc-drift check: ${docs.length} docs vs ${cliCount} CLI commands, ${sdkCount} SDK methods`,
  );

  if (errors.length > 0) {
    console.error(`\n✗ ${errors.length} stale reference(s):\n`);
    for (const e of [...new Set(errors)].sort()) console.error(`  ${e}`);
    console.error("\nFix the doc, or update the CLI/SDK so the referenced surface exists.");
    process.exit(1);
  }
  console.log("✓ Every sailor command and client.* method referenced in docs exists.");
}

main();
