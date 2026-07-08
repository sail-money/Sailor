/**
 * Foundry workspace scaffolding for Sailor projects.
 *
 * Writes a minimal, ready-to-`forge build` setup so an AI agent can author a
 * mandate (an IPermission implementation), compile it, and deploy it with
 * `sailor mandate deploy` — without any manual Foundry setup beyond having
 * `forge` installed.
 *
 * Mandate sources live in `mandates/`; the vendored Sail interfaces they import
 * live under `.sail/contracts/` and are reachable via the `@sail/` remapping.
 * Everything is written only if missing, so re-running is safe.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FOUNDRY_TOML = `[profile.default]
src = "mandates"
out = "out"
libs = ["lib"]
remappings = ["@sail/=.sail/contracts/"]
solc = "0.8.26"
optimizer = true
optimizer_runs = 200
# Mandates are deployed as standalone contracts and configured via their
# constructor, then registered on a Safe with \`sailor mandate register\`.
`;

/** Vendored copy of SailProtocol/contracts/interfaces/IPermission.sol */
const IPERMISSION_SOL = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Execution context passed to every permission on each dispatch call.
/// @dev    Read-only snapshot of the transaction environment (staticcall).
struct Context {
    address account;        // the Safe whose assets are being moved
    address manager;        // the delegated signer who submitted the dispatch
    address submitter;      // msg.sender of the dispatch (may be a relayer)
    address target;         // the call target
    bytes4  selector;       // leading 4 bytes of calldata
    uint256 value;          // native ETH forwarded (wei)
    uint256 blockTimestamp; // block.timestamp at dispatch
    uint256 blockNumber;    // block.number at dispatch
    uint256 configEpoch;    // kernel registrationEpoch(account, permission) at dispatch;
                            // configurable permissions fail closed on a mismatch with the
                            // epoch stamped at configure() time. Custom permissions that
                            // take no post-deploy configuration can ignore it.
}

/// @title  IPermission
/// @notice Interface every Sail permission (mandate) contract must implement.
/// @dev    Evaluated via staticcall with a fixed gas cap; a revert or gas
///         exhaustion is treated as \`false\`. Must not mutate state.
interface IPermission {
    /// @notice Decide whether a manager-submitted transaction is permitted.
    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool);

    /// @notice Optional stable identifier for off-chain indexing/deduplication.
    function discriminator() external view returns (bytes32);
}
`;

/**
 * Vendored copy of SailProtocol/contracts/interfaces/IBatchPermission.sol.
 *
 * A batch-aware permission gates `dispatchBatch` — an ordered array of subcalls
 * run as one atomic transaction (e.g. [approve, swap]). Exactly ONE batch
 * permission is consulted per batch dispatch and it owns validation of every
 * subcall AND the cross-call invariants (ordering, matching amounts, mandatory
 * allowance cleanup) that no per-call IPermission can express. A normal
 * IPermission is rejected in a batch (`PermissionNotBatchAware`).
 *
 * Shipped so the `@sail/interfaces/IBatchPermission.sol` remapping resolves out
 * of the box — without it, any batch permission fails to compile.
 */
const IBATCHPERMISSION_SOL = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice A single subcall in a batch dispatch.
/// @dev The kernel executes each Call as safe.execTransactionFromModule(target, value, data, 0)
///      — operation is always CALL, never DELEGATECALL.
struct Call {
    address target; // MUST NOT equal the kernel (enforced by the kernel)
    uint256 value;  // native ETH forwarded (wei)
    bytes   data;   // calldata for the subcall
}

/// @notice Execution context passed to evaluateBatch on each batch dispatch (read-only snapshot).
struct BatchContext {
    address account;        // the Safe (SMA) whose assets are moved
    address manager;        // the delegated signer who authorised the batch
    address submitter;      // msg.sender of the dispatch (may differ from manager via a relayer)
    address permission;     // this batch permission contract
    bytes32 batchHash;      // keccak256(abi.encode(calls)) — stable id for the exact sequence
    uint256 blockTimestamp; // block.timestamp at dispatch
    uint256 blockNumber;    // block.number at dispatch
    uint256 configEpoch;    // kernel registrationEpoch(account, permission) at dispatch —
                            // same fail-closed freshness check as Context.configEpoch
}

/// @title  IBatchPermission
/// @notice Gates an atomic batch of subcalls. Evaluated via staticcall under a gas cap;
///         a revert / OOG / malformed return is treated as \`false\` (fail-closed).
interface IBatchPermission {
    /// @notice Validate an entire batch of subcalls and their cross-call invariants.
    function evaluateBatch(Call[] calldata calls, BatchContext calldata ctx) external view returns (bool);

    /// @notice Marker the kernel uses (try/catch) to detect batch-aware permissions. MUST return true.
    function isBatchPermission() external pure returns (bool);
}
`;

