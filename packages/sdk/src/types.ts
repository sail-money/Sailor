import type { Address, Hex } from "viem";

export type { Address, Hex };

// ── Core domain types ──────────────────────────────────────────────────────────

/** A Sail SMA: a Safe registered with the SailKernel. */
export type Account = {
  safe: Address;
  owner: Address;
  permissionSigner: Address;
  manager: Address;
  chainId: number;
  createdAtBlock: bigint;
};

/** A single registered IPermission mandate on a Safe. */
export type Mandate = {
  permission: Address;
  templateName: string;
  params: unknown;
  registeredAtBlock: bigint;
  active: boolean;
};

/** Human-readable explanation produced by a TemplateExplainer. */
export type MandateExplanation = {
  templateName: string;
  humanReadable: string[];
  warnings: string[];
};

/** A single EVM call (target / value / calldata). */
export type Call = {
  target: Address;
  value: bigint;
  data: Hex;
};

/** On-chain result of a submitted dispatch. */
export type Dispatch = {
  txHash: Hex;
  calls: Call[];
  success: boolean;
  gasUsed: bigint;
};

/** Off-chain simulation output, optionally attached to a PreviewResult. */
export type SimulationResult = {
  success: boolean;
  gasUsed: bigint;
  returnData: Hex;
  stateDiff?: Record<string, unknown>;
};

/** Result from client.dispatch.preview — no gas spent. */
export type PreviewResult = {
  approved: boolean;
  calls: Call[];
  /** Short denial descriptor from the kernel's previewBatch (empty when approved). */
  reason?: string;
  simulation?: SimulationResult;
};

/** Minimal result of a state-changing call: the submitted transaction hash. */
export type TxResult = {
  txHash: Hex;
};

/** Manager session state on a Safe. */
export type Session = {
  safe: Address;
  active: boolean;
  manager: Address;
  activatedAtBlock: bigint | null;
  revokedAtBlock: bigint | null;
};

/** Fee configuration for a Sail SMA. */
export type FeePolicy = {
  /** Annual management fee in basis points (e.g. 200 = 2%). */
  managementFeeBps: number;
  /** Performance fee on profit above high-water mark, in basis points. */
  performanceFeeBps: number;
  feeRecipient: Address;
  /** High-water mark NAV used for performance fee calculation. */
  hwm: bigint;
};

// ── Permission template types ──────────────────────────────────────────────────

/** Encodes/decodes typed params into the bytes an IPermission initializer expects. */
export type TemplateEncoder<T = unknown> = {
  encode(params: T): Hex;
  decode(data: Hex): T;
};

/** Converts typed params to a human-readable MandateExplanation. */
export type TemplateExplainer<T = unknown> = {
  explain(params: T): MandateExplanation;
};

/** A named, addressed permission template with encoder and explainer. */
export type PermissionTemplate<T = unknown> = {
  /** On-chain discriminator name matching IPermission.discriminator(). */
  name: string;
  /** Deployed implementation address (zero until SailKernel is deployed on this chain). */
  address: Address;
  encoder: TemplateEncoder<T>;
  explainer: TemplateExplainer<T>;
};

/** One item in a batch mandate operation. */
export type MandateItem<T = unknown> = {
  template: PermissionTemplate<T>;
  params: T;
};

/** Input to client.mandate.draft — natural language → MandateExplanation. */
export type MandateDraftInput = {
  description: string;
  suggestedTemplates?: string[];
};

// ── Client config and agent types ─────────────────────────────────────────────

export type SailorClientConfig = {
  rpcUrl: string;
  chainId: number;
  /** Deployed SailKernel address on this chain. Required for on-chain operations. */
  kernel?: Address;
  /** Deployed MandateFactory address on this chain. Required for bundled attach flows. */
  mandateFactory?: Address;
};

