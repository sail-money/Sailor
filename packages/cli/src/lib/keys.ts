import { type EncryptedKeystore, LocalKeyring } from "@sail/sdk";
import { isAddress } from "viem";
import { fileExists, parseEnvFile, promptHidden, readJsonFile, sailPath } from "./io.js";

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
 * Loads and decrypts a role key.
 *
 * Honors `SAIL_PASSPHRASE` (injected from .sail/.env.local by the caller) so that
 * every key-loading command — not just `sailor run` — works non-interactively in
 * CI and automation. Only falls back to an interactive prompt when the env var is
 * absent AND stdin is a TTY; on a non-TTY without the env var it fails with the
 * real cause instead of a misleading "Invalid password" from an unanswerable
 * prompt. (F6: previously this always prompted, so `sailor session resume`
 * ignored SAIL_PASSPHRASE.)
 */
export async function loadKeyring(role: Role, safe?: string): Promise<LocalKeyring> {
  const keystore = readJsonFile<EncryptedKeystore>(resolveKeyPath(role, safe));
  if (!keystore) {
    throw new Error(
      `No ${roleLabel(role)} found.\nRun "sailor keys generate" and choose "${roleLabel(role)}" first.`,
    );
  }
  const passphrase = process.env.SAIL_PASSPHRASE;
  if (passphrase) {
    try {
      return await LocalKeyring.fromKeystore(keystore, passphrase);
    } catch {
      throw new Error(
        `SAIL_PASSPHRASE does not match the ${roleLabel(role)} keystore.\n` +
          "Check the value in .sail/.env.local (or the SAIL_PASSPHRASE CI secret) — " +
          "it must be the passphrase this key was encrypted with.",
      );
    }
  }
  if (process.stdin.isTTY !== true) {
    throw new Error(
      `${roleLabel(role)} keystore found but SAIL_PASSPHRASE is not set.\n` +
        "Set SAIL_PASSPHRASE in .sail/.env.local (or as a CI secret) to run non-interactively.",
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
 * Loads the agent (manager) key. Injects SAIL_PASSPHRASE from .sail/.env.local
 * when the caller hasn't, so mandate / onboard / run work headless, then defers
 * to loadKeyring — the single loader that owns passphrase decrypt, the non-TTY
 * guard, and the interactive prompt for every role.
 */
export async function loadManagerSigner(safe?: string): Promise<LocalKeyring> {
  if (!process.env.SAIL_PASSPHRASE) {
    try {
      const env = parseEnvFile(sailPath(".env.local"));
      if (env.SAIL_PASSPHRASE) process.env.SAIL_PASSPHRASE = env.SAIL_PASSPHRASE;
    } catch {
      // .env.local absent or unreadable — loadKeyring handles prompt / TTY guard
    }
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
