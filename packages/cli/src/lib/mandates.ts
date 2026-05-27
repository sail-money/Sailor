import type { Address, Hex } from "viem";
import { readJsonFile, sailPath, writeJsonFile } from "./io.js";

/** Record of a mandate (permission) contract this project has deployed. */
export interface DeployedMandate {
  /** Contract name (matches the Solidity contract / forge artifact). */
  name: string;
  /** Deployed contract address on `chainId`. */
  address: Address;
  /** Creation transaction hash. */
  txHash: Hex;
  chainId: number;
  /** Path to the Solidity source, relative to the project root, if known. */
  sourcePath?: string;
  /** Path to the forge artifact used for deployment, relative to project root. */
  artifactPath?: string;
  /** Raw constructor arguments supplied at deploy time (for the audit trail). */
  constructorArgs?: string[];
  /** ISO timestamp of deployment. */
  deployedAt: string;
  /** SMAs this mandate has been attached to. */
  attachments?: Array<{ sma: Address; txHash: Hex; at: string }>;
}

interface MandatesFile {
  version: 1;
  mandates: DeployedMandate[];
}

/**
 * Tracks mandate contracts deployed from this project in
 * `.sail/state/mandates.json`, so the agent can reference and attach them
 * across sessions.
 */
export class MandateStore {
  private readonly filePath: string;

  constructor(filePath: string = sailPath("state", "mandates.json")) {
    this.filePath = filePath;
  }

  private read(): MandatesFile {
    const parsed = readJsonFile<MandatesFile>(this.filePath);
    return { version: 1, mandates: parsed?.mandates ?? [] };
  }

  private write(data: MandatesFile): void {
    writeJsonFile(this.filePath, data);
  }

  list(): DeployedMandate[] {
    return this.read().mandates;
  }

  /** Find a tracked mandate by address (case-insensitive) or by exact name. */
  find(addressOrName: string): DeployedMandate | undefined {
    const needle = addressOrName.toLowerCase();
    return this.read().mandates.find(
      (m) => m.address.toLowerCase() === needle || m.name === addressOrName,
    );
  }

  /** Append a newly deployed mandate (replacing any prior record at the same address). */
  add(mandate: DeployedMandate): void {
    const data = this.read();
    data.mandates = data.mandates.filter(
      (m) => m.address.toLowerCase() !== mandate.address.toLowerCase(),
    );
    data.mandates.push(mandate);
    this.write(data);
  }

  /** Record that a tracked mandate was attached to an SMA. */
  recordAttachment(address: Address, attachment: { sma: Address; txHash: Hex }): void {
    const data = this.read();
    const mandate = data.mandates.find((m) => m.address.toLowerCase() === address.toLowerCase());
    if (!mandate) return;
    mandate.attachments ??= [];
    mandate.attachments.push({ ...attachment, at: new Date().toISOString() });
    this.write(data);
  }
}
