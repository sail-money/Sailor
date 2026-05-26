import { LocalKeyring } from "@sail/sdk";
import { checksum, confirm, fileExists, prompt, promptHidden, writeJsonFile } from "../lib/io.js";
import { keyExists, keyPath, loadKeyring, normalizeRole, ROLES } from "../lib/keys.js";

/**
 * `sailor keys generate` — creates a random key for a role and stores it
 * encrypted at .sail/keys/<role>.json. The private key is never printed.
 */
export async function keysGenerate(): Promise<void> {
  const roleInput = await prompt("Which key? (manager / permissionSigner)", "manager");
  const role = normalizeRole(roleInput);
  if (!role) {
    throw new Error(`Unknown key role: "${roleInput}". Choose "manager" or "permissionSigner".`);
  }

  if (fileExists(keyPath(role))) {
    const overwrite = await confirm(
      `A ${role} key already exists at .sail/keys/${role}.json. Overwrite it?`,
    );
    if (!overwrite) {
      console.log("Aborted — existing key left untouched.");
      return;
    }
  }

  const password = await promptHidden("Set a password to encrypt the key");
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  const confirmation = await promptHidden("Confirm password");
  if (password !== confirmation) {
    throw new Error("Passwords do not match.");
  }

  const keyring = LocalKeyring.generate();
  const keystore = await keyring.exportKeystore(password);
  writeJsonFile(keyPath(role), keystore);

  const label = role === "manager" ? "Manager" : "Permission signer";
  console.log(`\n${label} key saved. Address: ${checksum(keyring.address)}`);
  console.log(`Encrypted keystore written to .sail/keys/${role}.json`);
}

/**
 * `sailor keys show` — lists the keys present in .sail/keys/ and shows the
 * address of each (after the password decrypts it). Private keys never print.
 */
export async function keysShow(): Promise<void> {
  const present = ROLES.filter(keyExists);
  if (present.length === 0) {
    console.log("No keys found in .sail/keys/.");
    console.log('Run "sailor keys generate" to create one.');
    return;
  }

  console.log("Keys in .sail/keys/:\n");
  for (const role of present) {
    try {
      const keyring = await loadKeyring(role);
      console.log(`  ${role}: ${checksum(keyring.address)}`);
    } catch (err) {
      console.log(`  ${role}: ${(err as Error).message}`);
    }
  }
}
