import {
  SAFE_V141,
  SailKernelAbi,
  buildSafeSetupInitializer,
  computeSailSmaAddress,
  getChain,
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
  encodeFunctionData,
  getAddress,
  isAddress,
  parseEventLogs,
  zeroAddress,
} from "viem";
import { getChainById, getRpcUrl } from "../lib/chain.js";
import {
  appendActivity,
  checksum,
  makeClient,
  nowIso,
  parseEnvFile,
  prompt,
  promptAddress,
  readJsonFile,
  sailPath,
  writeJsonFile,
} from "../lib/io.js";
import { keyExists, loadKeyring } from "../lib/keys.js";
import { projectPort } from "../lib/packagePaths.js";
import { type StoredAccount, upsertAccountInList } from "../lib/state.js";
import { createSigningChannel } from "../signing/client.js";

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
const SAIL_MAINNET_CHAINS: SailChainId[] = [1, 8453, 42161, 130];

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
  manager?: string;
  chain?: string;
  json?: boolean;
}

/**
 * `sailor account predict` — compute the deterministic Safe address that
 * SailKernel.createAccount will deploy for a given owner + manager + salt on
 * each supported chain, WITHOUT deploying anything.
 *
 * The kernel binds the CREATE2 salt to the deployer, permission signer, manager
 * (agent wallet), and fee policy (see `computeSailSmaAddress`), so the address
 * depends on the agent wallet too — not just the owner and salt. It also differs
 * across chains because the Safe initializer and fee policy are chain-specific.
 * Both facts are reported with a root-cause explanation.
 */
