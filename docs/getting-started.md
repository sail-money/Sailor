# Getting started

End-to-end path from nothing to a running, bounded agent — and how to shut it down. Every command
here is copy-pasteable. The agent-driven flow (open the scaffold in your AI coding agent
and say **"start"**) walks the same journey conversationally; this page is the manual version.

## 1. Install and scaffold

**npm** (Node.js >= 18):

```bash
# bash / zsh (macOS, Linux)
mkdir my-agent && cd my-agent && npm i @sail.money/sailor && npx sailor init && npm install
```

```powershell
# PowerShell (Windows)
mkdir my-agent ; cd my-agent ; npm i @sail.money/sailor ; npx sailor init ; npm install
```

**Docker** (no Node.js on the host):

```bash
mkdir my-agent && cd my-agent
docker run -d --name agent -P -v "${PWD}:/workspace" sailmoney/sailor
docker exec agent sailor init
```

With Docker, prefix every `sailor` command below with `docker exec agent` — project files are on
your host through the volume mount. Details: [docker.md](./docker.md).

The scaffold contains your agent code (`src/`), a Foundry workspace for custom permissions
(`mandates/`), worked example permissions (`examples/`), the operator guide (`AGENTS.md`) with
its skills (`.agents/skills/`), and the local workspace (`.sail/` — config, encrypted keys,
state).

You will also need a wallet (MetaMask, Rabby, …), an RPC URL for your chain (put it in
`.sail/.env.local` as `RPC_URL=`), and a little gas on the chain you pick. `sailor chains` lists
the supported chains.

## 2. Keys and owner

```bash
sailor keys generate --type agent-wallet   # the manager key the agent signs dispatches with
sailor keys show                           # addresses of stored keys
sailor owner connect                       # opens the browser signing station; connect your wallet
```

The agent key is encrypted on disk (`.sail/keys/`, geth keystore v3) behind a passphrase you
choose (or `SAIL_PASSPHRASE` for non-interactive use). Your owner key never leaves your wallet —
Sailor only records the address and asks your wallet to sign when a step needs owner authority.

## 3. Deploy your SMA

```bash
sailor account predict     # optional: see the deterministic Safe address before paying gas
sailor onboard --new-sma   # deploys the SMA (a Safe) and walks the setup
```

The same owner, permission signer, manager, and salt produce the **same SMA address on every
supported chain** (`sailor account deploy-chain` reuses it elsewhere).

## 4. Give the agent a mandate

A mandate is one or more onchain permission contracts registered on your SMA. The fastest path is
a **shared template** — audited-pattern, multi-tenant permission contracts already deployed on
every supported chain (swap, transfer, deposit, withdraw, borrow, approve-and-call-batch,
swap-no-oracle). Register, then configure:

```bash
# Register (owner signs an EIP-712 RegisterPermission in the browser):
sailor mandate register --address <templateAddress> --sma <yourSMA>

# Configure your bounds (tokens, caps, venues) for that template:
sailor mandate configure --address <templateAddress> \
  --template SwapPermission --args-file swap-config.json
```

The scaffold's skills (`.agents/skills/sail-template-*`) carry the exact parameter schema and the
safe order of operations per template — this is where the agent-driven flow shines. For a
custom policy instead, author an `IPermission` contract in `mandates/` (start from the
`examples/custom-mandate/` scaffold) and use
`sailor mandate deploy --contract <Name> --register --sma <yourSMA>`.

## 5. Prove the bounds before running

```bash
sailor mandate simulate --address <permission> \
  --target <contract> --calldata 0x... --expect pass    # a call your mandate allows
sailor mandate simulate --address <permission> \
  --target <otherContract> --calldata 0x... --expect fail # a call outside it
```

`simulate` is an off-chain `eth_call` against the permission's real `evaluate()` — no gas, no
signatures. Verdicts are `PASS` / `FAIL` / `REVERT`, and `--expect` makes a mismatch exit
non-zero. If the out-of-bounds call doesn't `FAIL`, fix the mandate before running anything.

## 6. Run

```bash
sailor run --once   # single tick
sailor run          # the loop
```

Every planned call is resolved against the registered permissions first; a call nothing
authorizes is **skipped** (`skipped: no registered permission authorizes call to <target>`) and
recorded in `.sail/activity.jsonl` as `dispatch_denied`. For unattended operation:
`sailor service install` (launchd / systemd / Task Scheduler) or the scaffold's GitHub Actions
cron (`sailor trigger github` fires it on demand). Watch it all in the dashboard:
`sailor ui start`.

## 7. Revoke

Two independent brakes, neither touches Safe custody:

```bash
sailor session pause                       # instantly revoke dispatch rights (reversible: resume)
sailor mandate revoke --address <perm>     # remove one permission (owner-signed)
sailor mandate revoke --all                # remove every permission
```

`sailor status` and `sailor doctor` confirm the resulting state at any time.

---

Feedback: something unclear or broken on this page? [Open an issue](https://github.com/sail-money/Sailor/issues).
