# @sail/sdk

TypeScript SDK for Sailor — the operator toolkit for Sail Protocol.

Exports `SailorClient`, all domain types, `LocalKeyring`, and shared permission template
encoders/explainers. Peer-depends on `viem ^2`.

All chain-touching methods currently throw `Error("not implemented")` — the typed surface
exists for review. Real implementations land in the next phase.

```ts
import { SailorClient } from "@sail/sdk";
const client = new SailorClient({ rpcUrl: "...", chainId: 8453 });
```
