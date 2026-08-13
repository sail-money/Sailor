#!/usr/bin/env node
/**
 * Doc-drift gate.
 *
 * The agent-facing docs (CLAUDE.md, AGENTS.md, the scaffolded
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
  // An immediately-chained `.alias("station")` registers a second name (e.g. a
  // deprecated hidden alias) that resolves to the SAME subcommand set.
  for (const m of src.matchAll(
    /const\s+(\w+)\s*=\s*program\s*\.command\(\s*"([^"]+)"\s*\)(?:\s*\.alias\(\s*"([^"]+)"\s*\))?/g,
  )) {
    const groupName = m[2].split(/\s+/)[0];
    varToGroup.set(m[1], groupName);
    if (!groups.has(groupName)) groups.set(groupName, new Set());
    if (m[3]) groups.set(m[3], groups.get(groupName)); // alias shares the same Set
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
  "README.md",
  "docs",
  "scaffold",
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
// the USER's own file (their project instructions) and carries no skill routing
// to check against, so completeness is checked against this manually maintained
// list instead — add a name here when a new skill ships, remove one when a
// skill is deleted.

const EXPECTED_SKILLS = [
  "sailor-agent-build",
  "sailor-automation",
  "sailor-extend",
  "sailor-mandate-planner",
  "sailor-mandates",
  "sailor-memory",
  "sailor-navigator",
  "sailor-onboarding",
  "sailor-operate",
  "sailor-project-info",
  "sailor-risk",
  "sailor-servers",
  "sailor-strategy",
  "sailor-swap-quote",
  "sailor-templates",
  "sailor-token-resolve",
  "sailor-transactions",
];

/** Legal values for a skill's `station` frontmatter tag (see docs/skill-authoring.md). */
const STATIONS = new Set(["arrive", "strategy", "mandate", "agent", "sail", "anytime"]);

