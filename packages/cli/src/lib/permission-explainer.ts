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

// Section-header matchers, loose enough to cover the shipped example headers
// (F17): "ENFORCED ON-CHAIN:", "ENFORCES ON-CHAIN (…)", "NOT ENFORCED:",
// "AGENT-ENFORCED / NOT BOUNDED HERE". `enforced` requires the ON-CHAIN
// adjacency so an "AGENT-ENFORCED / NOT BOUNDED" line can't be misread as the
// enforced section.
const ENFORCED_HEADER = /ENFORCE[SD]\s+ON-CHAIN/i;
const NOT_ENFORCED_HEADER = /NOT\s+(ENFORCED|BOUNDED)/i;

function parseStructured(src: string): PermissionExplanation | null {
  if (!ENFORCED_HEADER.test(src)) return null;

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

    // Section headers. Check "not enforced/bounded" first: those lines never
    // carry the ON-CHAIN adjacency the enforced matcher requires, and checking
    // them first avoids any ambiguity with "AGENT-ENFORCED / NOT BOUNDED".
    if (NOT_ENFORCED_HEADER.test(trimmed)) { section = "notEnforced"; continue; }
    if (ENFORCED_HEADER.test(trimmed)) { section = "enforced"; continue; }
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

  // A NatSpec tag's text can wrap across several `///` lines until the next tag
  // or a non-NatSpec line (F15). Track the current tag and join its
  // continuation lines into one entry instead of dropping all but the first.
  let current: "enforced" | "notEnforced" | null = null;
  let buf: string[] = [];
  const flush = (): void => {
    if (current && buf.length) {
      const text = buf.join(" ").replace(/\s+/g, " ").trim();
      if (text) (current === "enforced" ? enforced : notEnforced).push(text);
    }
    buf = [];
  };

  for (const line of src.split("\n")) {
    const t = line.trim();
    const tagged = t.match(/^\/\/\/\s*@(\w+)\s+(.+)$/);
    if (tagged) {
      const [, tag, text] = tagged;
      if (tag === "notice") { flush(); current = "enforced"; buf.push(text.trim()); }
      else if (tag === "dev") { flush(); current = "notEnforced"; buf.push(text.trim()); }
      else { flush(); current = null; } // @title/@param/etc. close the block
      continue;
    }
    const cont = t.match(/^\/\/\/\s?(.*)$/); // `///` line with no tag → continuation
    if (cont && current) {
      const text = cont[1].trim();
      if (text) buf.push(text);
      continue;
    }
    if (!t.startsWith("///")) { flush(); current = null; } // non-NatSpec line ends the block
  }
  flush();

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