export async function accountPredict(options: PredictOptions): Promise<void> {
  const stored = readJsonFile<StoredAccount>(sailPath("account.json"));

  // ── Resolve owner (= deployer = permission signer in the onboarding flow) ─────
  let ownerAddr: Address;
  if (options.owner) {
    if (!isAddress(options.owner, { strict: false })) {
      throw new Error(`Invalid --owner address: ${options.owner}`);
    }
    ownerAddr = getAddress(options.owner);
  } else {
    if (!stored?.owner) {
      throw new Error(
        "No owner found in .sail/account.json. Pass --owner <address> or run sailor onboard first.",
      );
    }
    ownerAddr = getAddress(stored.owner);
  }

  // ── Resolve manager (agent wallet) — part of the kernel's salt binding ────────
  let managerAddr: Address;
  if (options.manager) {
    if (!isAddress(options.manager, { strict: false })) {
      throw new Error(`Invalid --manager address: ${options.manager}`);
    }
    managerAddr = getAddress(options.manager);
  } else if (stored?.manager) {
    managerAddr = getAddress(stored.manager);
  } else {
    throw new Error(
      "The predicted address depends on the agent (manager) wallet, which is mixed into the kernel's CREATE2 salt.\n" +
        "Pass --manager <agent address> (create one first with `sailor keys`), or run after onboarding so it can be read from .sail/account.json.",
    );
  }

  if (options.salt != null && !/^\d+$/.test(options.salt)) {
    throw new Error(`Invalid --salt value: "${options.salt}" — must be a non-negative integer.`);
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
  // Prefer a chain where the user has a configured RPC to avoid falling back to
  // a rate-limited public endpoint when only a non-first chain has a URL set.
  const preferredChain = chainIds.find((cid) => getRpcUrl(cid) != null) ?? chainIds[0];
  const proxyCreationCode = await fetchProxyCreationCode(preferredChain);

  // ── Compute predicted address per chain ──────────────────────────────────────
  const results = chainIds.map((chainId) => {
    const deployment = sailDeployments[chainId];
    const viemChain = getChainById(chainId);
    const { predicted: predictedAddress } = buildSmaAddressPrediction(
      deployment,
      ownerAddr,
      managerAddr,
      saltNonce,
      proxyCreationCode,
    );
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
          manager: managerAddr,
          chains: results.map(({ chainId, name, predictedAddress }) => ({
            chainId,
            name,
            predictedAddress,
          })),
          allSame,
          note: allSame
            ? "All chains produce the same address with this salt, owner, and manager."
            : "Addresses differ per chain because the kernel salt binds the chain-specific fee policy and the Safe initializer encodes chain-specific contract addresses (kernel, safeModuleEnabler). Cross-chain same-address requires deterministic protocol deployment or a registerExisting() flow.",
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("\nPredicted Safe addresses");
  console.log(`  Owner:   ${ownerAddr}`);
  console.log(`  Manager: ${managerAddr}`);
  console.log(`  Salt:    ${saltNonce}`);
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
      "   Root cause: SailKernel.createAccount binds the CREATE2 salt as\n" +
        "   keccak256(saltNonce, deployer, permissionSigner, manager, feePolicy),\n" +
        "   then SafeProxyFactory derives the address from that bound salt and the\n" +
        "   Safe initializer. Both the fee policy and the initializer (kernel,\n" +
        "   safeModuleEnabler) are chain-specific, so each chain yields a different\n" +
        "   address even with the same owner, manager, and salt.\n" +
        "\n" +
        "   For cross-chain same-address the Sail Protocol needs one of:\n" +
        "   A) Deterministic (CREATE2) deployment of kernel + safeModuleEnabler +\n" +
        "      fee policy so they land at the same address on every chain.\n" +
        "   B) A registerExisting() path allowing a plain Safe (deployed with a\n" +
        "      chain-agnostic initializer) to be registered with the kernel.",
    );
  }
  console.log(`\nTo deploy on this chain: sailor onboard --new-sma --salt ${saltNonce}`);
}

export interface DeployChainOptions {
  chain: string;
  salt?: string;
  json?: boolean;
}

/**
 * `sailor account deploy-chain --chain <id>` — deploy the SAME SMA address on an
 * additional chain using the stored owner, manager, and saltNonce.
 *
 * Requires the project's SMA to have been created against the current CREATE2
 * contracts (PR #74). If the stored SMA address doesn't match what the current
 * contracts would predict, the command refuses with a clear explanation — the SMA
 * was deployed against the old per-chain kernel addresses and cannot be reproduced
 * at the same address on another chain.
 */
export async function accountDeployChain(options: DeployChainOptions): Promise<void> {
  const json = !!options.json;
  const say = (fn: () => void) => { if (!json) fn(); };

  // ── 1. Read stored account ────────────────────────────────────────────────────
  const stored = readJsonFile<StoredAccount>(sailPath("account.json"));
  if (!stored?.safe || !stored?.owner || !stored?.manager) {
    throw new Error(
      "No SMA found in .sail/account.json. Run `sailor onboard --new-sma` first.",
    );
  }
  if (stored.saltNonce == null && options.salt == null) {
    throw new Error(
      "No saltNonce stored in .sail/account.json.\n" +
        "Pass --salt <n> explicitly, or re-deploy your SMA with `sailor onboard --new-sma --salt <n>`\n" +
        "so the salt is recorded for cross-chain use.",
    );
  }

  if (options.salt != null && !/^\d+$/.test(options.salt)) {
    throw new Error(`Invalid --salt value: "${options.salt}" — must be a non-negative integer.`);
  }
  const ownerAddr = getAddress(stored.owner);
  const managerAddr = getAddress(stored.manager);
  const storedSafe = getAddress(stored.safe);
  const saltNonce = options.salt != null ? BigInt(options.salt) : BigInt(stored.saltNonce!);

  // ── 2. Validate target chain ──────────────────────────────────────────────────
  if (!/^\d+$/.test(options.chain)) {
    throw new Error(`Invalid --chain value: "${options.chain}" — must be a numeric chain ID.`);
  }
  const targetChainId = Number(options.chain) as SailChainId;
  if (!(targetChainId in sailDeployments)) {
    throw new Error(
      `Chain ${targetChainId} has no Sail Protocol deployment.\n` +
        `Supported: ${Object.keys(sailDeployments).join(", ")}`,
    );
  }
  if (targetChainId === stored.chainId) {
    throw new Error(
      `Chain ${targetChainId} is already the primary chain for this SMA.\n` +
        "Use a different chain ID.",
    );
  }

  // ── 3. Fetch proxyCreationCode (once; same Safe factory on every chain) ───────
  const allChainIds = Object.keys(sailDeployments).map(Number);
  const rpcPreferred = allChainIds.find((cid) => getRpcUrl(cid) != null);
  if (rpcPreferred == null) {
    throw new Error(
      "No RPC URL configured for any supported chain.\n" +
        "Set RPC_URL or RPC_URL_<CHAIN_ID> in .sail/.env.local.",
    );
  }
  const proxyCreationCode = await fetchProxyCreationCode(rpcPreferred);

  // ── 4. Predict SMA address on target chain ────────────────────────────────────
  const deployment = sailDeployments[targetChainId];
  const { initializer, predicted } = buildSmaAddressPrediction(
    deployment,
    ownerAddr,
    managerAddr,
    saltNonce,
    proxyCreationCode,
  );

  // ── 5. OLD-SMA GUARD ──────────────────────────────────────────────────────────
  // If the prediction doesn't match the stored safe, this SMA was deployed against
  // the old per-chain kernel addresses (pre-CREATE2 deployment) and cannot be
  // reproduced at the same address on another chain.
  if (predicted.toLowerCase() !== storedSafe.toLowerCase()) {
    const msg =
      `Your existing SMA (${storedSafe}) cannot be reproduced at the same address on\n` +
      `chain ${targetChainId}. Predicted address: ${predicted}.\n\n` +
      "Two possible causes:\n" +
      "  a) Wrong --salt value. The stored deployment salt is " +
      `${stored.saltNonce ?? "unknown"}. Re-run without --salt to use it automatically.\n` +
      "  b) SMA was deployed against the old per-chain contracts (pre-deterministic\n" +
      "     kernel deployment). The current contracts are identical across all chains.\n\n" +
      "If it is (b), deploy a new SMA with the current contracts:\n" +
      `  sailor onboard --new-sma --salt ${stored.saltNonce ?? saltNonce}\n` +
      "Then run deploy-chain from that account.";
    if (json) {
      console.log(
        JSON.stringify(
          {
            status: "error",
            error: "old-contracts",
            stored: storedSafe,
            predicted,
            targetChainId,
            message: msg,
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    throw new Error(msg);
  }

  // ── 6. Already-deployed check (idempotent — no double-deploy) ─────────────────
  const targetClient = createPublicClient({
    chain: getChainById(targetChainId),
    transport: http(getRpcUrl(targetChainId) ?? undefined),
  });
  const alreadyRecorded = (stored.deployedChains ?? []).includes(targetChainId);
  if (alreadyRecorded) {
    say(() => console.log(`\nChain ${targetChainId} is already recorded as deployed — verifying on-chain…`));
  }
  const existingCode = await targetClient.getCode({ address: predicted });
  if (existingCode && existingCode !== "0x") {
    say(() => console.log(`SMA confirmed at ${predicted} on chain ${targetChainId}.`));
    if (!alreadyRecorded) recordDeployedChain(stored, targetChainId);
    if (json) {
      console.log(
        JSON.stringify({ status: "ok", alreadyDeployed: true, address: predicted, chainId: targetChainId }, null, 2),
      );
    }
    return;
  }

  // ── 7. Deploy via signing channel (owner approves in browser) ─────────────────
  say(() =>
    console.log(
      `\nDeploying SMA on ${getChainById(targetChainId).name} (chain ${targetChainId})…`,
    ),
  );
  say(() => console.log(`  Predicted address: ${predicted}`));

  const createAccountData = encodeFunctionData({
    abi: SailKernelAbi,
    functionName: "createAccount",
    args: [
      SAFE_V141.proxyFactory as Address,
      SAFE_V141.singletonL2 as Address,
      initializer,
      saltNonce,
      ownerAddr,   // permissionSigner = owner (same as original deployment)
      managerAddr, // manager = agent wallet
      deployment.standardFeePolicy as Address,
      zeroAddress, // feeAsset (native)
    ],
  });

  const channel = await createSigningChannel(process.cwd());
  try {
    await channel.start();

    const stationUrl = `http://localhost:${projectPort(process.cwd())}/#/station`;
    if (json) {
      console.log(
        JSON.stringify(
          { status: "waiting_for_signature", url: stationUrl, chainId: targetChainId },
          null,
          2,
        ),
      );
    } else {
      console.log(
        `\n→ Open the Sailor dashboard and switch your wallet to ${getChainById(targetChainId).name}:\n` +
          `  ${stationUrl}\n`,
      );
    }

    say(() => console.log("Pushing signing request…"));
    const response = await channel.requestSignature({
      type: "transaction",
      kind: "create-sma",
      title: `Deploy SMA on ${getChainById(targetChainId).name}`,
      description:
        `Deploy the same SMA at ${predicted} on ${getChainById(targetChainId).name}. ` +
        `Switch your wallet to chain ${targetChainId} before signing.`,
      chainId: targetChainId,
      to: deployment.kernel,
      data: createAccountData,
      details: [
        { label: "Owner", value: ownerAddr },
        { label: "Agent wallet", value: managerAddr },
        { label: "Predicted address", value: predicted },
        { label: "Fee policy", value: deployment.standardFeePolicy },
        { label: "Salt", value: saltNonce.toString() },
      ],
    });

    if (response.status === "rejected") {
      throw new Error(`User rejected deployment: ${response.reason ?? "no reason given"}`);
    }
    if (response.status !== "signed") {
      throw new Error("Unexpected response from signing UI");
    }

    say(() => console.log("Waiting for transaction confirmation…"));
    const receipt = await targetClient.waitForTransactionReceipt({ hash: response.txHash });

    // ── 8. Verify deployed address matches prediction ─────────────────────────
    const logs = parseEventLogs({ abi: SailKernelAbi, logs: receipt.logs });
    const registered = logs.find(
      (l): l is typeof l & { eventName: "AccountRegistered"; args: { account: Address } } =>
        l.eventName === "AccountRegistered",
    );
    if (!registered) {
      throw new Error(
        `AccountRegistered event not found in receipt (tx ${response.txHash}) — ` +
          "transaction may have failed or was sent to the wrong contract.",
      );
    }
    const deployedAddress = registered.args.account;
    if (deployedAddress.toLowerCase() !== predicted.toLowerCase()) {
      throw new Error(
        `Deployed address mismatch: predicted ${predicted}, got ${deployedAddress}.\n` +
          "Please report this as a bug — this should not happen with deterministic contracts.",
      );
    }

    // ── 9. Persist + activity log ─────────────────────────────────────────────
    recordDeployedChain(stored, targetChainId);
    appendActivity({
      ts: nowIso(),
      actor: "owner",
      type: "sma_deployed_chain",
      sma: deployedAddress,
      owner: ownerAddr,
      manager: managerAddr,
      txHash: response.txHash,
      chainId: targetChainId,
      saltNonce: saltNonce.toString(),
    });

    say(() => {
      console.log(`\n${"─".repeat(56)}`);
      console.log("✓ SMA deployed on additional chain!");
      console.log(`  Address: ${deployedAddress}`);
      console.log(`  Chain:   ${getChainById(targetChainId).name} (${targetChainId})`);
      console.log(`  Tx:      ${response.txHash}`);
      console.log("─".repeat(56));
    });
    if (json) {
      console.log(
        JSON.stringify(
          {
            status: "ok",
            address: deployedAddress,
            chainId: targetChainId,
            txHash: response.txHash,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    channel.stop();
  }
}

/** Build the Safe initializer and deterministic SMA address for a given deployment + params. */
export function buildSmaAddressPrediction(
  deployment: { kernel: Address; safeModuleEnabler: Address; standardFeePolicy: Address },
  ownerAddr: Address,
  managerAddr: Address,
  saltNonce: bigint,
  proxyCreationCode: Hex,
): { initializer: Hex; predicted: Address } {
  const initializer = buildSafeSetupInitializer({
    owners: [ownerAddr],
    threshold: 1n,
    kernel: deployment.kernel,
    safeModuleEnabler: deployment.safeModuleEnabler,
  });
  const predicted = computeSailSmaAddress({
    initializer,
    saltNonce,
    deployer: ownerAddr,
    permissionSigner: ownerAddr,
    manager: managerAddr,
    feePolicy: deployment.standardFeePolicy as Address,
    proxyCreationCode,
  });
  return { initializer, predicted };
}

/** Append chainId to stored.deployedChains and rewrite account.json + accounts list. */
function recordDeployedChain(stored: StoredAccount, chainId: number): void {
  const existing = Array.from(new Set([stored.chainId, ...(stored.deployedChains ?? [])]));
  if (!existing.includes(chainId)) {
    existing.push(chainId);
    existing.sort((a, b) => a - b);
  }
  const updated: StoredAccount = { ...stored, deployedChains: existing };
  upsertAccountInList(updated);
  writeJsonFile(sailPath("account.json"), updated);
}

