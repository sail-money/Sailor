import type { Address, Hex } from "./types.js";
import type { ILocalKeyring } from "./types.js";

/** Encrypted keystore file format (ERC-55 / Geth-compatible). */
export type EncryptedKeystore = {
  version: number;
  id: string;
  address: string;
  crypto: Record<string, unknown>;
};

export type LocalKeyringOptions =
  | { type: "privateKey"; privateKey: Hex }
  | { type: "keystore"; keystore: EncryptedKeystore; password: string }
  | { type: "mnemonic"; mnemonic: string; derivationPath?: string };

/**
 * A locally-held signing key used by agents to authorize dispatches.
 * The owner key never belongs here — it stays in the user's wallet (MetaMask / WalletConnect).
 *
 * All methods throw "not implemented" until the real keyring is wired up.
 */
export class LocalKeyring implements ILocalKeyring {
  readonly address: Address;

  constructor(_options: LocalKeyringOptions) {
    this.address = "0x0000000000000000000000000000000000000000";
    throw new Error("not implemented");
  }

  /** Returns the signer address without deriving from key material. */
  static fromAddress(address: Address): Pick<LocalKeyring, "address"> {
    return { address };
  }

  /** Loads a keyring from an encrypted JSON keystore file on disk. */
  static async fromKeystoreFile(
    _path: string,
    _password: string,
  ): Promise<LocalKeyring> {
    throw new Error("not implemented");
  }

  /** Signs a raw 32-byte hash. Returns a 65-byte ECDSA signature. */
  sign(_hash: Hex): Promise<Hex> {
    throw new Error("not implemented");
  }

  /** Signs a typed-data payload (EIP-712). */
  signTyped(
    _domain: unknown,
    _types: unknown,
    _value: unknown,
  ): Promise<Hex> {
    throw new Error("not implemented");
  }

  /** Exports the private key as an encrypted ERC-55 keystore JSON. */
  exportKeystore(_password: string): Promise<EncryptedKeystore> {
    throw new Error("not implemented");
  }
}
