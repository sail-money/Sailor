import { getChain } from "@sail/chains";
import type { ChainConfig } from "@sail/sdk";
import {
  checksum,
  makeClient,
  parseEnvFile,
  prompt,
  promptAddress,
  sailPath,
  writeJsonFile,
} from "../lib/io.js";
import { keyExists, loadKeyring } from "../lib/keys.js";
import { type StoredAccount, upsertAccountInList } from "../lib/state.js";

function resolveChain(chainId: number): ChainConfig {
  try {
    return getChain(chainId);
  } catch {
    throw new Error(
      `Chain ${chainId} is not yet configured in @sail/chains.\n` +
        "The SailKernel and mandate-factory addresses for this chain are unknown,\n" +
        "so an account cannot be created yet. Add the chain to @sail/chains once\n" +
        "SailKernel is deployed there.",
    );
  }
}

/**
 * `sailor account create` — deploys a Sail SMA (Safe + kernel registration).
 *
 * Validates the manager key, RPC/chain config, and chain support, gathers the
 * Safe deployment parameters, then calls client.account.create. While the SDK
 * call is still a stub, the command degrades gracefully with a clear message.
 */
export async function accountCreate(): Promise<void> {
  if (!keyExists("manager")) {
    throw new Error(
      'No agent wallet found.\nRun "sailor keys generate" and choose "agent wallet" first.',
    );
  }

  const env = parseEnvFile(sailPath(".env.local"));
  const rpcUrl = env["RPC_URL"] ?? process.env["RPC_URL"];
  const chainIdRaw = env["CHAIN_ID"] ?? process.env["CHAIN_ID"];
  if (!rpcUrl || !chainIdRaw) {
    throw new Error(
      "RPC_URL and CHAIN_ID must be set in .sail/.env.local.\n" +
        "Create that file with, for example:\n" +
        "  RPC_URL=https://your-rpc-endpoint\n" +
        "  CHAIN_ID=8453",
    );
  }
  const chainId = Number(chainIdRaw);
  if (Number.isNaN(chainId)) {
    throw new Error(`Invalid CHAIN_ID: "${chainIdRaw}" — must be a number.`);
  }

  const chain = resolveChain(chainId);
  console.log(`Chain ${chainId} (${chain.name})`);
  console.log(`  SailKernel:      ${checksum(chain.kernel)}`);
  console.log(`  Mandate factory: ${checksum(chain.mandateFactory)}\n`);

  const manager = await loadKeyring("manager");
  const managerAddr = checksum(manager.address);

  const safeFactory = await promptAddress("Safe factory address");
  const safeSingleton = await promptAddress("Safe singleton address");
  const owner = await promptAddress("Owner (EOA) address", managerAddr);
  const permissionSigner = await promptAddress("Mandate signer address", managerAddr);
  const feePolicy = await prompt("Fee policy", "none");

  console.log("\nCreating SMA with:");
  console.log(`  Owner:           ${owner}`);
  console.log(`  Agent wallet:    ${managerAddr}`);
  console.log(`  Mandate signer:  ${permissionSigner}`);
  console.log(`  Safe factory:    ${safeFactory}`);
  console.log(`  Safe singleton:  ${safeSingleton}`);
  console.log(`  Fee policy:      ${feePolicy}`);

  const client = makeClient(chainId);
  try {
    const account = await client.account.create({
      owner,
      permissionSigner,
      manager: managerAddr,
      chainId,
    });
    const stored: StoredAccount = {
      safe: checksum(account.safe),
      owner: checksum(account.owner),
      permissionSigner: checksum(account.permissionSigner),
      manager: checksum(account.manager),
      chainId: account.chainId,
      createdAtBlock: account.createdAtBlock.toString(),
    };
    upsertAccountInList(stored);
    writeJsonFile(sailPath("account.json"), stored);
    console.log(`\nSMA created. Address: ${stored.safe}`);
    console.log("Saved to .sail/account.json");
  } catch (err) {
    if ((err as Error).message === "not implemented") {
      console.log(
        "\nOn-chain account creation is not wired up in this build yet —\n" +
          "client.account.create is a stub until SailKernel is deployed and the\n" +
          "SDK is connected. Nothing was created on-chain.",
      );
      return;
    }
    throw err;
  }
}
