import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PermissionExplanation = {
  source: "structured" | "natspec" | "require-only" | "none";
  protocol?: string;
  version?: string;
  chain?: string;
  target?: string;
  /** Constraints enforced on-chain by evaluate(). */
  enforced: string[];
  /** Things NOT enforced — controlled by agent code instead. */
  notEnforced: string[];
};

/**
 * Statically extract a human-readable explanation for a permission contract.
 *
 * Priority:
 * 1. Sailor structured header comment (Protocol:, ENFORCED ON-CHAIN:, NOT ENFORCED:)
 * 2. NatSpec (/// @notice, /// @dev)
 * 3. require() messages extracted from evaluate()
 * 4. null — nothing found, caller should skip the dropdown
 */
export function explainPermission(
  name: string,
  sourcePath?: string,
): PermissionExplanation | null {
  const resolved = sourcePath ?? join(process.cwd(), "mandates", `${name}.sol`);
  let src: string;
  try {
    src = readFileSync(resolved, "utf8");
  } catch {
    return null;
  }

  return parseStructured(src) ?? parseNatSpec(src) ?? parseRequires(src);
}

// ── Structured header comment (the Sailor standard format) ────────────────────

function parseStructured(src: string): PermissionExplanation | null {
  if (!src.includes("ENFORCED ON-CHAIN")) return null;

  const lines = src.split("\n");
  const result: PermissionExplanation = {
    source: "structured",
    enforced: [],
    notEnforced: [],
  };

  // Collect all `//`-prefixed lines before the first import/contract statement.
  const headerLines: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("import ") || t.startsWith("contract ") || t.startsWith("abstract contract ")) break;
    if (t.startsWith("//")) headerLines.push(t.slice(2)); // strip `//`
  }

  let section: "enforced" | "notEnforced" | null = null;

  for (const raw of headerLines) {
    const trimmed = raw.trim();

    // Separator lines (─────)
    if (/^─+$/.test(trimmed)) continue;

    // Section headers
    if (trimmed.includes("ENFORCED ON-CHAIN")) { section = "enforced"; continue; }
    if (trimmed.includes("NOT ENFORCED")) { section = "notEnforced"; continue; }
    // VERIFY BEFORE USE section is omitted — deploy-time detail, not user-facing
    if (trimmed.includes("VERIFY BEFORE USE")) { section = null; continue; }

    // Key : Value metadata (only before any section starts)
    if (section === null) {
      const kv = trimmed.match(/^(Protocol|Version|Chain|Target)\s*:\s*(.+)$/i);
      if (kv) {
        const key = kv[1].toLowerCase() as "protocol" | "version" | "chain" | "target";
        result[key] = kv[2].trim();
      }
    }

    // Bullet points
    if (section && trimmed.startsWith("•")) {
      const bullet = trimmed.slice(1).trim();
      if (bullet) result[section].push(bullet);
    }
  }

  if (result.enforced.length === 0 && !result.protocol) return null;
  return result;
}

// ── NatSpec fallback ──────────────────────────────────────────────────────────

function parseNatSpec(src: string): PermissionExplanation | null {
  const enforced: string[] = [];
  const notEnforced: string[] = [];

  for (const line of src.split("\n")) {
    const t = line.trim();
    const notice = t.match(/^\/\/\/\s*@notice\s+(.+)$/);
    if (notice) enforced.push(notice[1].trim());
    const dev = t.match(/^\/\/\/\s*@dev\s+(.+)$/);
    if (dev) notEnforced.push(dev[1].trim());
  }

  if (enforced.length === 0 && notEnforced.length === 0) return null;
  return { source: "natspec", enforced, notEnforced };
}

// ── require() message fallback ────────────────────────────────────────────────

function parseRequires(src: string): PermissionExplanation | null {
  const enforced: string[] = [];
  const re = /require\s*\([^,)]+,\s*["']([^"']+)["']\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) enforced.push(m[1]);
  if (enforced.length === 0) return null;
  return { source: "require-only", enforced, notEnforced: [] };
}
