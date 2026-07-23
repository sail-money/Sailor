import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_REGISTER_DEADLINE_SEC,
  REGISTER_SIGN_WAIT_SEC,
  assertSignatureFresh,
  registrationDeadline,
} from "./registration.js";

// Run with: npx tsx --test packages/cli/src/lib/registration.test.ts
// (requires `pnpm --filter @sail/sdk build` first so @sail/sdk resolves.)

// ── S5: deadline window outlasts the signing wait ────────────────────────────

test("registrationDeadline: default window comfortably exceeds the signing wait", () => {
  const now = Math.floor(Date.now() / 1000);
  const d = Number(registrationDeadline());
  // The old bug: deadline == sign wait (300s) → zero headroom → guaranteed
  // revert on a slow sign. The window must clear the full sign wait plus buffer.
  assert.ok(d - now > REGISTER_SIGN_WAIT_SEC, "deadline must outlast the 600s signing wait");
  assert.ok(d - now >= DEFAULT_REGISTER_DEADLINE_SEC - 2, "≈ default window ahead of now");
});

test("registrationDeadline: honors an explicit window override", () => {
  const now = Math.floor(Date.now() / 1000);
  const d = Number(registrationDeadline(1200));
  assert.ok(Math.abs(d - now - 1200) <= 2);
});

test("registrationDeadline: bad window falls back to the default", () => {
  const now = Math.floor(Date.now() / 1000);
  const d = Number(registrationDeadline(-5));
  assert.ok(Math.abs(d - now - DEFAULT_REGISTER_DEADLINE_SEC) <= 2);
});

// ── S5: submit-time staleness guard ──────────────────────────────────────────

test("assertSignatureFresh: passes for a fresh, comfortably-ahead deadline", () => {
  assert.doesNotThrow(() => assertSignatureFresh(registrationDeadline(), "re-run"));
});

test("assertSignatureFresh: throws a clear, no-gas-spent error when the deadline has passed", () => {
  const past = BigInt(Math.floor(Date.now() / 1000) - 10);
  assert.throws(
    () => assertSignatureFresh(past, "Re-run sailor mandate attach ... to sign again."),
    (err: Error) => {
      assert.match(err.message, /deadline expired before submission/i);
      assert.match(err.message, /NOT submitted/i); // no gas wasted
      assert.match(err.message, /sign again/i); // actionable
      return true;
    },
  );
});

test("assertSignatureFresh: throws when within the min submit headroom (about to lapse)", () => {
  // 5s of headroom is below REGISTER_MIN_SUBMIT_HEADROOM_SEC (30s) → treat as stale.
  const almost = BigInt(Math.floor(Date.now() / 1000) + 5);
  assert.throws(() => assertSignatureFresh(almost, "re-run"));
});
