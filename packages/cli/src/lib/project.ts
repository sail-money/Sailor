import {
  type EncryptedKeystore,
  LocalKeyring,
  type SailDeployment,
  getSailDeployment,
} from "@sail/sdk";
import { type Address, getAddress } from "viem";
import { fileExists, parseEnvFile, readJsonFile, sailPath, writeJsonFile } from "./io.js";
import { keyPath, loadKeyring } from "./keys.js";

type ProjectConfigFile = {
  version?: number;
  name?: string;
  chainId?: number;
  stateDir?: string;
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
    this.chainId = cfg.chainId ?? 8453;
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
    const account = readJsonFile<{ owner?: string }>(sailPath("account.json"));
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

/**
 * Load the agent's manager signer (the EOA that submits dispatches and the
 * permission-registration transaction, paying gas + the registration fee).
 *
 * Uses `SAIL_PASSPHRASE` when set so agents can run headless. Reads from
 * `.sail/.env.local` if not already in the process environment — this lets
 * `sailor mandate attach` / `mandate deploy` / `mandate revoke` run without
 * an interactive prompt when the passphrase is configured in `.env.local`,
 * matching the behaviour of `sailor run`.
 */
export async function loadManagerSigner(): Promise<LocalKeyring> {
  // Populate SAIL_PASSPHRASE from .env.local if the caller (e.g. a mandate
  // command) hasn't already loaded it into the process environment.
  if (!process.env.SAIL_PASSPHRASE) {
    try {
      const env = parseEnvFile(sailPath(".env.local"));
      if (env.SAIL_PASSPHRASE) process.env.SAIL_PASSPHRASE = env.SAIL_PASSPHRASE;
    } catch {
      // .env.local absent or unreadable — proceed; passphrase prompt follows
    }
  }
  const passphrase = process.env.SAIL_PASSPHRASE;
  if (passphrase) {
    const keystore = readJsonFile<EncryptedKeystore>(keyPath("manager"));
    if (!keystore) {
      throw new Error('No manager key found.\nRun "sailor keys generate" and choose "manager".');
    }
    return LocalKeyring.fromKeystore(keystore, passphrase);
  }
  return loadKeyring("manager");
}
