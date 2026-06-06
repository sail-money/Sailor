import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters } from "viem";
import type { Hex, PermissionTemplate } from "../types.js";
import {
  ammLiquidityTemplate,
  approveAndCallBatchTemplate,
  boundedBorrowTemplate,
  boundedSwapTemplate,
  defiBundleTemplate,
  pendleTemplate,
  transferTargetTemplate,
} from "./index.js";

// Checksum-stable test addresses (no a–f hex letters → checksum form == lowercase),
// so SDK decode (which returns checksummed addresses) round-trips without case drift.
const A1 = "0x1111111111111111111111111111111111111111";
const A2 = "0x2222222222222222222222222222222222222222";
const A3 = "0x3333333333333333333333333333333333333333";
const A4 = "0x4444444444444444444444444444444444444444";
const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Each case pairs an SDK template with:
 *  - `params`: typed input for the SDK encoder
 *  - `contractAbi` + `contractValues`: an INDEPENDENT description of the deployed
 *    contract's `_applyConfig` decode signature and the equivalent values.
 *
 * The contract ABI here is transcribed straight from the Solidity source under
 * SailProtocol/contracts/templates/shared/*.sol — it is the ground truth. If an
 * SDK template's shape drifts from its contract, `encode(params)` will no longer
 * equal `encodeAbiParameters(contractAbi, contractValues)` and the test fails.
 */
type Case = {
  name: string;
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous template param types
  template: PermissionTemplate<any>;
  // biome-ignore lint/suspicious/noExplicitAny: per-case param shape
  params: any;
  // biome-ignore lint/suspicious/noExplicitAny: per-case ABI shape
  contractAbi: any;
  // biome-ignore lint/suspicious/noExplicitAny: per-case values shape
  contractValues: any[];
};

