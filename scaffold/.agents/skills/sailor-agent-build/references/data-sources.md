# Decision data — where the agent's inputs come from

Guidance by **question**, not by vendor. Two rules run through all of it: prefer permissionless, no-key paths first; and **verify every off-chain answer on-chain before acting on it**. Decision data lives inside the mandate's blast radius — a wrong answer produces a bounded trade or a kernel denial, never a drain.

## Prices — what is X worth right now?

- **On-chain first.** The quoter the project already uses (`sailor-swap-quote` / the venue's QuoterV2) and the mandate's own price oracle are the most trustworthy sources — they are the same numbers the kernel will check against. Use `ctx.publicClient` for arbitrary reads.
- **Breadth:** GeckoTerminal's keyless API covers many chains and DEXes for cross-venue liquidity/price — `sailor-token-resolve` already uses it (precedent).

## Yields — which market pays what?

- DefiLlama's free API is the common choice for an APY/TVL survey across protocols; **any equivalent works** — it is a category, not an endorsement.
- Whatever a survey returns, **verify the specific market on-chain** (the contract exists, exposes the expected interface, the rate is live) before the agent supplies into it.

## Token metadata — address, decimals, is it swap-ready?

Use `sailor-token-resolve`. Never hand-type an address or assume decimals.

## RPC — the endpoint the reads run against

The shipped defaults cover every supported chain (`sailor doctor` validates connectivity and chain-id match). A high-frequency strategy may want a dedicated, higher-rate endpoint. Put it in `.sail/.env.local`; the runner resolves in this order (from `getRpcUrl` in the CLI):

1. `.env.local` named chain var (e.g. `BASE_RPC_URL`)
2. `.env.local` chainId-keyed var (e.g. `RPC_URL_8453`)
3. `.env.local` generic `RPC_URL`
4. shell named chain var, then shell `RPC_URL`

An earlier entry wins. `sailor doctor` re-validates whatever resolves.

## MCP servers — if your coding agent supports them

Data providers increasingly ship MCP servers; if the operator's coding agent supports MCP, that is a convenient way to pull prices/yields/news into the loop. A category pointer only — no vendor endorsement.

## Non-negotiables

- **No API keys in the scaffold, ever.** Permissionless paths first; if a source needs a key, it belongs in the operator's environment, never committed.
- **Categories with examples, never endorsements.** GeckoTerminal and DefiLlama are named as common, keyless options — not as the required or only ones.
- **Verify before acting.** Every off-chain answer is checked on-chain before it drives a dispatch; the mandate bounds the damage of a bad one either way.
