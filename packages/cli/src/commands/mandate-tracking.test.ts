import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Address, Hex } from "viem";
import { MandateStore } from "../lib/mandates.js";
import { mergeOnChainPermissions } from "./mandate.js";

// Run with: npx tsx --test packages/cli/src/commands/mandate-tracking.test.ts
// (requires `pnpm --filter @sail/sdk build` first so @sail/sdk resolves.)

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const C = "0xcccccccccccccccccccccccccccccccccccccccc" as Address;
const hex = (s: string): Hex => s as Hex;

// ── Option B: mergeOnChainPermissions ────────────────────────────────────────

test("mergeOnChainPermissions: unions on-chain permissions absent from the local store", () => {
  // Local store knows only A; the kernel lists A and a shared singleton B.
  const local = [{ address: A, label: "Tracked A", registeredOnSma: true }];
  const merged = mergeOnChainPermissions(local, new Set([A, B]));

  const b = merged.find((p) => p.address === B);
  assert.ok(b, "on-chain-only permission B should be unioned into the list");
  assert.equal(b.registeredOnSma, true, "unioned entry is registered on-chain");
  assert.equal(b.revokedOnChain ?? false, false);
  // This is the bug fix: B is the shared singleton that `register` failed to track,
  // and without it `sign` saw nothing and the operator hand-wrote mandate.json.
  assert.equal(merged.length, 2);
});

test("mergeOnChainPermissions: labels unioned entries via labelFor, falls back to a short address", () => {
  const labelFor = (addr: string) => (addr === B ? "SwapPermission" : undefined);
  const merged = mergeOnChainPermissions([], new Set([B, C]), labelFor);

  assert.equal(merged.find((p) => p.address === B)?.label, "SwapPermission");
  assert.equal(
    merged.find((p) => p.address === C)?.label,
    `permission ${C.slice(0, 10)}…`,
    "unlabelled on-chain permission falls back to a short address",
  );
});

test("mergeOnChainPermissions: flags local entries the kernel no longer lists as revoked", () => {
  const local = [
    { address: A, label: "still here", registeredOnSma: true },
    { address: B, label: "revoked externally", registeredOnSma: true },
  ];
  const merged = mergeOnChainPermissions(local, new Set([A])); // B gone on-chain

  assert.equal(merged.find((p) => p.address === A)?.revokedOnChain ?? false, false);
  assert.equal(merged.find((p) => p.address === B)?.revokedOnChain, true);
});

test("mergeOnChainPermissions: matches addresses case-insensitively (no spurious duplicate)", () => {
  // Local stores a checksummed address; the kernel read is lowercased.
  const local = [
    { address: "0xAbC0000000000000000000000000000000000000", label: "A", registeredOnSma: true },
  ];
  const merged = mergeOnChainPermissions(
    local,
    new Set(["0xabc0000000000000000000000000000000000000"]),
  );

  assert.equal(merged.length, 1, "same address in different casing must not be duplicated");
  assert.equal(merged[0].revokedOnChain ?? false, false);
});

// ── Option A: MandateStore.ensureTracked ─────────────────────────────────────

function tempStore(): { store: MandateStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "sail-mandate-store-"));
  return { store: new MandateStore(join(dir, "mandates.json")), dir };
}

test("ensureTracked: records a never-deployed address so register is no longer invisible", () => {
  const { store, dir } = tempStore();
  try {
    assert.equal(store.find(A), undefined);
    store.ensureTracked({
      name: "Shared Singleton",
      address: A,
      txHash: hex("0x" + "1".repeat(64)),
      chainId: 130,
      deployedAt: "2026-06-29T00:00:00.000Z",
    });
    const rec = store.find(A);
    assert.ok(rec, "ensureTracked should add the previously-untracked address");
    assert.equal(rec.name, "Shared Singleton");
    // recordAttachment is now effective because a record exists.
    store.recordAttachment(A, { sma: B, txHash: hex("0x" + "2".repeat(64)) });
    assert.equal(store.find(A)?.attachments?.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recordAttachment: idempotent for the same (sma, txHash) — no duplicate rows (S6)", () => {
  const { store, dir } = tempStore();
  try {
    store.ensureTracked({
      name: "Shared Singleton",
      address: A,
      txHash: hex("0x" + "1".repeat(64)),
      chainId: 130,
      deployedAt: "2026-06-29T00:00:00.000Z",
    });
    const tx = hex("0x" + "2".repeat(64));
    // Attach once at mine time, then a retry / `mandate sync` records the same fact.
    store.recordAttachment(A, { sma: B, txHash: tx });
    store.recordAttachment(A, { sma: B, txHash: tx });
    assert.equal(store.find(A)?.attachments?.length, 1, "same (sma, txHash) must not duplicate");
    // A genuinely different registration (e.g. reattach after revoke) still appends.
    store.recordAttachment(A, { sma: B, txHash: hex("0x" + "3".repeat(64)) });
    assert.equal(store.find(A)?.attachments?.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureTracked: preserves an existing richer record (does not overwrite deploy metadata)", () => {
  const { store, dir } = tempStore();
  try {
    store.add({
      name: "MyDeployedMandate",
      address: A,
      txHash: hex("0x" + "1".repeat(64)),
      chainId: 130,
      sourcePath: "/abs/mandates/MyDeployedMandate.sol",
      deployedAt: "2026-06-01T00:00:00.000Z",
    });
    // A later register-time ensureTracked with a minimal record must not clobber it.
    store.ensureTracked({
      name: "different-label",
      address: A,
      txHash: hex("0x" + "9".repeat(64)),
      chainId: 130,
      deployedAt: "2026-06-29T00:00:00.000Z",
    });
    const rec = store.find(A);
    assert.equal(rec?.name, "MyDeployedMandate", "existing name preserved");
    assert.equal(rec?.sourcePath, "/abs/mandates/MyDeployedMandate.sol", "sourcePath preserved");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
