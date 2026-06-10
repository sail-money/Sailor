# @sail.money/chains

Per-chain SailKernel deployment addresses for Sailor.

Exports a `chains` map keyed by `chainId` (kernel, mandate factory, and governance addresses per
chain) and `getChain(chainId)`, which returns the config for a chain or throws if it isn't
supported yet. Sail Protocol is EVM-compatible — add a chain here once `SailKernel` is deployed
there and its addresses are verified.
