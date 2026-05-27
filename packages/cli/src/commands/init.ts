import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function findWorkspaceRoot(from: string): string {
  let dir = from;
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        "Could not locate pnpm-workspace.yaml — is this a Sailor monorepo checkout?",
      );
    }
    dir = parent;
  }
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export async function initCommand(name = "my-sailor-agent"): Promise<void> {
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
    pkg["name"] = name;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }

  console.log(`\nDone! Your agent is ready at ./${name}/\n`);
  console.log("Next steps:");
  console.log(`  cd ${name}`);
  console.log("  Open this folder in Claude Code, Cursor, or Codex");
  console.log('  Say: "start"\n');
  console.log("The setup guide in sail/WIZARD.md will walk you through everything.");
}
