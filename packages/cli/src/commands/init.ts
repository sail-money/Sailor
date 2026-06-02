import fs from "node:fs";
import path from "node:path";
import { scaffoldFoundryWorkspace } from "../lib/foundry.js";
import { packageRoot } from "../lib/packagePaths.js";

const TEMPLATE_COPY_EXCLUDES = new Set([
  "node_modules",
  "dist",
  "out",
  "cache",
  "broadcast",
  ".git",
]);

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (TEMPLATE_COPY_EXCLUDES.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

type InitOptions = {
  chain?: string;
  rpcUrl?: string;
  template?: string;
};

const DEFAULT_CHAIN_ID = 8453;

const SAIL_WORKSPACE_README = `# Sailor Project Workspace

This folder is the local workspace for one Sailor agent deployment.

## Layout

- \`config.json\` is the project manifest: name, chain, and state location.
- \`keys/\` stores encrypted local signing keys. Never commit these files.
- \`runtime/\` is for local UI and signing handoff state.
- \`state/\` is for persistent agent state, audit logs, and tx history.

AI coding agents should read this file and \`config.json\`, plus \`../AGENTS.md\`
(setup + operating index), \`../sail/WIZARD.md\` (account setup), and
\`../AGENT_PLAYBOOK.md\` + \`../docs/PERMISSION_MODEL.md\` (operating — read before any
dispatch) before changing strategy code or running commands that touch funds.
`;

function writeIfMissing(file: string, content: string): void {
  if (!fs.existsSync(file)) fs.writeFileSync(file, content, "utf-8");
}

function scaffoldProjectWorkspace(dest: string, name: string, options: InitOptions): void {
  const chainId = Number(options.chain ?? DEFAULT_CHAIN_ID);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`Invalid chain id: "${options.chain}"`);
  }

  const sailDir = path.join(dest, ".sail");
  fs.mkdirSync(path.join(sailDir, "keys"), { recursive: true });
  fs.mkdirSync(path.join(sailDir, "runtime"), { recursive: true });
  fs.mkdirSync(path.join(sailDir, "state"), { recursive: true });

  fs.writeFileSync(
    path.join(sailDir, "config.json"),
    `${JSON.stringify(
      {
        version: 1,
        name,
        chainId,
        stateDir: ".sail/state",
        createdAt: new Date().toISOString(),
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

  fs.writeFileSync(
    path.join(dest, ".env.example"),
    `# Sailor agent environment
RPC_URL=https://your-rpc-endpoint
CHAIN_ID=${chainId}

# Optional for non-interactive runs
# SAIL_PASSPHRASE=change-me-to-a-strong-passphrase
`,
    "utf-8",
  );

  if (options.rpcUrl) {
    writeIfMissing(
      path.join(sailDir, ".env.local"),
      `RPC_URL=${options.rpcUrl}
CHAIN_ID=${chainId}
`,
    );
  }
}

export async function initCommand(
  dir?: string,
  options: InitOptions = {},
): Promise<void> {
  const inPlace = !dir || dir === ".";
  const dest = inPlace ? process.cwd() : path.join(process.cwd(), dir);
  const name = path.basename(dest);

  const templatesDir = path.join(packageRoot(), "templates");
  const templateName = options.template ?? "dca-rebalancer";

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

  if (!inPlace && fs.existsSync(dest)) {
    throw new Error(`Directory already exists: ${dest}`);
  }

  if (inPlace && fs.existsSync(path.join(dest, ".sail", "config.json"))) {
    throw new Error(`Already initialized — .sail/config.json exists`);
  }

  console.log(inPlace ? "Scaffolding into current directory…" : `Scaffolding ${name}/ from ${templateName} template…`);
  copyDirSync(templateSrc, dest);

  // Patch package.json: set name and resolve @sail/sdk.
  // The template uses `workspace:*` (pnpm monorepo protocol) which is invalid
  // outside the Sailor monorepo. When installed as an npm package, resolve it to
  // the SDK bundled alongside the CLI in the same package installation.
  const pkgPath = path.join(dest, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<
      string,
      Record<string, string>
    >;
    pkg.name = name as never;
    const deps = pkg.dependencies ?? {};
    if (deps["@sail/sdk"] === "workspace:*") {
      // Resolve to the SDK installed alongside this CLI package.
      // packageRoot() = …/node_modules/@sailagent/sailor → SDK is at packages/sdk
      // relative to the monorepo root, but when distributed only packages/cli/dist
      // and packages/ui/dist are shipped. Point at the dist that IS present.
      const sdkPath = path.join(packageRoot(), "packages", "sdk");
      deps["@sail/sdk"] = fs.existsSync(sdkPath)
        ? `file:${sdkPath}`
        : // Fallback: SDK not bundled — user must install it manually.
          "0.1.0";
    }
    pkg.dependencies = deps;
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  scaffoldProjectWorkspace(dest, name, options);
  scaffoldFoundryWorkspace(dest);

  console.log("\nDone! Your agent is ready.\n");
  console.log("Next steps:");
  if (!inPlace) console.log(`  cd ${name}`);
  if (!options.rpcUrl) console.log("  cp .env.example .sail/.env.local");
  console.log("  sailor capabilities    # what you can build here — read-only, no gas, no wallet");
  console.log("  sailor doctor          # kernel model + RPC + gas balances — read-only, no gas");
  console.log("  Open this folder in Claude Code, Cursor, or Codex");
  console.log('  Say: "start"\n');
  console.log("The setup guide in sail/WIZARD.md will walk you through everything.");
}
