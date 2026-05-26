import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  scryptSync,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { type Address, type Hex, hashTypedData, keccak256, type TypedDataDomain } from "viem";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import type { ILocalKeyring } from "./types.js";

// scrypt KDF parameters for keystore encryption (geth keystore v3 compatible).
const SCRYPT_N = 1 << 15; // 32768 — fast enough for an interactive CLI
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DKLEN = 32;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

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
  /** Present only when the keyring was constructed from a raw private key. */
  private readonly privateKey?: Hex;

  constructor(options: LocalKeyringOptions) {
    if (options.type === "privateKey") {
      const account = privateKeyToAccount(options.privateKey);
      this.account = account;
      this.address = account.address;
      this.privateKey = options.privateKey;
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

  /** Generates a brand-new keyring backed by a random private key. */
  static generate(): LocalKeyring {
    return new LocalKeyring({ type: "privateKey", privateKey: generatePrivateKey() });
  }

  /** Constructs a keyring from an existing raw private key. */
  static fromPrivateKey(privateKey: Hex): LocalKeyring {
    return new LocalKeyring({ type: "privateKey", privateKey });
  }

  /** Decrypts an in-memory keystore object with the given password. */
  static async fromKeystore(keystore: EncryptedKeystore, password: string): Promise<LocalKeyring> {
    const crypto = keystore.crypto as {
      cipher: string;
      ciphertext: string;
      cipherparams: { iv: string };
      kdf: string;
      kdfparams: { n: number; r: number; p: number; dklen: number; salt: string };
      mac: string;
    };
    if (crypto.kdf !== "scrypt") {
      throw new Error(`Unsupported keystore KDF: ${crypto.kdf}`);
    }
    const { n, r, p, dklen, salt } = crypto.kdfparams;
    const derived = scryptSync(password, Buffer.from(salt, "hex"), dklen, {
      N: n,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });
    const ciphertext = Buffer.from(crypto.ciphertext, "hex");
    const macInput = `0x${Buffer.concat([derived.subarray(16, 32), ciphertext]).toString("hex")}` as Hex;
    if (keccak256(macInput).slice(2) !== crypto.mac.toLowerCase()) {
      throw new Error("Invalid password or corrupt keystore");
    }
    const decipher = createDecipheriv(
      "aes-128-ctr",
      derived.subarray(0, 16),
      Buffer.from(crypto.cipherparams.iv, "hex"),
    );
    const pkBytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return LocalKeyring.fromPrivateKey(`0x${pkBytes.toString("hex")}` as Hex);
  }

  /** Loads a keyring from an encrypted JSON keystore file on disk. */
  static async fromKeystoreFile(path: string, password: string): Promise<LocalKeyring> {
    const keystore = JSON.parse(readFileSync(path, "utf-8")) as EncryptedKeystore;
    return LocalKeyring.fromKeystore(keystore, password);
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

  /** Exports the private key as an encrypted keystore JSON (scrypt + aes-128-ctr, geth v3). */
  async exportKeystore(password: string): Promise<EncryptedKeystore> {
    if (!this.privateKey) {
      throw new Error("Private key unavailable — only privateKey/generated keyrings can be exported");
    }
    const salt = randomBytes(32);
    const derived = scryptSync(password, salt, SCRYPT_DKLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAXMEM,
    });
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-128-ctr", derived.subarray(0, 16), iv);
    const pkBytes = Buffer.from(this.privateKey.slice(2), "hex");
    const ciphertext = Buffer.concat([cipher.update(pkBytes), cipher.final()]);
    const macInput = `0x${Buffer.concat([derived.subarray(16, 32), ciphertext]).toString("hex")}` as Hex;
    const mac = keccak256(macInput).slice(2);

    return {
      version: 3,
      id: randomUUID(),
      address: this.address.slice(2).toLowerCase(),
      crypto: {
        cipher: "aes-128-ctr",
        ciphertext: ciphertext.toString("hex"),
        cipherparams: { iv: iv.toString("hex") },
        kdf: "scrypt",
        kdfparams: {
          n: SCRYPT_N,
          r: SCRYPT_R,
          p: SCRYPT_P,
          dklen: SCRYPT_DKLEN,
          salt: salt.toString("hex"),
        },
        mac,
      },
    };
  }
}
