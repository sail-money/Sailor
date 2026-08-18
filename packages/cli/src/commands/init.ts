import fs from "node:fs";
import path from "node:path";
import { chains } from "@sail/sdk";
import { readActiveAccount } from "@sail/sdk/accounts";
import { packageRoot } from "../lib/packagePaths.js";
import { copyDirSync, writeIfMissing } from "../lib/template.js";

type InitOptions = {
  chain?: string;
  rpcUrl?: string;
  template?: string;
  force?: boolean;
};

// No default chain — Stage 1 of onboarding asks the user which chain they want.
// Scaffolded projects start with chainId: null in config.json.

const SAIL_WORKSPACE_README = `# Sailor Project Workspace

This folder is the local workspace for one Sailor agent deployment.

## Layout

- \`config.json\` is the project manifest: name, chain, and state location.
- \`keys/\` stores encrypted local signing keys. Never commit these files.
- \`runtime/\` is for local UI and signing handoff state.
- \`state/\` is for persistent agent state, audit logs, and tx history.

AI coding agents should read the \`sailor-navigator\` skill (.agents/skills/sailor-navigator/SKILL.md) and this folder's \`config.json\`
before changing strategy code or running commands that touch funds.
`;

const CANONICAL_PKG = "@sail.money/sailor";

/**
 * Version of the running CLI, read from its package manifest. Throws rather than
 * falling back to a placeholder: a bad version would scaffold an unresolvable
 * `@sail.money/sailor: ^0.0.0` devDependency, failing later and more confusingly.
 */
function cliVersion(): string {
  const manifest = path.join(packageRoot(), "package.json");
  let version: string | undefined;
  try {
    version = (JSON.parse(fs.readFileSync(manifest, "utf-8")) as { version?: string }).version;
  } catch (err) {
    throw new Error(`Cannot read CLI package manifest at ${manifest}: ${(err as Error).message}`);
  }
  if (!version) throw new Error(`CLI package manifest at ${manifest} has no version`);
  return version;
}

