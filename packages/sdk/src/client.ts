import { createPublicClient, defineChain, http, type PublicClient } from "viem";
import type {
  Account,
  Address,
  AgentContext,
  Call,
  CreateAccountParams,
  Dispatch,
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
} from "./types.js";

// Re-export so consumers can use AgentContext without a separate import
export type { AgentContext };

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

class AccountNamespace implements IAccountNamespace {
  constructor(
    protected readonly publicClient: PublicClient,
    protected readonly config: SailorClientConfig,
  ) {}

  create(_params: CreateAccountParams): Promise<Account> {
    return notImplemented();
  }

  registerExisting(_safe: Address, _params: RegisterAccountParams): Promise<Account> {
    return notImplemented();
  }

  get(_safe: Address): Promise<Account> {
    return notImplemented();
  }
}

class MandateNamespace implements IMandateNamespace {
  constructor(
    protected readonly publicClient: PublicClient,
    protected readonly config: SailorClientConfig,
  ) {}

  attach(
    _safe: Address,
    _template: PermissionTemplate,
    _params: unknown,
    _signer: ILocalKeyring,
  ): Promise<void> {
    return notImplemented();
  }

  attachBatch(_safe: Address, _items: MandateItem[], _signer: ILocalKeyring): Promise<void> {
    return notImplemented();
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

  list(_safe: Address): Promise<Mandate[]> {
    return notImplemented();
  }

  isRegistered(_safe: Address, _permission: Address): Promise<boolean> {
    return notImplemented();
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
      warnings: [
        "This is a draft — review each permission term before signing.",
      ],
    });
  }
}

class DispatchNamespace implements IDispatchNamespace {
  constructor(
    protected readonly publicClient: PublicClient,
    protected readonly config: SailorClientConfig,
  ) {}

  single(
    _safe: Address,
    _permission: Address,
    _call: Call,
    _manager: ILocalKeyring,
  ): Promise<Dispatch> {
    return notImplemented();
  }

  batch(
    _safe: Address,
    _permission: Address,
    _calls: Call[],
    _manager: ILocalKeyring,
  ): Promise<Dispatch> {
    return notImplemented();
  }

  preview(_safe: Address, _permission: Address, _calls: Call[]): Promise<PreviewResult> {
    return notImplemented();
  }
}

class SessionNamespace implements ISessionNamespace {
  constructor(
    protected readonly publicClient: PublicClient,
    protected readonly config: SailorClientConfig,
  ) {}

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

class FeesNamespace implements IFeesNamespace {
  constructor(
    protected readonly publicClient: PublicClient,
    protected readonly config: SailorClientConfig,
  ) {}

  setPolicy(_safe: Address, _policy: FeePolicy, _signer: ILocalKeyring): Promise<void> {
    return notImplemented();
  }

  collect(
    _safe: Address,
    _gross: bigint,
    _nav: bigint,
    _token: Address,
    _manager: ILocalKeyring,
  ): Promise<void> {
    return notImplemented();
  }
}

class PrincipalNamespace implements IPrincipalNamespace {
  constructor(
    protected readonly publicClient: PublicClient,
    protected readonly config: SailorClientConfig,
  ) {}

  recordDeposit(_safe: Address, _amount: bigint, _signer: ILocalKeyring): Promise<void> {
    return notImplemented();
  }

  recordWithdrawal(_safe: Address, _amount: bigint, _signer: ILocalKeyring): Promise<void> {
    return notImplemented();
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

  constructor(config: SailorClientConfig) {
    const publicClient = buildPublicClient(config);
    this.account = new AccountNamespace(publicClient, config);
    this.mandate = new MandateNamespace(publicClient, config);
    this.dispatch = new DispatchNamespace(publicClient, config);
    this.session = new SessionNamespace(publicClient, config);
    this.fees = new FeesNamespace(publicClient, config);
    this.principal = new PrincipalNamespace(publicClient, config);
  }
}
