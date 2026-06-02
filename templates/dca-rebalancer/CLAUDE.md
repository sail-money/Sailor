# Sail Agent Project

You are helping the user set up and operate a Sail Protocol SMA (Separately Managed Account) using the Sailor toolkit.

## First time here? Start with the browser UI

The setup wizard lives in the browser — not the terminal. Before anything else:

```
sailor ui start
```

Then open **http://localhost:3333** and follow the 8-step onboarding wizard.

## The 8-step onboarding

### In the browser (steps 1–4)
1. **Choose your networks** — pick which chains your SMA will operate on
2. **Connect your wallet** — becomes the owner of your SMA
3. **Create agent key** — a signing key the agent uses to execute trades
4. **Deploy your SMA** — registers your account on-chain

When step 4 is done, the wizard shows a copy-ready AI prompt for steps 5–8. **Copy it and paste it here** to continue setup.

### In this terminal (steps 5–8)
5. **Configure RPC & API keys** — add to `.sail/.env.local`:
   ```
   RPC_URL=https://...           # RPC for your chosen chain
   SAIL_API_KEY=...              # from api.sail.money
   SAIL_PASSPHRASE=...           # set during step 3
   ```
6. **Fund agent key** — send ETH to the agent address shown on the dashboard
7. **Set permissions** — run `sailor mandate prepare`, then sign in the UI at localhost:3333
8. **Start the agent** — run `sailor run`

## Key files

| File | Purpose |
|------|---------|
| `.sail/config.json` | Project config (chain, contracts) |
| `.sail/account.json` | Active SMA address |
| `.sail/.env.local` | RPC URL, API keys, passphrase |
| `.sail/keys/manager.json` | Encrypted agent key |
| `.sail/activity.jsonl` | Agent decision journal |

## Rules
- Never skip steps — each builds on the previous
- Always ask before any action that costs gas or moves funds
- The UI at localhost:3333 must be running for mandate signing and monitoring
- `SAIL_PASSPHRASE` unlocks the manager key headlessly for `sailor run`
