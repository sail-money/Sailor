# Portfolio

A self-custodied agent that holds a weighted basket of tokens and tokenized stocks, invests every
deposit, and keeps the basket rebalanced across the chains its assets live on, inside on-chain
permissions only the owner controls. Built on [Sailor](https://github.com/sail-money/Sailor) and
Sail Protocol; published in the [harbor](https://github.com/sail-money/harbor) registry as
`portfolio`.

You name the basket and the weights. The agent derives the chains from where each asset has
liquidity, computes one funding instruction, and does the plumbing: swaps, bridges, mints,
rebalances, reports.

## Start in Claude Code or Codex

Use **Node.js 22+**. Run this in your terminal, or ask your coding agent to run it. No repository clone or global Sailor installation is needed.

```bash
npx @sail.money/sailor@latest harbor create portfolio my-portfolio --no-agent
```

Accept the npm installation prompt and review the blueprint import when prompted. Use a new folder name if the destination already exists. Sailor downloads the blueprint, verifies it, installs dependencies, and checks the project. `--no-agent` stops it from launching a second coding-agent session.

**Next:** open the generated folder in Claude Code or Codex, then send:

> Read AGENTS.md and guide me through setting up this portfolio agent.

The coding agent helps you install Foundry, configure an RPC endpoint for each required chain, connect your owner wallet, confirm the strategy, and sign its permissions. It explains gas and registration costs before you fund or sign. Creating the project does not start trading.

### Launch a coding agent from a standalone terminal

If you want Sailor to launch the coding-agent CLI for you, omit `--no-agent`. The selected CLI must already be installed and on your PATH. For example:

```bash
# Codex
npx @sail.money/sailor@latest harbor create portfolio my-portfolio

# Or Claude Code (choose this instead)
npx @sail.money/sailor@latest harbor create portfolio my-portfolio --agent claude
```

- [Your portfolio](#your-portfolio)
- [Your thesis](#your-thesis)
- [How the agent works](#how-the-agent-works)
- [Run it](#run-it)
- [Operating it](#operating-it)
- [What can go wrong](#what-can-go-wrong)
- [Repository layout](#repository-layout)

---

## Your portfolio

Onboarding writes the basket you confirm to `basket.json` (a themed blueprint may ship one; this
generic template does not) and fills this table. Until then it is the template.

| Vertical | Asset | Target | Chain | Why this one |
|---|---|---|---|---|
| _e.g. Exchange_ | _HYPE_ | _25%_ | _Base_ | _one line_ |
| | | | | |

Weights are global targets that sum to 100%; the chain is wherever the asset's deepest liquidity
lives. A holding more than the band (default ±10 percentage points) over its target is trimmed on
every run by default (set `rebalancePeriodSec` in `.sail/portfolio.json` for a slower cadence, such
as weekly); anything under target is bought with idle USDC on every run.

## Your thesis

Write down why you hold what you hold. The useful shape, borrowed from how index providers reason
about crypto as an asset class, is four questions per position: how big is the market it serves, is
it winning share, does the token capture the cash flow, and what multiple does that cash flow trade
at. Add what would change your mind. The agent never reads this section; you will, the day a
position is down 40%.

For a worked example, see the [Onchain Finance Portfolio](https://github.com/aadopii/onchain-finance-portfolio),
the first portfolio built with this blueprint.

---

## How the agent works

### The custody model

Your assets live in a Safe (the SMA) that only you own, deployed at the same address on every chain
the basket needs. The agent holds a separate manager key that can only act through the Sail kernel,
and the kernel executes a call only if one of the permissions you registered says yes. The agent's
code can change without your signature; the permissions cannot.

| Permission | What it allows | What it refuses |
|---|---|---|
| `ExactInputSwapPermission` | Uniswap V3 and Aerodrome swaps, settlement currency in and basket tokens out, or the reverse, with the Safe as recipient, up to a per-buy cap, canonical ABI offsets and exact length | Any other router, token, recipient or selector; zero min-out; native value |
| `BoundedErc20Approve` | `approve()` on the settlement currency and basket tokens to the routers and the CCTP messenger, with an optional per-token cap | Any other spender, token or function |
| `CctpBridgePermission` | `depositForBurn` of USDC, up to a per-transaction cap, to the allowlisted chains, mint recipient pinned to the Safe's own address; `receiveMessage` to complete a mint | Any other token, destination or recipient |
| `AcrossBridgePermission` | `depositV3` on an Across SpokePool for chains CCTP does not reach (Robinhood Chain, in USDG): depositor and recipient pinned to the Safe, both tokens and the destination fixed, per-transaction cap, output floor, fresh quote, bounded deadline, empty message | Any other token, chain, recipient, relayer exclusivity, or any cross-chain message |

There is no registered path by which the manager key can move value to any address other than the
Safe itself. The residual risk is a bad fill: the on-chain min-out is a dust guard; the slippage
floor is computed by the agent from a live quote. Source and Foundry tests are in
[`contracts/`](contracts/).

### One tick

Every run is a sequence of ticks. A tick reads the world and emits at most one round of
transactions; the runner executes them and records the outcome.

1. **Reconcile.** Pending intents from the previous tick (buys, sells, bridge burns) are confirmed
   from the runner's outcome or marked failed. Nothing is recorded as done before the chain says so.
2. **Complete bridges.** For every confirmed CCTP burn, fetch Circle's attestation; wait while it is
   pending; record the mint once the destination transmitter reports the nonce as used; otherwise
   emit `receiveMessage`. For every confirmed Across deposit, record the arrival only after the fill
   transaction is verified on the destination SpokePool; an expired deposit is recorded as refunded.
3. **Value.** Idle settlement currency on every chain, every holding quoted through its own pool,
   and USDC still in flight across a bridge, all in one base.
4. **Trim.** Sell the excess of any holding more than the band over target — on every run by
   default, or on the `rebalancePeriodSec` cadence when one is set. A holding whose pool gives no
   quote pauses every trim and buy for that run (its value is unknown, not zero) and is reported
   as unpriced.
5. **Buy toward target**, in basket order, sized to `min(shortfall, cash)` against a shared per-chain
   budget. Shortfalls on a chain with no cash reserve their share and are pooled into one bridge
   per source and destination: CCTP between USDC chains, Across to chains that settle in USDG.
6. **Report.** Write the snapshot the dashboard reads and, on cadence, send the Telegram report,
   which splits the period's change into what you deposited or withdrew and what the market did.

### Why it runs until settled

A rebalance that crosses chains is four rounds with Circle's attestation in the middle. The
scheduled entry point, [`scripts/run-until-settled.sh`](scripts/run-until-settled.sh), ticks every
90 seconds until [`scripts/settled.mjs`](scripts/settled.mjs) reports nothing in flight, and gives
up after 90 minutes so the next run resumes from the ledger. One daily run leaves the portfolio
ready.

### The ledger

`.sail/memory/ledger.jsonl` is the agent's memory across runs: intents, confirmations, bridges,
mints, cost basis, report baselines. Append-only, reconciled against the runner's activity log.

---

## Run it

Start with the [Claude Code or Codex quickstart](#start-in-claude-code-or-codex) above. Continue in the generated project folder.

Onboarding walks five stations: create the Safe and choose its chains; name the basket and confirm
weights, band and report cadence (written to `basket.json`, from which `.sail/portfolio.json` is
derived); deploy, simulate and register the permissions on each chain; confirm the runtime and its
tests (`npm test`, `forge test` in `contracts/`); fund the agent wallet with gas, deposit the
settlement currency to your Safe, and run:

```bash
npm run settle
```

### Scheduling

```bash
sailor service install --interval 86400
```

or any launchd, cron or GitHub Actions entry that runs `scripts/run-until-settled.sh` daily. On
macOS keep the project outside `~/Desktop` and `~/Documents`, or launchd cannot read it.

### Dashboards and reports

```bash
npm run dashboard:start    # http://localhost:4123  value, amounts, weights, targets
sailor ui start            # the Sailor dashboard: mandate, signing requests, activity
```

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.sail/.env.local` for the periodic report.

---

## Operating it

**Deposit.** Send the settlement currency to your Safe on the funding chain; the next run invests it.

**Change the weights.** Edit `basket.json`, regenerate `.sail/portfolio.json` from it (the
`sailor-portfolio` skill does this), keep the weights summing to 1.0, and run `npm run settle`.
Adding a token outside the swap permission's allowlist means redeploying that permission.

**Exit.** Every swap permission authorises the reverse leg; selling a holding to the settlement
currency is inside the mandate. Withdrawing is an owner action on the Safe.

**Revoke.** `sailor mandate revoke --address <permission> --sma <safe>`. With all permissions gone
the agent can do nothing, and your assets are still in your Safe.

**Check state.** `sailor status`, `sailor doctor`, `node scripts/settled.mjs`.

---

## What can go wrong

- **A thin pool.** The agent quotes before every swap and refuses fills worse than the slippage
  floor, but a large rebalance can move a small pool. Size deposits accordingly.
- **A slow attestation.** Circle can take up to an hour. The settle run waits 90 minutes, then
  hands over to the next run; money in flight is counted in total value throughout.
- **Gas.** The manager wallet pays gas and registration fees on every chain. `sailor doctor` flags
  it when low; an empty wallet stalls a leg, never loses funds.
- **A reverted swap.** Recorded as failed, never as bought; retried next tick within the configured
  slippage maximum.
- **A compromised manager key.** Can trade inside the mandate at bad prices; cannot move anything
  out of the Safe. Revoke and rotate.

---

## Repository layout

| Path | What |
|---|---|
| `basket.json` | The basket: assets, weights, chains, routes. Written at onboarding; the one file that encodes your thesis. |
| `src/agent.ts` | The runtime: reconcile, mints, valuation, trims, buys, pooled bridges, snapshot, report |
| `src/report.ts` | The snapshot and the three-state Telegram report |
| `contracts/mandates/` | The permission contracts (swap, approve, CCTP bridge, Across bridge); tests in `contracts/test/` |
| `scripts/run-until-settled.sh` | The scheduled entry point; `settled.mjs` decides when a run is done |
| `dashboard/server.mjs` | The read-only local dashboard with live on-chain amounts |
| `.agents/skills/` | The Sailor skills that onboard, plan the mandate and operate the agent |
| `docs/` | Your notes: reports, reviews, the thesis in long form |

Operator state (`.sail/keys`, `.env.local`, account, mandate, activity, ledger, args, probes) is
gitignored and never leaves the machine.

## Release safety and valuation

Use Sailor 2.3 or later. Failed swaps are retried within `maxSlippageBps`; the runtime never increases that cap automatically. This is a runtime quote limit, not an oracle-based guarantee enforced by the bespoke swap permission.

The dashboard uses the last tick's one-token sell quote multiplied by the balance. This is an estimate, not a full-position liquidation quote; balances can be newer than the prices. A missing holding price pauses purchases and trims. The settle wrapper prevents overlapping runs.

Operators of older deployments must redeploy and register the corrected `ExactInputSwapPermission` and revoke its old registrations. Updating these files alone cannot update an immutable deployed contract.
