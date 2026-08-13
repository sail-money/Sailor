// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPermission, Context} from "@sail/interfaces/IPermission.sol";
import {SailCalldata} from "./SailCalldata.sol";

// ENFORCES ON-CHAIN (kernel calls evaluate() on every dispatch; false => dispatch blocked):
//   depositForBurn(uint256,uint32,bytes32,address)  selector 0x6fd3504e
//     • target == the bound CCTP TokenMessenger (source chain)
//     • burnToken == the bound USDC (the only asset this permission may bridge)
//     • amount <= MAX_AMOUNT (per-tx cap, in USDC base units)
//     • destinationDomain ∈ the bound domain allowlist (which chains may receive)
//     • mintRecipient == the account's own address (chain-invariant: the SMA carries the
//       same CREATE2 address on every chain, so "your account on the destination chain"
//       is the same 20 bytes as ctx.account)
//     • ctx.value == 0 (depositForBurn never carries native value)
//
// AGENT-ENFORCED / NOT BOUNDED HERE (off-chain, can change without redeploying this contract):
//   • a per-period (cumulative) cap above the per-tx cap — the agent limits total bridged
//     volume over time
//   • which allowed domain the agent picks, and when it bridges
//   • the ERC-20 approve() that precedes depositForBurn — covered by a bounded approve
//     permission, not this contract
contract CctpBridgePermission is IPermission {
    bytes32 private constant DISCRIMINATOR = keccak256("CctpBridgePermission");
    bytes4 private constant DEPOSIT_FOR_BURN = 0x6fd3504e; // depositForBurn(uint256,uint32,bytes32,address)

    address public immutable MESSENGER;
    address public immutable USDC;
    uint256 public immutable MAX_AMOUNT; // 0 == uncapped
    mapping(uint32 => bool) public isAllowedDomain;

    constructor(address messenger, address usdc, uint32[] memory allowedDomains, uint256 maxAmount) {
        MESSENGER = messenger;
        USDC = usdc;
        MAX_AMOUNT = maxAmount;
        for (uint256 i = 0; i < allowedDomains.length; i++) isAllowedDomain[allowedDomains[i]] = true;
    }

    function evaluate(bytes calldata txData, Context calldata ctx) external view returns (bool) {
        if (ctx.target != MESSENGER) return false;
        if (ctx.selector != DEPOSIT_FOR_BURN) return false;
        if (ctx.value != 0) return false;
        if (!SailCalldata.hasParams(txData, 4)) return false;

        uint256 amount = SailCalldata.asUint256(txData, 0);
        uint32 destinationDomain = SailCalldata.asUint32(txData, 1);
        bytes32 mintRecipient = SailCalldata.asBytes32(txData, 2);
        address burnToken = SailCalldata.asAddress(txData, 3);

        if (burnToken != USDC) return false;
        if (MAX_AMOUNT != 0 && amount > MAX_AMOUNT) return false;
        if (!isAllowedDomain[destinationDomain]) return false;
        // Self-recipient: the mint must land at the account's own address on the destination
        // chain. The SMA address is CREATE2-deterministic, so the same 20 bytes identify it
        // everywhere. mintRecipient is bytes32 (address left-padded), so compare as such.
        if (mintRecipient != bytes32(uint256(uint160(ctx.account)))) return false;

        return true;
    }

    function discriminator() external pure returns (bytes32) { return DISCRIMINATOR; }
}
