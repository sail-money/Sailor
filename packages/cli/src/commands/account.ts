import { getChain } from "@sail/chains";
import {
  SAFE_V141,
  buildSafeSetupInitializer,
  computeSafeProxyAddress,
  sailDeployments,
  safeProxyFactoryAbi,
  type ChainConfig,
  type SailChainId,
} from "@sail/sdk";
import {
  http,
  type Address,
  type Hex,
  createPublicClient,
  getAddress,
  isAddress,
} from "viem";
import { getChainById, getRpcUrl } from "../lib/chain.js";
import {
  checksum,
  makeClient,
  parseEnvFile,
  prompt,
  promptAddress,
  readJsonFile,
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

/** Supported mainnet chains for multi-chain SMA operations. */
const SAIL_MAINNET_CHAINS: SailChainId[] = [8453, 42161, 130];

/**
 * Fetch proxyCreationCode from SafeProxyFactory once (same on all chains).
 * Uses any available RPC — the factory contract is identical on every chain.
 */
async function fetchProxyCreationCode(preferredChainId: number): Promise<Hex> {
  const rpcUrl = getRpcUrl(preferredChainId) ?? undefined;
  const publicClient = createPublicClient({
    chain: getChainById(preferredChainId),
    transport: http(rpcUrl),
  });
  return (await publicClient.readContract({
    address: SAFE_V141.proxyFactory as Address,
    abi: safeProxyFactoryAbi,
    functionName: "proxyCreationCode",
  })) as Hex;
}

export interface PredictOptions {
  salt?: string;
  owner?: string;
  chain?: string;
  json?: boolean;
}

/**
 * `sailor account predict` — compute the deterministic Safe address for a
 * given owner + salt on each supported chain, WITHOUT deploying anything.
 *
 * Shows predicted addresses before any gas is spent ("reservation"). Since the
 * Safe initializer encodes chain-specific contract addresses (kernel and
 * safeModuleEnabler), addresses differ across chains even with the same salt —
 * this is reported clearly with a root-cause explanation.
 */
export async function accountPredict(options: PredictOptions): Promise<void> {
  // ── Resolve owner ────────────────────────────────────────────────────────────
  let ownerAddr: Address;
  if (options.owner) {
    if (!isAddress(options.owner, { strict: false })) {
      throw new Error(`Invalid --owner address: ${options.owner}`);
    }
    ownerAddr = getAddress(options.owner);
  } else {
    const stored = readJsonFile<StoredAccount>(sailPath("account.json"));
    if (!stored?.owner) {
      throw new Error(
        "No owner found in .sail/account.json. Pass --owner <address> or run sailor onboard first.",
      );
    }
    ownerAddr = getAddress(stored.owner);
  }

  const saltNonce = options.salt != null ? BigInt(options.salt) : 0n;

  // ── Determine chains ─────────────────────────────────────────────────────────
  let chainIds: SailChainId[];
  if (options.chain) {
    const chainId = Number(options.chain) as SailChainId;
    if (!(chainId in sailDeployments)) {
      throw new Error(
        `Chain ${chainId} has no Sail Protocol deployment. Supported: ${Object.keys(sailDeployments).join(", ")}`,
      );
    }
    chainIds = [chainId];
  } else {
    chainIds = SAIL_MAINNET_CHAINS;
  }

  // ── Fetch proxyCreationCode (one read from any chain — same factory everywhere) ─
  const firstChain = chainIds[0];
  const proxyCreationCode = await fetchProxyCreationCode(firstChain);

  // ── Compute predicted address per chain ──────────────────────────────────────
  const results = chainIds.map((chainId) => {
    const deployment = sailDeployments[chainId];
    const viemChain = getChainById(chainId);
    const initializer = buildSafeSetupInitializer({
      owners: [ownerAddr],
      threshold: 1n,
      kernel: deployment.kernel,
      safeModuleEnabler: deployment.safeModuleEnabler,
    });
    const predictedAddress = computeSafeProxyAddress({ initializer, saltNonce, proxyCreationCode });
    return {
      chainId,
      name: viemChain.name,
      predictedAddress,
      kernel: deployment.kernel,
      safeModuleEnabler: deployment.safeModuleEnabler,
    };
  });

  const uniqueAddresses = new Set(results.map((r) => r.predictedAddress.toLowerCase()));
  const allSame = uniqueAddresses.size === 1;

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          salt: saltNonce.toString(),
          owner: ownerAddr,
          chains: results.map(({ chainId, name, predictedAddress }) => ({
            chainId,
            name,
            predictedAddress,
          })),
          allSame,
          note: allSame
            ? "All chains produce the same address with this salt and owner."
            : "Addresses differ per chain because the Safe initializer encodes chain-specific contract addresses (kernel, safeModuleEnabler). Cross-chain same-address requires deterministic protocol deployment or a registerExisting() flow.",
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`\nPredicted Safe addresses`);
  console.log(`  Owner: ${ownerAddr}`);
  console.log(`  Salt:  ${saltNonce}`);
  console.log("────────────────────────────────────────────────────");
  for (const { chainId, name, predictedAddress } of results) {
    console.log(`  ${name.padEnd(14)} (${String(chainId).padEnd(5)}):  ${predictedAddress}`);
  }
  console.log("────────────────────────────────────────────────────");

  if (allSame) {
    console.log("✓ All chains produce the same address.");
  } else {
    console.log("\n⚠  Addresses differ across chains.");
    console.log(
      "   Root cause: SafeProxyFactory computes CREATE2 salt as\n" +
        "   keccak256(keccak256(initializer) ‖ saltNonce). The Safe initializer\n" +
        "   includes chain-specific addresses (kernel, safeModuleEnabler), so\n" +
        "   different chains produce different salts → different addresses.\n" +
        "\n" +
        "   For cross-chain same-address the Sail Protocol needs one of:\n" +
        "   A) Deterministic (CREATE2) deployment of kernel + safeModuleEnabler\n" +
        "      so they land at the same address on every chain.\n" +
        "   B) A registerExisting() path allowing a plain Safe (deployed with a\n" +
        "      chain-agnostic initializer) to be registered with the kernel.",
    );
  }
  console.log(
    "\nTo deploy on this chain: sailor onboard --new-sma --salt " + saltNonce.toString(),
  );
}

