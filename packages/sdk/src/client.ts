import {
  type Account as ViemAccount,
  type Chain,
  createPublicClient,
  defineChain,
  encodeAbiParameters,
  http,
  keccak256,
  parseEventLogs,
  type PublicClient,
  type Transport,
  type WalletClient,
  zeroAddress,
} from "viem";
import { SailKernelAbi } from "./abis/SailKernel.js";
import {
  type KernelCapabilities,
  detectKernelCapabilities,
} from "./capabilities.js";
import { sailDeployments } from "./deployments.js";
import { explainKernelRevert } from "./errors.js";
import type {
  Account,
  Address,
  AgentContext,
  Call,
  CreateAccountParams,
  Dispatch,
  DispatchOptions,
  FeePolicy,
  Hex,
  IAccountNamespace,
  IDispatchNamespace,
  IFeesNamespace,
  ILocalKeyring,
  IMandateNamespace,
  IPrincipalNamespace,
  ISailorClient,
  ISessionNamespace,
  Mandate,
  MandateDraftInput,
  MandateExplanation,
  MandateItem,
  PermissionTemplate,
  PreviewResult,
  RegisterAccountParams,
  SailorClientConfig,
  Session,
  TxResult,
} from "./types.js";

// Re-export so consumers can use AgentContext without a separate import
export type { AgentContext };
export { SailKernelAbi } from "./abis/SailKernel.js";
export { MandateFactoryAbi } from "./abis/MandateFactory.js";

/** A WalletClient with bound account + chain, used for state-changing calls. */
type Signer = WalletClient<Transport, Chain, ViemAccount>;

function notImplemented(): never {
  throw new Error("not implemented");
}

