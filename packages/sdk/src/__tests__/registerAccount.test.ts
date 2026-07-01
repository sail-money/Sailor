import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData } from "viem";
import { buildRegisterAccountTypedData } from "../eip712.js";
import { buildRegisterAccountExecTransaction, gnosisSafeExecAbi } from "../safe.js";

const KERNEL = "0x00000000000000000000000000000000000000A1" as const;
const SAFE = "0x000000000000000000000000000000000000Safe".replace("Safe", "5afe") as `0x${string}`;
const OWNER = "0x0000000000000000000000000000000000000011" as const;
const MANAGER = "0x0000000000000000000000000000000000000022" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

test("buildRegisterAccountTypedData: matches REGISTER_ACCOUNT_TYPEHASH shape", () => {
  const td = buildRegisterAccountTypedData({
    chainId: 8453,
    kernel: KERNEL,
    account: SAFE,
    permissionSigner: OWNER,
    manager: MANAGER,
    feePolicy: ZERO,
    deadline: 1234n,
  });
  assert.equal(td.domain.name, "SailKernel");
  assert.equal(td.domain.version, "1");
  assert.equal(td.domain.chainId, 8453);
  assert.equal(td.domain.verifyingContract, KERNEL);
  assert.equal(td.primaryType, "RegisterAccount");
  // account, permissionSigner, manager, feePolicy, feeAsset, deadline
  assert.equal(td.types.RegisterAccount.length, 6);
  assert.equal(td.message.account, SAFE);
  assert.equal(td.message.feeAsset, ZERO); // defaulted to native
  assert.equal(td.message.deadline, "1234");
});

test("buildRegisterAccountExecTransaction: wraps 6-arg registerAccount in Safe.execTransaction", () => {
  const ownerSig = `0x${"ab".repeat(65)}` as `0x${string}`;
  const { to, data } = buildRegisterAccountExecTransaction({
    safe: SAFE,
    kernel: KERNEL,
    permissionSigner: OWNER,
    manager: MANAGER,
    feePolicy: ZERO,
    feeAsset: ZERO,
    deadline: 1234n,
    ownerSig,
    owner: OWNER,
  });
  // Outer tx targets the Safe itself.
  assert.equal(to, SAFE);

  // Outer call is Safe.execTransaction to the kernel, operation Call (0), zero value.
  const outer = decodeFunctionData({ abi: gnosisSafeExecAbi, data });
  assert.equal(outer.functionName, "execTransaction");
  assert.equal((outer.args[0] as string).toLowerCase(), KERNEL.toLowerCase()); // to == kernel
  assert.equal(outer.args[1], 0n); // value
  assert.equal(outer.args[3], 0); // operation: Call

  // Inner calldata is the 6-arg registerAccount carrying the ECDSA ownerSig (not a
  // pre-validated blob — the execTransaction signature is the pre-validated one).
  const innerData = outer.args[2] as `0x${string}`;
  const inner = decodeFunctionData({
    abi: [
      {
        type: "function",
        name: "registerAccount",
        stateMutability: "nonpayable",
        inputs: [
          { name: "permissionSigner", type: "address" },
          { name: "manager", type: "address" },
          { name: "feePolicy", type: "address" },
          { name: "feeAsset", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "ownerSig", type: "bytes" },
        ],
        outputs: [],
      },
    ] as const,
    data: innerData,
  });
  assert.equal(inner.functionName, "registerAccount");
  assert.equal(inner.args.length, 6);
  assert.equal((inner.args[0] as string).toLowerCase(), OWNER.toLowerCase());
  assert.equal(inner.args[4], 1234n); // deadline matches the signed digest
  assert.equal(inner.args[5], ownerSig); // ECDSA owner signature threaded through
});
