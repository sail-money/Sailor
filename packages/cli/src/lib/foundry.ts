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
# constructor, then attached to a Safe with \`sailor mandate attach\`.
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
 * Example mandate: gates dispatch to an allowlist of call targets. Fully
 * configured by its constructor (per the Sail deploy flow), so a single deploy
 * transaction + a single attach signature is all that is needed.
 */
const EXAMPLE_MANDATE_SOL = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";

/// @title  AllowlistTargetMandate
/// @notice Example mandate — permits dispatch only to allowlisted target
///         addresses. Configured entirely via the constructor.
contract AllowlistTargetMandate is IPermission {
    address public immutable permissionSigner;
    mapping(address => bool) public isAllowedTarget;

    /// @param _permissionSigner The Safe's permission signer (metadata / future use).
    /// @param allowedTargets    Call targets this mandate permits.
    constructor(address _permissionSigner, address[] memory allowedTargets) {
        permissionSigner = _permissionSigner;
        for (uint256 i = 0; i < allowedTargets.length; i++) {
            isAllowedTarget[allowedTargets[i]] = true;
        }
    }

    /// @inheritdoc IPermission
    function evaluate(bytes calldata, Context calldata ctx) external view returns (bool) {
        return isAllowedTarget[ctx.target];
    }

    /// @inheritdoc IPermission
    function discriminator() external pure returns (bytes32) {
        return keccak256("AllowlistTargetMandate");
    }
}
`;

const MANDATES_README = `# Mandates

Solidity mandate (permission) contracts for this Sailor project live here.

A mandate implements \`@sail/interfaces/IPermission.sol\` — \`evaluate(txData, ctx)\`
returns \`true\` to permit a manager-submitted dispatch, \`false\` to block it.

## Authoring + deploying

1. Write your contract in this folder (see \`AllowlistTargetMandate.sol\`).
   Configure all parameters in the **constructor** — the deploy flow expects a
   single creation transaction to fully set up the mandate.
2. Compile:
   \`\`\`bash
   forge build
   \`\`\`
3. Deploy it (the owner signs the creation tx in the browser signing UI):
   \`\`\`bash
   sailor mandate deploy --contract AllowlistTargetMandate \\
     --args '["0xPermissionSigner", ["0xTarget1", "0xTarget2"]]'
   \`\`\`
4. Attach it to a Safe:
   \`\`\`bash
   sailor mandate attach --address 0xDeployed --sma 0xSafe
   \`\`\`
   (or pass \`--attach --sma 0xSafe\` to \`deploy\` to do both at once.)

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
  writeIfMissing(join(root, "mandates", "AllowlistTargetMandate.sol"), EXAMPLE_MANDATE_SOL);
  writeIfMissing(join(root, "mandates", "README.md"), MANDATES_README);
}

function writeIfMissing(path: string, content: string): void {
  if (!existsSync(path)) writeFileSync(path, content, "utf8");
}
