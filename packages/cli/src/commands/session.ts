import { checksum, makeClient, readActiveAccount, readJsonFile, sailPath, writeJsonFile } from "../lib/io.js";
import { loadAnySigner } from "../lib/keys.js";
import type { StoredAccount, StoredSession } from "../lib/state.js";

function requireAccount(): StoredAccount {
  const account = readActiveAccount();
  if (!account) {
    throw new Error(
      'No account found at .sail/account.json.\nRun "sailor onboard --new-sma" first.',
    );
  }
  return account;
}

interface SessionOptions {
  json?: boolean;
}

/** `sailor session pause` — revokes the manager's dispatch rights. */
export async function sessionPause(opts: SessionOptions = {}): Promise<void> {
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
  if (opts.json) console.log(JSON.stringify(session));
  else console.log("Session paused — agent dispatch rights revoked.");
}

/** `sailor session resume` — re-enables the manager's dispatch rights. */
export async function sessionResume(opts: SessionOptions = {}): Promise<void> {
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
  if (opts.json) console.log(JSON.stringify(session));
  else console.log("Session resumed — agent dispatch rights restored.");
}
