import assert from "node:assert/strict";
import { test } from "node:test";
import { buildConfigureTypedData } from "../eip712.js";

const KERNEL = "0x0000000000000000000000000000000000000A11" as const;
const TEMPLATE = "0x00000000000000000000000000000000000000C0" as const;
const ACCOUNT = "0x000000000000000000000000000000000000Acc7" as const;
const PARAMS = "0x1234" as const;

/** Minimal publicClient that reports a chosen template EIP-712 version + epoch. */
function fakeClient(version: string, epoch = 7n) {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "eip712Domain") {
        return ["0x0f", "SwapPermission", version, 8453n, TEMPLATE, `0x${"0".repeat(64)}`, []];
      }
      if (functionName === "registrationEpoch") return epoch;
      throw new Error(`unexpected call ${functionName}`);
    },
  } as never;
}

test("v1 template: legacy Configure struct, domain version 1, no epoch", async () => {
  const td = await buildConfigureTypedData({
    publicClient: fakeClient("1"),
    kernel: KERNEL,
    template: TEMPLATE,
    account: ACCOUNT,
    params: PARAMS,
    nonce: 3n,
    deadline: 999n,
  });
  assert.equal(td.domain.version, "1");
  assert.equal(td.domain.verifyingContract, TEMPLATE);
  assert.equal(td.primaryType, "Configure");
  assert.equal(td.types.Configure.length, 4); // no epoch
  assert.equal(td.message.epoch, undefined);
  assert.equal(td.message.nonce, "3");
});

test("v2 template: epoch-bound Configure struct, domain version 2, epoch from kernel", async () => {
  const td = await buildConfigureTypedData({
    publicClient: fakeClient("2", 7n),
    kernel: KERNEL,
    template: TEMPLATE,
    account: ACCOUNT,
    params: PARAMS,
    nonce: 3n,
    deadline: 999n,
  });
  assert.equal(td.domain.version, "2");
  assert.equal(td.types.Configure.length, 5); // + epoch
  assert.equal(td.types.Configure[4].name, "epoch");
  assert.equal(td.message.epoch, "7"); // read from registrationEpoch, decimal string
});
