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

describe("probe-mandate: WithdrawPermission v2 — 4626 withdraw/redeem + Aave withdraw", () => {
  const VAULT = "0x2222222222222222222222222222222222222222" as Address;
  const W_4626 = toFunctionSelector("withdraw(uint256,address,address)"); // 0xb460af94
  const R_4626 = toFunctionSelector("redeem(uint256,address,address)"); //   0xba087652
  const W_AAVE = toFunctionSelector("withdraw(address,uint256,address)"); // 0x69328dec
  // v2 config layout: (address[] targets, address[] tokens, uint256 maxAmountPerTx).
  const blob = encodeAbiParameters(
    [{ type: "address[]" }, { type: "address[]" }, { type: "uint256" }],
    [[VAULT], [USDC], CAP],
  );
  const cfg = decodeConfig("WithdrawPermission", blob);
  const { probes, notes } = generateProbes("WithdrawPermission", cfg, SMA);
  const byLabel = (re: RegExp) => probes.find((p: any) => re.test(p.label));

  test("decodes the v2 config blob (targets, tokens, cap) — no v1 `recipient` field", () => {
    assert.equal(cfg.cap, CAP);
    assert.equal((cfg.targets as string[])[0].toLowerCase(), VAULT.toLowerCase());
    assert.equal((cfg.tokens as string[])[0].toLowerCase(), USDC.toLowerCase());
    assert.equal(cfg.recipient, undefined, "v1 single-recipient field is gone");
  });

  test("covers all three gated selectors, each with a must-pass at the cap", () => {
    for (const [sel, name] of [[W_4626, "4626 withdraw"], [R_4626, "4626 redeem"], [W_AAVE, "aave withdraw"]] as const) {
      const pass = probes.find((p: any) => p.expect === "pass" && SEL(p) === sel);
      assert.ok(pass, `${name} has a must-pass probe`);
    }
    // No probe may use the v1 ERC-20 transfer selector as a must-pass.
    assert.ok(
      !probes.some((p: any) => p.expect === "pass" && SEL(p) === "0xa9059cbb"),
      "v1 transfer selector is never a must-pass under v2",
    );
  });

  test("redeem's cap is denominated in SHARES, and over-cap shares are rejected", () => {
    const pass = probes.find((p: any) => p.expect === "pass" && SEL(p) === R_4626)!;
    const over = probes.find((p: any) => p.expect === "fail" && SEL(p) === R_4626 && /OVER-CAP/i.test(p.label))!;
    assert.ok(pass && over);
    assert.ok(/SHARES/.test(pass.label), "the passing redeem probe names its unit as shares");
    assert.ok(/SHARES/.test(over.label), "the over-cap redeem probe names its unit as shares");
    // redeem(shares, receiver, owner): shares is calldata word 0 (bytes 4..36).
    const sharesOf = (p: any) => BigInt(`0x${(p.calldata as string).slice(10, 74)}`);
    assert.equal(sharesOf(pass), CAP, "passing redeem sits exactly at the cap, in shares");
    assert.equal(sharesOf(over), CAP + 1n, "over-cap redeem is cap+1 shares");
  });

  test("both ERC-4626 paths pin receiver AND owner to the account", () => {
    // Count how many of the two address words in the calldata are the SMA.
    const smaWords = (p: any) =>
      (p.calldata as string).toLowerCase().split(SMA.slice(2).toLowerCase()).length - 1;

    // Each must-pass 4626 probe carries the SMA twice: once as receiver, once as owner.
    for (const sel of [W_4626, R_4626]) {
      const pass = probes.find((p: any) => p.expect === "pass" && SEL(p) === sel)!;
      assert.ok(pass, "must-pass probe exists");
      assert.equal(smaWords(pass), 2, "receiver and owner are both the SMA");
    }

    // Each negative swaps exactly one of the two out, so the SMA appears exactly once.
    for (const re of [/4626 withdraw: WRONG receiver/i, /4626 withdraw: WRONG owner/i, /4626 redeem: WRONG owner/i]) {
      const p = byLabel(re)!;
      assert.ok(p, `probe ${re} exists`);
      assert.equal(p.expect, "fail");
      assert.equal(smaWords(p), 1, "exactly one of receiver/owner was swapped away from the SMA");
    }
  });

  test("the Aave path gates the asset on the token allowlist and pins `to`", () => {
    const offAsset = byLabel(/aave withdraw: OFF-ALLOWLIST asset/i)!;
    const wrongTo = byLabel(/aave withdraw: WRONG `to`/i)!;
    assert.equal(SEL(offAsset), W_AAVE);
    assert.equal(offAsset.expect, "fail");
    assert.ok(!(offAsset.calldata as string).toLowerCase().includes(USDC.slice(2).toLowerCase()), "off-allowlist asset is not USDC");
    assert.equal(wrongTo.expect, "fail");
  });

  test("off-allowlist target, non-zero native value, and unknown selectors are rejected", () => {
    const offTarget = byLabel(/OFF-ALLOWLIST target/i)!;
    assert.equal(offTarget.expect, "fail");
    assert.ok((offTarget.target as string).toLowerCase() !== VAULT.toLowerCase());

    const nativeValue = probes.find((p: any) => p.value !== "0")!;
    assert.ok(nativeValue, "a non-zero-value probe exists");
    assert.equal(nativeValue.expect, "fail");

    const unknownSel = probes.find((p: any) => SEL(p) === "0xa9059cbb")!;
    assert.ok(unknownSel, "the v1 transfer selector is probed as an unknown selector");
    assert.equal(unknownSel.expect, "fail");
  });

  test("notes disclose that the token allowlist binds only the Aave path", () => {
    assert.ok(notes.some((n) => /token allowlist/i.test(n) && /Aave/i.test(n)));
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

  test("includes a REVERSED-direction must-fail proof (tokensIn/tokensOut are directional, not a shared set)", () => {
    const cfg = decodeConfig("SwapPermissionNoOracle", mkSwapBlob("0x2626664c2603336E57B271c5C0b26F421741e481" as Address));
    const { probes } = generateProbes("SwapPermissionNoOracle", cfg, SMA);
    const reversed = probes.find((p: any) => /REVERSED direction/i.test(p.label));
    assert.ok(reversed && reversed.expect === "fail", "reversed-direction swap must be a must-fail proof");
    // The reversed probe's calldata pulls tokenOut (WETH) rather than tokenIn (USDC) — assert the
    // tokenIn/tokenOut ordering is genuinely flipped, not a duplicate of the pass probe.
    const pass = probes.find((p: any) => p.expect === "pass")!;
    assert.notEqual(reversed!.calldata, pass.calldata);
  });

  test("skips the reversed-direction probe (with a note) when tokensIn and tokensOut share a token", () => {
    const sameTokenBlob = encodeAbiParameters(
      [
        { type: "address[]" }, { type: "address[]" }, { type: "address[]" }, { type: "uint256" },
        { type: "tuple[]", components: [
          { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint8" }, { type: "uint256" },
        ] },
      ],
      [["0x2626664c2603336E57B271c5C0b26F421741e481"], [USDC], [USDC], 10_000_000n, []],
    );
    const cfg = decodeConfig("SwapPermissionNoOracle", sameTokenBlob);
    const { probes, notes } = generateProbes("SwapPermissionNoOracle", cfg, SMA);
    assert.ok(!probes.some((p: any) => /REVERSED direction/i.test(p.label)));
    assert.ok(notes.some((n: string) => /same token/i.test(n)));
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
      ["WithdrawPermission", encodeAbiParameters([{ type: "address[]" }, { type: "address[]" }, { type: "uint256" }], [[POOL], [USDC], 1n])],
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