const cases: Case[] = [
  {
    name: "SharedBoundedSwapPermission",
    template: boundedSwapTemplate,
    params: {
      routers: [A1, A2],
      tokensIn: [A3],
      tokensOut: [A4],
      maxAmountPerTx: 1_000_000_000_000_000_000n,
      maxSlippageBps: 50,
      priceOracle: A1,
      maxPriceAgeSec: 3600,
    },
    // abi.decode(params, (address[], address[], address[], uint256, uint256, address, uint256))
    contractAbi: [
      { type: "address[]" },
      { type: "address[]" },
      { type: "address[]" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "address" },
      { type: "uint256" },
    ],
    contractValues: [[A1, A2], [A3], [A4], 1_000_000_000_000_000_000n, 50n, A1, 3600n],
  },
  {
    name: "SharedBoundedBorrowPermission",
    template: boundedBorrowTemplate,
    params: {
      protocols: [A1],
      assets: [A2, A3],
      maxAmountPerTx: 500n,
      maxLtvBps: 7500,
      collateralOracle: A4,
      borrowOracle: A1,
      maxPriceAgeSec: 1800,
    },
    // abi.decode(params, (address[], address[], uint256, uint256, address, address, uint256))
    contractAbi: [
      { type: "address[]" },
      { type: "address[]" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
    ],
    contractValues: [[A1], [A2, A3], 500n, 7500n, A4, A1, 1800n],
  },
  {
    name: "SharedAMMLiquidityPermission",
    template: ammLiquidityTemplate,
    params: {
      allowedTargets: [A1],
      allowedTokens: [A2, A3],
      maxAmountPerTokenPerTx: 12345n,
      allowMint: true,
      allowIncrease: false,
      allowDecrease: true,
      allowCollect: true,
      allowBurn: false,
    },
    // abi.decode(params, (address[], address[], uint128, bool, bool, bool, bool, bool))
    contractAbi: [
      { type: "address[]" },
      { type: "address[]" },
      { type: "uint128" },
      { type: "bool" },
      { type: "bool" },
      { type: "bool" },
      { type: "bool" },
      { type: "bool" },
    ],
    contractValues: [[A1], [A2, A3], 12345n, true, false, true, true, false],
  },
  {
    name: "SharedPendlePermission",
    template: pendleTemplate,
    params: {
      pendleRouter: A1,
      allowedMarkets: [A2, A3],
      maxAmountPerTx: 99n,
      allowLiquidityOps: true,
      allowPtSwaps: false,
      allowYtSwaps: true,
      allowMintRedeem: false,
      allowClaimYield: true,
    },
    // abi.decode(params, (address, address[], uint128, bool, bool, bool, bool, bool))
    contractAbi: [
      { type: "address" },
      { type: "address[]" },
      { type: "uint128" },
      { type: "bool" },
      { type: "bool" },
      { type: "bool" },
      { type: "bool" },
      { type: "bool" },
    ],
    contractValues: [A1, [A2, A3], 99n, true, false, true, false, true],
  },
  {
    name: "SharedTransferTargetPermission",
    template: transferTargetTemplate,
    params: {
      allowedRecipients: [A1, A2],
      allowedTokens: [A3],
      maxAmountPerTx: 7n,
    },
    // abi.decode(params, (address[], address[], uint256))
    contractAbi: [{ type: "address[]" }, { type: "address[]" }, { type: "uint256" }],
    contractValues: [[A1, A2], [A3], 7n],
  },
  {
    name: "SharedDeFiBundlePermission",
    template: defiBundleTemplate,
    params: {
      swap: {
        routers: [A1],
        tokensIn: [A2],
        tokensOut: [A3],
        maxAmountPerTx: 10n,
        maxSlippageBps: 30,
        priceOracle: A4,
        maxPriceAgeSec: 600,
      },
      borrow: {
        protocols: [A2],
        assets: [A3],
        maxAmountPerTx: 20n,
        maxLtvBps: 6000,
        collateralOracle: A1,
        borrowOracle: A4,
        maxPriceAgeSec: 900,
      },
      transfer: {
        recipients: [A1],
        tokens: [A2],
        maxAmountPerTx: 30n,
      },
    },
    // abi.decode(params, (SwapConfig, BorrowConfig, TransferConfig))
    contractAbi: [
      {
        type: "tuple",
        components: [
          { type: "address[]" },
          { type: "address[]" },
          { type: "address[]" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "address" },
          { type: "uint256" },
        ],
      },
      {
        type: "tuple",
        components: [
          { type: "address[]" },
          { type: "address[]" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "address" },
          { type: "address" },
          { type: "uint256" },
        ],
      },
      {
        type: "tuple",
        components: [{ type: "address[]" }, { type: "address[]" }, { type: "uint256" }],
      },
    ],
    contractValues: [
      [[A1], [A2], [A3], 10n, 30n, A4, 600n],
      [[A2], [A3], 20n, 6000n, A1, A4, 900n],
      [[A1], [A2], 30n],
    ],
  },
  {
    name: "SharedApproveAndCallBatchPermission",
    template: approveAndCallBatchTemplate,
    params: {
      tokens: [A1, A2],
      spenders: [A3],
      consumingTargets: [A3],
      consumingSelectors: ["0x095ea7b3", "0x38ed1739"] as Hex[],
      maxApprovalAmounts: [100n, 200n],
      requireAmountMatch: true,
    },
    // abi.decode(params, (Config)) — a SINGLE struct, so one top-level tuple.
    contractAbi: [
      {
        type: "tuple",
        components: [
          { type: "address[]" },
          { type: "address[]" },
          { type: "address[]" },
          { type: "bytes4[]" },
          { type: "uint256[]" },
          { type: "bool" },
        ],
      },
    ],
    contractValues: [
      [[A1, A2], [A3], [A3], ["0x095ea7b3", "0x38ed1739"], [100n, 200n], true],
    ],
  },
];

for (const c of cases) {
  test(`${c.name}: SDK encoder matches deployed contract ABI`, () => {
    const sdkBlob: Hex = c.template.encoder.encode(c.params);
    const contractBlob = encodeAbiParameters(c.contractAbi, c.contractValues);
    assert.equal(
      sdkBlob,
      contractBlob,
      `${c.name} encoded blob does not match the deployed contract's _applyConfig ABI`,
    );
  });

  test(`${c.name}: SDK encode→decode round-trips`, () => {
    const decoded = c.template.encoder.decode(c.template.encoder.encode(c.params));
    assert.deepEqual(decoded, c.params);
  });
}