export type CreateAccountParams = {
  owner: Address;
  permissionSigner: Address;
  manager: Address;
  chainId: number;
  /** Safe proxy factory (must be governance-trusted). Required to deploy the SMA. */
  safeFactory?: Address;
  /** Safe singleton/implementation (must be governance-trusted). Required to deploy. */
  safeSingleton?: Address;
  /** ABI-encoded Safe `setup` calldata used during proxy deployment. Required to deploy. */
  safeInitializer?: Hex;
  /** Caller-chosen nonce combined with msg.sender to form the CREATE2 salt. */
  saltNonce?: bigint;
  /** Fee policy contract; address(0)/undefined means no fee policy. */
  feePolicy?: Address;
};

export type RegisterAccountParams = {
  permissionSigner: Address;
  manager: Address;
};

// ── Namespace interfaces (forward-declared to avoid circular imports) ──────────

export interface ILocalKeyring {
  address: Address;
  sign(hash: Hex): Promise<Hex>;
  signTyped(domain: unknown, types: unknown, value: unknown): Promise<Hex>;
}

export interface IAccountNamespace {
  /**
   * Deploys a new Safe and registers it with the SailKernel in one transaction.
   * Sets permissionSigner and manager as part of setup.
   */
  create(params: CreateAccountParams): Promise<Account>;

  /**
   * Registers an existing Safe with the SailKernel without redeploying.
   * The caller must control the Safe.
   */
  registerExisting(safe: Address, params: RegisterAccountParams): Promise<Account>;

  /** Fetches current account state from the kernel. */
  get(safe: Address): Promise<Account>;
}

export interface IMandateNamespace {
  /**
   * Registers a single IPermission contract on the Safe.
   * The signer must be the Safe's permissionSigner.
   */
  attach(
    safe: Address,
    template: PermissionTemplate,
    params: unknown,
    signer: ILocalKeyring,
  ): Promise<void>;

  /**
   * Registers multiple IPermission contracts atomically (single Safe tx).
   */
  attachBatch(safe: Address, items: MandateItem[], signer: ILocalKeyring): Promise<void>;

  /**
   * Updates params on an already-registered IPermission (re-signs the mandate).
   */
  reconfigure(
    safe: Address,
    template: PermissionTemplate,
    params: unknown,
    signer: ILocalKeyring,
  ): Promise<void>;

  /**
   * Atomically replaces one IPermission with another.
   * Useful when upgrading a template implementation.
   */
  replace(
    safe: Address,
    oldTemplate: PermissionTemplate,
    newTemplate: PermissionTemplate,
    params: unknown,
    signer: ILocalKeyring,
  ): Promise<void>;

  /** Removes an IPermission from the Safe's registered set. */
  detach(safe: Address, template: PermissionTemplate, signer: ILocalKeyring): Promise<void>;

  /**
   * Clones an implementation contract via ERC-1167 minimal proxy, then attaches it.
   * Use when you want a dedicated permission instance rather than a shared one.
   */
  deployAndAttachClone(
    safe: Address,
    impl: Address,
    initData: Hex,
    salt: Hex,
    signer: ILocalKeyring,
  ): Promise<void>;

  /** Returns all currently registered mandates on a Safe. */
  list(safe: Address): Promise<Mandate[]>;

  /** Returns true if the given permission address is registered and active. */
  isRegistered(safe: Address, permission: Address): Promise<boolean>;

  /**
   * Drafts a MandateExplanation from a natural-language description.
   * Matches the description against known templates and produces human-readable terms.
   */
  draft(input: MandateDraftInput): Promise<MandateExplanation>;
}

export interface IDispatchNamespace {
  /**
   * Submits a single call through SailKernel.dispatch().
   * The kernel evaluates all registered permissions before executing.
   */
  single(
    safe: Address,
    permission: Address,
    call: Call,
    manager: ILocalKeyring,
  ): Promise<Dispatch>;

