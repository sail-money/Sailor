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

class AccountNamespace implements IAccountNamespace {
  constructor(_config: SailorClientConfig) {}

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
  constructor(_config: SailorClientConfig) {}

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

  draft(_input: MandateDraftInput): Promise<MandateExplanation> {
    return notImplemented();
  }
}

class DispatchNamespace implements IDispatchNamespace {
  constructor(_config: SailorClientConfig) {}

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
  constructor(_config: SailorClientConfig) {}

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
  constructor(_config: SailorClientConfig) {}

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
  constructor(_config: SailorClientConfig) {}

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
    this.account = new AccountNamespace(config);
    this.mandate = new MandateNamespace(config);
    this.dispatch = new DispatchNamespace(config);
    this.session = new SessionNamespace(config);
    this.fees = new FeesNamespace(config);
    this.principal = new PrincipalNamespace(config);
  }
}
