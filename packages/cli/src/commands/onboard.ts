/**
 * sailor onboard
 *
 * Walks the full agent onboarding sequence:
 *   1. Ensure a manager (agent) key exists
 *   2. Resolve the SMA — use --sma, or create a new one with --new-sma
 *   3. Verify on-chain registration with SailKernel
 *   4. Optionally attach one mandate template
 *   5. Persist the SMA to .sail/account.json and print a summary
 *
 * Signing requests are pushed to the signing station (a running `sailor station`
 * daemon if one exists, otherwise an ephemeral in-process server) so the owner
 * approves them in the browser UI. Fully agent-driveable: pass --sma/--new-sma +
 * --template/--skip-mandate and --json to run without interactive prompts.
 */

import {
  type LocalKeyring,
  SAFE_V141,
  SailKernelAbi,
  buildRegisterPermissionTypedData,
  buildSafeSetupInitializer,
  detectKernelCapabilities,
  estimatePermissionFee,
  getSailDeployment,
} from "@sail/sdk";
import {
  http,
  type Address,
  type Hex,
  type PublicClient,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  isAddress,
  parseEventLogs,
  publicActions,
} from "viem";
import { getChainById, getRpcUrl } from "../lib/chain.js";
import { appendActivity, checksum, nowIso, prompt, sailPath, writeJsonFile } from "../lib/io.js";
import { keyExists } from "../lib/keys.js";
import { emit } from "../lib/output.js";
import { ProjectContext, loadManagerSigner } from "../lib/project.js";
import { type StoredAccount, upsertAccountInList } from "../lib/state.js";
import { type SigningChannel, createSigningChannel } from "../signing/client.js";

export interface OnboardOptions {
  sma?: string;
  newSma?: boolean;
  template?: string;
  skipMandate?: boolean;
  json?: boolean;
}

interface OnboardResult {
  sma: Address;
  agent: Address;
  mandates: Address[];
  created: boolean;
}

