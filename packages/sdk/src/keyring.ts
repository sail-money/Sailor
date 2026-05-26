import { type Address, type Hex, hashTypedData, type TypedDataDomain } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
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

type SigningAccount = {
  address: Address;
  sign(args: { hash: Hex }): Promise<Hex>;
  signTypedData(args: unknown): Promise<Hex>;
};

/**
 * A locally-held signing key used by agents to authorize dispatches.
 * The owner key never belongs here — it stays in the user's wallet (MetaMask / WalletConnect).
 */
export class LocalKeyring implements ILocalKeyring {
  readonly address: Address;
  private readonly account: SigningAccount;

  constructor(options: LocalKeyringOptions) {
    if (options.type === "privateKey") {
      const account = privateKeyToAccount(options.privateKey);
      this.account = account;
      this.address = account.address;
    } else if (options.type === "mnemonic") {
      const account = mnemonicToAccount(
        options.mnemonic,
        options.derivationPath
          ? { path: options.derivationPath as `m/44'/60'/${string}` }
          : undefined,
      );
      this.account = account;
      this.address = account.address;
    } else {
      throw new Error(
        "keystore decryption not implemented — use type: 'privateKey' or type: 'mnemonic' instead",
      );
    }
  }

  /** Returns a lightweight signer stub for read-only contexts where the key is not available. */
  static fromAddress(address: Address): Pick<LocalKeyring, "address"> {
    return { address };
  }

  /** Loads a keyring from an encrypted JSON keystore file on disk. */
  static async fromKeystoreFile(_path: string, _password: string): Promise<LocalKeyring> {
    throw new Error("keystore file loading not implemented");
  }

  /** Signs a raw 32-byte hash. Returns a 65-byte ECDSA signature. */
  async sign(hash: Hex): Promise<Hex> {
    return this.account.sign({ hash });
  }

  /**
   * Signs a typed-data payload (EIP-712).
   * `types` must be `{ primaryType: string; types: Record<string, TypedDataParameter[]> }`.
   */
  async signTyped(domain: unknown, types: unknown, value: unknown): Promise<Hex> {
    const { primaryType, types: typeDefs } = types as {
      primaryType: string;
      types: Record<string, { name: string; type: string }[]>;
    };
    const hash = hashTypedData({
      domain: domain as TypedDataDomain,
      types: typeDefs,
      primaryType,
      message: value as Record<string, unknown>,
    });
    return this.account.sign({ hash });
  }

  /** Exports the private key as an encrypted ERC-55 keystore JSON. */
  exportKeystore(_password: string): Promise<EncryptedKeystore> {
    return Promise.reject(new Error("keystore export not implemented"));
  }
}
