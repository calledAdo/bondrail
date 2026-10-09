# Slice

**Revenue bonds for onchain businesses on Monad.**

Monad apps earn fees onchain but can't borrow against them. Slice turns an onchain revenue stream into a
bond that pays investors automatically, and makes cheating either impossible or expensive.

- App: https://slice-flame.vercel.app (Monad testnet)
- Demo issuer, a paid x402 AI API: https://slice-agent.vercel.app/api/oracle
- Indexer (Envio HyperIndex): https://indexer.dev.hyperindex.xyz/d81de52/v1/graphql

Built for Monad Metropolis, Track 1 (Onchain Finance & Trading).

## How it works

1. **Revenue goes to a Slice Router, never to the business.** On every sweep the router sends the
   investors' share (e.g. 25%) to the bond and credits the rest to the business. Neither the business
   nor anyone else can take money out of the router any other way.
2. **The business sells a share of that revenue for cash today.** Investors deposit USDC into a
   `SliceBond` and receive 1:1 claim tokens. Capital is released in two stages, 50/50 or 25/75: the
   first at activation, the second only after a signed revenue milestone. Unreleased capital goes back
   to claim holders if the milestone is missed or the business defaults.
3. **Claims are redeemable at any time** for a pro-rata share of the pool collected so far, and
   tradable on **Kuru**. Their price is a live market forecast of the business's revenue.