export async function onboard(options: OnboardOptions): Promise<void> {
  if (!ProjectContext.exists()) {
    emit(options.json, () => console.log('No Sailor project found. Run "sailor init" first.'), {
      status: "error",
      error: "no-project",
    });
    process.exit(1);
  }

  const project = new ProjectContext();
  const channel = await createSigningChannel(process.cwd());
  try {
    await channel.start();
    const result = await runOnboard(project, channel, options);
    emit(options.json, () => printSummary(result.sma, result.agent, result.mandates), {
      status: "ok",
      ...result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(options.json, () => console.error(`\nOnboarding failed: ${msg}`), {
      status: "error",
      error: msg,
    });
    process.exit(1);
  } finally {
    channel.stop();
  }
}

async function runOnboard(
  project: ProjectContext,
  channel: SigningChannel,
  options: OnboardOptions,
): Promise<OnboardResult> {
  const json = !!options.json;
  const say = (fn: () => void) => {
    if (!json) fn();
  };

  say(() => console.log(`\nProject: ${project.name}`));

  if (project.chainId !== 8453) {
    say(() =>
      console.warn(
        `\n⚠  Testnet mode: operating on chain ${project.chainId}, not Base mainnet (8453).\n   Set chainId to 8453 in .sail/config.json for production.\n`,
      ),
    );
  }

  // ── Step 1: Ensure a manager (agent) key ────────────────────────────────────
  if (!keyExists("manager")) {
    throw new Error('No manager key found. Run "sailor keys generate" and choose "manager" first.');
  }
  const agentSigner = await loadManagerSigner();
  const agentAddress = agentSigner.address;
  say(() => console.log("✓", `Agent (manager) wallet: ${agentAddress}`));

  // ── Step 2: Resolve SMA address ─────────────────────────────────────────────
  const chain = getChainById(project.chainId);
  const publicClient = createPublicClient({
    chain,
    transport: http(getRpcUrl(project.chainId)),
  }).extend(publicActions) as PublicClient;

  const smaChoice = await resolveSmaChoice(options, json);

  say(() =>
    console.log(
      `\n→ Signing station:\n  Open ${channel.url} in your browser and connect your wallet\n`,
    ),
  );

  let smaAddress: Address;
  let justCreated = false;
  let ownerAddress = project.getOwner();

  if (smaChoice.kind === "new") {
    const created = await createSma(project, channel, publicClient, agentAddress, json);
    smaAddress = created.sma;
    ownerAddress = created.owner;
    justCreated = true;
  } else {
    smaAddress = smaChoice.address;
  }

  say(() => console.log("SMA:", smaAddress));

  // ── Step 3: Check on-chain registration ─────────────────────────────────────
  const isRegistered = await waitForRegistration(
    publicClient,
    project.contracts.kernel,
    smaAddress,
    justCreated ? 10 : 1,
  );
  if (!isRegistered) {
    throw new Error(
      `Safe ${smaAddress} is not registered with SailKernel. Only Safes created via kernel.createAccount can be registered — run with --new-sma to create one.`,
    );
  }

  const kernelConfig = (await publicClient.readContract({
    address: project.contracts.kernel,
    abi: SailKernelAbi,
    functionName: "configs",
    args: [smaAddress],
  })) as [Address, Address, Address, boolean];
  const [permissionSigner, onChainManager] = kernelConfig;

  say(() => {
    console.log("✓", "SMA registered with SailKernel");
    console.log("  Permission signer:", permissionSigner);
    console.log("  Manager:          ", onChainManager);
    if (onChainManager.toLowerCase() !== agentAddress.toLowerCase()) {
      console.log(
        `\n⚠  On-chain manager (${onChainManager}) differs from your agent (${agentAddress}).\n   Manager rotation is not handled here — update it manually.`,
      );
    } else {
      console.log("✓", "Agent is set as manager");
    }
  });

  // Persist the SMA to .sail/account.json so `sailor status`/`run` can read it.
  await persistAccount(publicClient, {
    safe: smaAddress,
    owner: ownerAddress ?? permissionSigner,
    permissionSigner,
    manager: onChainManager,
    chainId: project.chainId,
  });

  // ── Step 4: Mandate attachment ──────────────────────────────────────────────
  if (options.skipMandate) {
    return { sma: smaAddress, agent: agentAddress, mandates: [], created: justCreated };
  }

  const currentPermissions = (await publicClient.readContract({
    address: project.contracts.kernel,
    abi: SailKernelAbi,
    functionName: "getPermissions",
    args: [smaAddress],
  })) as Address[];

  if (currentPermissions.length > 0) {
    say(() => console.log("✓", `${currentPermissions.length} mandate(s) already attached`));
    return {
      sma: smaAddress,
      agent: agentAddress,
      mandates: currentPermissions,
      created: justCreated,
    };
  }

  const template = await resolveTemplate(project, options, json);
  if (!template) {
    return { sma: smaAddress, agent: agentAddress, mandates: [], created: justCreated };
  }

  // On a conjunctive kernel every registered permission evaluates every dispatch.
  // The shared templates (SharedBoundedSwapPermission, SharedTransferTargetPermission)
  // are NOT pass-through — they reject any call outside their specific scope, which
  // bricks all other dispatches. Warn before attaching to a conjunctive kernel.
  try {
    const caps = await detectKernelCapabilities(publicClient, project.contracts.kernel, {
      chainId: project.chainId,
    });
    if (caps.dispatchModel === "conjunctive") {
      say(() =>
        console.log(
          "\n⚠  Conjunctive kernel detected. Every registered permission evaluates every dispatch.\n" +
            "   The shared templates (SharedBoundedSwapPermission, SharedTransferTargetPermission)\n" +
            "   are NOT pass-through — they will block any dispatch they do not recognise.\n" +
            "   Use pass-through clone templates (sailor mandate templates) for conjunctive kernels.\n",
        ),
      );
    }
  } catch {
    // Capability detection is advisory — don't block onboard if it fails.
  }

  await attachMandate(
    project,
    channel,
    publicClient,
    agentSigner,
    smaAddress,
    permissionSigner,
    template,
    { json },
  );

  const updatedPermissions = (await publicClient.readContract({
    address: project.contracts.kernel,
    abi: SailKernelAbi,
    functionName: "getPermissions",
    args: [smaAddress],
  })) as Address[];

  return {
    sma: smaAddress,
    agent: agentAddress,
    mandates: updatedPermissions,
    created: justCreated,
  };
}

type SmaChoice = { kind: "new" } | { kind: "address"; address: Address };

async function resolveSmaChoice(options: OnboardOptions, json: boolean): Promise<SmaChoice> {
  if (options.sma) {
    if (!isAddress(options.sma, { strict: false })) {
      throw new Error(`Invalid --sma address: ${options.sma}`);
    }
    return { kind: "address", address: options.sma as Address };
  }
  if (options.newSma) return { kind: "new" };
  if (json) {
    throw new Error("Specify --sma <address> or --new-sma (non-interactive / --json mode).");
  }

  const choice = await prompt(
    "Create a new Safe? (y = new, or paste an existing Safe address)",
    "y",
  );
  if (choice.toLowerCase() === "y" || choice.toLowerCase() === "yes") return { kind: "new" };
  if (!isAddress(choice, { strict: false })) throw new Error(`Invalid Safe address: ${choice}`);
  return { kind: "address", address: choice as Address };
}

async function resolveTemplate(
  project: ProjectContext,
  options: OnboardOptions,
  json: boolean,
): Promise<{ address: Address; label: string } | null> {
  const templates = (() => {
    try {
      return getSailDeployment(project.chainId).knownTemplates ?? [];
    } catch {
      return [];
    }
  })();

  if (options.template) {
    const needle = options.template.toLowerCase();
    const match = templates.find(
      (t) =>
        t.address.toLowerCase() === needle ||
        t.kind.toLowerCase() === needle ||
        t.label.toLowerCase() === needle,
    );
    if (match) return { address: match.address as Address, label: match.label };
    if (isAddress(options.template, { strict: false })) {
      return { address: options.template as Address, label: options.template };
    }
    throw new Error(
      `Unknown mandate template "${options.template}". Run "sailor mandate templates".`,
    );
  }

  if (json) return null;
  if (templates.length === 0) {
    console.log("\nNo known templates for this chain. Skipping the mandate step.");
    console.log('Author and deploy your own with "sailor mandate deploy".');
    return null;
  }

  console.log("\nAvailable templates:");
  templates.forEach((t, i) => console.log(`  ${i + 1}. ${t.label} (${t.address})`));
  const pick = await prompt("Attach which template? (number, or blank to skip)", "");
  if (!pick) return null;
  const idx = Number(pick) - 1;
  const chosen = templates[idx];
  if (!chosen) throw new Error(`Invalid selection: ${pick}`);
  return { address: chosen.address as Address, label: chosen.label };
}

async function waitForRegistration(
  publicClient: PublicClient,
  kernel: Address,
  account: Address,
  attempts: number,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const registered = await publicClient.readContract({
      address: kernel,
      abi: SailKernelAbi,
      functionName: "registered",
      args: [account],
    });
    if (registered) return true;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function createSma(
  project: ProjectContext,
  channel: SigningChannel,
  publicClient: PublicClient,
  agentAddress: Address,
  json = false,
): Promise<{ sma: Address; owner: Address }> {
  const say = (fn: () => void) => {
    if (!json) fn();
  };
  say(() => console.log("\nWaiting for wallet connection to read your address…"));
  const ownerAddress = await channel.waitForWallet();
  say(() => console.log("✓", `Wallet connected: ${ownerAddress}`));

  // 1-of-1 Safe owned by the user, with the kernel enabled as a module during
  // setup (createAccount reverts with ModuleNotEnabled() otherwise).
  const deployment = getSailDeployment(project.chainId);
  const safeInitializer = buildSafeSetupInitializer({
    owners: [ownerAddress],
    threshold: 1n,
    kernel: project.contracts.kernel,
    safeModuleEnabler: deployment.safeModuleEnabler,
  });
  const saltNonce = BigInt(Date.now());

  const createAccountData = encodeFunctionData({
    abi: SailKernelAbi,
    functionName: "createAccount",
    args: [
      SAFE_V141.proxyFactory as Address,
      SAFE_V141.singletonL2 as Address,
      safeInitializer,
      saltNonce,
      ownerAddress, // permissionSigner = user's wallet
      agentAddress, // manager = agent's wallet
      project.contracts.standardFeePolicy,
    ],
  });

  say(() => console.log("\nPushing signing request…"));
  const response = await channel.requestSignature({
    type: "transaction",
    kind: "create-sma",
    title: "Create & Register Safe",
    description:
      "Deploy a new 1-of-1 Safe and register it with SailKernel. The agent wallet will be set as manager.",
    chainId: project.chainId,
    to: project.contracts.kernel,
    data: createAccountData,
    details: [
      { label: "Owner (you)", value: ownerAddress },
      { label: "Agent (manager)", value: agentAddress },
      { label: "Fee policy", value: project.contracts.standardFeePolicy },
      { label: "Safe factory", value: SAFE_V141.proxyFactory },
    ],
  });

  if (response.status === "rejected") {
    throw new Error(`User rejected Safe creation: ${response.reason ?? "no reason given"}`);
  }
  if (response.status !== "signed") {
    throw new Error("Unexpected response from signing UI");
  }

  say(() => console.log("Waiting for transaction confirmation…"));
  const receipt = await publicClient.waitForTransactionReceipt({ hash: response.txHash });

  const logs = parseEventLogs({ abi: SailKernelAbi, logs: receipt.logs });
  const registered = logs.find(
    (l): l is typeof l & { eventName: "AccountRegistered"; args: { account: Address } } =>
      l.eventName === "AccountRegistered",
  );
  if (!registered) {
    throw new Error("AccountRegistered event not found in receipt — transaction may have failed");
  }

  const safeAddress = registered.args.account;
  say(() => console.log("✓", `Safe created at ${safeAddress}`));
  appendActivity({
    ts: nowIso(),
    actor: "owner",
    type: "sma_created",
    sma: safeAddress,
    owner: ownerAddress,
    manager: agentAddress,
    txHash: response.txHash,
    chainId: project.chainId,
  });
  return { sma: safeAddress, owner: ownerAddress };
}

/**
 * Shared attach path: read the signer nonce, push a RegisterPermission EIP-712
 * request for the owner to sign in the browser, then submit
 * kernel.registerPermission from the agent wallet with the exact fee.
 * Returns the registration tx hash.
 */
export async function attachMandate(
  project: ProjectContext,
  channel: SigningChannel,
  publicClient: PublicClient,
  agentSigner: LocalKeyring,
  smaAddress: Address,
  permissionSigner: Address,
  template: { address: Address; label: string },
  opts: { json?: boolean } = {},
): Promise<Hex> {
  const say = (fn: () => void) => {
    if (!opts.json) fn();
  };
  const templateAddress = template.address;
  const chain = getChainById(project.chainId);

  const nonce = (await publicClient.readContract({
    address: project.contracts.kernel,
    abi: SailKernelAbi,
    functionName: "signerNonces",
    args: [smaAddress],
  })) as bigint;

  const typedData = buildRegisterPermissionTypedData({
    chainId: project.chainId,
    kernel: project.contracts.kernel,
    account: smaAddress,
    permission: templateAddress,
    nonce,
  });

  say(() => console.log(`\nPushing signing request for "${template.label}" mandate…`));
  const response = await channel.requestSignature({
    type: "typed-data",
    kind: "register-permission",
    title: `Authorize "${template.label}"`,
    description: `Sign to authorize the ${template.label} mandate on your Safe. The agent will submit the registration transaction.`,
    chainId: project.chainId,
    details: [
      { label: "Safe", value: smaAddress },
      { label: "Template", value: templateAddress },
      { label: "Mandate", value: template.label },
      { label: "Signer", value: permissionSigner },
    ],
    typedData,
  });

  if (response.status === "rejected") {
    throw new Error(`User rejected mandate authorization: ${response.reason ?? "no reason given"}`);
  }
  if (response.status !== "signature") {
    throw new Error(`Expected EIP-712 signature response, got: ${response.status}`);
  }
  const signature = response.signature;

  say(() => console.log("Estimating permission fee…"));
  const fee = await estimatePermissionFee(
    publicClient,
    project.contracts.governance,
    templateAddress,
  );

  say(() => console.log(`Submitting mandate registration (agent pays gas; fee ${fee} wei)…`));
  const walletClient = createWalletClient({
    account: agentSigner.viemAccount,
    chain,
    transport: http(getRpcUrl(project.chainId)),
  });

  const registerData = encodeFunctionData({
    abi: SailKernelAbi,
    functionName: "registerPermission",
    args: [smaAddress, templateAddress, signature],
  });

  const txHash = await walletClient.sendTransaction({
    to: project.contracts.kernel,
    data: registerData,
    value: fee,
    account: agentSigner.viemAccount,
    chain,
  });

  say(() => console.log("Waiting for confirmation…"));
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`registerPermission reverted (tx ${txHash})`);
  }

  say(() => console.log("✓", `Mandate "${template.label}" registered`));
  // The agent (manager) submits and pays for this on-chain registration; the
  // owner's off-chain authorization signature was logged separately by the
  // signing server (register-permission → owner_signed).
  appendActivity({
    ts: nowIso(),
    actor: "agent",
    type: "permission_registered",
    permission: templateAddress,
    name: template.label,
    sma: smaAddress,
    txHash,
    chainId: project.chainId,
  });
  return txHash;
}

async function persistAccount(
  publicClient: PublicClient,
  account: {
    safe: Address;
    owner: Address;
    permissionSigner: Address;
    manager: Address;
    chainId: number;
  },
): Promise<void> {
  let createdAtBlock = "0";
  try {
    createdAtBlock = (await publicClient.getBlockNumber()).toString();
  } catch {
    /* keep default */
  }
  const stored: StoredAccount = {
    safe: checksum(account.safe),
    owner: checksum(account.owner),
    permissionSigner: checksum(account.permissionSigner),
    manager: checksum(account.manager),
    chainId: account.chainId,
    createdAtBlock,
  };
  // Register the SMA in the multi-SMA list the dashboard switcher reads *before*
  // overwriting account.json, so the previously-active SMA is backfilled into
  // the list rather than dropped.
  upsertAccountInList(stored);
  writeJsonFile(sailPath("account.json"), stored);
}

function printSummary(smaAddress: Address, agentAddress: Address, permissions: Address[]): void {
  console.log(`\n${"─".repeat(56)}`);
  console.log("✓ Setup complete!");
  console.log(`  Safe:       ${smaAddress}`);
  console.log(`  Agent:      ${agentAddress}`);
  if (permissions.length > 0) {
    console.log(`  Mandates:   ${permissions.length}`);
    for (const p of permissions) console.log("    -", p);
  } else {
    console.log("  Mandates:   none — attach one later with sailor mandate attach");
  }
  console.log("─".repeat(56));
}
