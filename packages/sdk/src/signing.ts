import type { Address, Hex } from "viem";

// ---------------------------------------------------------------------------
// Signing handoff — CLI ↔ browser signing server protocol
//
// The agent (CLI) cannot hold the owner's wallet key, so any owner-authorized
// action (deploy a Safe, deploy a mandate, authorize a permission, or any
// arbitrary call) is handed off to a browser signing page over a small
// HTTP + WebSocket channel. The agent enqueues a SigningRequest; the browser
// renders an approval card, the owner signs/submits with their wallet, and a
// SigningResponse comes back.
//
// "arbitrary-tx" kind is supported for any custom calldata the agent needs the
// owner to execute (e.g. calling admin functions on custom IPermission contracts).
// ---------------------------------------------------------------------------

export type SigningRequestKind =
  | "create-sma" // Deploy a new Safe via kernel.createAccount (on-chain tx)
  | "deploy-mandate" // Deploy a new mandate (permission) contract — contract-creation tx, no `to`
  | "register-permission" // Authorize a mandate via EIP-712 (typed-data)
  | "attach-mandate" // Configure + authorize a shared template (typed-data)
  | "revoke-permissions" // Authorize removing permission(s) via EIP-712 RevokePermissions (typed-data)
  | "set-delegate" // Rotate manager key (on-chain tx)
  | "arbitrary-tx"; // Arbitrary transaction — the agent can request the owner to sign any calldata (e.g. admin calls on custom permissions)

/** Fields shared by all signing request variants. */
/**
 * Natural-language summary of a permission being signed, parsed from the
 * contract's comments (structured header → NatSpec → require messages). Lets the
 * approval card explain what the contract enforces *before* the user signs —
 * rather than approving an opaque deploy/registration.
 */
export type SigningExplanation = {
  source?: string;
  protocol?: string;
  version?: string;
  chain?: string;
  target?: string;
  /** Constraints enforced on-chain. */
  enforced: string[];
  /** Things left to agent code, not enforced on-chain. */
  notEnforced: string[];
};

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
  /** Optional NL summary of the permission, parsed from its contract comments. */
  explanation?: SigningExplanation;
  /**
   * Optional per-permission NL summaries — used when one signature authorizes
   * several permissions (batch register), so the card can list each with its own
   * "what you're signing" breakdown.
   */
  permissions?: Array<{
    label?: string;
    address?: string;
    explanation?: SigningExplanation;
  }>;
  /**
   * Registration fee the agent wallet will pay on-chain for this signing.
   * Absent when no fee is charged (zero-fee chains) or when the fee couldn't
   * be read. Passed from the CLI so the signing card can disclose it before
   * the owner signs.
   */
  registrationFee?: {
    /** Total fee in the chain's native token (formatted string, e.g. "0.00003"). */
    totalEth: string;
    /** Number of permissions the total covers. */
    permissionCount: number;
    /** Flat per-permission fee in the chain's native token, present when count > 1. */
    perPermissionEth?: string;
    /**
     * The chain's native gas token symbol (e.g. "ETH", "BNB", "HYPE") — what
     * `totalEth`/`perPermissionEth` are actually denominated in. Defaults to
     * "ETH" when absent (older callers / zero-fee chains).
     */
    symbol?: string;
  };
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

/**
 * The final outcome of a signing request, reported by whoever actually
 * verified it — never assumed from "a wallet accepted it" or "a signature was
 * captured". The command that submits the transaction (or, for the few
 * owner-submitted kinds no command verifies, the daemon) reports back once the
 * outcome is known, via `confirmOutcome` on `SigningChannel`.
 *
 * The four outcomes are deliberately distinct — a signed transaction we simply
 * could not observe (`unverified`) is NOT a failure verdict and must never be
 * shown as one:
 *  - `confirmed`  — mined with a successful receipt. `note` carries a
 *                   non-alarming caveat (e.g. an index/permission-set read that
 *                   is still catching up after a confirmed receipt).
 *  - `reverted`   — mined, but the receipt status was `reverted`.
 *  - `failed`     — the submission itself errored; the transaction was never
 *                   sent (e.g. the agent's `sendTransaction` threw).
 *  - `unverified` — a transaction was submitted (we have a hash) but its
 *                   receipt could not be observed (no RPC for the chain, or the
 *                   receipt wait timed out). Verify manually; do not treat as
 *                   failed.
 */
export type SigningConfirmation =
  | { outcome: "confirmed"; txHash?: Hex; note?: string }
  | { outcome: "reverted"; txHash?: Hex; error?: string }
  | { outcome: "failed"; error?: string }
  | { outcome: "unverified"; txHash?: Hex; error?: string };

/** WebSocket messages: server → UI. */
export type ServerMessage =
  | { type: "pending"; requests: SigningRequest[] }
  | { type: "request"; request: SigningRequest }
  | { type: "request-resolved"; requestId: string }
  | { type: "request-confirmed"; requestId: string; confirmation: SigningConfirmation };

/** WebSocket messages: UI → server. */
export type ClientMessage =
  | { type: "signed"; requestId: string; txHash: Hex }
  | { type: "signature"; requestId: string; signature: Hex }
  | { type: "rejected"; requestId: string; reason?: string }
  | { type: "wallet-connected"; address: Address }
  | { type: "wallet-disconnected" };