/**
 * General-purpose bounded-call permission: gates dispatch by allowed targets,
 * optional selector allowlist, and max ETH value. For calldata-parameter bounds
 * (amount caps, slippage floors, recipient checks), extend this pattern with
 * ABI-decoding of txData specific to the target protocol.
 */
const EXAMPLE_MANDATE_SOL = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";

/// @title  BoundedCallPermission
/// @notice General-purpose IPermission primitive. Bounds the universal properties of any call:
///         allowed targets, allowed selectors, and max ETH value. Protocol-agnostic.
///         For calldata-parameter bounds (amount caps, recipient checks, slippage), write a
///         protocol-specific permission — see examples/permissions/ for the pattern per protocol.
/// @dev Deploy one instance per SMA with constructor-configured parameters.
contract BoundedCallPermission is IPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("BoundedCallPermission");

    mapping(address => bool) public isAllowedTarget;
    mapping(bytes4 => bool) public isAllowedSelector;
    bool public immutable SELECTOR_FILTERING;
    uint256 public immutable MAX_VALUE;

    constructor(address[] memory allowedTargets, bytes4[] memory allowedSelectors, uint256 maxValue) {
        for (uint256 i = 0; i < allowedTargets.length; i++) isAllowedTarget[allowedTargets[i]] = true;
        SELECTOR_FILTERING = allowedSelectors.length > 0;
        for (uint256 i = 0; i < allowedSelectors.length; i++) isAllowedSelector[allowedSelectors[i]] = true;
        MAX_VALUE = maxValue;
    }

    function evaluate(bytes calldata, Context calldata ctx) external view returns (bool) {
        if (!isAllowedTarget[ctx.target]) return false;
        if (SELECTOR_FILTERING && !isAllowedSelector[ctx.selector]) return false;
        if (ctx.value > MAX_VALUE) return false;
        return true;
    }

    function discriminator() external pure returns (bytes32) { return DISCRIMINATOR; }
}
`;

const MANDATES_README = `# Mandates

Solidity permission contracts for this Sailor project live here.

A permission implements \`@sail/interfaces/IPermission.sol\` — \`evaluate(txData, ctx)\`
returns \`true\` to permit a manager-submitted dispatch, \`false\` to block it.

## Authoring + deploying

1. Start from \`BoundedCallPermission.sol\` for target/selector/value gating.
   For calldata-parameter bounds (amount caps, slippage, recipient checks),
   decode \`txData\` with the target protocol's ABI and add bounds to \`evaluate()\`.
   Configure all parameters in the **constructor** — the deploy flow expects a
   single creation transaction to fully set up the permission.
2. Compile:
   \`\`\`bash
   forge build
   \`\`\`
3. Deploy it (the owner signs the creation tx in the browser signing UI):
   \`\`\`bash
   sailor mandate deploy --contract BoundedCallPermission \\
     --args '[["0xTarget1", "0xTarget2"], [], 0]'
   \`\`\`
   Args: (allowedTargets[], allowedSelectors[], maxValue).
   Pass an empty selector array [] to skip selector filtering.
   Pass 0 for maxValue to block all ETH transfers.
4. Register it on a Safe:
   \`\`\`bash
   sailor mandate register --address 0xDeployed --sma 0xSafe
   \`\`\`
   (or pass \`--register --sma 0xSafe\` to \`deploy\` to do both at once.)

Compiled artifacts are written to \`out/\` and the deployed address is tracked in
\`.sail/state/mandates.json\`.
`;

/**
 * Scaffold the Foundry workspace inside `root`. Idempotent: only writes files
 * that don't already exist.
 */
export function scaffoldFoundryWorkspace(root: string): void {
  const dirs = [join(root, "mandates"), join(root, ".sail", "contracts", "interfaces")];
  for (const d of dirs) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }

  writeIfMissing(join(root, "foundry.toml"), FOUNDRY_TOML);
  writeIfMissing(
    join(root, ".sail", "contracts", "interfaces", "IPermission.sol"),
    IPERMISSION_SOL,
  );
  writeIfMissing(
    join(root, ".sail", "contracts", "interfaces", "IBatchPermission.sol"),
    IBATCHPERMISSION_SOL,
  );
  writeIfMissing(join(root, "mandates", "BoundedCallPermission.sol"), EXAMPLE_MANDATE_SOL);
  writeIfMissing(join(root, "mandates", "README.md"), MANDATES_README);
}

function writeIfMissing(path: string, content: string): void {
  if (!existsSync(path)) writeFileSync(path, content, "utf8");
}
