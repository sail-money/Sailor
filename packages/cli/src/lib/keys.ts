import { type EncryptedKeystore, LocalKeyring } from "@sail/sdk";
import { fileExists, promptHidden, readJsonFile, sailPath } from "./io.js";

export const ROLES = ["manager", "permissionSigner"] as const;
export type Role = (typeof ROLES)[number];

/** Maps loose user input ("signer", "permission-signer", "MGR") to a canonical role. */
export function normalizeRole(input: string): Role | null {
  const n = input.trim().toLowerCase().replace(/[-_\s]/g, "");
  if (n === "manager" || n === "mgr" || n === "m") return "manager";
  if (n === "permissionsigner" || n === "signer" || n === "ps" || n === "permission") {
    return "permissionSigner";
  }
  return null;
}

export function keyPath(role: Role, safe?: string): string {
  return sailPath("keys", safe ? `${role}-${safe.toLowerCase()}.json` : `${role}.json`);
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
      `No ${role} key found.\nRun "sailor keys generate" and choose "${role}" first.`,
    );
  }
  const password = await promptHidden(`Password for ${role} key`);
  try {
    return await LocalKeyring.fromKeystore(keystore, password);
  } catch {
    throw new Error("Invalid password.");
  }
}

/** Loads whichever signing key is available, preferring the permission signer. */
export async function loadAnySigner(): Promise<LocalKeyring> {
  if (keyExists("permissionSigner")) return loadKeyring("permissionSigner");
  if (keyExists("manager")) return loadKeyring("manager");
  throw new Error('No signing key found.\nRun "sailor keys generate" first.');
}
