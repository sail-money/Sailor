import assert from "node:assert/strict";
import test from "node:test";
import { nextRelease } from "./next-release.mjs";
test("first release", () => assert.equal(nextRelease("new-agent", []), 1));
test("unrelated tags", () => assert.equal(nextRelease("new-agent", ["portfolio-v22"]), 1));
test("gaps and unordered tags", () => assert.equal(nextRelease("portfolio", ["portfolio-v2", "portfolio-v22", "portfolio-v4"]), 23));
test("invalid slug", () => assert.throws(() => nextRelease("../bad", [])));
