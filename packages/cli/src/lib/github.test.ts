import assert from "node:assert/strict";
import { test } from "node:test";
import { createRelease, parseReleaseRef } from "./github.js";

// Run with: npx tsx --test packages/cli/src/lib/github.test.ts

test("parseReleaseRef accepts owner/repo@tag shorthand", () => {
  assert.deepEqual(parseReleaseRef("sail-money/harbor@dca-rebalancer-v3"), {
    repo: "sail-money/harbor",
    tag: "dca-rebalancer-v3",
  });
});

test("parseReleaseRef accepts a release page URL", () => {
  assert.deepEqual(
    parseReleaseRef("https://github.com/sail-money/harbor/releases/tag/dca-rebalancer"),
    { repo: "sail-money/harbor", tag: "dca-rebalancer" },
  );
});

test("parseReleaseRef accepts an asset download URL and captures the filename", () => {
  assert.deepEqual(
    parseReleaseRef(
      "https://github.com/sail-money/harbor/releases/download/dca-rebalancer/dca-rebalancer.tar.gz",
    ),
    { repo: "sail-money/harbor", tag: "dca-rebalancer", asset: "dca-rebalancer.tar.gz" },
  );
});

test("parseReleaseRef decodes url-encoded tag/asset", () => {
  const r = parseReleaseRef("https://github.com/o/r/releases/tag/v1%2E0%20beta");
  assert.equal(r.repo, "o/r");
  assert.equal(r.tag, "v1.0 beta");
});

test("parseReleaseRef throws on an unrecognizable ref", () => {
  assert.throws(() => parseReleaseRef("not a release ref"), /Could not parse/);
});

// ── createRelease asset-upload host ────────────────────────────────────────────

/** Recorded fetch calls: { url, method }. */
interface FetchCall {
  url: string;
  method?: string;
}

function stubFetch(handler: (call: FetchCall) => Response): () => void {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
    const call: FetchCall = { url: String(input), method: init?.method };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("createRelease uploads the asset to uploads.github.com, not api.github.com", async () => {
  const prevToken = process.env.SAIL_GH_TOKEN;
  process.env.SAIL_GH_TOKEN = "test-token";
  const uploadUrls: string[] = [];
  const restore = stubFetch((call) => {
    if (call.method === "POST" && call.url === "https://api.github.com/repos/sail-money/harbor/releases") {
      return new Response(
        JSON.stringify({
          id: 378526181,
          html_url: "https://github.com/sail-money/harbor/releases/tag/dca-v1",
          upload_url:
            "https://uploads.github.com/repos/sail-money/harbor/releases/378526181/assets{?name,label}",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }
    if (call.method === "POST" && call.url.startsWith("https://uploads.github.com/")) {
      uploadUrls.push(call.url);
      return new Response("", { status: 201 });
    }
    return new Response("", { status: 404 });
  });

  try {
    await createRelease("sail-money/harbor", {
      tag: "dca-v1",
      name: "DCA",
      body: "summary",
      assetName: "dca.tar.gz",
      assetBytes: new Uint8Array([1, 2, 3]),
    });

    assert.equal(uploadUrls.length, 1);
    assert.match(uploadUrls[0], /^https:\/\/uploads\.github\.com\//);
    assert.match(uploadUrls[0], /\?name=dca\.tar\.gz$/);
    assert.ok(!uploadUrls[0].includes("api.github.com"));
  } finally {
    restore();
    if (prevToken === undefined) delete process.env.SAIL_GH_TOKEN;
    else process.env.SAIL_GH_TOKEN = prevToken;
  }
});

test("createRelease retries a transient 404 on the asset upload", async () => {
  const prevToken = process.env.SAIL_GH_TOKEN;
  process.env.SAIL_GH_TOKEN = "test-token";
  let uploadAttempts = 0;
  const restore = stubFetch((call) => {
    if (call.method === "POST" && call.url === "https://api.github.com/repos/sail-money/harbor/releases") {
      return new Response(
        JSON.stringify({
          id: 1,
          html_url: "https://github.com/sail-money/harbor/releases/tag/dca-v1",
          upload_url:
            "https://uploads.github.com/repos/sail-money/harbor/releases/1/assets{?name,label}",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }
    if (call.method === "POST" && call.url.startsWith("https://uploads.github.com/")) {
      uploadAttempts += 1;
      return uploadAttempts === 1
        ? new Response("", { status: 404 })
        : new Response("", { status: 201 });
    }
    return new Response("", { status: 404 });
  });

  try {
    await createRelease("sail-money/harbor", {
      tag: "dca-v1",
      assetName: "dca.tar.gz",
      assetBytes: new Uint8Array([1]),
    });
    assert.equal(uploadAttempts, 2);
  } finally {
    restore();
    if (prevToken === undefined) delete process.env.SAIL_GH_TOKEN;
    else process.env.SAIL_GH_TOKEN = prevToken;
  }
});

test("createRelease surfaces a hard upload failure without retrying", async () => {
  const prevToken = process.env.SAIL_GH_TOKEN;
  process.env.SAIL_GH_TOKEN = "test-token";
  let uploadAttempts = 0;
  const restore = stubFetch((call) => {
    if (call.method === "POST" && call.url === "https://api.github.com/repos/sail-money/harbor/releases") {
      return new Response(
        JSON.stringify({
          id: 1,
          html_url: "https://github.com/sail-money/harbor/releases/tag/dca-v1",
          upload_url:
            "https://uploads.github.com/repos/sail-money/harbor/releases/1/assets{?name,label}",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }
    if (call.method === "POST" && call.url.startsWith("https://uploads.github.com/")) {
      uploadAttempts += 1;
      return new Response("", { status: 422 });
    }
    return new Response("", { status: 404 });
  });

  try {
    await assert.rejects(
      createRelease("sail-money/harbor", {
        tag: "dca-v1",
        assetName: "dca.tar.gz",
        assetBytes: new Uint8Array([1]),
      }),
      /GitHub returned 422 while uploading asset/,
    );
    assert.equal(uploadAttempts, 1);
  } finally {
    restore();
    if (prevToken === undefined) delete process.env.SAIL_GH_TOKEN;
    else process.env.SAIL_GH_TOKEN = prevToken;
  }
});
