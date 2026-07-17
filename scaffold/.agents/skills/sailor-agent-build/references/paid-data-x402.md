# Paid decision data — the x402 pattern

`AgentContext.data` names "an x402 first-party API" as an intended plug-in
(`packages/sdk/src/types.ts`). This reference shows the complete pattern: an
agent paying a metered HTTP API per-call with USDC during `tick()`, using only
primitives Sailor already ships. **No SDK change is required** — the manager
keyring's `signTyped` plus `fetch` are sufficient.

The motivating use case: a bounded operational wallet buying fresh external
data during `tick()` **when that data changes a dispatch/risk/routing
decision**. If the answer doesn't change what the agent does next, don't pay
for it.

## The trust model — read this before the code

- **The payer is the manager key's own funds, never SMA custody.** x402
  payments are off-chain EIP-3009 authorizations signed by the manager key and
  drawn from USDC held *at the manager address*. The SMA's mandate kernel
  never sees them: they are not dispatches, and `IPermission.evaluate()` does
  not gate them.
- Because these spends live **outside mandate enforcement**, the spending
  bound is the manager wallet's balance. Keep only an operational float there
  (a few dollars of USDC) — a bound enforced by physics, not policy. Typical
  paid data calls price at $0.001–$0.05.
- Payments are gasless for the buyer: the signed authorization is settled
  on-chain by the seller's facilitator. The manager address needs USDC but no
  ETH for this.

## How a paid call works

1. `fetch` the resource. A paid endpoint answers `402 Payment Required` with a
   JSON body listing payment options (`accepts`), each naming a scheme, chain,
   asset, price, and payee.
2. Pick an option the agent can pay — here: scheme `exact`, USDC on the
   tick's chain.
3. Sign an EIP-3009 `TransferWithAuthorization` for exactly the quoted amount
   with `ctx.manager.signTyped` (off-chain, no gas).
4. Retry the request with the signed payment in a header. The seller verifies,
   settles on-chain, and answers `200` with the data plus a settlement receipt
   header (`PAYMENT-RESPONSE`, base64 JSON with the settling transaction).

## Worked example

```ts
import { getAddress, toHex } from "viem";
import type { AgentContext } from "@sail.money/sailor/sdk";

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

/**
 * Fetch an x402-priced resource, paying from the manager key's own USDC.
 * `maxPrice` is in the asset's smallest unit (USDC has 6 decimals, so the
 * default 50_000n = $0.05) — a per-call ceiling on top of the wallet-balance
 * bound.
 */
async function fetchPaid(ctx: AgentContext, url: string, maxPrice = 50_000n) {
  const first = await fetch(url);
  if (first.status !== 402) return first; // free (or cached) — nothing to pay
  const paymentRequired = await first.json();

  const req = paymentRequired.accepts.find(
    (a: any) => a.scheme === "exact" && a.network === `eip155:${ctx.chainId}`,
  );
  if (!req) throw new Error(`no exact/eip155:${ctx.chainId} payment option`);
  if (BigInt(req.amount) > maxPrice)
    throw new Error(`quoted ${req.amount} exceeds per-call cap ${maxPrice}`);

  const authorization = {
    from: ctx.manager.address,
    to: getAddress(req.payTo),
    value: req.amount,
    validAfter: "0",
    validBefore: String(ctx.timestamp + req.maxTimeoutSeconds),
    nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
  };
  const signature = await ctx.manager.signTyped(
    {
      name: req.extra.name,
      version: req.extra.version,
      chainId: ctx.chainId,
      verifyingContract: getAddress(req.asset),
    },
    { primaryType: "TransferWithAuthorization", types: EIP3009_TYPES },
    {
      ...authorization,
      value: BigInt(req.amount),
      validAfter: 0n,
      validBefore: BigInt(authorization.validBefore),
    },
  );

  const paymentPayload = {
    x402Version: 2,
    payload: { authorization, signature },
    extensions: {},
    resource: paymentRequired.resource,
    accepted: req,
  };
  return fetch(url, {
    headers: {
      "PAYMENT-SIGNATURE": Buffer.from(
        JSON.stringify(paymentPayload),
      ).toString("base64"),
    },
  });
}
```

Inside `tick()`:

```ts
const res = await fetchPaid(ctx, process.env.YIELD_FEED_URL!);
const survey = await res.json();
ctx.data.yieldSurvey = survey;
// As with every off-chain answer: verify the specific market on-chain
// (contract exists, interface matches, rate is live) before dispatching.
// See data-sources.md.
```

## Where paid endpoints come from

- **Self-host one to test against.** The open-source x402 middleware
  (github.com/coinbase/x402) turns any HTTP handler into a 402-speaking seller
  in a few lines; run it locally and point `fetchPaid` at it. The example
  above is protocol-generic — it works against any conformant seller.
- **Registries list live resources by category** — crypto/financial data,
  search, web automation, document transforms, geo/weather — e.g. the x402
  Bazaar and x402scan. As everywhere in these docs: categories with examples,
  never endorsements. Prefer sellers whose answers you can verify on-chain.

## Non-negotiables

- **Never fund the manager address beyond an operational float.** It is the
  blast radius for this pattern.
- **Never pay from SMA custody.** The mandate kernel cannot see or bound
  x402 spends; only the manager's own wallet may make them.
- **Verify before acting.** A paid answer is still an off-chain answer — check
  it on-chain before it drives a dispatch, and let the mandate bound the
  damage of a bad one either way.
- **No endpoint URLs or API keys in the scaffold, ever.** Paid endpoints are
  operator configuration (`.sail/.env.local`), same as RPC overrides.
