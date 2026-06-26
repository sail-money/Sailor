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
  REGISTER_PERMISSION_TYPES,
  REGISTER_PERMISSION_TYPES_NO_DEADLINE,
  SAFE_V141,
  SailKernelAbi,
  buildRegisterPermissionTypedData,
  buildSafeSetupInitializer,
  detectKernelCapabilities,
  estimateMandateRegistrationFee,
  getSailDeployment,
  sailKernelDomain,
} from "@sail/sdk";
import {
  http,
  type Address,
  type Hex,
  type PublicClient,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  getAddress,
  isAddress,
  parseEventLogs,
  publicActions,
  recoverTypedDataAddress,
  zeroAddress,
} from "viem";
import { getChainById, getRpcUrl } from "../lib/chain.js";
import { appendActivity, checksum, nowIso, prompt, sailPath, writeJsonFile } from "../lib/io.js";
import { keyExists, loadManagerSigner } from "../lib/keys.js";
import { MandateStore } from "../lib/mandates.js";
import { explainPermission } from "../lib/permission-explainer.js";
import { emit } from "../lib/output.js";
import { ProjectContext } from "../lib/project.js";
import { registrationGate } from "../lib/registration-fee.js";
import { type StoredAccount, upsertAccountInList } from "../lib/state.js";
import { type SigningChannel, createSigningChannel, signingPageUrl } from "../signing/client.js";
import { projectPort } from "../lib/packagePaths.js";