function checkSkills(errors) {
  const skillsRoot = join(ROOT, "scaffold/.agents/skills");
  if (!existsSync(skillsRoot)) {
    errors.push("scaffold/.agents/skills: directory missing");
    return;
  }
  const dirs = readdirSync(skillsRoot).filter((d) => statSync(join(skillsRoot, d)).isDirectory());
  if (dirs.length === 0) errors.push("scaffold/.agents/skills: no skills found");

  for (const d of dirs) {
    const skillFile = join(skillsRoot, d, "SKILL.md");
    if (!existsSync(skillFile)) {
      errors.push(`scaffold/.agents/skills/${d}: missing SKILL.md`);
      continue;
    }
    const fm = readFileSync(skillFile, "utf-8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) {
      errors.push(`${rel(skillFile)}: missing YAML frontmatter`);
      continue;
    }
    const name = fm[1].match(/^name:\s*(\S+)\s*$/m)?.[1];
    const description = fm[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
    const station = fm[1].match(/^station:\s*(\S+)\s*$/m)?.[1];
    if (name !== d) errors.push(`${rel(skillFile)}: frontmatter name "${name}" ≠ directory "${d}"`);
    if (!description) errors.push(`${rel(skillFile)}: frontmatter description missing or empty`);
    if (!station) {
      errors.push(
        `${rel(skillFile)}: frontmatter station missing — add one of ${[...STATIONS].join("/")}`,
      );
    } else if (!STATIONS.has(station)) {
      errors.push(
        `${rel(skillFile)}: frontmatter station "${station}" is not one of ${[...STATIONS].join("/")}`,
      );
    }
    if (!EXPECTED_SKILLS.includes(d)) {
      errors.push(
        `scaffold/.agents/skills/${d}: not in EXPECTED_SKILLS (scripts/check-docs.mjs) — add it there if this skill is intentional`,
      );
    }
  }

  for (const name of EXPECTED_SKILLS) {
    if (!dirs.includes(name)) {
      errors.push(
        `scaffold/.agents/skills/${name}: listed in EXPECTED_SKILLS (scripts/check-docs.mjs) but missing`,
      );
    }
  }
}

// ── 4.5. Truth checks — skill claims vs deployed.json, forbidden paths, ─────
//        required flags. Extends the doc-drift gate: a stale FACT (not a
//        stale command/method name) is the same class of bug — the coding
//        agent reads it and repeats it to the user with full confidence.
//
// Scope is deliberately NARROWER than DOC_GLOBS above: this validates what a
// SCAFFOLDED PROJECT'S agent reads (scaffold/, docs/, the root README) — not
// the monorepo's own contributor-facing root AGENTS.md/CLAUDE.md or the
// per-package READMEs, which legitimately reference packages/... paths for a
// completely different audience (someone working ON this repo, not a user's
// scaffolded agent). Reusing the broader DOC_GLOBS scope here would flag
// root AGENTS.md's own (correct) `packages/sdk/src/deployments.ts` citations.
const SHIPPED_DOC_GLOBS = ["scaffold", "docs", "README.md"];

function collectShippedDocs() {
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
  for (const g of SHIPPED_DOC_GLOBS) walk(join(ROOT, g));
  return [...new Set(files)];
}

const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const numberOf = (tok) => (/^\d+$/.test(tok) ? Number(tok) : NUMBER_WORDS[tok.toLowerCase()]);
const NUM_WORD_ALT = Object.keys(NUMBER_WORDS).join("|");

/** Ground truth: deployed.json (chains + templates) and deployments.ts (standaloneTemplates). */
function loadDeploymentTruth() {
  const deployedPath = join(ROOT, "scaffold/.agents/skills/sailor-templates/deployed.json");
  const deployed = JSON.parse(readFileSync(deployedPath, "utf-8"));
  const chainIds = Object.keys(deployed.chains);
  const templateSet = new Set();
  for (const perChain of Object.values(deployed.chains)) {
    for (const t of Object.keys(perChain)) templateSet.add(t);
  }
  // Deployed on this chain count == every chain has every template (verified
  // true today; if a future chain ships a partial set, "deployed" per-template
  // stops being a single number — the claim-check below only asserts against
  // the chain COUNT and the "is it deployed anywhere" question, not per-chain.
  const deployedEverywhere = new Set(
    [...templateSet].filter((t) => chainIds.every((c) => t in deployed.chains[c])),
  );

  const deploymentsSrc = readFileSync(join(ROOT, "packages/sdk/src/deployments.ts"), "utf-8");
  const standaloneEmpty = /standaloneTemplates:\s*\{\}/.test(deploymentsSrc);

  return {
    chainCount: chainIds.length,
    templates: templateSet,
    deployedEverywhere,
    standaloneEmpty,
  };
}

/**
 * CHECK 1 — deployment claims vs deployed.json.
 *
 * Three narrow, precise patterns — chosen from what deployment-count claims
 * actually look like in this codebase (verified against every current
 * mention before writing the rule): a table's "✅ N chains" status cell, a
 * parenthetical total after an enumerated chain-name list "(N chains)", or a
 * deployment verb directly governing the count ("deployed/live/bundled ...
 * N chains"). Deliberately NOT "any number followed by 'chains'" — this
 * codebase legitimately says "one chain", "two chains", "a two-chain DCA"
 * throughout sailor-strategy/sailor-onboarding/sailor-token-resolve to mean
 * "a single target chain" or "a 2-of-11 example", never a deployment total;
 * a bare-number rule would flag every one of those as a false positive.
 */
function checkDeploymentClaims(truth, errors) {
  const files = collectShippedDocs();
  const countPatterns = [
    new RegExp(`✅\\s*(\\d+|${NUM_WORD_ALT})[-\\s]chains?`, "gi"),
    new RegExp(`\\((\\d+|${NUM_WORD_ALT})\\s+chains?\\)`, "gi"),
    // NOT "live" — "the SMA is live on one chain" is a real, correct sentence
    // about a single deployment's status, not a protocol-wide chain-count
    // claim; "live" false-positived on exactly this before it was removed.
    new RegExp(
      `\\b(?:deployed|bundle[sd]?)\\b(?:[^.\\n]{0,30}?)\\b(?:on\\s+|for\\s+)?(?:all\\s+)?(\\d+|${NUM_WORD_ALT})[-\\s]chains?`,
      "gi",
    ),
  ];
  const templateAlt = [...truth.templates].join("|");
  const notDeployedPattern = new RegExp(
    `\\b(${templateAlt})\\b(?:(?!\\.)[\\s\\S]){0,40}?\\b(?:is not|isn't)\\s+deployed\\b`,
    "gi",
  );
  const standalonePopulatedPattern = /standaloneTemplates\b(?:(?!\.)[\s\S]){0,150}?\bpopulated\b/gi;

  for (const file of files) {
    const md = readFileSync(file, "utf-8");
    const lines = md.split("\n");
    lines.forEach((line, i) => {
      const lineNo = i + 1;

      for (const re of countPatterns) {
        re.lastIndex = 0;
        for (const m of line.matchAll(re)) {
          const n = numberOf(m[1]);
          if (n !== undefined && n !== truth.chainCount) {
            errors.push(
              `${rel(file)}:${lineNo}: claims ${m[1]} chains — deployed.json shows ${truth.chainCount} chains deployed. Fix the count or point at deployed.json instead of hardcoding it.`,
            );
          }
        }
      }

      for (const m of line.matchAll(notDeployedPattern)) {
        const tmpl = m[1];
        if (truth.deployedEverywhere.has(tmpl)) {
          errors.push(
            `${rel(file)}:${lineNo}: says "${tmpl}" is not deployed — deployed.json shows it deployed on all ${truth.chainCount} chains.`,
          );
        }
      }

      if (!truth.standaloneEmpty) return; // only a lie when ground truth is actually empty
      for (const _m of line.matchAll(standalonePopulatedPattern)) {
        errors.push(
          `${rel(file)}:${lineNo}: claims standaloneTemplates is populated — packages/sdk/src/deployments.ts shows it empty ({} — the seven shared templates live in knownTemplates instead).`,
        );
      }
    });
  }
}

/**
 * CHECK 2 — forbidden workspace tokens in shipped text.
 *
 * `@sail/sdk` (exact) — the internal TS workspace alias; a scaffolded project
 * depends on @sail.money/sailor and never has this alias. Deliberately NOT a
 * broader `@sail/*` glob: `@sail/interfaces/*.sol` is a real, working Solidity
 * remapping in the shipped contracts/ workspace (contracts/foundry.toml) and
 * must never be flagged — verified it's the only other @sail/ pattern in the
 * shipped scope before writing this as an exact-string match, not a prefix.
 *
 * `packages/...` — a monorepo-only path with zero legitimate use in the
 * shipped scope (verified: zero hits in scaffold/, docs/, README.md today).
 * Blanket-forbidden — no narrowing needed.
 *
 * `Protocol/...` — the frozen protocol repo. Has LEGITIMATE, INTENTIONAL
 * citation uses throughout the skills ("the tuples come from
 * Protocol/contracts/templates/*.sol", "read access to the workspace
 * Protocol/..." as a compatibility note) — verified every current mention is
 * a citation, never an instruction. Only forbidden when the text actually
 * tells the user to open/read/cat it as an action, since that directory does
 * not exist in a scaffolded project. A blanket ban would flag several
 * correct, pre-existing citations; this narrower rule flags none of them
 * today and catches a future "cat Protocol/..." regression.
 */
function checkForbiddenTokens(errors) {
  const files = collectShippedDocs();
  const protocolActionPattern = /\b(?:open|read|cat|view|edit)\s+`?Protocol\//i;

  for (const file of files) {
    const md = readFileSync(file, "utf-8");
    const lines = md.split("\n");
    lines.forEach((line, i) => {
      const lineNo = i + 1;
      if (line.includes("@sail/sdk")) {
        errors.push(
          `${rel(file)}:${lineNo}: "@sail/sdk" is the internal workspace alias — module-not-found in a scaffolded project. Use "@sail.money/sailor/sdk".`,
        );
      }
      if (/\bpackages\/[\w./-]+/.test(line)) {
        errors.push(
          `${rel(file)}:${lineNo}: references a monorepo-only "packages/..." path — a scaffolded project has no packages/ directory. State the fact without the path, or point at what actually ships (e.g. @sail.money/sailor/sdk).`,
        );
      }
      if (protocolActionPattern.test(line)) {
        errors.push(
          `${rel(file)}:${lineNo}: tells the user to open/read "Protocol/..." — that directory does not exist in a scaffolded project (it's the frozen protocol repo). Cite it as a source; don't instruct the user to open it.`,
        );
      }
    });
  }
}

/**
 * Parse every `.requiredOption(...)` in the CLI's commander tree into
 * Map<"group sub" | "leaf", Set<flagName>>. Reuses the same command-naming
 * convention as parseCliSurface (leaves vs "group sub") so lookups line up.
 *
 * Command chains in index.ts run from one `.command("x")` declaration to the
 * next — resolved here by sorting every command-declaration's source offset
 * and slicing the text between consecutive ones, then scanning each slice
 * for `.requiredOption(`. Handles both direct string literals and the
 * `...arrayVar[i]` spread form (mandate register/attach share a
 * `registerOptions` array) by pre-resolving `const x = [[...], [...]] as
 * const;` declarations.
 */
function parseRequiredFlags() {
  const src = readFileSync(join(ROOT, "packages/cli/src/index.ts"), "utf-8");

  const optionArrays = new Map();
  for (const m of src.matchAll(
    /const\s+(\w+)\s*=\s*\[\s*((?:\[[\s\S]*?\],?\s*)+)\]\s*as const;/g,
  )) {
    const entries = [...m[2].matchAll(/\[\s*"(--[\w-]+)/g)].map((e) => e[1]);
    optionArrays.set(m[1], entries);
  }

  const varToGroup = new Map();
  for (const m of src.matchAll(
    /const\s+(\w+)\s*=\s*program\s*\.command\(\s*"([^"]+)"\s*\)(?:\s*\.alias\(\s*"([^"]+)"\s*\))?/g,
  )) {
    varToGroup.set(m[1], m[2].split(/\s+/)[0]);
  }

  // Every command-declaration site, in source order: { index, key }.
  const sites = [];
  for (const m of src.matchAll(/\bprogram\s*\.command\(\s*"([^"]+)"/g)) {
    const name = m[1]
      .replace(/\s*\[.*$/, "")
      .replace(/\s*<.*$/, "")
      .trim()
      .split(/\s+/)[0];
    sites.push({ index: m.index, key: name });
  }
  for (const m of src.matchAll(/(\w+)\s*\.command\(\s*"([^"]+)"/g)) {
    const groupName = varToGroup.get(m[1]);
    if (!groupName) continue; // not a group variable — already covered by the program.command() pass
    sites.push({ index: m.index, key: `${groupName} ${m[2].split(/\s+/)[0]}` });
  }
  sites.sort((a, b) => a.index - b.index);

  const requiredByCommand = new Map();
  for (let i = 0; i < sites.length; i++) {
    const start = sites[i].index;
    const end = i + 1 < sites.length ? sites[i + 1].index : src.length;
    const chunk = src.slice(start, end);
    const flags = new Set();
    // No trailing `"` after the flag name — a real option string is
    // "--sma <address>" (placeholder text before the closing quote), so
    // requiring the quote immediately after the flag silently matched
    // nothing for every multi-word option (confirmed: this dropped every
    // required flag except the two-element registerOptions array, whose
    // separate array-parsing regex never had the same requirement).
    for (const m of chunk.matchAll(/\.requiredOption\(\s*(?:"(--[\w-]+)|\.\.\.(\w+)\[(\d+)\])/g)) {
      if (m[1]) {
        flags.add(m[1]);
      } else if (m[2] && optionArrays.has(m[2])) {
        const flag = optionArrays.get(m[2])[Number(m[3])];
        if (flag) flags.add(flag);
      }
    }
    if (flags.size > 0) {
      const existing = requiredByCommand.get(sites[i].key) ?? new Set();
      for (const f of flags) existing.add(f);
      requiredByCommand.set(sites[i].key, existing);
    }
  }
  return requiredByCommand;
}

/**
 * CHECK 3 — documented command invocations carry every flag the CLI marks
 * required.
 *
 * Checks each DISCRETE backtick-delimited span on its own — a fenced
 * ```block``` body, or a single-line `inline span` — never the raw
 * surrounding line. That distinction is the whole precision story here,
 * found by testing against real false positives while building this check:
 *
 * - A reference-table row like "| `sailor mandate register` | ...
 *   comma-separated list = one signature (`--label`) |" puts the command
 *   name and an unrelated flag mention in DIFFERENT backtick spans (and
 *   often different table columns). Scanning the raw line would see both
 *   and wrongly conclude the flag was "shown"; scanning the command's own
 *   span alone correctly sees no flags there and skips it as a bare
 *   name-drop, not a presented invocation.
 * - A wrapped prose sentence can leave an inline span UNCLOSED on the line
 *   where the match starts ("... then `sailor mandate register --address\n
 *   <deployed>` to authorize it."). Requiring the closing backtick before
 *   the newline (same convention as codeRegions() above) means this never
 *   matches as a complete span — correct, since it's narration, not a
 *   copy-pasteable instruction.
 * - The actual bug this targets (sailor-operate's shutdown recipe) presented
 *   `sailor mandate revoke --all` as a single-backtick inline reference
 *   inside a numbered-list step, not inside a fenced block — a fenced-only
 *   scan verifiably misses it. Scanning inline spans too catches it.
 *
 * Only flags a span that already shows at least one `--flag` — i.e. it's
 * presenting a concrete invocation, not just naming the command. `--force`
 * doesn't count on its own: in this codebase it's exclusively a "modify what
 * you already registered" idiom, always paired with "repeat step N" / "the
 * same registered singleton" framing that refers back to a full invocation
 * shown earlier ("sailor mandate configure --force") — never a fresh,
 * standalone command. Both current uses of `--force` alone were exactly this
 * elliptical shorthand, not an incomplete instruction; requiring some OTHER
 * flag too avoids flagging either. Does not attempt full shell/argv parsing —
 * a required flag anywhere in the span is accepted, so this can't
 * false-positive on argument order, quoting, or extra flags; it only catches
 * a required flag missing entirely.
 */
function checkRequiredFlags(docs, requiredByCommand, errors) {
  const checkSpan = (file, lineNo, text, errors) => {
    const m = text.match(/\bsailor\s+([a-z][\w-]*)\s+([a-z][\w-]*)\b/);
    if (!m) return;
    const key = `${m[1]} ${m[2]}`;
    const required = requiredByCommand.get(key);
    if (!required) return;
    if (!/--(?!force\b)[\w-]+/.test(text)) return; // bare name-drop, or --force-only shorthand

    for (const flag of required) {
      if (!text.includes(flag)) {
        errors.push(
          `${rel(file)}:${lineNo}: \`sailor ${key}\` is missing required flag "${flag}" — as documented, this command fails as written.\n      ${text.trim().split("\n").join(" ")}`,
        );
      }
    }
  };

  for (const file of docs) {
    const md = readFileSync(file, "utf-8");

    // Fenced blocks — the whole body is one span (a multi-line command's
    // flags may be split across its own lines; no need for `\`-continuation
    // bookkeeping when the body is already checked as a single unit).
    for (const m of md.matchAll(/```\w*\n([\s\S]*?)```/g)) {
      const lineNo = md.slice(0, m.index).split("\n").length;
      checkSpan(file, lineNo, m[1], errors);
    }

    // Inline spans — same convention as codeRegions(): a closing backtick
    // must land before the newline, or it isn't a complete span.
    md.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/`([^`\n]+)`/g)) {
        checkSpan(file, i + 1, m[1], errors);
      }
    });
  }
}

// ── 5. Validate ──────────────────────────────────────────────────────────────

function main() {
  const cli = parseCliSurface();
  const sdk = parseSdkSurface();
  const docs = collectDocs();
  const truth = loadDeploymentTruth();
  const requiredByCommand = parseRequiredFlags();
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
  checkDeploymentClaims(truth, errors);
  checkForbiddenTokens(errors);
  checkRequiredFlags(docs, requiredByCommand, errors);

  // ── Report ───────────────────────────────────────────────────────────────
  const cliCount = cli.leaves.size + [...cli.groups.values()].reduce((n, s) => n + s.size, 0);
  const sdkCount =
    [...sdk.namespaces.values()].reduce((n, s) => n + s.size, 0) + sdk.clientMethods.size;
  console.log(
    `Doc-drift check: ${docs.length} docs vs ${cliCount} CLI commands, ${sdkCount} SDK methods`,
  );
  console.log(
    `Truth check: ${truth.chainCount} chains / ${truth.templates.size} templates ` +
      `(deployed.json), ${requiredByCommand.size} command(s) with required flags`,
  );

  if (errors.length > 0) {
    console.error(`\n✗ ${errors.length} stale reference(s):\n`);
    for (const e of [...new Set(errors)].sort()) console.error(`  ${e}`);
    console.error("\nFix the doc, or update the CLI/SDK so the referenced surface exists.");
    process.exit(1);
  }
  console.log("✓ Every sailor command and client.* method referenced in docs exists.");
  console.log("✓ Every deployment claim, workspace path, and required flag checks out.");
}

main();
