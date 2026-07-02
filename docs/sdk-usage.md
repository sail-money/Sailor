# SDK usage

The SDK is available two ways:

- **Inside a Sailor project**: `@sail.money/sailor` ships it at the `@sail.money/sailor/sdk`
  subpath — this is what scaffolded agent code imports and is injected as a devDependency by
  `sailor init`.
- **Standalone**: [`@sail.money/sdk`](https://www.npmjs.com/package/@sail.money/sdk) — the same
  library with granular subpath exports, for integrations that don't need the CLI. Pre-1.0; the
  API may change between releases.

> **viem is required.** The SDK declares `viem` as a peer dependency — install it yourself
> (`npm i viem`). If it's missing, imports fail at runtime with `ERR_MODULE_NOT_FOUND` for
> `viem`, which is the symptom to look for.

## SailorClient basics

```ts
import { SailorClient, LocalKeyring, getSailDeployment } from "@sail.money/sailor/sdk";

const chainId = 8453; // Base
const { kernel } = getSailDeployment(chainId);
const client = new SailorClient({ chainId, rpcUrl: process.env.RPC_URL!, kernel });

// Read-only: what does this kernel support?
const caps = await client.capabilities();

// The agent's encrypted signing key (geth keystore v3 on disk)
const manager = await LocalKeyring.fromKeystoreFile(".sail/keys/manager.json", process.env.SAIL_PASSPHRASE!);

// Dispatch one bounded call: the manager names ONE registered permission,
// and the kernel consults exactly that permission before executing.
await client.dispatch.single(safeAddress, permissionAddress, {
  target, value: 0n, data,
}, manager);
```

Namespaces on the client: `client.account` (SMA creation and reads), `client.mandate`
(registration, configuration, revocation flows), `client.dispatch` (single + batch dispatch,
preview), `client.strategy` (higher-level recipes, e.g. delegated swaps), `client.session`
(pause/resume), `client.fees`, `client.principal`. The doc-drift gate keeps method references in
these docs honest against the source.

## Subpath exports (standalone `@sail.money/sdk`)

| Import | What it gives you |
|---|---|
| `@sail.money/sdk` | `SailorClient`, `LocalKeyring`, capabilities/discovery/fee helpers, error decoding, core types |
| `@sail.money/sdk/templates` | Typed config encoders for shared templates — e.g. `boundedSwapTemplate`, `boundedBorrowTemplate`, `transferTargetTemplate` and their param types |
| `@sail.money/sdk/safe` | Safe (SMA) helpers |
| `@sail.money/sdk/eip712` | EIP-712 typed-data builders — dispatch, register/revoke, and the version-adaptive `buildConfigureTypedData` (detects the deployed template's schema via ERC-5267 and signs v1 or the epoch-bound v2 accordingly) |
| `@sail.money/sdk/deployments` | `getSailDeployment(chainId)` — kernel, governance, factory, shared-template addresses per chain |
| `@sail.money/sdk/chains` | The chain registry: ids, names, RPC env-var conventions |
| `@sail.money/sdk/abis` | `SailKernelAbi`, `MandateFactoryAbi`, `SailGovernanceAbi` |

Quick examples:

```ts
// deployments: everything the SDK knows about a chain
import { getSailDeployment } from "@sail.money/sdk/deployments";
const dep = getSailDeployment(42161); // kernel, governance, knownTemplates, ...

// abis + viem: read the kernel directly
import { SailKernelAbi } from "@sail.money/sdk/abis";
import { createPublicClient, http } from "viem";
const pc = createPublicClient({ transport: http(process.env.RPC_URL!) });
const cap = await pc.readContract({ address: dep.kernel, abi: SailKernelAbi, functionName: "PERMISSION_GAS_CAP" });

// templates: encode a SwapPermission config blob for mandate configuration
import { boundedSwapTemplate } from "@sail.money/sdk/templates";

// eip712: build the Configure typed data against whatever schema is deployed
import { buildConfigureTypedData } from "@sail.money/sdk/eip712";

// chains: enumerate supported networks
import { chains, getChain } from "@sail.money/sdk/chains";
```

Inside a Sailor project, the same symbols come from the single `@sail.money/sailor/sdk` entry
point rather than per-subpath imports.

---

Feedback: an export missing from this page, or an example that doesn't run? [Open an issue](https://github.com/sail-money/Sailor/issues).
