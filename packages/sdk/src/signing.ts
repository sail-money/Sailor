import type { Address, Hex } from "viem";

// ---------------------------------------------------------------------------
// Signing handoff — CLI ↔ browser signing station protocol
//
// The agent (CLI) cannot hold the owner's wallet key, so any owner-authorized
// action (deploy a Safe, deploy a mandate, authorize a permission) is handed
// off to a browser signing station over a small HTTP + WebSocket channel. The
// agent enqueues a SigningRequest; the browser renders an approval card, the
// owner signs/submits with their wallet, and a SigningResponse comes back.
// ---------------------------------------------------------------------------

export type SigningRequestKind =
  | "create-sma" // Deploy a new Safe via kernel.createAccount (on-chain tx)
  | "deploy-mandate" // Deploy a new mandate (permission) contract — contract-creation tx, no `to`
  | "register-permission" // Authorize a mandate via EIP-712 (typed-data)
  | "attach-mandate" // Configure + authorize a shared template (typed-data)
  | "set-delegate"; // Rotate manager key (on-chain tx)

/** Fields shared by all signing request variants. */
export type SigningRequestBase = {
  id: string;
  kind: SigningRequestKind;
  /** Short title shown in the UI approval card. */
  title: string;
  /** Plain-English description of what will happen. */
  description: string;
  chainId: number;
  /** Human-readable breakdown rendered in the card. */
  details: Array<{ label: string; value: string }>;
  createdAt: number;
};

/**
 * The user submits an on-chain transaction from their connected wallet.
 * The UI uses useSendTransaction; the response carries the txHash.
 */
export type SigningTxRequest = SigningRequestBase & {
  type: "transaction";
  /**
   * Target contract. Omitted for contract-creation transactions (e.g.
   * deploying a new mandate), where `data` is the creation bytecode and the
   * wallet must send the tx with no `to`.
   */
  to?: Address;
  /** ETH value in wei, stringified (JSON-safe bigint). */
  value?: string;
  data: Hex;
};

/**
 * JSON-serializable EIP-712 typed data (bigints stringified).
 * The UI uses useSignTypedData; the response carries the signature.
 */
export type SerializedTypedData = {
  domain: {
    name?: string;
    version?: string;
    chainId?: number;
    verifyingContract?: string;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  /** All bigint values must be serialized as decimal strings. */
  message: Record<string, string | number | boolean | string[]>;
};

/**
 * The user signs an EIP-712 message (off-chain).
 * The agent collects the signature and submits the actual transaction.
 */
export type SigningTypedDataRequest = SigningRequestBase & {
  type: "typed-data";
  typedData: SerializedTypedData;
};

export type SigningRequest = SigningTxRequest | SigningTypedDataRequest;

export type SigningResponse =
  | { status: "signed"; requestId: string; txHash: Hex }
  | { status: "signature"; requestId: string; signature: Hex }
  | { status: "rejected"; requestId: string; reason?: string };

/** WebSocket messages: server → UI. */
export type ServerMessage =
  | { type: "pending"; requests: SigningRequest[] }
  | { type: "request"; request: SigningRequest }
  | { type: "request-resolved"; requestId: string };

/** WebSocket messages: UI → server. */
export type ClientMessage =
  | { type: "signed"; requestId: string; txHash: Hex }
  | { type: "signature"; requestId: string; signature: Hex }
  | { type: "rejected"; requestId: string; reason?: string }
  | { type: "wallet-connected"; address: Address }
  | { type: "wallet-disconnected" };
