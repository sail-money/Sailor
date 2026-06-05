# @sail.money/sdk

> **Pre-1.0 — unstable.** The Sail Protocol trusted core is under an ongoing
> external audit by [Octane Security](https://octane.security). The API may
> change between releases while the protocol is in audit. Do not use staging
> deployments with funds you are not prepared to lose.

TypeScript SDK for Sail Protocol — the on-chain SMA (Separately Managed
Account) infrastructure. Peer-depends on `viem ^2`.

## Install

```sh
npm install @sail.money/sdk viem
```

## Key exports

| Export | What it does |
|---|---|
| `SailorClient` | Full client: account, mandate, dispatch, session, fees |
| `buildDispatchSignature` | Self-detecting EIP-712 Dispatch signer (reads on-chain model; no footguns) |
| `detectKernelCapabilities` | Reads `DISPATCH_TYPEHASH` on-chain; identifies conjunctive vs selective kernel |
| `sailKernelDomain` | EIP-712 domain for any SailKernel |
| `DISPATCH_EIP712_FIELDS` | Typed struct field lists keyed by dispatch model |
| `LocalKeyring` | Encrypted manager key (geth keystore v3) |
| `sailDeployments` | Live staging addresses (Base, Base Sepolia, Arbitrum) |
| `SailIntelligence` | Typed client for the Sail Intelligence API |

## Dispatch signing

```ts
import { buildDispatchSignature, LocalKeyring } from "@sail.money/sdk";
import { createPublicClient, http } from "viem";

const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
const manager = await LocalKeyring.load("path/to/manager.json", passphrase);

const { signature, nonce, deadline, dispatchModel } = await buildDispatchSignature({
  publicClient,
  kernel: "0x6319d3dfDDe3804ba93D65752b00c52bFb05a1ab", // Base
  chainId: 8453,
  account: mySafe,
  permission: myPermission,
  call: { target: router, value: 0n, data: swapCalldata },
  manager,
});
// Submit: kernel.dispatch(account, permission, target, value, data, signature, deadline)
```

`buildDispatchSignature` reads the kernel's on-chain `DISPATCH_TYPEHASH` to
select the correct struct automatically — you cannot pass the wrong model.

## Full client

```ts
import { SailorClient } from "@sail.money/sdk";

const client = new SailorClient({ rpcUrl: "https://...", chainId: 8453 });
// Read-only operations (no signer required):
const caps = await client.capabilities();
// State-changing operations require a signer:
const exec = client.withSigner(walletClient);
await exec.dispatch.single(safe, permission, call, manager);
```
