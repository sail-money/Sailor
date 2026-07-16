import { type SailDeployment, getSailDeployment } from "@sail/sdk";
import { type Address, getAddress } from "viem";
import { fileExists, parseEnvFile, readActiveAccount, readJsonFile, sailPath, writeJsonFile } from "./io.js";

type ProjectConfigFile = {
  version?: number;
  name?: string;
  chainId?: number;
  stateDir?: string;
  installMode?: "local" | "docker";
  containerName?: string;
  contracts?: {
    kernel?: string;
    governance?: string;
    standardFeePolicy?: string;
    safeModuleEnabler?: string;
    permissionFactory?: string;
    mandateFactory?: string;
  };
};

/** The contract addresses the onboarding / mandate flows operate against. */
export type ProjectContracts = {
  chainId: number;
  kernel: Address;
  governance: Address;
  standardFeePolicy: Address;
  safeModuleEnabler: Address;
  mandateFactory: Address;
};

type OwnerState = { owner: Address; chainId: number; connectedAt: string };

function nonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Project context for the onboarding / mandate-deploy flows. Bridges the
 * `.sail/config.json` manifest to the verified on-chain deployment registry in
 * `@sail/sdk`: contract addresses come from the bundled deployment for the
 * project's chain, with any explicit `config.json` overrides taking precedence.
 */
export class ProjectContext {
  readonly config: ProjectConfigFile;
  readonly chainId: number;
  readonly deployment: SailDeployment;
  readonly contracts: ProjectContracts;

  constructor() {
    const cfg = readJsonFile<ProjectConfigFile>(sailPath("config.json"));
    if (!cfg) {
      throw new Error('No Sailor project found here. Run "sailor init" first.');
    }
    this.config = cfg;
    // Resolution order: inline shell env → .env.local CHAIN_ID → config.json → default Base
    const envLocal = parseEnvFile(sailPath(".env.local"));
    const envChainId = process.env.CHAIN_ID ?? envLocal.CHAIN_ID;
    this.chainId = envChainId ? Number(envChainId) : (cfg.chainId ?? 8453);
    this.deployment = getSailDeployment(this.chainId);

    const overrides = cfg.contracts ?? {};
    this.contracts = {
      chainId: this.chainId,
      kernel: getAddress(nonEmpty(overrides.kernel) ? overrides.kernel : this.deployment.kernel),
      governance: getAddress(
        nonEmpty(overrides.governance) ? overrides.governance : this.deployment.governance,
      ),
      standardFeePolicy: getAddress(
        nonEmpty(overrides.standardFeePolicy)
          ? overrides.standardFeePolicy
          : this.deployment.standardFeePolicy,
      ),
      safeModuleEnabler: getAddress(
        nonEmpty(overrides.safeModuleEnabler)
          ? overrides.safeModuleEnabler
          : this.deployment.safeModuleEnabler,
      ),
      // Accept both override names: mandateFactory (new) and permissionFactory (legacy).
      mandateFactory: getAddress(
        nonEmpty(overrides.mandateFactory)
          ? overrides.mandateFactory
          : nonEmpty(overrides.permissionFactory)
            ? overrides.permissionFactory
            : this.deployment.mandateFactory,
      ),
    };
  }

  static exists(): boolean {
    return fileExists(sailPath("config.json"));
  }

  get name(): string {
    return this.config.name ?? "sailor-agent";
  }

  // ── Owner persistence (.sail/state/owner.json) ──────────────────────────────

  getOwner(): Address | null {
    const state = readJsonFile<OwnerState>(sailPath("state", "owner.json"));
    if (state?.owner) return getAddress(state.owner);
    // Fallback: a deployed SMA records its owner in account.json even when the
    // owner was never persisted via `sailor owner connect` (e.g. created through
    // the wizard/onboard path). Surface that so `owner show` and agents relying
    // on it resolve the connected wallet once an account exists.
    const account = readActiveAccount();
    return account?.owner ? getAddress(account.owner) : null;
  }

  setOwner(owner: Address): void {
    writeJsonFile(sailPath("state", "owner.json"), {
      owner: getAddress(owner),
      chainId: this.chainId,
      connectedAt: new Date().toISOString(),
    } satisfies OwnerState);
  }
}

