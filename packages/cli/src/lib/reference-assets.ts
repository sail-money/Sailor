import fs from "node:fs";
import path from "node:path";
import { packageRoot } from "./packagePaths.js";
import { copyDirSyncIfMissing, writeIfMissing } from "./template.js";

/**
 * Re-inject the core Sailor reference material that `sailor share` strips from a
 * published project (it's identical for everyone and lives in the installed
 * package). Mirrors the package-asset copies in `sailor init`. Uses if-missing
 * semantics throughout so the operator's own extracted files always win.
 *
 * Returns the project-relative paths that were added.
 */
export function injectCoreReferenceAssets(dest: string): string[] {
  const added: string[] = [];
  const pkgRoot = packageRoot();

  // The default template carries AGENTS.md, CLAUDE.md, .agents/skills, .cursor,
  // examples/dca, and the .sail workspace README.
  const templateDefault = path.join(pkgRoot, "templates", "default");
  if (fs.existsSync(templateDefault)) {
    copyDirSyncIfMissing(templateDefault, dest, added, dest);
  }

  // Reference permission library + the IPermission authoring scaffold.
  const examplesPerm = path.join(pkgRoot, "examples", "permissions");
  if (fs.existsSync(examplesPerm)) {
    copyDirSyncIfMissing(examplesPerm, path.join(dest, "examples", "permissions"), added, dest);
  }
  const customMandate = path.join(pkgRoot, "examples", "custom-mandate");
  if (fs.existsSync(customMandate)) {
    copyDirSyncIfMissing(customMandate, path.join(dest, "examples", "custom-mandate"), added, dest);
  }

  // Protocol permission-model doc.
  const permModel = path.join(pkgRoot, "docs", "PERMISSION_MODEL.md");
  if (fs.existsSync(permModel)) {
    const target = path.join(dest, "docs", "PERMISSION_MODEL.md");
    if (!fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      writeIfMissing(target, fs.readFileSync(permModel, "utf-8"));
      added.push("docs/PERMISSION_MODEL.md");
    }
  }

  return added;
}
