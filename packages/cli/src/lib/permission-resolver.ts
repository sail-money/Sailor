/**
 * Off-chain permission resolution for the Sailor runner.
 *
 * The selective SailKernel requires a dispatch to name EXACTLY ONE registered
 * permission. For multi-permission SMAs the runner must determine which
 * permission authorises each call without requiring the agent to know or care
 * about the permission topology.
 *
 * Resolution strategy: call permission.evaluate(txData, ctx) off-chain via
 * eth_call for each registered permission in registration order and return the
 * first that returns true. This mirrors the on-chain evaluate semantics exactly —
 * the same function, the same inputs, the same fail-closed rule (revert / gas
 * overage → treat as false). When two permissions both accept a call,
 * FIRST-BY-REGISTRATION-ORDER wins. This is intentional and deterministic.
 */

import { SailKernelAbi } from "@sail/sdk";
import type { Address, Hex, PublicClient } from "viem";

/**
 * Minimal IPermission ABI for the off-chain evaluate() probe.
 * The Context tuple mirrors SailProtocol's Context struct field order exactly.
 * Single source of truth — imported by doctor.ts and run.ts; never duplicated.
 */
export const IPERMISSION_ABI = [
  {
    type: "function",
    name: "evaluate",
    stateMutability: "view",
    inputs: [
      { name: "txData", type: "bytes" },
      {
        name: "ctx",
        type: "tuple",
        components: [
          { name: "account",        type: "address" },
          { name: "manager",        type: "address" },
          { name: "submitter",      type: "address" },
          { name: "target",         type: "address" },
          { name: "selector",       type: "bytes4"  },
          { name: "value",          type: "uint256" },
          { name: "blockTimestamp", type: "uint256" },
          { name: "blockNumber",    type: "uint256" },
        ],
      },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/** Shape of the Context struct passed to IPermission.evaluate(). */
export type PermissionContext = {
  account:        Address;
  manager:        Address;
  submitter:      Address;
  target:         Address;
  selector:       Hex;
  value:          bigint;
  blockTimestamp: bigint;
  blockNumber:    bigint;
};

/**
 * Probe a single call against all registered permissions off-chain (eth_call),
 * returning the address of the first permission whose evaluate() returns true.
 *
 * - Iterates `registeredPermissions` in the supplied order (registration order).
 * - When two permissions both accept a call, FIRST-BY-REGISTRATION-ORDER wins.
 *   This is intentional: it is deterministic, matches the order the owner
 *   approved permissions, and the kernel's selective model makes the choice
 *   semantically equivalent regardless of which matching permission is named.
 * - Revert / out-of-gas / malformed return from evaluate() is treated as false
 *   and iteration continues — mirroring the kernel's own fail-closed rule.
 * - Returns `undefined` if no registered permission accepts the call.
 *
 * @param publicClient viem public client bound to the kernel's chain
 * @param account      the Safe (SMA) account being dispatched from
 * @param manager      the manager (agent) address — used as submitter in ctx
 * @param call         the call the agent wants to execute
 * @param registeredPermissions all permission addresses registered on the account,
 *                     in registration order
 * @param blockInfo    current block number + timestamp (fetch once per tick;
 *                     real values prevent false negatives on time/block-gated perms)
 */
export async function resolvePermissionForCall(params: {
  publicClient:          PublicClient;
  account:               Address;
  manager:               Address;
  call:                  { target: Address; value: bigint; data: Hex };
  registeredPermissions: Address[];
  blockInfo:             { number: bigint; timestamp: bigint };
}): Promise<Address | undefined> {
  const { publicClient, account, manager, call, registeredPermissions, blockInfo } = params;

  // Extract the 4-byte selector; default to all-zeros if calldata is short.
  const selector = (
    call.data.length >= 10 ? call.data.slice(0, 10) : "0x00000000"
  ) as Hex;

  const ctx: PermissionContext = {
    account,
    manager,
    submitter:      manager, // conservative: submitter = manager for off-chain probe
    target:         call.target,
    selector,
    value:          call.value,
    blockTimestamp: blockInfo.timestamp,
    blockNumber:    blockInfo.number,
  };

  for (const permission of registeredPermissions) {
    try {
      const accepted = await publicClient.readContract({
        address:      permission,
        abi:          IPERMISSION_ABI,
        functionName: "evaluate",
        args:         [call.data, ctx],
      });
      if (accepted) return permission;
    } catch {
      // Revert / gas overage / malformed return → false; continue to next.
      // This mirrors the kernel's fail-closed evaluation semantics.
    }
  }

  return undefined;
}

/**
 * Probe a batch of calls against all registered permissions using the kernel's
 * previewBatch view (eth_call). Returns the first permission (by registration
 * order) that accepts the whole batch — meaning it implements IBatchPermission
 * and evaluateBatch() returns true.
 *
 * Permissions that are not batch-aware revert on previewBatch and are naturally
 * skipped, so the caller does not need to pre-filter.
 *
 * Returns `undefined` if no registered permission accepts the full batch.
 */
export async function resolvePermissionForBatch(params: {
  publicClient:          PublicClient;
  kernel:                Address;
  account:               Address;
  calls:                 { target: Address; value: bigint; data: Hex }[];
  registeredPermissions: Address[];
}): Promise<Address | undefined> {
  const { publicClient, kernel, account, calls, registeredPermissions } = params;

  for (const permission of registeredPermissions) {
    try {
      const [approved] = await publicClient.readContract({
        address:      kernel,
        abi:          SailKernelAbi,
        functionName: "previewBatch",
        args:         [account, permission, calls],
      });
      if (approved) return permission;
    } catch {
      // Not a batch permission, or batch validation reverted — skip.
    }
  }

  return undefined;
}
