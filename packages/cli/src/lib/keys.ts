import { type EncryptedKeystore, LocalKeyring } from "@sail/sdk";
import { isAddress } from "viem";
import { fileExists, promptHidden, readJsonFile, sailPath } from "./io.js";

export const ROLES = ["manager", "permissionSigner"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Maps loose user input to a canonical role. Accepts both the user-facing names
 * ("agent wallet", "mandate signer") and the legacy/internal tokens ("manager",
 * "permissionSigner") so scripts and prompts keep working.
 */
export function normalizeRole(input: string): Role | null {
  const n = input.trim().toLowerCase().replace(/[-_\s]/g, "");
  if (n === "manager" || n === "mgr" || n === "m" || n === "agent" || n === "agentwallet") {
    return "manager";
  }
  if (
    n === "permissionsigner" ||
    n === "signer" ||
    n === "ps" ||
    n === "permission" ||
    n === "mandatesigner" ||
    n === "mandate"
  ) {
    return "permissionSigner";
  }
  return null;
}

/** User-facing label for a role. Internal key files stay <role>.json. */
export function roleLabel(role: Role): string {
  return role === "manager" ? "agent wallet" : "mandate signer";
}

/** Lowercase the safe address and reduce it to `0x` + hex only. */
function safeHex(safe: string): string {
  return safe.toLowerCase().replace(/^0x/, "").replace(/[^0-9a-f]/g, "");
}

/**
 * Per-SMA (or shared) keystore path for a role.
 *
 * The per-SMA filename keeps the `0x` prefix — `<role>-0x<address>.json` — so
 * the CLI and the dashboard UI (packages/ui/server.js, which writes the same
 * name) agree on a single file per SMA. The address is lowercased and stripped
 * to `0x` + hex as defense-in-depth: a crafted value containing path separators
 * or ".." can never escape the keys/ directory.
 */
export function keyPath(role: Role, safe?: string): string {
  if (safe) {
    return sailPath("keys", `${role}-0x${safeHex(safe)}.json`);
  }
  return sailPath("keys", `${role}.json`);
}

/**
 * Legacy per-SMA keystore filename written by CLI versions before the `0x`
 * prefix was unified with the UI (`<role>-<address>.json`, no prefix). Resolved
 * as a fallback so keys created by an older CLI keep loading.
 */
function legacyKeyPath(role: Role, safe: string): string {
  return sailPath("keys", `${role}-${safeHex(safe)}.json`);
}

/**
 * Resolves the keystore path for a role, preferring a per-SMA key
 * (`<role>-0x<safe>.json`, written by the dashboard's "add delegated signer"
 * flow) when present, then a legacy per-SMA file (no `0x`), and finally falling
 * back to the shared `<role>.json`. This keeps single-SMA projects working
 * unchanged while letting each SMA hold its own delegated signer — and lets the
 * CLI load a per-SMA key the dashboard created, regardless of which wrote it.
 */
export function resolveKeyPath(role: Role, safe?: string): string {
  if (safe) {
    const perSma = keyPath(role, safe);
    if (fileExists(perSma)) return perSma;
    const legacy = legacyKeyPath(role, safe);
    if (fileExists(legacy)) return legacy;
  }
  return keyPath(role);
}

export function keyExists(role: Role, safe?: string): boolean {
  return fileExists(resolveKeyPath(role, safe));
}

/**
 * Loads and decrypts a role key, prompting for its password.
 * Throws a clear, actionable error if the key is missing or the password is wrong.
 */
export async function loadKeyring(role: Role, safe?: string): Promise<LocalKeyring> {
  const keystore = readJsonFile<EncryptedKeystore>(resolveKeyPath(role, safe));
  if (!keystore) {
    throw new Error(
      `No ${roleLabel(role)} found.\nRun "sailor keys generate" and choose "${roleLabel(role)}" first.`,
    );
  }
  const password = await promptHidden(`Password for ${roleLabel(role)} key`);
  try {
    return await LocalKeyring.fromKeystore(keystore, password);
  } catch {
    throw new Error("Invalid password.");
  }
}

/**
 * Loads the manager key for non-interactive use.
 * Reads SAIL_PASSPHRASE from the environment (injected from .sail/.env.local by
 * the caller) to skip the password prompt — required for `sailor run` in CI
 * and GitHub Actions where stdin is not a TTY.
 */
export async function loadManagerSigner(safe?: string): Promise<LocalKeyring> {
  const passphrase = process.env.SAIL_PASSPHRASE;
  if (passphrase) {
    const keystore = readJsonFile<EncryptedKeystore>(resolveKeyPath("manager", safe));
    if (!keystore) {
      throw new Error(
        'No agent wallet found.\nRun "sailor keys generate" and choose "agent wallet".',
      );
    }
    try {
      return await LocalKeyring.fromKeystore(keystore, passphrase);
    } catch {
      // The keystore exists and a passphrase was supplied, but it didn't decrypt.
      // Say exactly that — not the generic "Invalid password" — so an operator
      // knows to fix SAIL_PASSPHRASE rather than suspect a corrupt key.
      throw new Error(
        "SAIL_PASSPHRASE does not match this keystore.\n" +
          "Check the value in .sail/.env.local (or the SAIL_PASSPHRASE CI secret) — " +
          "it must be the passphrase the agent wallet was encrypted with.",
      );
    }
  }
  // No SAIL_PASSPHRASE. When stdin is not a TTY (CI, the Monday cron, piped
  // input) we cannot prompt, so a present-but-unreadable keystore would otherwise
  // fall through to a misleading "Invalid password". Fail with the real cause.
  if (process.stdin.isTTY !== true && keyExists("manager", safe)) {
    throw new Error(
      "Agent keystore found but SAIL_PASSPHRASE is not set.\n" +
        "If you created the key in the dashboard, add SAIL_PASSPHRASE to .sail/.env.local, " +
        'or run "sailor keys generate".\n' +
        "For CI, set the SAIL_PASSPHRASE GitHub Actions secret.",
    );
  }
  return loadKeyring("manager", safe);
}

/**
 * Canonical keystore path for a specific manager address.
 * Stored as `.sail/keys/managers/<hex>.json` — separate namespace from per-SMA
 * keystores (`manager-0x<safe>.json`) so there is no collision.
 */
export function managerKeystorePath(managerAddr: string): string {
  if (!isAddress(managerAddr, { strict: false })) {
    throw new Error(`managerKeystorePath: invalid address "${managerAddr}"`);
  }
  const hex = managerAddr.toLowerCase().replace(/^0x/, "");
  return sailPath("keys", "managers", `${hex}.json`);
}

/** Loads whichever signing key is available, preferring the permission signer. */
export async function loadAnySigner(): Promise<LocalKeyring> {
  if (keyExists("permissionSigner")) return loadKeyring("permissionSigner");
  if (keyExists("manager")) return loadKeyring("manager");
  throw new Error('No signing key found.\nRun "sailor keys generate" first.');
}