export interface OnboardOptions {
  sma?: string;
  newSma?: boolean;
  template?: string;
  skipMandate?: boolean;
  json?: boolean;
  salt?: string;
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
    throw new Error('No agent wallet found. Run "sailor keys generate" and choose "agent wallet" first.');
  }
  const agentSigner = await loadManagerSigner();
  const agentAddress = agentSigner.address;
  say(() => console.log("✓", `Agent wallet: ${agentAddress}`));

  // ── Step 2: Resolve SMA address ─────────────────────────────────────────────
  const chain = getChainById(project.chainId);
  const publicClient = createPublicClient({
    chain,
    transport: http(getRpcUrl(project.chainId)),
  }).extend(publicActions) as PublicClient;

  const smaChoice = await resolveSmaChoice(options, json);

  say(() =>
    console.log(
      `\n→ Open the Sailor dashboard to approve signing requests:\n  ${signingPageUrl(projectPort(process.cwd()))}\n`,
    ),
  );

  let smaAddress: Address;
  let justCreated = false;
  let ownerAddress = project.getOwner();
  let deployedSaltNonce: bigint | undefined;

  if (smaChoice.kind === "new") {
    const saltNonce = options.salt != null ? BigInt(options.salt) : 0n;
    const created = await createSma(project, channel, publicClient, agentAddress, json, saltNonce);
    smaAddress = created.sma;
    ownerAddress = created.owner;
    deployedSaltNonce = created.saltNonce;
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
      `SMA ${smaAddress} is not registered with SailKernel. Only SMAs created via kernel.createAccount can be registered — run with --new-sma to create one.`,
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
    console.log("  Mandate signer:", permissionSigner);
    console.log("  Agent wallet:  ", onChainManager);
    if (onChainManager.toLowerCase() !== agentAddress.toLowerCase()) {
      console.log(
        `\n⚠  On-chain agent wallet (${onChainManager}) differs from your local agent wallet (${agentAddress}).\n   To make this SMA delegate to a new agent wallet, run "sailor account rotate-signer".`,
      );
    } else {
      console.log("✓", "Agent wallet is authorized for this SMA");
    }
  });

  // Persist the SMA to .sail/account.json so `sailor status`/`run` can read it.
  await persistAccount(publicClient, {
    safe: smaAddress,
    owner: ownerAddress ?? permissionSigner,
    permissionSigner,
    manager: onChainManager,
    chainId: project.chainId,
    saltNonce: deployedSaltNonce,
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
    say(() => console.log("✓", `${currentPermissions.length} permission(s) already registered`));
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

  // Detect conjunctive kernel and guard against unsafe mandate configurations
  // before attaching anything. Warnings are always printed (even with --json)
  // because they concern fund security, not just UX.
  let isConjunctive = false;
  try {
    const caps = await detectKernelCapabilities(publicClient, project.contracts.kernel, {
      chainId: project.chainId,
    });
    isConjunctive = caps.dispatchModel === "conjunctive";
    if (isConjunctive) {
      console.log(
        "\n⚠  This kernel evaluates every registered permission on every dispatch.\n" +
          "   The shared permission contracts (SharedBoundedSwapPermission, SharedTransferTargetPermission)\n" +
          "   are NOT pass-through — they will block any dispatch they do not recognise.\n" +
          "   Use pass-through permission contracts for this kernel.\n",
      );
    }
  } catch {
    // Capability detection is advisory — don't block onboard if it fails.
  }

  // MEDIUM security guard: if a LiFi swap permission (boundedLiFi / boundedApprove)
  // is being attached without a transfer-restriction companion, warn the operator.
  // These pass-through permissions leave ERC-20 transfer() calls unrestricted —
  // the manager key can call token.transfer(attacker, balance) from the Safe.
  // Production deployments must add SharedTransferTargetPermission or equivalent.
  const LIFI_PERMISSION_KINDS = new Set([
    "LifiDiamondSwapPermissionCloneable",
    "LifiBoundedApprovePermissionCloneable",
  ]);
  const TRANSFER_RESTRICTION_KINDS = new Set([
    "SharedTransferTargetPermission",
    "TransferTargetPermission",
  ]);
  const attachingLifi = LIFI_PERMISSION_KINDS.has(template.label) || LIFI_PERMISSION_KINDS.has(template.address);
  if (attachingLifi) {
    // Check if a transfer-restriction permission is already registered.
    const existing = (await publicClient.readContract({
      address: project.contracts.kernel,
      abi: SailKernelAbi,
      functionName: "getPermissions",
      args: [smaAddress],
    })) as Address[];
    const hasTransferRestriction = existing.some((p) => TRANSFER_RESTRICTION_KINDS.has(p));
    if (!hasTransferRestriction) {
      console.log(
        "\n⚠  SECURITY: You are registering a LiFi permission without a transfer-restriction companion.\n" +
          "   LiFi clone permissions pass through all calls whose target is not the LiFi Diamond.\n" +
          "   This means the agent wallet can call ERC-20 transfer() to any address from the SMA.\n" +
          "   Before managing real funds, also register SharedTransferTargetPermission to restrict\n" +
          "   token transfers to approved recipients only.\n",
      );
    }
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
    return { kind: "address", address: getAddress(options.sma) };
  }
  if (options.newSma) return { kind: "new" };
  if (json) {
    throw new Error("Specify --sma <address> or --new-sma (non-interactive / --json mode).");
  }

  const choice = await prompt(
    "Create a new SMA? (y = new, or paste an existing SMA address)",
    "y",
  );
  if (choice.toLowerCase() === "y" || choice.toLowerCase() === "yes") return { kind: "new" };
  if (!isAddress(choice, { strict: false })) throw new Error(`Invalid SMA address: ${choice}`);
  return { kind: "address", address: getAddress(choice) };
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
      return { address: getAddress(options.template), label: options.template };
    }
    throw new Error(
      `Unknown mandate template "${options.template}". Run "sailor mandate templates".`,
    );
  }

  if (json) return null;
  if (templates.length === 0) {
    console.log("\nNo known permission contracts for this chain. Skipping the permission step.");
    console.log('Author and deploy your own with "sailor mandate deploy".');
    return null;
  }

  console.log("\nAvailable permission contracts:");
  templates.forEach((t, i) => console.log(`  ${i + 1}. ${t.label} (${t.address})`));
  const pick = await prompt("Register which permission? (number, or blank to skip)", "");
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
  saltNonce = 0n,
): Promise<{ sma: Address; owner: Address; saltNonce: bigint }> {
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
      zeroAddress, // feeAsset (native)
    ],
  });

  say(() => console.log("\nPushing signing request…"));
  const response = await channel.requestSignature({
    type: "transaction",
    kind: "create-sma",
    title: "Create & Register SMA",
    description:
      "Deploy and register a new 1-of-1 SMA with SailKernel. The agent wallet will be authorized to dispatch.",
    chainId: project.chainId,
    to: project.contracts.kernel,
    data: createAccountData,
    details: [
      { label: "Owner (you)", value: ownerAddress },
      { label: "Agent wallet", value: agentAddress },
      { label: "Fee policy", value: project.contracts.standardFeePolicy },
      { label: "Safe factory", value: SAFE_V141.proxyFactory },
    ],
  });

  if (response.status === "rejected") {
    throw new Error(`User rejected SMA creation: ${response.reason ?? "no reason given"}`);
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
  say(() => console.log("✓", `SMA created at ${safeAddress}`));
  say(() => console.log("   Salt:", saltNonce.toString(), "(stored in .sail/account.json — use for sailor account predict)"));
  appendActivity({
    ts: nowIso(),
    actor: "owner",
    type: "sma_created",
    sma: safeAddress,
    owner: ownerAddress,
    manager: agentAddress,
    txHash: response.txHash,
    chainId: project.chainId,
    saltNonce: saltNonce.toString(),
  });
  return { sma: safeAddress, owner: ownerAddress, saltNonce };
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

  // Detect the kernel's RegisterPermission shape so we use the right type string.
  // All currently-supported kernels are selective (see deployments.ts dispatchModel)
  // and use the with-deadline RegisterPermission shape. We still detect the shape
  // on-chain (detectKernelCapabilities) rather than assume it, so this stays correct
  // if a kernel ever differs. The no-deadline path below is the legacy/conjunctive
  // shape, retained only as a detection-driven fallback — not a live target on any
  // of today's chains.
  let registerPermissionHasDeadline = false;
  try {
    const caps = await detectKernelCapabilities(publicClient, project.contracts.kernel, {
      chainId: project.chainId,
    });
    registerPermissionHasDeadline = caps.registerPermissionHasDeadline;
  } catch {
    // advisory — proceed with noDeadline fallback
  }

  // Capture an explicit deadline so we can reconstruct the exact message for
  // signature verification after the browser returns. Without this, recomputing
  // Date.now() a few seconds later would produce a different value.
  const registrationDeadline = registerPermissionHasDeadline
    ? BigInt(Math.floor(Date.now() / 1000) + 300)
    : undefined;

  const typedData = buildRegisterPermissionTypedData({
    chainId: project.chainId,
    kernel: project.contracts.kernel,
    account: smaAddress,
    permission: templateAddress,
    nonce,
    hasDeadline: registerPermissionHasDeadline,
    deadline: registrationDeadline,
  });

  // Compute the registration fee ONCE — the single source of truth shared by the
  // disclosure, the balance preflight, the tx `value`, and the activity log, so
  // every number is provably the same as what the kernel charges.
  // estimateMandateRegistrationFee reads the flat permissionRegistrationFee and
  // applies it per permission (fee × N) — exactly the kernel's charge.
  const feeEstimate = await estimateMandateRegistrationFee(
    publicClient,
    project.contracts.governance,
    [templateAddress],
  );
  const fee = feeEstimate.totalWei;

  // Preflight + disclose BEFORE asking the owner to sign, so an underfunded
  // signer fails early (via a typed RegistrationFeeError) instead of after a
  // wasted signature / on-chain revert.
  const agentBalanceWei = await publicClient.getBalance({
    address: agentSigner.viemAccount.address,
  });
  const gate = registrationGate({ estimate: feeEstimate, agentBalanceWei });
  say(() => console.log(gate.disclosure));

  say(() => console.log(`\nPushing signing request for "${template.label}" permission…`));
  say(() =>
    console.log(
      `  The mandate signer (${permissionSigner}) must sign in the browser — not the agent wallet.`,
    ),
  );
  // NL summary parsed from the permission's contract comments, so the approval
  // card explains what it enforces before the owner signs.
  const permRecord = new MandateStore().find(templateAddress);
  const permExplanation =
    (permRecord ? explainPermission(permRecord.name, permRecord.sourcePath) : explainPermission(template.label)) ??
    undefined;

  const response = await channel.requestSignature({
    type: "typed-data",
    kind: "register-permission",
    title: `Authorize "${template.label}"`,
    description: `Sign to authorize the ${template.label} permission on your SMA. The agent will submit the registration transaction.`,
    chainId: project.chainId,
    details: [
      { label: "SMA", value: smaAddress },
      { label: "Permission contract", value: templateAddress },
      { label: "Permission", value: template.label },
      { label: "Mandate signer", value: permissionSigner },
    ],
    explanation: permExplanation,
    typedData,
  });

  if (response.status === "rejected") {
    throw new Error(`User rejected mandate authorization: ${response.reason ?? "no reason given"}`);
  }
  if (response.status !== "signature") {
    throw new Error(`Expected EIP-712 signature response, got: ${response.status}`);
  }
  const signature = response.signature;

  // Security guard: verify the browser signature was made by the on-chain mandate
  // signer — NOT by the agent wallet. If the wrong wallet was connected in the
  // browser UI, ecrecover returns a different address and the on-chain call would
  // revert with InvalidManagerSignature anyway, but we surface it here with a clear
  // error before wasting gas.
  try {
    const recoveredSigner = await recoverTypedDataAddress({
      domain: sailKernelDomain({ chainId: project.chainId, kernel: project.contracts.kernel }),
      types: registerPermissionHasDeadline
        ? REGISTER_PERMISSION_TYPES
        : REGISTER_PERMISSION_TYPES_NO_DEADLINE,
      primaryType: "RegisterPermission",
      message: registerPermissionHasDeadline
        ? { account: smaAddress, permission: templateAddress, nonce, deadline: registrationDeadline! }
        : { account: smaAddress, permission: templateAddress, nonce },
      signature,
    });
    if (recoveredSigner.toLowerCase() !== permissionSigner.toLowerCase()) {
      throw new Error(
        `Security: RegisterPermission was signed by ${recoveredSigner} but the on-chain mandate signer is ${permissionSigner}.\n` +
          "Connect the owner wallet (mandate signer) in the browser — the agent wallet must never sign permission registrations.",
      );
    }
  } catch (err) {
    // Re-throw security errors; ignore recovery failures (e.g. unsupported sig format).
    if ((err as Error).message.startsWith("Security:")) throw err;
  }

  say(() => console.log(`Submitting mandate registration (agent pays gas; fee ${fee} wei)…`));
  const walletClient = createWalletClient({
    account: agentSigner.viemAccount,
    chain,
    transport: http(getRpcUrl(project.chainId)),
  });

  // The kernel has two registerPermission shapes: selective kernels take a
  // deadline (registerPermission(account, permission, deadline, sig)), conjunctive
  // kernels do not (registerPermission(account, permission, sig)). The owner's
  // signature was built over the matching typehash above; the on-chain call must
  // use the matching arity or it hits a nonexistent selector and reverts empty.
  const registerData = registerPermissionHasDeadline
    ? encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "registerPermission",
            stateMutability: "payable",
            inputs: [
              { name: "account", type: "address" },
              { name: "permission", type: "address" },
              { name: "deadline", type: "uint256" },
              { name: "sig", type: "bytes" },
            ],
            outputs: [],
          },
        ] as const,
        functionName: "registerPermission",
        args: [smaAddress, templateAddress, registrationDeadline!, signature],
      })
    : encodeFunctionData({
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

  say(() => console.log("✓", `Permission "${template.label}" registered`));
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
    // Registration fee actually paid by the agent for this permission.
    fee: fee.toString(),
    feeEth: formatEther(fee),
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
    saltNonce?: bigint;
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
    managers: [checksum(account.manager)],
    chainId: account.chainId,
    createdAtBlock,
    ...(account.saltNonce != null ? { saltNonce: account.saltNonce.toString() } : {}),
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
  console.log(`  SMA:         ${smaAddress}`);
  console.log(`  Agent:       ${agentAddress}`);
  if (permissions.length > 0) {
    console.log(`  Permissions: ${permissions.length}`);
    for (const p of permissions) console.log("    -", p);
  } else {
    console.log("  Permissions: none — register one later with sailor mandate attach");
  }
  console.log("─".repeat(56));
}
