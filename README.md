# Slice

**Revenue bonds for onchain businesses on Monad.**

Monad apps earn fees onchain but can't borrow against them. Slice gives every business a revenue
account from day one. The account records each payment, with the payer, before the business ever asks
for money. When it raises, the same account automatically pays investors their share, in a way the
business either cannot route around or gets punished for routing around.

- App: https://slice-flame.vercel.app (Monad testnet)
- Demo issuer, a paid x402 AI API: https://slice-agent.vercel.app/api/oracle
- Indexer (Envio HyperIndex): https://indexer.dev.hyperindex.xyz/b912a23/v1/graphql
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
| **Native** | New projects built on Slice: inherit `SliceEarner` | Every fee is pulled through the account, which is fixed into the project's contract. A disclosed Slice reviewer checks the code before the project can raise; history accrues before review: **impossible by construction** | PumpLab launchpad |
| **Locked** | Any existing owner-administered fee contract | Ownership is held by a generic `FeeGuard` (configured with the contract's fee-recipient getter, optional fee-rate floor and an allowlist of harmless admin calls); everything else is refused while a bond is live: **impossible while locked** | PumpLab Classic |
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
| SliceFactory | `0x14160bb3838714fed6842214ca29e66b39d756e1` |
| SliceCovenant (CRE receiver) | `0x599c8397c64b22794847f8644c0916064abbf780` |
| CRE MockKeystoneForwarder | `0xB9F79d863261869B234c481D1f9A7af84AeAd192` |
| Native reviewer (disclosed) | `0x10Be6883Ebbd9B610C43a97f338512a5e66f5893` |
| PumpLab (Native): account / project / bond `PLAB-RC` | `0xD4e4959e39787bbDb448d7437f67ca32AbD204B2` / `0x700d8a4e125e3a32dd2be9f727cab4d2a5d2f59d` / `0x121a1294Ced6c90c25bB823e72416E89677a717F` |
| PumpLab Classic (Locked): account / contract / FeeGuard / bond `CLAB-RC` | `0x2BA8145ebc85feB8A7E8Ebf55A03B37E8fB42A75` / `0x297b0fb25ffe786a88bf20c100c4476ea82dd8c7` / `0x04744483190D4373Ee55cE065c69374cc0f5C38B` / `0x9fcA536a68f0a47d029f93D1a28549288Ba163b5` |
| Oracle Agent (Watched): account = x402 `payTo` / bond `ORCL-RC` | `0xa4a870a3b5Bc457266416C84441011e879141a26` / `0xaDF2916EFd32A4F603E00423Cd9fB5c453a16630` |
| Kuru `PLAB-RC`/USDC market / AMM vault | `0xEd980DA024b1f5dcaaF3F103275F7a660ED00813` / `0x862f1372307162469DFc2bFe845bDCF0F634515E` |
| ERC-8004 agentId | `2091` (Identity Registry `0x8004A818BFB912233c491871b3d84c89A494BD9e`) |

| Transaction | Hash |
|---|---|
| CRE report that gated the Watched bond's activation | `0xd8d14065168c5f823f612c1108937b4dd9a6a1c72913f0ee7a69e72ba2f6c52f` |
| Watched bond activated | `0xb7242d699e57a189d3dca80b5c988631f0d36c493b3ddea093582c59f41c3857` |
| Paid x402 call settled to the agent's account | `0x895fda501203a0ef87aca1dc2cba77fbe0a77bdbabeb35401dcf7911ccc06bab` |
| Kuru market deployed / vault seeded | `0x1d92020bf951d4f8f937d3ae868d536475c4ac1951607025e19ad0706141f28b` / `0x5b9ac046684a23d350ca11992d56f821feffedf07fabbce5bc7d58e5a764352c` |

All addresses are in [`docs/deployments/10143.json`](docs/deployments/10143.json).

## Product vs demo

Slice is a protocol plus an SDK. The demo businesses are ordinary users of both.

| Product | |
|---|---|
| [`contracts/src`](contracts/src) | SliceAccount, SliceBond, SliceFactory, SliceCovenant, FeeGuard, **SliceEarner** (inherit it to be Native) |
| [`packages/sdk`](packages/sdk) (`@slice/sdk`) | Typed ABIs and client (accounts, guards, bonds, credit history), EIP-2612 permit for Native payments, **x402 handler** that pays a SliceAccount, revenue data and scoring |
| [`services`](services), [`cre`](cre), [`indexer`](indexer), [`apps/web`](apps/web) | Observer, keeper, Chainlink CRE covenant workflow, Envio indexer (protocol events only), the app |

| Demo ([`demo/`](demo)) | Built on |
|---|---|
| PumpLab | `SliceEarner`; bound to its account and reviewer-approved |
| PumpLab Classic | An ordinary Ownable launchpad, guarded by a generic `FeeGuard` |
| Oracle Agent | `@slice/sdk/x402` (about 60 lines of its own code) |
| `demo/scripts` | Setup, traffic, Kuru listing, ERC-8004, demo moments |

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
- [`demo/scripts/kuru-market.ts`](demo/scripts/kuru-market.ts): `deployProxy` on the Kuru router, then a vault deposit.

### Nansen: payer screening
- On the issuer page, **Screen top payers with Nansen** checks payers against Nansen labels on Monad
  mainnet ([`apps/web/src/app/api/nansen/route.ts`](apps/web/src/app/api/nansen/route.ts)).
- The key stays server-side and results are cached. Empty lookups cost 0 credits.

### Monad
- Per-payment splitting and $0.01 x402 micropayments only make sense with fast, cheap transactions.
- About 600 ms finality makes repayment visible live: the bond page shows backing per claim updating as payments land.
- The x402 facilitator settles on Monad and pays the gas, so payers need only USDC.

### Also used
- **x402:** `@slice/sdk/x402` makes any paid API pay its SliceAccount; the Oracle Agent ([`demo/agent`](demo/agent)) is a real paid API built on it.
- **ERC-8004:** the agent is registered (agentId 2091). A default triggers negative reputation feedback
  from an independent reporter ([`demo/scripts/erc8004.ts`](demo/scripts/erc8004.ts)).
- **Mera:** passkey accounts (Face ID / Touch ID) as a wagmi connector, so no wallet extension is needed.

## Demo commands

| Step | Command |
|---|---|
| Native launchpad revenue, organic and wash | `pnpm tsx demo/scripts/traffic-launchpad.ts pumplab organic 1` · `… pumplab wash 1` |
| Locked launchpad revenue | `pnpm tsx demo/scripts/traffic-launchpad.ts classic organic 1` |
| Paid API traffic | `pnpm tsx demo/scripts/traffic-agent.ts 10` |
| Locked: the guard blocks a fee redirect | `pnpm tsx demo/scripts/demo-locked.ts` |
| Watched: payTo diversion → CRE default → ERC-8004 feedback | `pnpm tsx demo/scripts/demo-default.ts --yes` (irreversible) |

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

- Foundry: 49 tests, including fuzz and an accounting invariant suite (`forge test` in `contracts/`).
- TypeScript: tests for scoring, observer, worker, agent and web (`pnpm -r test`).

## Limits, stated plainly

- **Testnet only.** All demo activity comes from team-controlled wallets. The organic and wash cohorts
  differ only in who funded them, which is exactly what the wash detector looks at.
- **CRE runs as a local simulation** that broadcasts real reports, not a deployed DON. The observer is a
  single disclosed signer.
- **Native trust is a disclosed reviewer.** A contract can't verify arbitrary bytecode, so a reviewer
  approves Native projects' code; approved templates (code-hash registry) are the planned next step.
- **Nansen** covers Monad mainnet, not testnet. Our fresh demo payers come back unlabelled.

## Repository

```
contracts/src     PROTOCOL  SliceFactory, SliceAccount, SliceBond, FeeGuard, SliceCovenant, SliceEarner
packages/sdk      PRODUCT   @slice/sdk: ABIs, client, permit, x402 handler, revenue data
apps/web          PRODUCT   markets, issuer evidence and credit history, bond workspace, onboarding, passkeys
services/         PRODUCT   observer (signs payTo observations), worker (sweeps, closes, CRE loop)
cre/              PRODUCT   Chainlink CRE covenant workflow
indexer/          PRODUCT   Envio HyperIndex (protocol events only)
scripts/          PRODUCT   protocol deploy
demo/             DEMO      contracts (PumpLab, PumpLabClassic), agent (Oracle Agent), scripts
```

Run locally: `pnpm install`; `forge test --root contracts`; `pnpm -r test`; start
`anvil --code-size-limit 131072`, then run `SLICE_CHAIN_ID=31337 pnpm tsx scripts/deploy.ts` and
`demo/scripts/setup-demo.ts`.

Built during the hackathon by calledAdo, with AI pair-programming (OpenAI Codex, then Claude Code).
MIT licensed.