function buildPublicClient(config: SailorClientConfig): PublicClient {
  const chain = defineChain({
    id: config.chainId,
    name: `Chain ${config.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  return createPublicClient({ chain, transport: http(config.rpcUrl) });
}

/** EIP-712 domain for all SailKernel signatures. */
function kernelDomain(kernel: Address, chainId: number) {
  return { name: "SailKernel", version: "1", chainId, verifyingContract: kernel };
}

/** Default signature deadline: 5 minutes from now (unix seconds). */
function defaultDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 300);
}

/**
 * Default gas limit for a single dispatch. Passing an explicit limit makes viem
 * skip its `eth_estimateGas` pre-flight, which a load-balanced RPC can route to a
 * lagging node — computing the digest against a stale nonce and failing with
 * InvalidManagerSignature even though the tx would mine fine. Generous enough for
 * an ERC-20 approve, a transfer, or a LiFi-diamond swap.
 */
const DEFAULT_DISPATCH_GAS = 2_000_000n;

/** Resolve after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ABI tuple components for the kernel's `Call` struct. */
const CALL_COMPONENTS = [
  { name: "target", type: "address" },
  { name: "value", type: "uint256" },
  { name: "data", type: "bytes" },
] as const;

/**
 * Minimal ABI for the older "conjunctive" kernel's dispatch — it takes NO
 * `permission` argument (the kernel checks every registered permission), so the
 * selective SailKernelAbi cannot encode a call to it.
 */
const CONJUNCTIVE_DISPATCH_ABI = [
  {
    type: "function",
    name: "dispatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "managerSig", type: "bytes" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** EIP-712 Dispatch struct fields, per dispatch model. */
const DISPATCH_EIP712_FIELDS = {
  selective: [
    { name: "account", type: "address" },
    { name: "permission", type: "address" },
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "dataHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  conjunctive: [
    { name: "account", type: "address" },
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "dataHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * Wrap a thrown dispatch error with a decoded kernel diagnosis, when one can be
 * recovered. The original error is preserved as `.cause`.
 */
async function enrichKernelRevert(err: unknown): Promise<Error> {
  const decoded = await explainKernelRevert(err);
  const base = err instanceof Error ? err : new Error(String(err));
  if (!decoded) return base;
  const wrapped = new Error(`Kernel reverted: ${decoded.message}`);
  (wrapped as Error & { cause?: unknown }).cause = base;
  (wrapped as Error & { kernelError?: unknown }).kernelError = decoded;
  return wrapped;
}

/** Shared base providing the public client, config, and an optional signer. */
abstract class KernelNamespace {
  constructor(
    protected readonly publicClient: PublicClient,
    protected readonly config: SailorClientConfig,
    protected readonly walletClient?: Signer,
  ) {}

  protected requireKernel(): Address {
    const kernel = this.config.kernel;
    if (!kernel) {
      throw new Error(
        "SailKernel address not configured — set `kernel` in SailorClientConfig.",
      );
    }
    return kernel;
  }

  protected requireSigner(): Signer {
    if (!this.walletClient) {
      throw new Error(
        "No signer attached — call client.withSigner(walletClient) before write operations.",
      );
    }
    return this.walletClient;
  }

  /**
   * Detect (and cache) the deployed kernel's dispatch model. Prefers reading the
   * on-chain DISPATCH_TYPEHASH; falls back to the bundled deployment's static
   * `dispatchModel` hint if the on-chain read is unavailable.
   */
  protected async capabilities(): Promise<KernelCapabilities> {
    const kernel = this.requireKernel();
    const staticModel = sailDeployments[this.config.chainId as keyof typeof sailDeployments]
      ?.dispatchModel;
    return detectKernelCapabilities(this.publicClient, kernel, {
      chainId: this.config.chainId,
      staticModel,
    });
  }
}

class AccountNamespace extends KernelNamespace implements IAccountNamespace {
  async create(params: CreateAccountParams): Promise<Account> {
    const kernel = this.requireKernel();
    const signer = this.requireSigner();
    if (!params.safeFactory || !params.safeSingleton || !params.safeInitializer) {
      throw new Error(
        "createAccount requires safeFactory, safeSingleton, and safeInitializer.",
      );
    }

    const txHash = await signer.writeContract({
      address: kernel,
      abi: SailKernelAbi,
      functionName: "createAccount",
      args: [
        params.safeFactory,
        params.safeSingleton,
        params.safeInitializer,
        params.saltNonce ?? 0n,
        params.permissionSigner,
        params.manager,
        params.feePolicy ?? zeroAddress,
      ],
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    const events = parseEventLogs({
      abi: SailKernelAbi,
      eventName: "AccountRegistered",
      logs: receipt.logs,
    });
    const safe = events[0]?.args.account ?? zeroAddress;

    return {
      safe,
      owner: params.owner,
      permissionSigner: params.permissionSigner,
      manager: params.manager,
      chainId: params.chainId,
      createdAtBlock: receipt.blockNumber,
    };
  }

  registerExisting(_safe: Address, _params: RegisterAccountParams): Promise<Account> {
    return notImplemented();
  }

  get(_safe: Address): Promise<Account> {
    return notImplemented();
  }
}

class MandateNamespace extends KernelNamespace implements IMandateNamespace {
  attach(
    _safe: Address,
    _template: PermissionTemplate,
    _params: unknown,
    _signer: ILocalKeyring,
  ): Promise<void> {
    return notImplemented();
  }

  /**
   * Registers a batch of permissions on the kernel. The permissionSigner signs
   * the EIP-712 RegisterPermissions struct; the attached wallet submits the tx.
   * Assumes each template is already configured for the account (shared
   * templates) or is stateless.
   */
  async attachBatch(safe: Address, items: MandateItem[], signer: ILocalKeyring): Promise<void> {
    const kernel = this.requireKernel();
    const wallet = this.requireSigner();
    const permissions = items.map((item) => item.template.address);
    const deadline = defaultDeadline();

    const nonce = await this.publicClient.readContract({
      address: kernel,
      abi: SailKernelAbi,
      functionName: "signerNonces",
      args: [safe],
    });

    const sig = await signer.signTyped(
      kernelDomain(kernel, this.config.chainId),
      {
        primaryType: "RegisterPermissions",
        types: {
          RegisterPermissions: [
            { name: "account", type: "address" },
            { name: "permissions", type: "address[]" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
      },
      { account: safe, permissions, nonce, deadline },
    );

    await wallet.writeContract({
      address: kernel,
      abi: SailKernelAbi,
      functionName: "registerPermissions",
      args: [safe, permissions, deadline, sig],
      value: 0n,
    });
  }

  reconfigure(
    _safe: Address,
    _template: PermissionTemplate,
    _params: unknown,
    _signer: ILocalKeyring,
  ): Promise<void> {
    return notImplemented();
  }

  replace(
    _safe: Address,
    _oldTemplate: PermissionTemplate,
    _newTemplate: PermissionTemplate,
    _params: unknown,
    _signer: ILocalKeyring,
  ): Promise<void> {
    return notImplemented();
  }

  detach(_safe: Address, _template: PermissionTemplate, _signer: ILocalKeyring): Promise<void> {
    return notImplemented();
  }

  deployAndAttachClone(
    _safe: Address,
    _impl: Address,
    _initData: Hex,
    _salt: Hex,
    _signer: ILocalKeyring,
  ): Promise<void> {
    return notImplemented();
  }

  async list(safe: Address): Promise<Mandate[]> {
    const kernel = this.requireKernel();
    const permissions = await this.publicClient.readContract({
      address: kernel,
      abi: SailKernelAbi,
      functionName: "getPermissions",
      args: [safe],
    });
    return permissions.map((permission) => ({
      permission,
      templateName: "",
      params: undefined,
      registeredAtBlock: 0n,
      active: true,
    }));
  }

  async isRegistered(safe: Address, permission: Address): Promise<boolean> {
    const kernel = this.requireKernel();
    return this.publicClient.readContract({
      address: kernel,
      abi: SailKernelAbi,
      functionName: "isPermissionRegistered",
      args: [safe, permission],
    });
  }

  draft(input: MandateDraftInput): Promise<MandateExplanation> {
    const matched = input.suggestedTemplates ?? [];
    return Promise.resolve({
      templateName: matched[0] ?? "unknown",
      humanReadable: [
        `Strategy: ${input.description}`,
        matched.length > 0
          ? `Suggested templates: ${matched.join(", ")}`
          : "No template matched — specify a template name to generate mandate terms.",
      ],
      warnings: ["This is a draft — review each permission term before signing."],
    });
  }
}

class DispatchNamespace extends KernelNamespace implements IDispatchNamespace {
  /**
   * Per-account expected next manager nonce, recorded after each confirmed
   * `single` dispatch. The next dispatch on the same account waits until the
   * on-chain `managerNonces` reflects this value before signing, so a lagging
   * node in a load-balanced RPC pool can't make us sign with a stale nonce.
   * Keyed by `${kernel}:${safe}` (lowercased).
   */
  private readonly nextNonce = new Map<string, bigint>();

  private nonceKey(kernel: Address, safe: Address): string {
    return `${kernel.toLowerCase()}:${safe.toLowerCase()}`;
  }

  /** Read the current on-chain manager nonce for an account. */
  private readManagerNonce(kernel: Address, safe: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: kernel,
      abi: SailKernelAbi,
      functionName: "managerNonces",
      args: [safe],
    });
  }

  /**
   * Poll `managerNonces` until it reaches at least `expected`. A load-balanced
   * RPC may briefly serve a stale (lower) value from a node that hasn't yet
   * indexed the prior dispatch; retrying guarantees the next dispatch is signed
   * against — and validated with — the correct nonce.
   */
  private async waitForManagerNonce(
    kernel: Address,
    safe: Address,
    expected: bigint,
    tries = 30,
  ): Promise<bigint> {
    let latest = 0n;
    for (let i = 0; i < tries; i++) {
      latest = await this.readManagerNonce(kernel, safe);
      if (latest >= expected) return latest;
      await delay(1000);
    }
    throw new Error(
      `Manager nonce for ${safe} did not reach ${expected} after ${tries}s ` +
        `(last seen ${latest}). The prior dispatch may not have mined, or the RPC ` +
        "endpoint is lagging. Retry, or pass an explicit nonce via options.nonce.",
    );
  }

  /**
   * Determine the nonce to sign with. Honors an explicit `options.nonce`
   * verbatim; otherwise waits for the on-chain nonce to reach any pending
   * expectation (explicit `options.awaitNonce` or the value tracked from a prior
   * dispatch on this account) before reading the live value.
   */
  private async resolveNonce(
    kernel: Address,
    safe: Address,
    options?: DispatchOptions,
  ): Promise<bigint> {
    if (options?.nonce !== undefined) return options.nonce;
    const expected = options?.awaitNonce ?? this.nextNonce.get(this.nonceKey(kernel, safe));
    if (expected !== undefined) {
      return this.waitForManagerNonce(kernel, safe, expected);
    }
    return this.readManagerNonce(kernel, safe);
  }

  /**
   * Wait for a receipt, retrying transient RPC failures. A dispatch that has been
   * submitted will mine; a flaky read of its receipt must not be reported as a
   * failed dispatch.
   */
  private async awaitReceipt(txHash: Hex, tries = 5) {
    let lastErr: unknown;
    for (let i = 0; i < tries; i++) {
      try {
        return await this.publicClient.waitForTransactionReceipt({ hash: txHash });
      } catch (err) {
        lastErr = err;
        await delay(1000);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /**
   * Single-call dispatch. The manager signs the EIP-712 Dispatch struct; the
   * attached wallet submits kernel.dispatch and we wait for the receipt.
   *
   * Nonce ordering is handled automatically: sequential `single` calls on the
   * same account wait for the prior dispatch's nonce bump to propagate before
   * signing, so callers don't hand-roll nonce tracking. Pass `options.nonce` to
   * take over ordering, or `options.gas` to override the default gas limit.
   */
  async single(
    safe: Address,
    permission: Address,
    call: Call,
    manager: ILocalKeyring,
    options?: DispatchOptions,
  ): Promise<Dispatch> {
    const kernel = this.requireKernel();
    const wallet = this.requireSigner();
    const deadline = options?.deadline ?? defaultDeadline();
    const caps = await this.capabilities();
    const selective = caps.dispatchModel === "selective";

    const nonce = await this.resolveNonce(kernel, safe, options);

    const dataHash = keccak256(call.data);

    // Sign the Dispatch struct matching the deployed kernel's model. Signing the
    // wrong shape (e.g. a permission field the kernel doesn't expect) recovers a
    // different address and reverts with InvalidManagerSignature.
    const message: Record<string, unknown> = selective
      ? { account: safe, permission, target: call.target, value: call.value, dataHash, nonce, deadline }
      : { account: safe, target: call.target, value: call.value, dataHash, nonce, deadline };

    const managerSig = await manager.signTyped(
      kernelDomain(kernel, this.config.chainId),
      {
        primaryType: "Dispatch",
        types: { Dispatch: DISPATCH_EIP712_FIELDS[caps.dispatchModel] as unknown as { name: string; type: string }[] },
      },
      message,
    );

    // Pass an explicit gas limit so viem skips eth_estimateGas (see
    // DEFAULT_DISPATCH_GAS). Conjunctive kernels take no `permission` arg and use
    // a different ABI.
    const gas = options?.gas ?? DEFAULT_DISPATCH_GAS;
    let txHash: Hex;
    try {
      txHash = selective
        ? await wallet.writeContract({
            address: kernel,
            abi: SailKernelAbi,
            functionName: "dispatch",
            args: [safe, permission, call.target, call.value, call.data, managerSig, deadline],
            gas,
          })
        : await wallet.writeContract({
            address: kernel,
            abi: CONJUNCTIVE_DISPATCH_ABI,
            functionName: "dispatch",
            args: [safe, call.target, call.value, call.data, managerSig, deadline],
            gas,
          });
    } catch (err) {
      throw await enrichKernelRevert(err);
    }

    const receipt = await this.awaitReceipt(txHash);
    const success = receipt.status === "success";
    // Record the next expected nonce only on success: a reverted dispatch reverts
    // the whole tx, so the kernel does NOT bump managerNonces.
    if (success) {
      this.nextNonce.set(this.nonceKey(kernel, safe), nonce + 1n);
    }
    return {
      txHash,
      calls: [call],
      success,
      gasUsed: receipt.gasUsed,
    };
  }

  /**
   * Batch dispatch. callsHash = keccak256(abi.encode(calls)); the manager signs
   * the EIP-712 DispatchBatch struct and the wallet submits kernel.dispatchBatch.
   */
  async batch(
    safe: Address,
    permission: Address,
    calls: Call[],
    manager: ILocalKeyring,
  ): Promise<Dispatch> {
    const kernel = this.requireKernel();
    const wallet = this.requireSigner();
    const deadline = defaultDeadline();

    const caps = await this.capabilities();
    if (caps.dispatchModel === "conjunctive") {
      throw new Error(
        `Batch dispatch is not supported by the conjunctive kernel at ${kernel} ` +
          "(it has no dispatchBatch). Submit calls individually via dispatch.single, " +
          "ensuring the manager nonce advances between them.",
      );
    }

    const nonce = await this.publicClient.readContract({
      address: kernel,
      abi: SailKernelAbi,
      functionName: "batchNonces",
      args: [safe],
    });

    const callsHash = keccak256(
      encodeAbiParameters([{ type: "tuple[]", components: CALL_COMPONENTS }], [calls]),
    );

    const managerSig = await manager.signTyped(
      kernelDomain(kernel, this.config.chainId),
      {
        primaryType: "DispatchBatch",
        types: {
          DispatchBatch: [
            { name: "account", type: "address" },
            { name: "permission", type: "address" },
            { name: "callsHash", type: "bytes32" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
      },
      { account: safe, permission, callsHash, nonce, deadline },
    );

    let txHash: Hex;
    try {
      txHash = await wallet.writeContract({
        address: kernel,
        abi: SailKernelAbi,
        functionName: "dispatchBatch",
        args: [safe, permission, calls, managerSig, deadline],
      });
    } catch (err) {
      throw await enrichKernelRevert(err);
    }

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return {
      txHash,
      calls,
      success: receipt.status === "success",
      gasUsed: receipt.gasUsed,
    };
  }

  /** Dry-run a batch via kernel.previewBatch — a read call, no signing. */
  async preview(safe: Address, permission: Address, calls: Call[]): Promise<PreviewResult> {
    const kernel = this.requireKernel();
    const caps = await this.capabilities();
    if (caps.dispatchModel === "conjunctive") {
      throw new Error(
        `Dry-run preview is not supported by the conjunctive kernel at ${kernel} ` +
          "(it has no previewBatch view). Validate calls off-chain against each registered " +
          "permission's evaluate() logic, or simulate the dispatch.single tx instead.",
      );
    }
    const [approved, reason] = await this.publicClient.readContract({
      address: kernel,
      abi: SailKernelAbi,
      functionName: "previewBatch",
      args: [safe, permission, calls],
    });
    return { approved, calls, reason };
  }
}

class SessionNamespace extends KernelNamespace implements ISessionNamespace {
  revoke(_safe: Address, _signer: ILocalKeyring): Promise<void> {
    return notImplemented();
  }

  activate(_safe: Address, _signer: ILocalKeyring): Promise<void> {
    return notImplemented();
  }

  status(_safe: Address): Promise<Session> {
    return notImplemented();
  }
}

class FeesNamespace extends KernelNamespace implements IFeesNamespace {
  setPolicy(_safe: Address, _policy: FeePolicy, _signer: ILocalKeyring): Promise<void> {
    return notImplemented();
  }

  /**
   * Collect fees. `collectFees` authorises by msg.sender == manager, so the
   * attached wallet must be the manager's account; no separate signature.
   */
  async collect(
    safe: Address,
    gross: bigint,
    nav: bigint,
    token: Address,
    _manager: ILocalKeyring,
  ): Promise<TxResult> {
    const kernel = this.requireKernel();
    const wallet = this.requireSigner();
    const txHash = await wallet.writeContract({
      address: kernel,
      abi: SailKernelAbi,
      functionName: "collectFees",
      args: [safe, gross, nav, token],
    });
    return { txHash };
  }
}

class PrincipalNamespace extends KernelNamespace implements IPrincipalNamespace {
  /** Record a deposit. msg.sender must be the permissionSigner (the attached wallet). */
  async recordDeposit(safe: Address, amount: bigint, _signer: ILocalKeyring): Promise<TxResult> {
    const kernel = this.requireKernel();
    const wallet = this.requireSigner();
    const txHash = await wallet.writeContract({
      address: kernel,
      abi: SailKernelAbi,
      functionName: "recordDeposit",
      args: [safe, amount],
    });
    return { txHash };
  }

  /** Record a withdrawal. msg.sender must be the permissionSigner (the attached wallet). */
  async recordWithdrawal(
    safe: Address,
    amount: bigint,
    _signer: ILocalKeyring,
  ): Promise<TxResult> {
    const kernel = this.requireKernel();
    const wallet = this.requireSigner();
    const txHash = await wallet.writeContract({
      address: kernel,
      abi: SailKernelAbi,
      functionName: "recordWithdrawal",
      args: [safe, amount],
    });
    return { txHash };
  }
}

/** Top-level client for all Sailor operations. Instantiate once per chain. */
export class SailorClient implements ISailorClient {
  readonly account: IAccountNamespace;
  readonly mandate: IMandateNamespace;
  readonly dispatch: IDispatchNamespace;
  readonly session: ISessionNamespace;
  readonly fees: IFeesNamespace;
  readonly principal: IPrincipalNamespace;

  private readonly config: SailorClientConfig;
  private readonly walletClient?: Signer;
  private readonly publicClient: PublicClient;

  constructor(config: SailorClientConfig, walletClient?: Signer) {
    this.config = config;
    this.walletClient = walletClient;
    const publicClient = buildPublicClient(config);
    this.publicClient = publicClient;
    this.account = new AccountNamespace(publicClient, config, walletClient);
    this.mandate = new MandateNamespace(publicClient, config, walletClient);
    this.dispatch = new DispatchNamespace(publicClient, config, walletClient);
    this.session = new SessionNamespace(publicClient, config, walletClient);
    this.fees = new FeesNamespace(publicClient, config, walletClient);
    this.principal = new PrincipalNamespace(publicClient, config, walletClient);
  }

  /**
   * Returns a new client bound to a WalletClient for state-changing calls.
   * Reads work without a signer; writes (dispatch, fees, principal, account
   * create, mandate attach) require one.
   */
  withSigner(walletClient: Signer): SailorClient {
    return new SailorClient(this.config, walletClient);
  }

  /**
   * Detect (and cache) the deployed kernel's dispatch model and EIP-712 shape by
   * reading its on-chain typehash constants. Falls back to the bundled
   * deployment's static `dispatchModel` hint if the on-chain read is unavailable.
   * Call this during onboarding/preflight to fail loudly on a kernel the SDK
   * cannot safely sign for.
   */
  async capabilities(): Promise<KernelCapabilities> {
    const kernel = this.config.kernel;
    if (!kernel) {
      throw new Error("SailKernel address not configured — set `kernel` in SailorClientConfig.");
    }
    const staticModel = sailDeployments[this.config.chainId as keyof typeof sailDeployments]
      ?.dispatchModel;
    return detectKernelCapabilities(this.publicClient, kernel, {
      chainId: this.config.chainId,
      staticModel,
    });
  }
}
