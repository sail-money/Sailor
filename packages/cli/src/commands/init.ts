import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scaffoldFoundryWorkspace } from "../lib/foundry.js";

function findWorkspaceRoot(from: string): string {
  let dir = from;
  for (let depth = 0; depth < 20; depth++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate pnpm-workspace.yaml — is this a Sailor monorepo checkout?");
}

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
};

const DEFAULT_CHAIN_ID = 8453;

const SAIL_WORKSPACE_README = `# Sailor Project Workspace

This folder is the local workspace for one Sailor agent deployment.

## Layout

- \`config.json\` is the project manifest: name, chain, and state location.
- \`keys/\` stores encrypted local signing keys. Never commit these files.
- \`runtime/\` is for local UI and signing handoff state.
- \`state/\` is for persistent agent state, audit logs, and tx history.
AI coding agents should read this file, \`config.json\`, and \`../sail/WIZARD.md\`
before changing strategy code or running commands that touch funds.
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
  name = "my-sailor-agent",
  options: InitOptions = {},
): Promise<void> {
  const packageDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = findWorkspaceRoot(packageDir);
  const templateSrc = path.join(workspaceRoot, "templates", "dca-rebalancer");
  const dest = path.join(process.cwd(), name);

  if (!fs.existsSync(templateSrc)) {
    throw new Error(`Template not found at ${templateSrc}`);
  }

  if (fs.existsSync(dest)) {
    throw new Error(`Directory already exists: ${dest}`);
  }

  console.log(`Scaffolding ${name}/ from dca-rebalancer template…`);
  copyDirSync(templateSrc, dest);

  // Patch package.json name
  const pkgPath = path.join(dest, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
    pkg.name = name;
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  scaffoldProjectWorkspace(dest, name, options);
  // Foundry workspace for authoring + deploying custom mandate contracts.
  scaffoldFoundryWorkspace(dest);

  console.log(`\nDone! Your agent is ready at ./${name}/\n`);
  console.log("Next steps:");
  console.log(`  cd ${name}`);
  if (!options.rpcUrl) {
    console.log("  cp .env.example .sail/.env.local");
  }
  console.log("  Open this folder in Claude Code, Cursor, or Codex");
  console.log('  Say: "start"\n');
  console.log("The setup guide in sail/WIZARD.md will walk you through everything.");
}
