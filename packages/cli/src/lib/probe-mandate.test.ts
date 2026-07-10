import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type Address, encodeAbiParameters } from "viem";

// The parametric probe generator ships as a standalone plain-JS scaffold script
// (no .d.ts by design — it runs in user projects); import its pure core untyped.
// The module guards its CLI main() behind an import.meta check, so importing is inert.
type Probe = { label: string; target: string; calldata: string; value: string; expect: string };
type ProbeMod = {
  decodeConfig: (template: string, blobHex: string) => Record<string, unknown>;
  generateProbes: (
    template: string,
    config: Record<string, unknown>,
    account: string,
  ) => { probes: Probe[]; notes: string[] };
};
// @ts-expect-error — scaffold script is plain JS with no declaration file (by design).
const probeMod: ProbeMod = await import("../../../../scaffold/scripts/probe-mandate.mjs");
const { decodeConfig, generateProbes } = probeMod;

// Run with: pnpm --filter sailor test  (requires `pnpm --filter @sail/sdk build`).
// Covers the mechanical derivation: given a config blob, the right lean probe set
// is produced with correct expectations and the correct swap selector per router
// (the F15 fix). No network — pure encode/derive.

const SMA = "0x9999999999999999999999999999999999999999" as Address;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
const WETH = "0x4200000000000000000000000000000000000006" as Address;
const REC = "0x1111111111111111111111111111111111111111" as Address;
const SEL = (p: { calldata: string } | undefined) => (p ? p.calldata.slice(0, 10) : "");
const CAP = 1_000_000_000n;

describe("probe-mandate: TransferPermission", () => {
  const blob = encodeAbiParameters(
    [{ type: "address[]" }, { type: "address[]" }, { type: "uint256" }],
    [[REC], [USDC], CAP],
  );
  const cfg = decodeConfig("TransferPermission", blob);
  const { probes } = generateProbes("TransferPermission", cfg, SMA);

  test("decodes the config blob (recipients, tokens, cap)", () => {
    assert.equal(cfg.cap, CAP);
    assert.equal((cfg.tokens as string[])[0].toLowerCase(), USDC.toLowerCase());
  });

  test("derives one must-pass and the must-fail proofs", () => {
    const pass = probes.filter((p: any) => p.expect === "pass");
    const fail = probes.filter((p: any) => p.expect === "fail");
    assert.equal(pass.length, 1, "exactly one representative must-pass");
    assert.ok(fail.length >= 3, "over-cap, off-allowlist, wrong-recipient must-fail proofs");
  });

  test("the pass probe is at the cap; an over-cap probe expects fail", () => {
    const pass = probes.find((p: any) => p.expect === "pass");
    const over = probes.find((p: any) => /OVER-CAP/i.test(p.label));
    assert.ok(pass && over);
    // ERC-20 transfer selector on both.
    assert.equal(SEL(pass), "0xa9059cbb");
    assert.equal(over.expect, "fail");
    // over-cap encodes cap+1 in the amount word (last 32 bytes of calldata).
    assert.ok(BigInt(`0x${over.calldata.slice(-64)}`) === CAP + 1n);
    assert.ok(BigInt(`0x${pass.calldata.slice(-64)}`) === CAP);
  });

  test("off-allowlist probe retargets away from the allowed token", () => {
    const off = probes.find((p: any) => /OFF-ALLOWLIST/i.test(p.label));
    assert.ok(off && off.target.toLowerCase() !== USDC.toLowerCase());
    assert.equal(off.expect, "fail");
  });
});

describe("probe-mandate: SwapPermissionNoOracle — F15 selector per router + zero-floor", () => {
  const mkSwapBlob = (router: Address) =>
    encodeAbiParameters(
      [
        { type: "address[]" }, { type: "address[]" }, { type: "address[]" }, { type: "uint256" },
        { type: "tuple[]", components: [
          { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint8" }, { type: "uint256" },
        ] },
      ],
      [[router], [USDC], [WETH], 10_000_000n, [[USDC, WETH, REC, 1, 1000n]]],
    );

  test("SwapRouter02 → exactInputSingle V2 selector 0x04e45aaf (the F15 fix)", () => {
    const cfg = decodeConfig("SwapPermissionNoOracle", mkSwapBlob("0x2626664c2603336E57B271c5C0b26F421741e481" as Address));
    const { probes } = generateProbes("SwapPermissionNoOracle", cfg, SMA);
    assert.equal(SEL(probes.find((p: any) => p.expect === "pass")), "0x04e45aaf");
  });

  test("classic SwapRouter (v1) → exactInputSingle V1 selector 0x414bf389", () => {
    const cfg = decodeConfig("SwapPermissionNoOracle", mkSwapBlob("0xE592427A0AEce92De3Edee1F18E0157C05861564" as Address));
    const { probes } = generateProbes("SwapPermissionNoOracle", cfg, SMA);
    assert.equal(SEL(probes.find((p: any) => p.expect === "pass")), "0x414bf389");
  });

  test("unknown router → defaults to SwapRouter02 shape + a note", () => {
    const cfg = decodeConfig("SwapPermissionNoOracle", mkSwapBlob("0x1234567890123456789012345678901234567890" as Address));
    const { probes, notes } = generateProbes("SwapPermissionNoOracle", cfg, SMA);
    assert.equal(SEL(probes.find((p: any) => p.expect === "pass")), "0x04e45aaf");
    assert.ok(notes.some((n: string) => /not a known SwapRouter02/.test(n)));
  });

  test("includes the zero-min-out rejection proof (no-oracle floor)", () => {
    const cfg = decodeConfig("SwapPermissionNoOracle", mkSwapBlob("0x2626664c2603336E57B271c5C0b26F421741e481" as Address));
    const { probes } = generateProbes("SwapPermissionNoOracle", cfg, SMA);
    const zero = probes.find((p: any) => /ZERO min-out/i.test(p.label));
    assert.ok(zero && zero.expect === "fail", "zero-min-out must be a must-fail proof");
  });
});

describe("probe-mandate: unsupported templates fail loudly (honest seam)", () => {
  test("BorrowPermission is not derivable here", () => {
    assert.throws(() => generateProbes("BorrowPermission", { cap: 1n } as any, SMA), /does not cover|not derivable/i);
  });
  test("ApproveAndCallBatchPermission is not derivable here (evaluateBatch)", () => {
    assert.throws(() => generateProbes("ApproveAndCallBatchPermission", {} as any, SMA), /does not cover|not derivable/i);
  });
});
