# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** to **hello@sail.money**. Do not open a
public issue or pull request for a security report, and do not disclose the issue publicly until
it has been addressed.

We will acknowledge reports on a best-effort basis and work with you on coordinated disclosure.
We do not commit to a fixed response timeline.

## Scope

Sailor is **off-chain tooling**. In scope here:

- The **SDK** (`packages/sdk`) — key management (`LocalKeyring`), EIP-712 signing and dispatch
  submission, the deployment registry.
- The **CLI** (`packages/cli`) — key handling, mandate signing flows, the agent runner, the
  signing station.
- The **local dashboard** (`packages/ui`) and its local server.
- The **scaffold template** (`templates/default/`) — anything a generated project executes or an
  agent is instructed to do.

Out of scope here — **smart-contract vulnerabilities**: `SailKernel`, `SailGovernance`,
`MandateFactory`, the shared permission templates, and anything else deployed on-chain belong to
the protocol repository's process — see the
[Sail Protocol Security Policy](https://github.com/sail-money/protocol/blob/main/SECURITY.md)
(same private contact: **hello@sail.money**).

Also out of scope: the correctness of **user-authored permission contracts and strategies**. The
kernel evaluates whatever contract you deploy; its policy logic is the author's responsibility.

## Handling expectations

Sailor handles encrypted keys (`.sail/keys/`), signs EIP-712 payloads, and submits transactions.
Reports touching key material, signing prompts, transaction construction, or anything that could
move funds outside a mandate's bounds are treated with the highest priority.

## Bug bounty

There is no formal bug-bounty program at this time. We still welcome reports and will credit
reporters who wish to be acknowledged.
