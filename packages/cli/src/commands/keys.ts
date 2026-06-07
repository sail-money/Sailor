import fs from "node:fs";
import path from "node:path";
import { LocalKeyring } from "@sail/sdk";
import { checksum, confirm, fileExists, prompt, promptHidden, readJsonFile, sailPath, writeJsonFile } from "../lib/io.js";
import { keyExists, keyPath, loadKeyring, normalizeRole, resolveKeyPath, roleLabel, ROLES } from "../lib/keys.js";
import type { StoredAccount } from "../lib/state.js";

/**
 * `sailor keys generate` — creates a random key for a role and stores it
 * encrypted at .sail/keys/<role>.json. The private key is never printed.
 */
export async function keysGenerate(): Promise<void> {
  const roleInput = await prompt("Which key? (agent wallet / mandate signer)", "agent wallet");
  const role = normalizeRole(roleInput);
  if (!role) {
    throw new Error(`Unknown key role: "${roleInput}". Choose "agent wallet" or "mandate signer".`);
  }

  if (fileExists(keyPath(role))) {
    const overwrite = await confirm(
      `A ${roleLabel(role)} key already exists at .sail/keys/${role}.json. Overwrite it?`,
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

  const label = role === "manager" ? "Agent wallet" : "Mandate signer";
  console.log(`\n${label} key saved. Address: ${checksum(keyring.address)}`);
  console.log(`Encrypted keystore written to .sail/keys/${role}.json`);

  // Offer to persist the passphrase to .sail/.env.local for non-interactive use.
  // This lets `sailor run` work in CI and automated environments without needing
  // to export the passphrase in the shell. The file is gitignored by default.
  if (role === "manager") {
    const save = await confirm(
      "\nSave passphrase to .sail/.env.local for non-interactive use? (required for CI/GitHub Actions)",
    );
    if (save) {
      const envPath = sailPath(".env.local");
      let content = "";
      if (fs.existsSync(envPath)) {
        content = fs.readFileSync(envPath, "utf-8");
        // Remove any existing SAIL_PASSPHRASE line
        content = content.replace(/^SAIL_PASSPHRASE=.*\n?/m, "");
      }
      content = content.trimEnd() + (content.length > 0 ? "\n" : "") + `SAIL_PASSPHRASE=${password}\n`;
      fs.mkdirSync(path.dirname(envPath), { recursive: true });
      fs.writeFileSync(envPath, content, { mode: 0o600 }); // owner-readable only
      console.log("✓ SAIL_PASSPHRASE saved to .sail/.env.local (mode 0600)");
      console.log("  sailor run will now work non-interactively.");
    } else {
      console.log("\nTo run non-interactively, add this to .sail/.env.local:");
      console.log(`  SAIL_PASSPHRASE=<your-passphrase>`);
    }
  }
}

/**
 * `sailor keys export-ci` — copies the encrypted manager keystore to
 * `./ci-keystore.json` in the project root so it can be committed and used in
 * GitHub Actions (or any headless CI).
 *
 * The keystore is geth keystore v3 — the private key is AES-encrypted and
 * never exposed. CI unlocks it non-interactively with SAIL_PASSPHRASE from
 * repository secrets. The raw key is never stored anywhere plaintext.
 */
export async function keysExportCi(): Promise<void> {
  // Resolve the keystore path: per-SMA preferred, shared manager.json fallback.
  const account = readJsonFile<StoredAccount>(sailPath("account.json"));
  const src = resolveKeyPath("manager", account?.safe);

  if (!fileExists(src)) {
    throw new Error(
      "No agent wallet keystore found.\n" +
        'Complete Stage 1 (browser UI) to generate your agent wallet, or run\n' +
        '"sailor keys generate" and choose "agent wallet" to create one manually.',
    );
  }

  const dest = path.resolve(process.cwd(), "ci-keystore.json");
  fs.copyFileSync(src, dest);
  console.log(`✓ Keystore copied to ci-keystore.json`);
  console.log(`  Source: ${src}`);

  // Ensure .gitignore explicitly allows ci-keystore.json.
  // The file is encrypted — safe to commit. We add a negation entry so the
  // intent is clear and the file stays tracked if someone later adds *.json.
  const gitignorePath = path.resolve(process.cwd(), ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    if (!content.includes("ci-keystore.json")) {
      fs.appendFileSync(
        gitignorePath,
        "\n# CI keystore — encrypted agent wallet, safe to commit\n!ci-keystore.json\n",
      );
      console.log("✓ Added !ci-keystore.json allowlist entry to .gitignore");
    } else {
      console.log("✓ .gitignore already tracks ci-keystore.json");
    }
  }

  console.log("\nNext steps:");
  console.log("  1. Add two GitHub Actions secrets (Settings → Secrets → Actions):");
  console.log("       SAIL_PASSPHRASE — the passphrase that encrypts your agent wallet");
  console.log("       RPC_URL         — your RPC endpoint");
  console.log("  2. Commit and push ci-keystore.json:");
  console.log('       git add ci-keystore.json && git commit -m "chore: add CI keystore" && git push');
  console.log("\n  The keystore is encrypted — the raw private key is never exposed.");
  console.log("  The workflow at .github/workflows/agent-tick.yml unlocks it with SAIL_PASSPHRASE.");
}

/**
 * `sailor keys show` — lists the keys present in .sail/keys/ and shows the
 * address of each (after the password decrypts it). Private keys never print.
 */
export async function keysShow(): Promise<void> {
  const present = ROLES.filter((role) => keyExists(role));
  if (present.length === 0) {
    console.log("No keys found in .sail/keys/.");
    console.log('Run "sailor keys generate" to create one.');
    return;
  }

  console.log("Keys in .sail/keys/:\n");
  for (const role of present) {
    try {
      const keyring = await loadKeyring(role);
      console.log(`  ${roleLabel(role)}: ${checksum(keyring.address)}`);
    } catch (err) {
      console.log(`  ${role}: ${(err as Error).message}`);
    }
  }
}
