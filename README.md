# Slice

**Revenue bonds for onchain businesses on Monad.**

Monad apps earn fees onchain but can't borrow against them. Slice gives every business a revenue
account from day one. The account records each payment, with the payer, before the business ever asks
for money. When it raises, the same account automatically pays investors their share, in a way the
business either cannot route around or gets punished for routing around.

- App: https://slice-flame.vercel.app (Monad testnet)
- Demo issuer, a paid x402 AI API: https://slice-agent.vercel.app/api/oracle
- Indexer (Envio HyperIndex): https://indexer.dev.hyperindex.xyz/db35311/v1/graphql
- Specification: [`docs/SPEC.md`](docs/SPEC.md)

Built for Monad Metropolis, Track 1 (Onchain Finance & Trading).

## How it works

1. **Every business has a SliceAccount from day one.** It is the business's revenue address and
   payment entrypoint.
   - **Native projects** call `account.collect(payer, gross, fee)`. The account *pulls* the payment
     from the payer (an approval, or one EIP-2612 permit signature), keeps the fee and forwards the
     rest to the project. The payer is proven by the pull itself.
   - **Plain transfers** (x402 settlements, a legacy contract's fee transfer) are booked with `sweep()`.
2. **The account keeps an on-chain credit history from its first payment:** total revenue, payments,
   distinct payers, first revenue date and revenue per day. This happens bond or no bond, so the record
   that underwrites a raise predates the raise.
3. **Raising.** Investors deposit USDC into a `SliceBond` and get 1:1 claim tokens.
   - **First release:** 50% (or 25%) of the capital is released at activation.
   - **Second release:** the rest needs proof of revenue since activation. The issuer chose one at
     creation:
     - **on-chain:** the account's own counter (trustless);
     - **signed:** a wash-adjusted attestation.
   - **Missed or defaulted:** unreleased capital goes back to claim holders if the deadline passes or the business defaults.
4. **Modes.**
   - **Passthrough:** no active bond, so 100% of revenue goes to the business.
   - **Credit:** while a bond is active, each payment's investor share (e.g. 25%) goes straight to the
     bond, up to a cap.
   - **Passthrough again:** when the bond closes.
5. **Claims are redeemable at any time** for a pro-rata share of what has been collected, and tradable
   on **Kuru**. Their price is a live market forecast of the business's revenue.

## Three ways to connect revenue

| Tier | For | Why revenue can't be diverted | Demo |
|---|---|---|---|
| **Native** | New projects built on Slice | Every fee is pulled through the account, which is fixed into the project's contract. No other fee path exists: **impossible by construction** | PumpLab launchpad |
| **Locked** | Existing contracts with an owner-set fee recipient | Ownership is held by a `FeeGuard`, which refuses recipient, rate, ownership and unknown calls while a bond is live: **impossible while locked** | PumpLab Classic |
| **Watched** | Revenue paid over HTTP (x402 agents) | **Chainlink CRE** checks the advertised `payTo` every 30 s; two adjacent violations default the bond and slash the issuer's stake: **caught and punished** | Oracle Agent |

```
 Native : trader ─ approve/permit ─► SliceAccount.collect ─┬─► fee: history, then the bond share ─► SliceBond
          PumpLab.buy() ─────────────────────────┘          └─► rest ─► PumpLab
 Locked : PumpLabClassic (owned by FeeGuard) ─ fee transfer ─► SliceAccount.sweep ─► same split
 Watched: payer ─ x402 ─► facilitator ─ USDC ─► SliceAccount.sweep ─► same split
          Chainlink CRE ─ unpaid GET ─► agent's 402 offer ─ signed report ─► SliceCovenant ─ default ─► SliceBond
 Envio HyperIndex ◄─ factory / account / bond / covenant / launchpad / USDC events ─► web app
 Kuru: claim/USDC order book and AMM vault          ERC-8004: agent identity and reputation
```

## Live on Monad testnet (chain 10143)

| What | Address |
|---|---|
| SliceFactory | `0xb4620109307835d4a52a781470279155a1bfbc09` |
| SliceCovenant (CRE receiver) | `0xb1c85a5dad3d619e5ef5a090c1eb1c1c9437d37a` |
| CRE MockKeystoneForwarder | `0xB9F79d863261869B234c481D1f9A7af84AeAd192` |
| PumpLab (Native): account / launchpad / bond `PLAB-RC` | `0x04319a0dFd177f70226E9D71F92F599f457f807c` / `0xA531e3D34e6dF05eE5dEA0beBc5C19351B05a743` / `0xc9F074793fe1E2f8Fa863386cD799Aaba22fC652` |
| PumpLab Classic (Locked): account / launchpad / FeeGuard / bond `CLAB-RC` | `0x57B42c0C9003A8b4659e0B8b2bcDeE5C297CeEF9` / `0x6DeaE3c4d0B677709D8Bf3DdD2CB3d7127a6dB75` / `0xcc1B19f5372FfCDde5a698F5f9dc366c8477493D` / `0x4dB03668B734f649f058ddC00569B5318615848c` |
| Oracle Agent (Watched): account = x402 `payTo` / bond `ORCL-RC` | `0xe74108A1Cb162Aa10F6dCac376eEbD2c2cF727e8` / `0xE9FA3Fe3A8a90F26f9Df0d1223D2F00fd57497F8` |
| Kuru `PLAB-RC`/USDC market / AMM vault | `0xBb5d25B18A988D39De9669a2F65B30dc45E1410A` / `0x0aa28475a14908fDf2a519a6C2A7C4712371c4cA` |
| ERC-8004 agentId | `2091` (Identity Registry `0x8004A818BFB912233c491871b3d84c89A494BD9e`) |

| Transaction | Hash |
|---|---|
| CRE report that gated the Watched bond's activation | `0xc7f73342df8f577398fda34dbccd36891fb485e16fa9c415a27bd15e70d456b2` |
| Watched bond activated | `0x7b0dc237cb9c87dc22dd5941fb9caeaaebcc015db781fc0683a966a30bb8c246` |
| Paid x402 call settled to the agent's account | `0x5edf3ff5e434404d7d92e433b1e9f41c01ee1938508e2a0369a5d0cd2d1a80d3` |
| x402 receipts booked and split (`sweep`) | `0x6c50f88633cee7efe0757cc8baa176c7d4391d78b014a663049b26ae3988ad03` |
| Kuru market deployed / vault seeded | `0xc893dbba1fb729f43ca5759d3549eb9359a53660ca22a539d1661fe4597ddd10` / `0xc69fc36973f51cbc6a399d5f3dcd884708619d13835c664a9ccac5e201d5a877` |

All addresses are in [`docs/deployments/10143.json`](docs/deployments/10143.json).

## Sponsor integrations

### Chainlink CRE: covenant checks that trigger defaults
- Workflow: [`cre/slice-covenant/src/workflow.ts`](cre/slice-covenant/src/workflow.ts). Steps:
  1. cron trigger;
  2. `HTTPClient` with identical-consensus aggregation fetches the agent's HTTP 402 offer itself, and
     the observer's signed observation;
  3. the two must agree;
  4. `runtime.report` → `EVMClient.writeReport` to `SliceCovenant`.
- Receiver: [`contracts/src/SliceCovenant.sol`](contracts/src/SliceCovenant.sol). `onReport` is the only
  way an observation can arrive. It records Compliant, Violation or Unknown per 30 s epoch; two adjacent
  violations call `markDefault`.
- Why an observer signature too: the simulation forwarder is permissionless, so each report also
  carries an EIP-712 signature from a pinned observer key. That stops anyone forging a default through
  the forwarder.
- The CRE check also gates the Watched bond's *activation*: the factory requires a fresh compliant report.
- Run: `cd cre && cre workflow simulate slice-covenant --target testnet --non-interactive --trigger-index 0 --broadcast`.
  Chainlink confirmed simulation is acceptable for Metropolis.

### Envio HyperIndex: the core data layer
- [`indexer/`](indexer/) runs on Envio Cloud via HyperSync.
- Accounts, bonds and launchpads are registered dynamically from factory events (`indexer.contractRegister`).
- Each payment is attributed exactly once:
  - **Native:** the account's `Revenue` event; the payer is proven by the pull.
  - **Locked:** PumpLab Classic `Trade` events.
  - **Watched:** USDC transfers into the account; the facilitator moves funds from the payer.
- Treasury `FundingEdge`s flag payers funded by the business itself.
- This drives raw vs verified revenue, the payer table, market totals and the bond views in the app
  ([`apps/web/src/lib/live.ts`](apps/web/src/lib/live.ts)).

### Kuru: a new asset class
- Revenue-bond claims trade on a Kuru order book against USDC, with an AMM vault.
- [`scripts/kuru-market.ts`](scripts/kuru-market.ts): `deployProxy` on the Kuru router, then a vault deposit.

### Nansen: payer screening
- On the issuer page, **Screen top payers with Nansen** checks payers against Nansen labels on Monad
  mainnet ([`apps/web/src/app/api/nansen/route.ts`](apps/web/src/app/api/nansen/route.ts)).
- The key stays server-side and results are cached. Empty lookups cost 0 credits.

### Monad
- Per-payment splitting and $0.01 x402 micropayments only make sense with fast, cheap transactions.
- About 600 ms finality makes repayment visible live: the bond page shows backing per claim updating as payments land.
- The x402 facilitator settles on Monad and pays the gas, so payers need only USDC.

### Also used
- **x402:** the Oracle Agent is a real paid API ([`apps/agent`](apps/agent)).
- **ERC-8004:** the agent is registered (agentId 2091). A default triggers negative reputation feedback
  from an independent reporter ([`scripts/erc8004.ts`](scripts/erc8004.ts)).
- **Mera:** passkey accounts (Face ID / Touch ID) as a wagmi connector, so no wallet extension is needed.

## Demo commands

| Step | Command |
|---|---|
| Native launchpad revenue, organic and wash | `pnpm tsx scripts/traffic-launchpad.ts pumplab organic 1` · `… pumplab wash 1` |
| Locked launchpad revenue | `pnpm tsx scripts/traffic-launchpad.ts classic organic 1` |
| Paid API traffic | `pnpm tsx scripts/traffic-agent.ts 10` |
| Locked: the guard blocks a fee redirect | `pnpm tsx scripts/demo-locked.ts` |
| Watched: payTo diversion → CRE default → ERC-8004 feedback | `pnpm tsx scripts/demo-default.ts --yes` (irreversible) |

## Security

| Attack | Defense | Residual risk |
|---|---|---|
| Native project diverts fees | The account address is immutable in the project, and only the bound project can call `collect` | The project can still lower its own fee or stop operating (priced by the claim on Kuru) |
| Fake payer attribution | Native payments are pulled from the payer's own balance; the event carries the real source | Wash trading from wallets the business funds; caught by funding edges |
| Issuer changes the fee recipient (Locked) | FeeGuard refuses the selector and re-checks the lock after every call | A proxy admin would also need guarding (PumpLab Classic is not upgradeable) |
| Issuer changes the x402 `payTo` (Watched) | CRE check every 30 s; two adjacent violations → default; stake slashed; ERC-8004 feedback | Revenue between the switch and detection |
| Forged default through the permissionless forwarder | Pinned observer EIP-712 signature, freshness and per-epoch replay checks | Trust in one observer key (disclosed) |
| Milestone faked with self-paid revenue (on-chain mode) | It costs real money, a share of which goes to investors; strict issuers choose the signed, wash-adjusted mode | By design; disclosed in the terms |
| Micro-payments rounding investors to zero | A rounding carry in the account's split | — |

- Foundry: 45 tests, including fuzz and an accounting invariant suite (`forge test` in `contracts/`).
- TypeScript: tests for scoring, observer, worker, agent and web (`pnpm -r test`).

## Limits, stated plainly

- **Testnet only.** All demo activity comes from team-controlled wallets. The organic and wash cohorts
  differ only in who funded them, which is exactly what the wash detector looks at.
- **CRE runs as a local simulation** that broadcasts real reports, not a deployed DON. The observer is a
  single disclosed signer.
- **Native recognition.** The factory recognises launchpads it deployed itself. Third-party Native
  projects would need a code review or allowlist, because a contract can't verify arbitrary bytecode.
- **Nansen** covers Monad mainnet, not testnet. Our fresh demo payers come back unlabelled.

## Repository

```
contracts/   Foundry: SliceFactory, SliceAccount, SliceBond, FeeGuard, SliceCovenant, PumpLab, PumpLabClassic
apps/web/    Next.js app: markets, issuer evidence and credit history, bond workspace, issue wizard, passkeys
apps/agent/  Paid x402 Oracle Agent (Vercel, Upstash-backed payment journal)
services/    observer (signs payTo observations), worker (sweeps, closes, CRE loop)
cre/         Chainlink CRE covenant workflow
indexer/     Envio HyperIndex
scripts/     deploy, demo setup, traffic, Kuru, ERC-8004, demo controls
```

Run locally: `pnpm install`; `forge test --root contracts`; `pnpm -r test`; start
`anvil --code-size-limit 131072`, then run `SLICE_CHAIN_ID=31337 pnpm tsx scripts/deploy.ts` and
`scripts/setup-demo.ts`.

Built during the hackathon by calledAdo, with AI pair-programming (OpenAI Codex, then Claude Code).
MIT licensed.