  /**
   * Submits multiple calls as a single kernel dispatch.
   * All calls are evaluated atomically — any permission rejection reverts the batch.
   */
  batch(
    safe: Address,
    permission: Address,
    calls: Call[],
    manager: ILocalKeyring,
  ): Promise<Dispatch>;

  /**
   * Simulates a batch dispatch without submitting a transaction.
   * Uses eth_call against the kernel's previewBatch view, optionally followed
   * by an Alchemy simulation for state-diff output.
   */
  preview(safe: Address, permission: Address, calls: Call[]): Promise<PreviewResult>;
}

export interface ISessionNamespace {
  /** Revokes the manager's dispatch rights. No further dispatches can execute. */
  revoke(safe: Address, signer: ILocalKeyring): Promise<void>;

  /** Re-enables dispatch rights for the manager after a revocation. */
  activate(safe: Address, signer: ILocalKeyring): Promise<void>;

  /** Returns the current session state (active/revoked, manager address, block timestamps). */
  status(safe: Address): Promise<Session>;
}

export interface IFeesNamespace {
  /**
   * Sets the fee policy (management + performance bps, recipient, HWM) on the Safe.
   */
  setPolicy(safe: Address, policy: FeePolicy, signer: ILocalKeyring): Promise<void>;

  /**
   * Triggers fee collection on the kernel.
   * gross = AUM value, nav = NAV for HWM comparison.
   */
  collect(
    safe: Address,
    gross: bigint,
    nav: bigint,
    token: Address,
    manager: ILocalKeyring,
  ): Promise<TxResult>;
}

export interface IPrincipalNamespace {
  /**
   * Records an LP deposit in the kernel's principal ledger.
   * Used to track cost basis for performance fee calculations.
   */
  recordDeposit(safe: Address, amount: bigint, signer: ILocalKeyring): Promise<TxResult>;

  /**
   * Records an LP withdrawal in the kernel's principal ledger.
   */
  recordWithdrawal(safe: Address, amount: bigint, signer: ILocalKeyring): Promise<TxResult>;
}

export interface ISailorClient {
  account: IAccountNamespace;
  mandate: IMandateNamespace;
  dispatch: IDispatchNamespace;
  session: ISessionNamespace;
  fees: IFeesNamespace;
  principal: IPrincipalNamespace;
}

/** Context passed to Agent.tick on every scheduled execution. */
export type AgentContext = {
  safe: Address;
  /** Alias of `safe` — the SMA address the agent operates on. */
  account: Address;
  chainId: number;
  blockNumber: bigint;
  /** Unix timestamp in seconds. */
  timestamp: number;
  /** Wall-clock time of this tick. */
  now: Date;
  client: ISailorClient;
  /** The manager keyring used for signing dispatches. */
  manager: ILocalKeyring;
  /** Logs to the console and appends a line to .sail/activity.jsonl. */
  log: (msg: string) => void;
  /**
   * Open slot for user-provided data sources. Sailor bakes in no third-party
   * APIs — plug in your own (e.g. an x402 first-party API) by mutating this in
   * your agent, or seed it from a JSON file via the SAILOR_DATA env var.
   * Defaults to an empty object.
   */
  data: Record<string, unknown>;
  /** Helpers for reading the SMA's on-chain state. */
  read: {
    /**
     * Returns the SMA's balance of `token`. Pass `'native'` for the chain's
     * native asset (ETH), or an ERC-20 token address for its `balanceOf`.
     */
    balance: (token: Address | "native") => Promise<bigint>;
  };
};

/** A Sailor agent: define tick() and wire it up to a runner. */
export type Agent = {
  name: string;
  description: string;
  tick(ctx: AgentContext): Promise<Dispatch[]>;
};

/** Per-chain deployment config. Key = chainId. */
export type ChainConfig = {
  chainId: number;
  name: string;
  kernel: Address;
  mandateFactory: Address;
  governance: Address;
  protocols: Record<string, Address>;
};
