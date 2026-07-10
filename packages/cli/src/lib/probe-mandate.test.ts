import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type Address, encodeAbiParameters, toFunctionSelector } from "viem";

// The parametric probe generator ships as a standalone plain-JS scaffold script
// (no .d.ts by design — it runs in user projects); import its pure core untyped.
// The module guards its CLI main() behind an import.meta check, so importing is inert.
type Call = { target: string; value: string; data: string };
type Probe = {
  label: string;
  expect: string;
  // single-call probes:
  target?: string;
  calldata?: string;
  value?: string;
  // batch probes (ApproveAndCallBatch):
  kind?: string;
  calls?: Call[];
};
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
const SEL = (p: { calldata?: string } | undefined) => (p?.calldata ? p.calldata.slice(0, 10) : "");
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
    assert.equal(over!.expect, "fail");
    // over-cap encodes cap+1 in the amount word (last 32 bytes of calldata).
    assert.ok(BigInt(`0x${(over!.calldata as string).slice(-64)}`) === CAP + 1n);
    assert.ok(BigInt(`0x${(pass!.calldata as string).slice(-64)}`) === CAP);
  });

  test("off-allowlist probe retargets away from the allowed token", () => {
    const off = probes.find((p: any) => /OFF-ALLOWLIST/i.test(p.label));
    assert.ok(off && (off.target as string).toLowerCase() !== USDC.toLowerCase());
    assert.equal(off!.expect, "fail");
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

const POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" as Address;
const ORACLE_C = "0x1111111111111111111111111111111111111111" as Address;
const ORACLE_B = "0x2222222222222222222222222222222222222222" as Address;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Address;
const borrowBlob = (oc: Address, ob: Address) =>
  encodeAbiParameters(
    [{ type: "address[]" }, { type: "address[]" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
    [[POOL], [USDC], 500_000_000n, 5000n, oc, ob, 3600n],
  );

describe("probe-mandate: BorrowPermission — per-family calldata + oracle-conditional LTV", () => {
  test("requires --protocol; refuses to guess a family", () => {
    const cfg = decodeConfig("BorrowPermission", borrowBlob(ZERO_ADDR, ZERO_ADDR));
    assert.throws(() => generateProbes("BorrowPermission", cfg, SMA), /requires --protocol/i);
    assert.throws(() => generateProbes("BorrowPermission", { ...cfg, family: "sushi" }, SMA), /requires --protocol/i);
  });

  test("aave: borrow(address,uint256,uint256,uint16,address) selector; over-cap encodes cap+1", () => {
    const cfg = { ...decodeConfig("BorrowPermission", borrowBlob(ZERO_ADDR, ZERO_ADDR)), family: "aave" };
    const { probes } = generateProbes("BorrowPermission", cfg, SMA);
    const pass = probes.find((p) => p.expect === "pass");
    const over = probes.find((p) => /OVER-CAP/i.test(p.label));
    assert.equal(SEL(pass), toFunctionSelector("borrow(address,uint256,uint256,uint16,address)"));
    // amountIn is arg[1] (word 1 of the args, i.e. bytes 36..68 after the selector).
    assert.equal(BigInt(`0x${(over!.calldata as string).slice(2).slice(8).slice(64, 128)}`), 500_000_001n);
  });

  test("morpho vs compound use their own selectors", () => {
    const base = decodeConfig("BorrowPermission", borrowBlob(ZERO_ADDR, ZERO_ADDR));
    const morpho = generateProbes("BorrowPermission", { ...base, family: "morpho" }, SMA);
    const compound = generateProbes("BorrowPermission", { ...base, family: "compound" }, SMA);
    assert.equal(SEL(morpho.probes.find((p) => p.expect === "pass")), toFunctionSelector("borrow(address,uint256,address,address)"));
    assert.equal(SEL(compound.probes.find((p) => p.expect === "pass")), toFunctionSelector("borrow(uint256)"));
    // Compound carries no asset/recipient in calldata → no off-allowlist-asset / wrong-recipient probes.
    assert.ok(!compound.probes.some((p) => /OFF-ALLOWLIST asset|WRONG recipient/i.test(p.label)));
    assert.ok(compound.notes.some((n) => /underlying\(\)/.test(n)));
  });

  test("zero oracles → a must-PASS and NO LTV probe, with the honest note", () => {
    const cfg = { ...decodeConfig("BorrowPermission", borrowBlob(ZERO_ADDR, ZERO_ADDR)), family: "aave" };
    const { probes, notes } = generateProbes("BorrowPermission", cfg, SMA);
    assert.ok(probes.some((p) => p.expect === "pass"), "zero-oracle config has a deterministic must-pass");
    assert.ok(!probes.some((p) => /LTV/i.test(p.label)), "no LTV probe when oracles are unset");
    assert.ok(notes.some((n) => /No LTV ceiling/i.test(n)));
  });

  test("both oracles → an LTV must-FAIL probe and NO fabricated must-pass", () => {
    const cfg = { ...decodeConfig("BorrowPermission", borrowBlob(ORACLE_C, ORACLE_B)), family: "aave" };
    const { probes, notes } = generateProbes("BorrowPermission", cfg, SMA);
    const ltv = probes.find((p) => /LTV/i.test(p.label));
    assert.ok(ltv && ltv.expect === "fail", "both-oracle config includes a must-fail LTV probe");
    assert.ok(!probes.some((p) => p.expect === "pass"), "no deterministic must-pass for a both-oracle borrow (collateral-dependent)");
    assert.ok(notes.some((n) => /enforced LIVE/i.test(n)));
  });
});

describe("probe-mandate: ApproveAndCallBatchPermission — evaluateBatch batch arrays", () => {
  const batchBlob = (allowUnconstrained: boolean) =>
    encodeAbiParameters(
      [{ type: "tuple", components: [
        { type: "address[]" }, { type: "address[]" },
        { type: "tuple[]", components: [{ type: "address" }, { type: "bytes4" }] },
        { type: "uint256[]" }, { type: "bool" }, { type: "bool" },
      ] }],
      [[[USDC], [REC], [[REC, "0x38ed1739"]], [1_000_000_000n], false, allowUnconstrained]],
    );

  test("compliant probe is a 3-call approve→consume→reset bracket, reset to zero", () => {
    const cfg = decodeConfig("ApproveAndCallBatchPermission", batchBlob(false));
    const { probes, notes } = generateProbes("ApproveAndCallBatchPermission", cfg, SMA);
    const ok = probes.find((p) => p.expect === "pass")!;
    assert.equal(ok.kind, "batch");
    assert.equal(ok.calls!.length, 3);
    assert.equal(ok.calls![0].data.slice(0, 10), "0x095ea7b3", "calls[0] = approve");
    assert.equal(ok.calls![1].data.slice(0, 10), "0x38ed1739", "calls[1] = the consuming selector from the config pair");
    assert.equal(ok.calls![2].data.slice(0, 10), "0x095ea7b3", "calls[2] = approve (reset)");
    assert.equal(BigInt(`0x${ok.calls![2].data.slice(-64)}`), 0n, "reset amount is zero");
    assert.ok(notes.some((n) => /evaluateBatch/.test(n)), "notes the direct-evaluateBatch mechanism");
  });

  test("must-fail proofs: missing reset, over-cap, off-allowlist spender", () => {
    const { probes } = generateProbes("ApproveAndCallBatchPermission", decodeConfig("ApproveAndCallBatchPermission", batchBlob(false)), SMA);
    const missingReset = probes.find((p) => /MISSING reset/i.test(p.label))!;
    assert.equal(missingReset.expect, "fail");
    assert.notEqual(BigInt(`0x${missingReset.calls![2].data.slice(-64)}`), 0n, "missing-reset probe's reset is non-zero");
    assert.ok(probes.some((p) => /OVER-CAP/i.test(p.label) && p.expect === "fail"));
    assert.ok(probes.some((p) => /OFF-ALLOWLIST spender/i.test(p.label) && p.expect === "fail"));
  });

  test("recipient probe is conditional on allowUnconstrainedRecipient", () => {
    const pinned = generateProbes("ApproveAndCallBatchPermission", decodeConfig("ApproveAndCallBatchPermission", batchBlob(false)), SMA);
    const open = generateProbes("ApproveAndCallBatchPermission", decodeConfig("ApproveAndCallBatchPermission", batchBlob(true)), SMA);
    assert.ok(pinned.probes.some((p) => /WRONG recipient/i.test(p.label)), "pinned config probes the recipient");
    assert.ok(!open.probes.some((p) => /WRONG recipient/i.test(p.label)), "unconstrained config skips the recipient probe");
    assert.ok(open.notes.some((n) => /allowUnconstrainedRecipient/.test(n)));
  });
});

describe("probe-mandate: all seven shared templates are covered (guards removed)", () => {
  test("no template throws a 'not covered' guard", () => {
    const all = [
      ["TransferPermission", encodeAbiParameters([{ type: "address[]" }, { type: "address[]" }, { type: "uint256" }], [[REC], [USDC], 1n])],
      ["WithdrawPermission", encodeAbiParameters([{ type: "address[]" }, { type: "address" }, { type: "uint256" }], [[USDC], REC, 1n])],
      ["DepositPermission", encodeAbiParameters([{ type: "address[]" }, { type: "address[]" }, { type: "uint256" }], [[POOL], [USDC], 1n])],
      ["SwapPermissionNoOracle", encodeAbiParameters([{ type: "address[]" }, { type: "address[]" }, { type: "address[]" }, { type: "uint256" }], [[REC], [USDC], [WETH], 1n])],
      ["SwapPermission", encodeAbiParameters([{ type: "address[]" }, { type: "address[]" }, { type: "address[]" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }], [[REC], [USDC], [WETH], 1n, 100n, ORACLE_C, 3600n])],
      ["BorrowPermission", borrowBlob(ZERO_ADDR, ZERO_ADDR)],
    ] as const;
    for (const [tmpl, blob] of all) {
      const cfg = decodeConfig(tmpl, blob);
      if (tmpl === "BorrowPermission") (cfg as Record<string, unknown>).family = "aave";
      const { probes } = generateProbes(tmpl, cfg, SMA);
      assert.ok(probes.length > 0, `${tmpl} produces probes`);
    }
    // approve-batch covered above; assert it does not throw either.
    assert.doesNotThrow(() =>
      generateProbes(
        "ApproveAndCallBatchPermission",
        decodeConfig(
          "ApproveAndCallBatchPermission",
          encodeAbiParameters(
            [{ type: "tuple", components: [{ type: "address[]" }, { type: "address[]" }, { type: "tuple[]", components: [{ type: "address" }, { type: "bytes4" }] }, { type: "uint256[]" }, { type: "bool" }, { type: "bool" }] }],
            [[[USDC], [REC], [[REC, "0x38ed1739"]], [1n], false, false]],
          ),
        ),
        SMA,
      ),
    );
  });

  test("a genuinely unknown template still throws", () => {
    assert.throws(() => decodeConfig("NotATemplate", "0x"), /Unknown|uncovered/i);
  });
});
