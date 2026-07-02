import fs from "node:fs";
import path from "node:path";
import { chains } from "@sail/sdk";
import { scaffoldFoundryWorkspace } from "../lib/foundry.js";
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

AI coding agents should read the project's \`AGENTS.md\` and this folder's \`config.json\`
before changing strategy code or running commands that touch funds.
`;

const CANONICAL_PKG = "@sail.money/sailor";
const DEV_PKG = "@dev.sail.money/sailor";

/**
 * Name and version of the running CLI, read from its package manifest.
 * When installed from the dev org (@dev.sail.money/sailor) the name differs
 * from the canonical published name — callers use this to emit an npm alias
 * so the scaffolded project resolves from the same registry/org the user
 * already has configured, while keeping the import path canonical.
 */
function cliPackageInfo(): { name: string; version: string } {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(packageRoot(), "package.json"), "utf-8"),
    ) as { name?: string; version?: string };
    return {
      name: pkg.name ?? CANONICAL_PKG,
      version: pkg.version ?? "0.0.0",
    };
  } catch {
    return { name: CANONICAL_PKG, version: "0.0.0" };
  }
}

function scaffoldProjectWorkspace(dest: string, name: string, options: InitOptions): void {
  // chainId is null when no --chain flag is provided. Stage 1 of AGENTS.md handles
  // chain selection conversationally — the assistant asks the user which chain to use
  // and writes it into config.json before proceeding. This keeps init frictionless.
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

  const templatesDir = path.join(packageRoot(), "templates");
  const templateName = options.template ?? "default";

  if (/[/\\.]/.test(templateName) || templateName.includes("..")) {
    throw new Error(`Invalid template name: "${templateName}"`);
  }

  const templateSrc = path.join(templatesDir, templateName);

  const availableTemplates = (): string =>
    fs.existsSync(templatesDir)
      ? fs.readdirSync(templatesDir)
          .filter(e => fs.existsSync(path.join(templatesDir, e, "package.json")))
          .join(", ") || "none"
      : "none";

  if (!fs.existsSync(templateSrc) || !fs.existsSync(path.join(templateSrc, "package.json"))) {
    const available = availableTemplates();
    const hint =
      available === "none"
        ? `\nNo templates found under ${templatesDir}.\n` +
          "If you're running the in-tree CLI bundle from a monorepo checkout, the scaffolder\n" +
          "couldn't locate the repo's templates/ directory. Install the published package, or\n" +
          "run from the repo root."
        : ` Available: ${available}`;
    throw new Error(`Template "${templateName}" not found.${hint}`);
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

  copyDirSync(templateSrc, dest);

  // Copy shared reference assets from the package into the project so the agent
  // can read them locally regardless of where Sailor is installed.
  const pkgRoot = packageRoot();

  const examplesPermSrc = path.join(pkgRoot, "examples", "permissions");
  if (fs.existsSync(examplesPermSrc)) {
    copyDirSync(examplesPermSrc, path.join(dest, "examples", "permissions"));
  }

  // The IPermission authoring scaffold — `sailor mandate templates` points the
  // user at examples/custom-mandate/README.md, so it must exist locally.
  const customMandateSrc = path.join(pkgRoot, "examples", "custom-mandate");
  if (fs.existsSync(customMandateSrc)) {
    copyDirSync(customMandateSrc, path.join(dest, "examples", "custom-mandate"));
  }

  // Patch package.json: set the project name and inject the Sailor CLI as a
  // devDependency pinned to the version that generated this scaffold.
  //
  // `@sail.money/sailor` ships the SDK at the `@sail.money/sailor/sdk` subpath the
  // agent code imports. It is injected here (rather than carried in the template)
  // because templates/default is itself a pnpm workspace member — a literal
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
    const { name: cliName, version: cliVer } = cliPackageInfo();
    // Use npm alias syntax when the installed package comes from a non-canonical
    // org (e.g. @dev.sail.money/sailor) so the scaffolded project resolves from
    // the same registry the user already has configured. The dep key stays as the
    // canonical name so all `@sail.money/sailor/sdk` imports work unchanged.
    devDeps[CANONICAL_PKG] =
      cliName === DEV_PKG ? `npm:${DEV_PKG}@^${cliVer}` : `^${cliVer}`;
    pkg.devDependencies = devDeps;
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  // Strip the monorepo-only tsconfig path mapping from the emitted project.
  // In-repo, templates/default/tsconfig.json maps `@sail.money/sailor/sdk` to the
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
  scaffoldFoundryWorkspace(dest);

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

    const accountPath = path.join(dest, ".sail", "account.json");
    if (!fs.existsSync(accountPath)) {
      return { kind: "B", projectName, chain: chainLabel(config.chainId ?? 0) };
    }

    const accountRaw = fs.readFileSync(accountPath, "utf-8");
    const account = JSON.parse(accountRaw) as { safe?: string; chainId?: number };
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
    console.log('Or open this folder in your AI coding assistant and say: "continue"');
    return;
  }

  if (state.kind === "C") {
    console.log("\nWelcome back.\n");
    console.log(`Project: ${state.projectName}`);
    console.log(`SMA: ${state.sma} on ${state.chain}`);
    console.log(
      "Permissions: none registered yet — your agent has no mandate to execute against.\n",
    );
    console.log("Next:");
    console.log(
      "  Write your permission contract in mandates/ (start from BoundedCallPermission.sol)",
    );
    console.log("  forge build");
    console.log(`  sailor mandate deploy --contract <Name> --attach --sma ${state.sma}\n`);
    console.log('Or open this folder in your AI coding assistant and say: "continue"');
    return;
  }

  if (state.kind === "D") {
    console.log("\nWelcome back.\n");
    console.log(`Project: ${state.projectName}`);
    console.log(`SMA: ${state.sma} on ${state.chain}`);
    console.log(`Permissions: ${state.permissionCount} registered\n`);
    console.log('Open this folder in your AI coding assistant and say: "continue"');
    return;
  }

  // STATE A — fresh project.
  if (!inPlace) console.log(`\nCreated ${name}/`);
  console.log([
    "",
    "╔══════════════════════════════════════════════════════════════════════╗",
    "║   !!  AI AGENT — MANDATORY ACTION REQUIRED BEFORE CONTINUING   !!    ║",
    "╠══════════════════════════════════════════════════════════════════════╣",
    "║                                                                      ║",
    "║  YOU MUST STOP AND READ AGENTS.md BEFORE DOING ANYTHING ELSE.        ║",
    "║                                                                      ║",
    "║  DO NOT:                                                             ║",
    "║    • respond to the user yet                                         ║",
    "║    • run any sailor commands                                         ║",
    "║    • assume you know what to do next                                 ║",
    "║                                                                      ║",
    "║  DO THIS FIRST:                                                      ║",
    "║    1. Read AGENTS.md in the project root (FULL FILE, not a skim)     ║",
    "║    2. Follow it — the detailed steps live in .agents/skills/         ║",
    '║    3. Confirm to the user: "I have read AGENTS.md and am ready."     ║',
    "║                                                                      ║",
    "║  If you skip this step, setup WILL break and you will have to        ║",
    "║  restart. There are no shortcuts.                                    ║",
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
