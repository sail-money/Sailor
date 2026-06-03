import { checksum, makeClient, readJsonFile, sailPath, writeJsonFile } from "../lib/io.js";
import { loadAnySigner } from "../lib/keys.js";
import type { StoredAccount, StoredSession } from "../lib/state.js";

function requireAccount(): StoredAccount {
  const account = readJsonFile<StoredAccount>(sailPath("account.json"));
  if (!account) {
    throw new Error(
      'No account found at .sail/account.json.\nRun "sailor account create" first.',
    );
  }
  return account;
}

/** `sailor session pause` — revokes the manager's dispatch rights. */
export async function sessionPause(): Promise<void> {
  const account = requireAccount();
  const signer = await loadAnySigner();
  const client = makeClient(account.chainId);

  try {
    await client.session.revoke(checksum(account.safe), signer);
  } catch (err) {
    if ((err as Error).message !== "not implemented") throw err;
  }

  const session: StoredSession = {
    safe: checksum(account.safe),
    active: false,
    updatedAt: new Date().toISOString(),
  };
  writeJsonFile(sailPath("session.json"), session);
  console.log("Session paused — agent dispatch rights revoked.");
}

/** `sailor session resume` — re-enables the manager's dispatch rights. */
export async function sessionResume(): Promise<void> {
  const account = requireAccount();
  const signer = await loadAnySigner();
  const client = makeClient(account.chainId);

  try {
    await client.session.activate(checksum(account.safe), signer);
  } catch (err) {
    if ((err as Error).message !== "not implemented") throw err;
  }

  const session: StoredSession = {
    safe: checksum(account.safe),
    active: true,
    updatedAt: new Date().toISOString(),
  };
  writeJsonFile(sailPath("session.json"), session);
  console.log("Session resumed — agent dispatch rights restored.");
}
