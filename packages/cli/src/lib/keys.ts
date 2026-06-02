import { type EncryptedKeystore, LocalKeyring } from "@sail/sdk";
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

export function keyPath(role: Role, safe?: string): string {
  if (safe) {
    // Validate that the safe address component cannot escape the keys/ directory.
    // A crafted address containing path separators or ".." would be rejected by
    // the EVM address regex check at call sites, but guard here as defense-in-depth.
    const normalised = safe.toLowerCase().replace(/[^0-9a-f]/g, "");
    return sailPath("keys", `${role}-${normalised}.json`);
  }
  return sailPath("keys", `${role}.json`);
}

/**
 * Resolves the keystore path for a role, preferring a per-SMA key
 * (`<role>-<safe>.json`, written by the dashboard's "add delegated signer"
 * flow) when present, and falling back to the shared `<role>.json` otherwise.
 * This keeps single-SMA projects working unchanged while letting each SMA hold
 * its own delegated signer.
 */
export function resolveKeyPath(role: Role, safe?: string): string {
  if (safe) {
    const perSma = keyPath(role, safe);
    if (fileExists(perSma)) return perSma;
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
    return LocalKeyring.fromKeystore(keystore, passphrase);
  }
  return loadKeyring("manager", safe);
}

/** Loads whichever signing key is available, preferring the permission signer. */
export async function loadAnySigner(): Promise<LocalKeyring> {
  if (keyExists("permissionSigner")) return loadKeyring("permissionSigner");
  if (keyExists("manager")) return loadKeyring("manager");
  throw new Error('No signing key found.\nRun "sailor keys generate" first.');
}
