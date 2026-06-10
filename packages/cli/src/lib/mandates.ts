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

  /**
   * Append a newly deployed mandate (replacing any prior record at the same address).
   * When another mandate with the same name already exists on the same chain, the
   * incoming mandate's name is suffixed with `[2]`, `[3]`, … to keep names unique.
   */
  add(mandate: DeployedMandate): void {
    const data = this.read();
    // Drop any prior record at the same address (redeploy).
    data.mandates = data.mandates.filter(
      (m) => m.address.toLowerCase() !== mandate.address.toLowerCase(),
    );
    // Deduplicate name within the same chain by appending a numeric suffix.
    const baseName = mandate.name;
    const sameName = (m: DeployedMandate) => m.name === mandate.name && m.chainId === mandate.chainId;
    if (data.mandates.some(sameName)) {
      let n = 2;
      while (data.mandates.some((m) => m.name === `${baseName}[${n}]` && m.chainId === mandate.chainId)) {
        n++;
      }
      mandate = { ...mandate, name: `${baseName}[${n}]` };
    }
    data.mandates.push(mandate);
    this.write(data);
  }

  /** Update mutable metadata fields on a tracked mandate (name, sourcePath, artifactPath). */
  update(
    addressOrName: string,
    patch: Partial<Pick<DeployedMandate, "name" | "sourcePath" | "artifactPath">>,
  ): DeployedMandate {
    const data = this.read();
    const needle = addressOrName.toLowerCase();
    const mandate = data.mandates.find(
      (m) => m.address.toLowerCase() === needle || m.name === addressOrName,
    );
    if (!mandate) throw new Error(`No tracked mandate found for: ${addressOrName}`);
    if (patch.name !== undefined && patch.name !== mandate.name) {
      const conflict = data.mandates.find(
        (m) => m.name === patch.name && m.chainId === mandate.chainId && m.address !== mandate.address,
      );
      if (conflict) throw new Error(`Name "${patch.name}" is already used by ${conflict.address} on chain ${mandate.chainId}`);
      mandate.name = patch.name;
    }
    if (patch.sourcePath !== undefined) mandate.sourcePath = patch.sourcePath;
    if (patch.artifactPath !== undefined) mandate.artifactPath = patch.artifactPath;
    this.write(data);
    return mandate;
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
