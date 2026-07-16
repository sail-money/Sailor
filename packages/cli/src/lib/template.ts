import fs from "node:fs";
import path from "node:path";

export const TEMPLATE_COPY_EXCLUDES = new Set([
  "node_modules",
  "dist",
  "out",
  "cache",
  "broadcast",
  ".git",
  ".DS_Store",
]);

export function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (TEMPLATE_COPY_EXCLUDES.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    // Underscore-prefixed → dot-prefixed: npm strips dot-files (.gitignore,
    // .env.local) from package tarballs even inside `files`-listed directories.
    // Templates ship them as _gitignore / _env.local; restore the real name here.
    const destName = entry.name.startsWith("_") ? `.${entry.name.slice(1)}` : entry.name;
    const destPath = path.join(dest, destName);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function writeIfMissing(file: string, content: string): void {
  if (!fs.existsSync(file)) fs.writeFileSync(file, content, "utf-8");
}

export function copyDirSyncIfMissing(src: string, dest: string, added: string[] = [], base = dest): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (TEMPLATE_COPY_EXCLUDES.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destName = entry.name.startsWith("_") ? `.${entry.name.slice(1)}` : entry.name;
    const destPath = path.join(dest, destName);
    if (entry.isDirectory()) {
      copyDirSyncIfMissing(srcPath, destPath, added, base);
    } else if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
      added.push(path.relative(base, destPath));
    }
  }
}
