# Shipyard: the simulation sandbox

Shipyard runs copies of the real chains on your own machine, with fake money. An agent can be
taken all the way through the journey there, deploy an SMA, register and configure a mandate,
run the tick loop, without risking anything. The contracts it talks to are the real deployed
Sail contracts, so what passes in Shipyard is what the kernel would allow on mainnet.

What it gives you is real market **state**, captured at the instant the fork starts: real
liquidity, real pool depths, real contract storage, the real deployed kernel. Your own
transactions move that state exactly as they would in reality. What does not happen is the market
moving underneath you, because nobody else is trading on your fork. So Shipyard is the place to
answer "does my mandate actually permit what I think it permits", and not the place to answer
"how does my strategy behave through a drawdown". See
[what it cannot tell you](#what-it-cannot-tell-you).

It is entirely optional. Nothing else in Sailor needs it, and a project that never starts it
behaves exactly as before.

## What you need first

Shipyard forks chains with **anvil**, which ships with [Foundry](https://getfoundry.sh). If
Foundry is not installed, `sailor sandbox start` stops immediately and says so. This is the
most common reason a first run fails, so install it before anything else:

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

`sailor doctor` reports whether anvil was found, alongside its other checks.

## Quickstart

From inside a Sailor project:

```bash
sailor sandbox start
```

The command starts a second dashboard, separate from the live one, on its own port, and prints
where it is:

```
Sailor Sandbox started at http://localhost:3417  (pid 48231)
Stop it with: sailor sandbox stop
```

Open that URL yourself; nothing opens a browser for you. Every page carries a banner reading
"Shipyard: simulation sandbox. No real funds." so there is never a question about which one you
are looking at. The onboarding wizard asks which chains to fork, then walks the same setup as
the live dashboard.

To check on it, or stop it:

```bash
sailor sandbox status
sailor sandbox stop
```

`stop` shuts down the dashboard and the forks, writing each fork's chain state to disk first, so
the next `sailor sandbox start` resumes the same world rather than forking fresh. Pass
`--keep-forks` to stop only the dashboard and leave the forks running.

`sailor shipyard` is accepted everywhere `sailor sandbox` is, as an alias.

## What is real and what is not

Real:

- **The contracts.** The SailKernel, the shared permission templates, and the Safe contracts are
  the genuinely deployed ones, because the fork carries the chain's real code.
- **Chain state**, copied at the moment the fork starts and frozen there. Pools, balances, and
  every other contract's storage are whatever they were on the upstream chain at that block: real
  liquidity and real depths, not invented numbers.
- **Protocol behaviour.** Registration, configuration, dispatch, and permission evaluation run
  the real code paths. A dispatch the kernel would deny on mainnet is denied here for the same
  reason.

Not real:

- **The money.** Balances in Shipyard are written directly into the fork. They exist nowhere else
  and cannot leave it.
- **The wallet.** Shipyard signs with a local development account rather than your own wallet,
  and a browser wallet extension cannot connect to a Shipyard page.

Nothing leaves your machine except the requests that read chain state from your RPC endpoint.
There is no hosted service behind any of this.

## What it cannot tell you

**Runs are not reproducible between runs.** A fork tracks the latest block at the moment it
starts, so two runs of the same agent meet different chain state and can reach different results.
Shipyard answers "would this work against the chain as it is now", not "does this produce the
same number every time".

**Only the on-chain boundary is simulated.** Venues whose behaviour depends on state held off
chain stay off chain, because there is nothing in the fork to consult. Anything that resolves
through an off-chain quote, a relayer, or a private order flow will not behave as it would live.

**The market does not move on its own.** A fork mines its own blocks, but nobody else is trading
on it, so prices and liquidity sit exactly where they were when the fork started. Measured on a
Base fork against the WETH/USDC pool: after 47 blocks with no transactions of ours, the pool's
price and both depths were byte-identical, while the same pool on the real chain moved eight
ticks and shed roughly seventeen thousand USDC of depth over the same period.

That is what makes Shipyard good at some questions and useless at others:

- **It answers:** does this permission block the swap I expect it to block, does my slippage bound
  hold, does registering and configuring this mandate do what I believe it does, does my agent
  complete a tick against real liquidity. Your own transactions move the market exactly as they
  would live, so a trade large enough to move the price still moves it.
- **It cannot answer:** how the strategy behaves through a drawdown, across a volatility spike, or
  against anyone else's order flow. Nothing arrives to move the price but you.

Testing a strategy that reacts to price movement means moving the price yourself.

## Configuring it

**Which chains.** The onboarding wizard offers the chains Sailor supports and forks each one you
select. The fork engine covers a fixed set; picking a chain outside it fails with
`Unsupported sandbox chain id`.

**How many at once.** The default limit is **3** concurrent forked chains. Each fork is a separate
anvil process on its own port, so the limit keeps resource use bounded. Change it from the
Shipyard settings panel (the gear in the banner), which stores the value as `maxSandboxChains` in
the sandbox's own `config.json`. The ceiling is the number of chains the fork engine has ports
for.

**RPC endpoints matter.** A fork reads its state from an upstream RPC. Without a configured
endpoint Shipyard falls back to a public one and prints a warning, and those are rate limited
hard enough to make forking slow or fail outright. Set a per-chain endpoint in the sandbox's
`.env.local`:

```bash
BASE_RPC_URL=https://your-base-endpoint
ARBITRUM_RPC_URL=https://your-arbitrum-endpoint
```

Each chain reads its own variable, so a multi-chain Shipyard session resolves each endpoint
independently.

## Where state lives

Everything Shipyard writes goes under `.shipyard/` in your project, mirroring the shape of
`.sail/`: the SMA record, the mandate, the activity log, keys, and `.env.local`. It is
git-ignored in full, so none of it can be committed by accident.

Expect it to use real disk. Each forked chain's state is dumped to a file periodically while the
dashboard runs, and again on shutdown, so a crash does not lose the session. Those dumps are
frequently multiple megabytes each.

**Resets are archived, never deleted, and nothing ever prunes them.** Each reset moves the whole
world into a new `_reset-backup-<timestamp>/` directory beside it, chain-state dumps included, so
you can bring an old world back from the Shipyard settings panel. There is no retention limit and
no cleanup on start, stop, or reset: reset often enough and these will fill a disk. They are
ordinary directories, so remove the ones you no longer want yourself:

```bash
du -sh .shipyard/sandbox/_reset-backup-*     # what they are costing you
rm -rf .shipyard/sandbox/_reset-backup-<timestamp>
```

Restoring a backup archives the current world first, so a restore consumes one archive and creates
another rather than reducing the count.

Chain state is saved between runs. Stopping and starting resumes the same world: the SMA you
deployed, the mandates you signed, the balances you funded.

## Getting back to live

Shipyard and live keep entirely separate state, and this is the single most confusing consequence:

**While you are working in Shipyard, the live side looks like an empty project.** `sailor status`
and `sailor doctor` read the live root only, so a project you onboarded entirely inside Shipyard
reports no SMA and no mandate. That is expected. The work is not lost, it is in the other root.

To read the Shipyard side from the terminal, point `SAIL_DIR` at it:

```bash
SAIL_DIR=.shipyard/sandbox sailor status
```

To move between the two dashboards, use the "Exit to live dashboard" link in the Shipyard banner,
or the Shipyard link on the live dashboard. Each starts the other server if it is not already
running. Nothing you did in Shipyard carries over to live: going live means running the real
setup against the real chain.

## Troubleshooting

**"anvil was not found on PATH."** Foundry is not installed, or not on the PATH of the shell
running Sailor. Install it as above, then confirm with `anvil --version`.

**A fork fails to start, or starts slowly.** Almost always the upstream RPC. Check for the
rate-limit warning printed at start, and set a per-chain endpoint as described above. Fork
startup retries a few times before giving up, because public endpoints behind load balancers
routinely fail the first attempt.

**A port is already in use.** Each forked chain uses a fixed port, and the dashboard uses a
per-project port distinct from the live dashboard's. If something else holds one, stop it, or
stop a fork you are not using from the Shipyard settings panel.

**"This project is already wired to an externally-managed fork."** A different tool, the
standalone Shipyard harness, is already managing forks for this project. It is not the same thing
as this feature, and both would run their own fork managers on the same ports. Use that tool's
own dashboard instead, or set `SAILOR_ALLOW_SANDBOX_WITH_WRAP=1` if you understand the collision
and want the built-in one anyway.

**The dashboard shows an empty project.** Check which one you are looking at. The live dashboard
has no banner; the Shipyard one always does.

---

Feedback: something unclear or broken on this page? [Open an issue](https://github.com/sail-money/Sailor/issues).
