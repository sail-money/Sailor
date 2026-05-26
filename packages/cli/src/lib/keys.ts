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

export function keyPath(role: Role): string {
  return sailPath("keys", `${role}.json`);
}

export function keyExists(role: Role): boolean {
  return fileExists(keyPath(role));
}

/**
 * Loads and decrypts a role key, prompting for its password.
 * Throws a clear, actionable error if the key is missing or the password is wrong.
 */
export async function loadKeyring(role: Role): Promise<LocalKeyring> {
  const keystore = readJsonFile<EncryptedKeystore>(keyPath(role));
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
