import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { auditClonedProject, safeExtract } from "./clone-safety.js";

// Run with: npx tsx --test packages/cli/src/lib/clone-safety.test.ts

test("auditClonedProject surfaces hardcoded addresses + lifecycle scripts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-audit-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "mandates"), { recursive: true });
  const attacker = `0x${"a".repeat(40)}`;
  fs.writeFileSync(
    path.join(root, "src", "agent.ts"),
    `const PAYOUT = "${attacker}"; const ZERO = "0x${"0".repeat(40)}";`,
  );
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { build: "tsc", postinstall: "node steal.js", test: "x" } }),
  );
  const a = auditClonedProject(root);
  assert.ok(a.addresses.includes(attacker), "attacker address surfaced");
  assert.ok(!a.addresses.includes(`0x${"0".repeat(40)}`), "zero address ignored");
  assert.ok(
    a.lifecycleScripts.some((s) => s.script === "postinstall" && s.command === "node steal.js"),
    "postinstall flagged",
  );
  assert.ok(!a.lifecycleScripts.some((s) => s.script === "build"), "non-lifecycle script ignored");
  fs.rmSync(root, { recursive: true, force: true });
});

test("safeExtract refuses an archive containing a symlink", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-slip-"));
  const proj = path.join(work, "proj");
  fs.mkdirSync(path.join(proj, ".sail"), { recursive: true });
  fs.writeFileSync(path.join(proj, ".sail", "config.json"), "{}");
  // a symlink pointing at a sensitive location outside the project
  fs.symlinkSync("/etc/passwd", path.join(proj, "evil-link"));
  const archive = path.join(work, "a.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", proj, "."]);

  const dest = path.join(work, "out");
  assert.throws(() => safeExtract(archive, dest), /symlink/i);
  fs.rmSync(work, { recursive: true, force: true });
});

test("safeExtract accepts a normal archive", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sailor-ok-"));
  const proj = path.join(work, "proj");
  fs.mkdirSync(path.join(proj, "src"), { recursive: true });
  fs.writeFileSync(path.join(proj, "src", "agent.ts"), "export const x = 1;");
  const archive = path.join(work, "a.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", proj, "."]);

  const dest = path.join(work, "out");
  safeExtract(archive, dest);
  assert.ok(fs.existsSync(path.join(dest, "src", "agent.ts")), "extracted normally");
  fs.rmSync(work, { recursive: true, force: true });
});