function scaffoldProjectWorkspace(dest: string, name: string, options: InitOptions): void {
  // chainId is null when no --chain flag is provided. Station 1 of the onboarding flow
  // handles chain selection in the setup UI — chat must not pick or write the chain.
  // The wizard writes it into config.json before proceeding. This keeps init frictionless.
  const chainId: number | null = options.chain
    ? (() => {
        const n = Number(options.chain);
        if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid chain id: "${options.chain}"`);
        return n;
      })()
    : null;

  const sailDir = path.join(dest, ".sail");
  fs.mkdirSync(path.join(sailDir, "keys"), { recursive: true });
  fs.mkdirSync(path.join(sailDir, "runtime"), { recursive: true });
  fs.mkdirSync(path.join(sailDir, "state"), { recursive: true });

  const installMode = process.env.SAILOR_INSTALL_MODE === "docker" ? "docker" : "local";
  const _rawContainerName = process.env.SAILOR_CONTAINER_NAME ?? "agent";
  const containerName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(_rawContainerName) ? _rawContainerName : "agent";

  fs.writeFileSync(
    path.join(sailDir, "config.json"),
    `${JSON.stringify(
      {
        version: 1,
        name,
        chainId,   // null = chain not yet chosen; Stage 1 will set this
        stateDir: ".sail/state",
        createdAt: new Date().toISOString(),
        installMode,
        ...(installMode === "docker" ? { containerName } : {}),
        contracts: {
          kernel: "",
          mandateFactory: "",
        },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );

  writeIfMissing(path.join(sailDir, "README.md"), SAIL_WORKSPACE_README);

  // Build per-chain var lines from the SDK registry — stays in sync when chains are added.
  const chainEntries = Object.values(chains);
  const perChainVarLines = chainEntries
    .map(c => `# ${c.rpcEnvVar}=https://your-${c.name.toLowerCase().replace(/\s+/g, "-")}-endpoint`)
    .join("\n");

  // .env.example — documents both RPC config patterns; CHAIN_ID omitted when
  // no chain was specified so Stage 1 can set it after the user picks a chain.
  const chainIdExample = chainId != null ? `CHAIN_ID=${chainId}` : `# CHAIN_ID=8453   # set after choosing your chain in Stage 1`;
  fs.writeFileSync(
    path.join(dest, ".env.example"),
    `# Sailor agent environment
#
# RPC configuration — two patterns, pick one:
#
# Option A: single active chain (simplest)
RPC_URL=https://your-rpc-endpoint
${chainIdExample}
#
# Option B: per-chain endpoints (multi-chain projects, or if you prefer explicit names)
# Set CHAIN_ID to the chain sailor run uses; omit RPC_URL if all chains have a specific var.
${perChainVarLines}

# Optional: non-interactive passphrase (CI, GitHub Actions, launchd, systemd)
# SAIL_PASSPHRASE=change-me-to-a-strong-passphrase
`,
    "utf-8",
  );

  // .env.local — always generated so its per-chain comments match the SDK registry.
  // Shows both Option A (generic RPC_URL + CHAIN_ID) and Option B (per-chain vars).
  // When --rpc-url / --chain flags are given the active vars are pre-populated.
  const rpcUrlLine = options.rpcUrl ? `RPC_URL=${options.rpcUrl}` : `# RPC_URL=https://your-rpc-endpoint`;
  const chainIdLine = chainId != null ? `CHAIN_ID=${chainId}` : `# CHAIN_ID=8453   # set after choosing your chain`;
  const allChainVarLines = chainEntries
    .map(c => {
      const isActive = c.chainId === chainId;
      const val = isActive && options.rpcUrl ? options.rpcUrl : `https://your-${c.name.toLowerCase().replace(/\s+/g, "-")}-endpoint`;
      return isActive && options.rpcUrl ? `${c.rpcEnvVar}=${val}` : `# ${c.rpcEnvVar}=${val}`;
    })
    .join("\n");
  fs.writeFileSync(
    path.join(sailDir, ".env.local"),
    `# Real values — never commit this file.
#
# Option A: single active chain (simplest)
${rpcUrlLine}
${chainIdLine}
#
# Option B: per-chain endpoints (multi-chain or explicit names; omit RPC_URL if every chain has its own var)
${allChainVarLines}

# Optional: non-interactive passphrase (CI, GitHub Actions, launchd, systemd)
# SAIL_PASSPHRASE=change-me-to-a-strong-passphrase
`,
    "utf-8",
  );
}

export async function initCommand(
  dir?: string,
  options: InitOptions = {},
): Promise<void> {
  const inPlace = !dir || dir === ".";
  // Use resolve (not join) so an absolute path or one with `..` resolves to its
  // true location — the containment check below then rejects anything outside the
  // cwd with a clear error, instead of join() silently nesting an absolute path
  // into `<cwd>/<abs path>` and reporting "Done!".
  const dest = inPlace ? process.cwd() : path.resolve(process.cwd(), dir);
  const name = path.basename(dest);

  // A single, flat scaffold ships under scaffold/. The legacy `--template` flag is
  // still accepted for back-compat, but only the default scaffold exists — any other
  // name is an explicit error rather than a silently-ignored no-op.
  const templateName = options.template ?? "default";
  if (templateName !== "default") {
    throw new Error(`Unknown template "${templateName}" — only the default scaffold ships.`);
  }

  const templateSrc = path.join(packageRoot(), "scaffold");

  if (!fs.existsSync(templateSrc) || !fs.existsSync(path.join(templateSrc, "package.json"))) {
    throw new Error(
      `Scaffold not found at ${templateSrc}.\n` +
        "If you're running the in-tree CLI bundle from a monorepo checkout, the scaffolder\n" +
        "couldn't locate the repo's scaffold/ directory. Install the published package, or\n" +
        "run from the repo root.",
    );
  }

  const cwd = process.cwd();
  if (!inPlace && !dest.startsWith(cwd + path.sep) && dest !== cwd) {
    throw new Error(`Directory must be inside the current working directory`);
  }

  if (!inPlace && fs.existsSync(dest) && !options.force) {
    throw new Error(`Directory already exists: ${dest}\nPass --force to scaffold into it anyway (existing files with the same name are overwritten).`);
  }

  if (inPlace && fs.existsSync(path.join(dest, ".sail", "config.json")) && !options.force) {
    throw new Error(
      "This project is already initialized.\n" +
        "Run `sailor update` to re-sync template files, or `sailor init --force` to re-initialize " +
        "(overwrites scaffold files; your .sail/keys/ and .sail/state/ are left in place).",
    );
  }

  // Read existing install mode before scaffold overwrites config (handles --force re-init).
  const existingConfigPath = path.join(dest, ".sail", "config.json");
  const previousConfig = fs.existsSync(existingConfigPath)
    ? (() => { try { return JSON.parse(fs.readFileSync(existingConfigPath, "utf-8")) as { installMode?: string; containerName?: string }; } catch { return null; } })()
    : null;

  // The scaffold tree carries everything a project receives, including the
  // contracts/ permission-authoring workspace. The canonical agent loop is the
  // typecheck-verified skeleton inside the sailor-agent-build skill (no examples/ dir).
  copyDirSync(templateSrc, dest);

  // Patch package.json: set the project name and inject the Sailor CLI as a
  // devDependency pinned to the version that generated this scaffold.
  //
  // `@sail.money/sailor` ships the SDK at the `@sail.money/sailor/sdk` subpath the
  // agent code imports. It is injected here (rather than carried in the template)
  // because the scaffold is itself a pnpm workspace member — a literal
  // version placeholder in its manifest would be an unresolvable specifier that
  // breaks the monorepo's own `pnpm install`. It is a *dev*Dependency because the
  // SDK imports are type-only and the agent runs via `npx sailor`, so the package
  // is only needed for typecheck + editor/agent DX, never at runtime. Pinning it
  // to the running CLI's own version keeps the SDK in lockstep with the CLI that
  // created the project; a caret range lets compatible patch/minor updates flow.
  const pkgPath = path.join(dest, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<
      string,
      Record<string, string>
    >;
    pkg.name = name as never;
    const devDeps = pkg.devDependencies ?? {};
    // Single published package (@sail.money/sailor); dev/beta/latest are just
    // dist-tags of it. Pin the SDK devDependency to the running CLI's version.
    devDeps[CANONICAL_PKG] = `^${cliVersion()}`;
    pkg.devDependencies = devDeps;
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  // Strip the monorepo-only tsconfig path mapping from the emitted project.
  // In-repo, scaffold/tsconfig.json maps `@sail.money/sailor/sdk` to the
  // SDK source (`../../packages/sdk/src/index.ts`) so the monorepo's own template
  // typecheck resolves without an install — but that relative path does not exist
  // in a scaffolded project. There, the subpath must resolve via normal NodeNext
  // resolution against the installed `@sail.money/sailor` devDependency, so we
  // drop the `paths` mapping (and the `baseUrl` that only exists to anchor it).
  const tsconfigPath = path.join(dest, "tsconfig.json");
  if (fs.existsSync(tsconfigPath)) {
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8")) as {
      compilerOptions?: Record<string, unknown>;
    };
    const co = tsconfig.compilerOptions;
    if (co && "paths" in co) {
      delete co.paths;
      delete co.baseUrl;
      fs.writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
    }
  }

  scaffoldProjectWorkspace(dest, name, options);
  // The one Foundry workspace a project needs (contracts/, with IPermission.sol
  // and IBatchPermission.sol vendored, its own foundry.toml, and the example
  // test) already came from copyDirSync above — there is no second workspace
  // to scaffold. `sailor mandate deploy --build` builds and reads artifacts
  // from contracts/ (see runForgeBuild in mandate-contracts.ts).

  // Print transition advisory when install mode changes on a re-init (--force).
  const newMode = process.env.SAILOR_INSTALL_MODE === "docker" ? "docker" : "local";
  if (previousConfig?.installMode === "docker" && newMode === "local") {
    const prev = previousConfig.containerName ?? "agent";
    console.log(`\nSwitched to local install. If the Docker container is still running:`);
    console.log(`  docker stop ${prev}`);
    console.log(`You can restart it anytime with the standard docker run command.`);
  } else if (previousConfig?.installMode === "local" && newMode === "docker") {
    const containerName = process.env.SAILOR_CONTAINER_NAME ?? "agent";
    console.log(`\nSwitched to Docker install (container: ${containerName}).`);
  }

  printWelcome(dest, name, inPlace, !!options.rpcUrl, /* freshInit */ true);
}

function chainLabel(chainId: number): string {
  const labels: Record<number, string> = {
    8453: "Base",
    42161: "Arbitrum",
    84532: "Base Sepolia",
    130: "Unichain",
  };
  return labels[chainId] ?? `Chain ${chainId}`;
}

type ProjectState =
  | { kind: "A" }
  | { kind: "B"; projectName: string; chain: string }
  | { kind: "C"; projectName: string; chain: string; sma: string }
  | { kind: "D"; projectName: string; chain: string; sma: string; permissionCount: number };

function detectState(dest: string): ProjectState {
  try {
    const configRaw = fs.readFileSync(path.join(dest, ".sail", "config.json"), "utf-8");
    const config = JSON.parse(configRaw) as { name?: string; chainId?: number };
    const projectName = config.name ?? path.basename(dest);

    const account = readActiveAccount(path.join(dest, ".sail"));
    if (!account) {
      return { kind: "B", projectName, chain: chainLabel(config.chainId ?? 0) };
    }

    const sma = account.safe ?? "";
    const chain = chainLabel(account.chainId ?? config.chainId ?? 0);

    let permissionCount = 0;
    try {
      const mandatesRaw = fs.readFileSync(
        path.join(dest, ".sail", "state", "mandates.json"),
        "utf-8",
      );
      const mandates = JSON.parse(mandatesRaw) as { mandates?: unknown[] };
      permissionCount = Array.isArray(mandates.mandates) ? mandates.mandates.length : 0;
    } catch {
      // no mandates file or unparseable — treat as 0
    }

    if (permissionCount > 0) {
      return { kind: "D", projectName, chain, sma, permissionCount };
    }
    return { kind: "C", projectName, chain, sma };
  } catch {
    return { kind: "A" };
  }
}

function printWelcome(dest: string, name: string, inPlace: boolean, _hasRpc: boolean, freshInit = false): void {
  // A fresh sailor init always shows STATE A — the project was just created.
  const state = freshInit ? { kind: "A" as const } : detectState(dest);

  if (state.kind === "B") {
    console.log("\nWelcome back.\n");
    console.log(`Project: ${state.projectName} | Network: ${state.chain}`);
    console.log("Status: SMA not yet deployed.\n");
    console.log("Next:");
    console.log("  sailor ui start");
    console.log("  Connect your wallet and deploy your SMA in the browser.\n");
    console.log('Or open this folder in your AI coding agent and say: "continue"');
    return;
  }

  if (state.kind === "C") {
    console.log("\nWelcome back.\n");
    console.log(`Project: ${state.projectName}`);
    console.log(`SMA: ${state.sma} on ${state.chain}`);
    console.log(
      "Permissions: none registered yet — your agent has no mandate to execute against.\n",
    );
    console.log("Next (see the sailor-navigator skill):");
    console.log("  Station 2 — define the strategy: the sailor-strategy skill writes its concrete spec");
    console.log("    and registers it: sailor strategy create <name> --sma " + state.sma);
    console.log("  Station 3 — the sailor-mandate-planner skill then reads that spec and decides");
    console.log("    shared-template vs. bespoke, and only then walks you through deploying,");
    console.log("    simulating, and registering the mandate.\n");
    console.log('Or open this folder in your AI coding agent and say: "continue"');
    return;
  }

  if (state.kind === "D") {
    console.log("\nWelcome back.\n");
    console.log(`Project: ${state.projectName}`);
    console.log(`SMA: ${state.sma} on ${state.chain}`);
    console.log(`Permissions: ${state.permissionCount} registered\n`);
    console.log('Open this folder in your AI coding agent and say: "continue"');
    return;
  }

  // STATE A — fresh project.
  if (!inPlace) console.log(`\nCreated ${name}/`);
  console.log([
    "",
    "⛵ Sailor — your project is ready.",
    "",
    'Open this folder in Claude Code, Cursor, or another AI coding agent — that\'s where',
    'the guided setup happens. Once it\'s open, say "start".',
    "",
    "No coding agent? Run `sailor ui start` for the browser dashboard instead.",
  ].join("\n"));
  console.log([
    "",
    "╔══════════════════════════════════════════════════════════════════════╗",
    "║   !!  AI AGENT — MANDATORY ACTION REQUIRED BEFORE CONTINUING   !!    ║",
    "╠══════════════════════════════════════════════════════════════════════╣",
    "║                                                                      ║",
    "║" + "  STOP AND READ .agents/skills/sailor-navigator/SKILL.md".padEnd(70) + "║",
    "║" + "  (the FULL FILE) before responding or running any command.".padEnd(70) + "║",
    "║" + '  When done, confirm: "I have read sailor-navigator and am ready."'.padEnd(70) + "║",
    "║                                                                      ║",
    "║" + "  It is the map: five stations from setup to a live agent —".padEnd(70) + "║",
    "║  it tells you exactly what to do and when. Detailed procedures       ║",
    "║  live in .agents/skills/.                                            ║",
    "║                                                                      ║",
    "║  IF SAILOR IS RUNNING IN DOCKER:                                     ║",
    "║    • Read project files from your local filesystem — they are        ║",
    "║      shared via volume mount, do NOT use docker exec to read them.   ║",
    "║    • Prefix every sailor command with:                               ║",
    "║      docker exec <containerName> sailor <command>                    ║",
    "║                                                                      ║",
    "╚══════════════════════════════════════════════════════════════════════╝",
    "",
  ].join("\n"));
}