4. **The business cannot quietly redirect revenue.** There are two adapters:
   - **Locked** (fees set in the business's own contracts, e.g. a launchpad): the business hands
     ownership of its contract to a `FeeGuard`. The guard passes through harmless admin calls and
     refuses anything that could divert or cut fees. Diversion is **impossible**.
   - **Watched** (revenue paid over HTTP with x402, e.g. an AI agent's API): a **Chainlink CRE**
     workflow calls the endpoint unpaid and reads the `payTo` from its HTTP 402 offer. It reports
     onchain through the CRE forwarder. Two adjacent violations default the bond and move the
     business's stake to investors. Diversion is **caught within about a minute and penalised**.
5. **Credit history is real.** **Envio HyperIndex** indexes every payment. The issuer page separates
   **verified revenue** from **wash revenue** (the business paying itself): it follows USDC funding
   edges from the issuer's treasury to the wallets that pay it.

```
 payers (x402 calls, launchpad trades) ─► SliceRouter ─sweep─► investor share ─► SliceBond (vault + ERC-20 claim)
                                               └──────────► issuer share (pull credit)        ▲ deposit / redeem
 Locked : PumpLab launchpad ◄─ owned by ─ FeeGuard ◄─ issuer admin calls                     │ investors
 Watched: Oracle Agent (x402, payTo = router) ◄─ unpaid GET ─ Chainlink CRE workflow ─ report ─► SliceCovenant
                                                                       (observer-signed)          └─ default ─► SliceBond
 Envio HyperIndex ◄─ Factory / Router / Bond / Covenant / PumpLab / USDC events ─► web app (Next.js, wagmi, passkeys)
 Kuru: claim/USDC order book + AMM vault        ERC-8004: agent identity and reputation
```

## Live on Monad testnet (chain 10143)

| What | Address / tx |
|---|---|
| SliceFactory | `0x4c71c74a7544015008fd3951b823a87633b44424` |
| SliceCovenant (CRE receiver) | `0xf90fcfe1532d8e74f8125cec3ee771f62f13ed41` |
| CRE MockKeystoneForwarder | `0xB9F79d863261869B234c481D1f9A7af84AeAd192` |
| PumpLab bond `PLAB-RC` (Locked) | `0x2e47673714E4F597135213B2564be48AA4658C27` |
| PumpLab launchpad / FeeGuard | `0xEA647eC403FedBd15E8f56680d5cFc3EdC9e4CC2` / `0x8E7DC3A9e685AcD3941a3508245592D082dB642E` |
| Oracle Agent bond `ORCL-RC` (Watched) | `0xC60B199c7128e42AD277dAA4569C7E8Bb6866F82` |
| Oracle Agent router (= x402 `payTo`) | `0xd9644fBf11Fd243402F9D969EEf4454dba697432` |
| Kuru `PLAB-RC`/USDC market / AMM vault | `0xea590a84fcb602ef1caadc0927585012a12d7ecc` / `0x2fC508d90aB26845dECE47c8EDb7AEDF8d976e8F` |
| ERC-8004 agentId | `2091` (Identity Registry `0x8004A818BFB912233c491871b3d84c89A494BD9e`) |
| First CRE reports (simulate `--broadcast`) | `0x330f949c089d6004b936c5331b4d16583ab36c293e9cd983e05ac0907129eb23`, `0xd6b2872d1dc4efb5e1051c9088ba593a7fa713d1522177900bb0c370e8488479` |
| Watched bond activated after a fresh CRE report | `0x849828b94fb5115f205d164c7732c90003482daffd079bd7d8a9613f616408b1` |
| Paid x402 call settled to the router | `0x197d28f02cfa7f4dc1313080290ba5e33aa1901ceecaf8cdb15bdfc49e040ea8` |
| Kuru vault seeded | `0x025faee9981adf45bf500f7c01a5ec2d6fd04632693822bf914f6b7346853ecc` |

All addresses are in [`docs/deployments/10143.json`](docs/deployments/10143.json).

## Sponsor integrations

### Chainlink CRE: covenant checks that trigger defaults
- Workflow: [`cre/slice-covenant/src/workflow.ts`](cre/slice-covenant/src/workflow.ts). Steps:
  1. cron trigger;
  2. `HTTPClient` with identical-consensus aggregation fetches the agent's 402 offer itself and the
     observer's signed observation;
  3. the two must agree;
  4. `runtime.report` → `EVMClient.writeReport` to `SliceCovenant`.
- Receiver: [`contracts/src/SliceCovenant.sol`](contracts/src/SliceCovenant.sol). `onReport` is the
  only way an observation can arrive. It records Compliant, Violation or Unknown per 30 s epoch;
  two adjacent violations call `markDefault`.
- Why an observer signature too: the simulation forwarder is permissionless, so the report also
  carries an EIP-712 signature from a pinned observer key. That stops anyone from forging a default
  through the forwarder.
- Run it: `cd cre && cre workflow simulate slice-covenant --target testnet --non-interactive --trigger-index 0 --broadcast`.
  Chainlink confirmed simulation is acceptable for Metropolis.

### Envio HyperIndex: the core data layer
- [`indexer/`](indexer/) runs on Envio Cloud via HyperSync.
- Routers, bonds and launchpads are registered dynamically from factory events
  (`indexer.contractRegister`).
- Payments are attributed to payers:
  - x402: USDC transfers into a router;
  - launchpad: `Trade` events, so a trader pays the fee even though the transfer comes from the launchpad.
- Treasury `FundingEdge`s flag related payers, which drives the **raw vs verified** revenue chart, the
  payer table and the market totals in the app ([`apps/web/src/lib/live.ts`](apps/web/src/lib/live.ts)).

### Kuru: a new asset class
- Revenue-bond claims trade on a Kuru order book against USDC, with an AMM vault seeded at 1:1.
- [`scripts/kuru-market.ts`](scripts/kuru-market.ts): `deployProxy` on the Kuru router, then a vault deposit.

### Nansen: payer screening
- On the issuer page, **Screen top payers with Nansen** sends up to 10 payer addresses to a server
  route, [`apps/web/src/app/api/nansen/route.ts`](apps/web/src/app/api/nansen/route.ts).
- The route calls Nansen `profiler/address/labels` for Monad mainnet and shows each payer's labels next
  to its verified or excluded status.
- The key stays server-side, and results are cached. Empty lookups cost 0 credits.

### Monad
- About 600 ms finality makes repayment visible live: the bond page polls backing-per-claim every 2 s.
- Per-call micro-revenue ($0.01 x402 payments) is only viable with fast, cheap transactions.
- The x402 facilitator settles on Monad and pays the gas, so payers need only USDC.

### Also used
- **x402:** the Oracle Agent is a real paid API ([`apps/agent`](apps/agent)). Its answers come from an
  OpenAI-compatible model.
- **ERC-8004:** the agent is registered (agentId 2091). A default triggers negative reputation
  feedback from an independent reporter ([`scripts/erc8004.ts`](scripts/erc8004.ts)).
- **Mera:** passkey accounts (Face ID / Touch ID) as a wagmi connector, so no wallet extension is needed.

## Demo

| Step | Command |
|---|---|
| Launchpad revenue, organic and wash | `pnpm tsx scripts/traffic-launchpad.ts organic 1` · `… wash 1` |
| Paid API traffic | `AGENT_URL=https://slice-agent.vercel.app/api/oracle pnpm tsx scripts/traffic-agent.ts 10` |
| Locked: the guard blocks a fee redirect | `pnpm tsx scripts/demo-locked.ts` |
| Watched: payTo diversion → CRE default → ERC-8004 feedback | `pnpm tsx scripts/demo-default.ts --yes` (irreversible) |

## Security

| Attack | Defense | Residual risk |
|---|---|---|
| Issuer changes the fee recipient (Locked) | FeeGuard refuses the selector and re-checks the lock after every call | A proxy admin would also need guarding (PumpLab is not upgradeable) |
| Issuer lowers the fee rate to 0 | `setFeeBps` refused; `isLocked` requires the agreed rate | — |
| Issuer changes the x402 `payTo` (Watched) | CRE check every 30 s; two adjacent violations → default; stake slashed; ERC-8004 feedback | Revenue between the switch and detection |
| Forged default through the permissionless forwarder | Pinned observer EIP-712 signature, freshness and per-epoch replay checks | Trust in one observer key (disclosed) |
| Issuer runs a second, unregistered endpoint | Stake; reputation; the drop in routed revenue is visible | Not preventable; disclosed |
| Wash revenue to inflate history | Treasury funding edges; per-payer concentration cap | Laundering through clean wallets |
| Revenue simply declines | Investor risk, priced by the claim on Kuru | By design |

- Foundry: 36 tests, including fuzz and an accounting invariant suite (`forge test` in `contracts/`).
- TypeScript: tests for scoring, observer, worker, agent and web (`pnpm -r test`).

## Limits, stated plainly

- **Testnet only.** All demo activity is generated by team-controlled wallets. The two cohorts differ
  only in who funded them, which is exactly what the wash detector looks at.
- **CRE runs as a local simulation** that broadcasts real reports, not a deployed DON. The observer is
  a single disclosed signer.
- **Nansen screening** uses Monad **mainnet** labels (Nansen doesn't cover testnet). Our team-controlled
  demo payers are fresh wallets, so they come back unlabelled; the integration is real but has little
  to find on testnet.
- The second-release milestone is attested by a disclosed evaluator key, not proven onchain.

## Repository

```
contracts/   Foundry: SliceFactory, SliceRouter, SliceBond, FeeGuard, SliceCovenant, PumpLab
apps/web/    Next.js app: markets, issuer evidence, bond workspace, issue wizard, passkeys
apps/agent/  Paid x402 Oracle Agent (Vercel, Upstash-backed payment journal)
services/    observer (signs payTo observations), worker (sweeps, closes, CRE loop)
cre/         Chainlink CRE covenant workflow
indexer/     Envio HyperIndex
scripts/     deploy, demo setup, traffic, Kuru, ERC-8004, demo controls
```

Run locally: `pnpm install`, `forge test --root contracts`, `pnpm -r test`, then
`SLICE_CHAIN_ID=31337 pnpm tsx scripts/deploy.ts` against anvil.

Built during the hackathon by calledAdo, with AI pair-programming (OpenAI Codex, then Claude Code).
MIT licensed.
