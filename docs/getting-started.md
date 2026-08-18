# Getting started

End-to-end path from nothing to a running, bounded agent — and how to get your money back out. Every command here is copy-pasteable. The agent-driven flow (open the scaffold in your AI coding agent and say **"start"**) walks the same journey conversationally, guided by the `sailor-navigator` skill; this page is the manual version.

> **Prefer a ready-to-run agent?** `npx @sail.money/sailor harbor create index` gives you a working index agent (USDC into a weighted basket, rebalanced across your chains) with onboarding questions instead of the manual journey below.

The journey is five stations, in order: **ARRIVE → STRATEGY → MANDATE → AGENT → SAIL**. The `sailor-navigator` skill is the map (each station names its owning skill, entry gate, and exit check); this page follows the same order with commands.

## Station 1 — ARRIVE: set up the project, keys, account, and chain

**Install and scaffold.** npm (Node.js ≥ 18):

```bash
npx @sail.money/sailor init my-agent && cd my-agent && npm install
```

Or Docker (no Node.js on the host) — then prefix every `sailor` command below with `docker exec agent` (project files are on your host via the volume mount; details in [docker.md](./docker.md)):

```bash
mkdir my-agent && cd my-agent
docker run -d --name agent -P -v "${PWD}:/workspace" sailmoney/sailor
docker exec agent sailor init
```

`sailor init` scaffolds from `scaffold/`: your agent code (`src/`), a Foundry workspace for custom permissions (`contracts/`, with a test), the operator guide (the `sailor-navigator` skill) and the other skills (`.agents/skills/`), your own instructions file (`AGENTS.md`), and the local workspace (`.sail/` — config, encrypted keys, state). You will also need a wallet (MetaMask, Rabby, …), an RPC URL for your chain (put it in `.sail/.env.local` as `RPC_URL=`), and a little gas. `sailor chains` lists the supported chains.

**Keys and owner:**

```bash
sailor keys generate --type agent-wallet   # the manager key the agent signs dispatches with
sailor owner connect                       # opens the browser signing page; connect your wallet
```

The agent key is encrypted on disk (`.sail/keys/`, geth keystore v3) behind a passphrase you choose (or `SAIL_PASSPHRASE` for non-interactive use). Your owner key never leaves your wallet — Sailor records the address and asks your wallet to sign when a step needs owner authority.

**Deploy your SMA:**

```bash
sailor account predict     # optional: see the deterministic Safe address before paying gas
sailor onboard --new-sma   # deploys the SMA (a Safe) and walks the setup
```

The same owner, permission signer, manager, and salt produce the **same SMA address on every supported chain** (`sailor account deploy-chain --chain <id>` reuses it elsewhere).

**Exit check:** `sailor doctor` — green (RPC connected, chain-id matches, keys present, gas funded) means Station 1 is done. Full procedure: [`sailor-onboarding`](../scaffold/.agents/skills/sailor-onboarding/SKILL.md).

## Station 2 — STRATEGY: make the intent concrete

Before any mandate, the strategy becomes a complete, concrete spec — one per strategy, at `.sail/strategies/<name>.md` (camelCase name = the `--strategy` selector) — chains, tokens (resolved addresses + decimals), venues, amounts, caps, cadence, risk bounds, and an exit condition, all concrete. There is no CLI command for the spec itself; it is a guided conversation. The [`sailor-strategy`](../scaffold/.agents/skills/sailor-strategy/SKILL.md) skill runs it (categories: Trading, Yield, Payments & treasury, or anything else on-chain) and writes the spec. Station 2 also registers the **execution config** — `.sail/strategies/strategies.json` — binding the executable to the SMA:

```bash
sailor strategy create <name> --sma <yourSMA> [--chains <ids>] --description "…"
sailor strategy env set <chain> KEY=value   # per-chain env the executable reads via ctx.env, if any
```

Before Station 3, present each resolved address, pool, and cap to the user for review and persist the approved values in `.sail/strategies/<name>.md`. Every later station reads these. **Exit check:** each strategy's `.sail/strategies/<name>.md` exists with every dimension concrete and user-reviewed values persisted, AND `.sail/strategies/strategies.json` registered via `sailor strategy create`.

## Station 3 — MANDATE: turn the strategy into enforced bounds

A mandate is one or more onchain permission contracts registered on your SMA. The fastest path is a **shared permission singleton** — deployed on every supported chain (swap, swap-no-oracle, transfer, deposit, withdraw, borrow, approve-and-call-batch). You **register** it, then **configure** your bounds:

```bash
# Register (owner signs an EIP-712 RegisterPermission in the browser):
sailor mandate register --address <singleton> --sma <yourSMA>

# Configure your bounds (tokens, caps, venues) for that template:
sailor mandate configure --address <singleton> --sma <yourSMA> \
  --template SwapPermission --args-file swap-config.json
```

A registered-but-unconfigured singleton denies every call — always do both. To change bounds later, re-run `configure --force` (same address, no re-register); `mandate update` changes only tracked metadata (name/paths), not bounds. The [`sailor-templates`](../scaffold/.agents/skills/sailor-templates/SKILL.md) hub and its per-template references carry the exact parameter schema and safe order of operations. For a policy no template expresses, author an `IPermission` in `contracts/` and `sailor mandate deploy --contract <Name> --register --sma <yourSMA>` — see [`sailor-mandates`](../scaffold/.agents/skills/sailor-mandates/SKILL.md).

**Prove the bounds before authorizing** — off-chain `eth_call`, no gas, no signatures:

```bash
sailor mandate simulate --address <permission> --sma <yourSMA> \
  --target <contract> --calldata 0x... --expect pass    # a call your mandate allows
sailor mandate simulate --address <permission> --sma <yourSMA> \
  --target <otherContract> --calldata 0x... --expect fail # a call outside it
```

Verdicts are `PASS` / `FAIL` / `REVERT`; `--expect` makes a mismatch exit non-zero. **Exit check:** every permission registered and configured, with simulate passing the must-pass cases and rejecting the must-fail cases. (Order is always deploy → simulate → register for bespoke; register → configure → simulate for shared templates.) [`sailor-mandate-planner`](../scaffold/.agents/skills/sailor-mandate-planner/SKILL.md) routes each action of the spec to a template or bespoke.

**Optional: rehearse it first.** [Shipyard](./shipyard.md) forks the real chains onto your own machine with fake money, so you can take the whole journey (deploy, register, configure, run) without spending anything. It needs Foundry, and it keeps its own state entirely separate from `.sail/`. Start it with `sailor sandbox start`.

## Station 4 — AGENT: build the tick loop

The agent's decision logic lives in `src/agent.ts` — a `tick()` that reads state, decides, and returns dispatches within the mandate's bounds. The [`sailor-agent-build`](../scaffold/.agents/skills/sailor-agent-build/SKILL.md) skill carries the canonical, typecheck-verified skeleton (read → decide → act) to adapt. Then:

```bash
sailor run --once   # single tick — the Station 4 exit check
sailor run          # the continuous loop
```

Every planned call is resolved against the registered permissions first; a call nothing authorizes is **skipped** (`skipped: no registered permission authorizes call to <target>`) and recorded in `.sail/activity.jsonl` as `dispatch_denied` — a denial is the system working, not an error. **Exit check:** `sailor run --once` completes cleanly.

## Station 5 — SAIL: launch, operate, and exit

**Launch unattended** — pick a host by timing and infra ([`sailor-automation`](../scaffold/.agents/skills/sailor-automation/SKILL.md)): `sailor service install` (local launchd/systemd/Task Scheduler), the scaffold's GitHub Actions cron (`sailor trigger github` fires it on demand), or Docker on a VM.

**Operate** ([`sailor-operate`](../scaffold/.agents/skills/sailor-operate/SKILL.md)) — watch it in the dashboard (`sailor ui start`) or by tailing `.sail/activity.jsonl`; `sailor status` / `sailor doctor` confirm state. Tune bounds with `configure --force`. Two independent brakes, neither touching Safe custody:

```bash
sailor session pause                       # on-chain: revoke the manager's dispatch rights (reversible: resume)
sailor mandate revoke --address <perm>     # remove one permission (owner-signed)
sailor mandate revoke --all                # remove every permission
```

**Get your money out.** The SMA is a Safe you control directly: `sailor ui start` → the dashboard's Open-in-Safe link (chain-aware) opens `app.safe.global` for your account, where you move funds with your own wallet signature — this works regardless of agent, mandate, or session state. Two permissions cover the agent-mediated route, and they do different jobs: a withdraw permission exits a vault or lending position back into the SMA, and a transfer permission moves tokens the SMA holds out to a recipient you pinned. Getting funds all the way from a position to your own address needs both. Full shutdown: pause → withdraw → revoke.

---

Feedback: something unclear or broken on this page? [Open an issue](https://github.com/sail-money/Sailor/issues).
