# Slice

**Revenue bonds for onchain businesses on Monad.**

Monad apps earn fees onchain but can't borrow against them. Slice gives every business a revenue
account from day one. The account records each payment, with the payer, before the business ever asks
for money. When it raises, the same account automatically pays investors their share, in a way the
business either cannot route around (Native) or gets punished for routing around (Watched).

- App: https://slice-flame.vercel.app (Monad testnet)
- Demo issuer, a paid x402 AI API: https://slice-agent.vercel.app/api/oracle
- Indexer (Envio HyperIndex): https://indexer.dev.hyperindex.xyz/383cdcc/v1/graphql
- Specification: [`docs/SPEC.md`](docs/SPEC.md)

Built for Monad Metropolis, Track 1 (Onchain Finance & Trading).

## How it works

1. **Every business has a SliceAccount from day one.** It is the business's revenue address and
   payment entrypoint.
   - The account holds **one asset: the token the business charges fees in** (any ERC-20: USDC, WETH,
     ...). Its bonds raise and repay in that token, so no oracle or conversion is involved.
   - **Native projects** move money through it in both directions:
     - **in**, `collect(payer, gross, fee)`: the account *pulls* the payment from the payer (an approval or
       an EIP-2612 permit), keeps the fee and forwards the rest to the project; the payer is proven by the pull;
     - **out**, `settleOut(payer, gross, fee)`: for fees on what the payer receives (a sell), the project
       hands the payout to the account, which pays the payer minus the fee. The payer approves nothing.
   - The account records volume as well as fees, so the fee rate is on-chain; a bond can set a **fee
     floor** (`minFeeBps`) the project must keep while it is live.
   - **Plain transfers** (x402 settlements, anything else sent to the account) are booked with `sweep()`.
     The indexer tells them apart: an x402 settlement carries the payer's EIP-3009 signature; any other
     transfer is shown as an unclassified inflow and never counts as attributed revenue.
2. **The account keeps an on-chain credit history from its first payment:** total revenue, payments,
   distinct payers, first revenue date and revenue per day. This happens bond or no bond, so the record
   that underwrites a raise predates the raise.
3. **Raising.** Investors deposit USDC into a `SliceBond` and get 1:1 claim tokens.
   - **While the raise is open** an investor can withdraw (claims burn 1:1 for the escrowed deposit).
     The issuer can activate only a fully funded bond, before its funding deadline; if that doesn't happen,
     anyone cancels the raise after the deadline and every investor is refunded in full.
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

## Two ways to connect revenue

| Tier | For | Why revenue can't be diverted | Demo |
|---|---|---|---|
| **Native** | New projects built on Slice: inherit `SliceEarner` | Every fee is pulled through the account, which is fixed into the project's contract. A disclosed reviewer approves a **template** once (by creation-code hash); any issuer deploys it through `SliceFactory.deployNative`, bound to its own account in the same transaction, and can raise with no per-project review (custom contracts are still reviewed individually); history accrues before review: **impossible by construction for the reviewed contract's payment path** (the business can still stop operating or move users to a new contract) | PumpLab launchpad |
| **Watched** | Revenue paid over HTTP (x402 agents) | The business publishes `/.well-known/slice.json` (its account and every paid endpoint). **Chainlink CRE** checks the manifest and every endpoint's offer (every 30 minutes on testnet; each report covers one 30 s epoch): any option paying elsewhere or below the price floor is a violation; a violation is re-checked in the next 30 s epoch and two adjacent violations default the bond and slash the stake (so a diversion is caught within one check interval plus about a minute); a day of Unknown reports (offer unreachable) also defaults it, while a monitor outage never does. Guarded buyers (`@slice/sdk/x402-guard`) refuse to pay a `payTo` that isn't the published account: **caught and punished** | Oracle Agent |

```
 Native : trader ─ approve/permit ─► SliceAccount.collect ─┬─► fee: history, then the bond share ─► SliceBond
          PumpLab.buy() ─────────────────────────┘          └─► rest ─► PumpLab
          PumpLab.sell() ─ proceeds ─► SliceAccount.settleOut ─► fee kept (same split), rest ─► seller
 Watched: payer ─ x402 ─► facilitator ─ USDC ─► SliceAccount.sweep ─► same split
          Chainlink CRE ─ unpaid GET ─► agent's 402 offer ─ signed report ─► SliceCovenant ─ default ─► SliceBond
 Envio HyperIndex ◄─ factory / account / bond / covenant / USDC events ─► web app
 Kuru: claim/USDC order book and AMM vault          ERC-8004: agent identity and reputation
```

Any existing contract can still point its fee recipient at a SliceAccount to **build history**, but it
raises only once it is Native. An earlier Locked tier (an ownership guard around existing contracts) was
removed: a guard can only check the getters it is told about, so a second admin role, an upgradeable
proxy or a withdraw function would still divert fees, and making it safe needed the same review as
Native with weaker payer data.

Before a bond, an account must have `minHistory` of payment history (time is the one part of a history
that can't be faked), and every deposit re-checks the source: a Native project must still be reviewed and
bound, and a Watched bond's latest CRE observation must not be a violation.

## Join the live raise (judges welcome)

**CurveLab** (`CLAB-RC`, bond `0xD4E5901cce4A7173903F75e6e0327020f5C18B05`) is a second issuer on the same
reviewed Native template as PumpLab. Its raise is open until **28 October 2026** (the end of judging), so you
can take part with a testnet wallet:

1. Get test USDC from [Circle's faucet](https://faucet.circle.com) (Monad testnet); the app's drip sends MON for gas.
2. Open the bond in the app, approve and **Deposit**: you receive `CLAB-RC` claims 1:1.
3. Changed your mind? **Withdraw** any time before the deadline (claims burn 1:1 for your deposit).
4. When the raise is full the issuer activates it: from then on 25% of every CurveLab fee goes to claim
   holders in the same transaction. If it never fills, anyone can cancel after the deadline and every
   deposit is refunded in full.

Testnet only; nothing here is an offer (see Notices).

## Live on Monad testnet (chain 10143)

| What | Address |
|---|---|
| SliceFactory | `0xef7916dc8c95338cd060d498528484e97aa3c597` |
| SliceCovenant (CRE receiver) | `0x96a3fe15d3f311728ae836b9b0a7ad2feb252cb3` |
| CRE MockKeystoneForwarder | `0xB9F79d863261869B234c481D1f9A7af84AeAd192` |
| PumpLab (Native, reviewed template): account / project / bond `PLAB-RC` | `0xd5edc79C2a8589c268d37353d77183374897799a` / `0x72E53DD9D209512788e6F3859ce07c56f47983E9` / `0x80e0EB68a1731d545E80e6e9e997f66e6b38dEd0` |
| CurveLab (Native, same template, **raise open until 28 Oct**): account / project / bond `CLAB-RC` | `0x4295ba874FDf591AF88fD33C87A61b2e7A97b6D0` / `0xe45b023483B9323e7a41baBeb0e5186EC1FA8afB` / `0xD4E5901cce4A7173903F75e6e0327020f5C18B05` |
| Oracle Agent (Watched): account = x402 `payTo` / bond `ORCL-RC` | `0x8ec5924A95828c855834d7F5F37126B833AC3fAc` / `0xd30bf6d5ecf1f55D1212F1a66F9521eEFBA50c21` |
| Kuru `PLAB-RC`/USDC market / AMM vault | `0x6492423ca48E33C8D82D085a97B830C9f86a5720` / `0xE714Adae8c3F7E459dEcbA4120E246C8C8223Cf5` |
| Reviewed PumpLab template (creation-code hash) | `0x1fced72c3e11090c89cf67c3ff0929d704f5a201e7b607fa4ec24c46a2972344` |
| ERC-8004 agentId | `2117` (Identity Registry `0x8004A818BFB912233c491871b3d84c89A494BD9e`) |

| Transaction | Hash |
|---|---|
| CRE report (compliant) that gated the Watched bond's activation | `0xaf3145ff84f95aad172635f422fae94090c8169a3443d4b6bc4201b3c9d8e16f` |
| Watched bond activated | `0xae0ff2f65e2fa4d75cfde285f90dd16fb1ee93f0a3550b85833e0fdd7fee624e` |
| Paid x402 call settled to the agent's account | `0x07e90ba5d70e290d35b8e646873ef90e98bddc3678517bdff1cef58dfc6aa072` |
| Kuru market deployed / vault seeded | `0xdc1d3d538e60e2e63cf76d0479b76e8ba1a7b44da8e4aa481735ab5945a35722` / `0x9143e52c3a365644a5da752285664b2f39259bf6a89ef9d525bd6380a99e5242` |
| Kuru fills (test wallet): buy 0.5 USDC → 0.454 `PLAB-RC`, then sell 0.2 `PLAB-RC` → 0.229 USDC, each quoted by simulation with a 1% floor | `0xcc77e7752041e13898ebbf42f64727778352933a2a51658fd94130c789731900` / `0x3c40a9ab49be2bfd49724d10e1a604a33316ce726e994e28c8546587259bf9d8` |

Native repayment is visible on-chain: `pool()` on the `PLAB-RC` bond holds the investors' 25% of every PumpLab
fee since activation, split inside each trade's own transaction.

All addresses are in [`docs/deployments/10143.json`](docs/deployments/10143.json). Every payment above is labelled
test activity from team-controlled wallets (see Notices).

## Product vs demo

Slice is a protocol plus an SDK. The demo businesses are ordinary users of both.

| Product | |
|---|---|
| [`contracts/src`](contracts/src) | SliceAccount, SliceBond, SliceFactory, SliceCovenant, **SliceEarner** (inherit it to be Native) |
| [`packages/sdk`](packages/sdk) (`@slice/sdk`) | Typed ABIs and client (accounts, bonds, credit history), EIP-2612 permit for Native payments, **x402 handler** that pays a SliceAccount, revenue data and scoring |
| [`services`](services), [`cre`](cre), [`indexer`](indexer), [`apps/web`](apps/web) | Observer, keeper, Chainlink CRE covenant workflow, Envio indexer (protocol events only), the app |

| Demo ([`demo/`](demo)) | Built on |
|---|---|
| PumpLab | `SliceEarner`; bound to its account and reviewer-approved |
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
- [`indexer/`](indexer/) runs on Envio Cloud (deployed from the `envio` branch).
- Accounts, bonds and launchpads are registered dynamically from factory events (`indexer.contractRegister`).
- Each payment is attributed exactly once:
  - **Native:** the account's `Revenue` event; the payer is proven by the pull.
  - **x402:** USDC transfers into an account whose transaction also emits `AuthorizationUsed` for the
    sender (EIP-3009, how x402 settles); the payer signed it. This works before any bond exists.
  - **Anything else** sent to an account is an unclassified inflow: booked on-chain, never attributed.
- Treasury `FundingEdge`s flag payers funded by the business itself.
- This drives raw vs attributed revenue (attributed: a proven payer with no detected link to the issuer; not proof of an independent customer), the payer table, market totals and the bond views in the app
  ([`apps/web/src/lib/protocol.ts`](apps/web/src/lib/protocol.ts)).

### Kuru: a new asset class
- Revenue-bond claims trade on a Kuru order book against USDC, with an AMM vault.
- Listing: the issuer console (or [`demo/scripts/kuru-market.ts`](demo/scripts/kuru-market.ts)) calls `deployProxy` on the
  Kuru router, seeds the vault, and registers the market by its `MarketRegistered` receipt.
- Trading: every bond page with a market has a buy/sell panel
  ([`apps/web/src/components/app/trade.tsx`](apps/web/src/components/app/trade.tsx)). The quote is the market order
  itself, simulated against the live book (so it includes vault price impact and the taker fee); the order carries a
  minimum output 1% under the quote, and a quote older than 30 s is refreshed before sending. Market bid/ask is shown
  next to the claim's cash backing, so a market price is never confused with what a claim redeems for today.
- Script equivalent: [`demo/scripts/kuru-trade.ts`](demo/scripts/kuru-trade.ts).

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
- **ERC-8004:** the agent is registered (agentId 2117). A default triggers negative reputation feedback
  from an independent reporter ([`demo/scripts/erc8004.ts`](demo/scripts/erc8004.ts)).
- **Mera:** passkey accounts (Face ID / Touch ID) as a wagmi connector, so no wallet extension is needed.

## Demo commands

| Step | Command |
|---|---|
| Native launchpad revenue, organic and wash | `pnpm tsx demo/scripts/traffic-launchpad.ts pumplab organic 1` · `… pumplab wash 1` |
| Paid API traffic | `pnpm tsx demo/scripts/traffic-agent.ts 10` |
| Watched: payTo diversion → CRE default → ERC-8004 feedback | `pnpm tsx demo/scripts/demo-default.ts --yes` (irreversible) |

## Security

| Attack | Defense | Residual risk |
|---|---|---|
| Native project diverts fees | The account address is immutable in the project, and only the bound project can call `collect`/`settleOut` | The project can stop operating or move users to a new contract (priced by the claim on Kuru) |
| Issuer cuts its fee after raising | Optional `minFeeBps` bond term: payments below the floor revert while the bond is live | Bonds without a floor rely on review of the fee logic |
| Bond raised in a token the issuer can mint | Not prevented (any token is allowed); the profile shows the asset and the default market view promotes only well-known assets | Investors' choice, disclosed |
| Fake payer attribution | Native payments are pulled from the payer's own balance; the event carries the real source | Wash trading from wallets the business funds; caught by funding edges |
| Issuer pads history by sending USDC to its own account | Indexer classifies it as an unclassified inflow, excluded from attributed revenue; `minHistory` makes a history take real time | The on-chain counter still includes it (the on-chain milestone mode is disclosed as trustless but wash-able) |
| Investors fund a source that has gone bad | Every deposit re-checks review/binding (Native) or the latest CRE result (Watched) | — |
| Issuer changes the x402 `payTo` (Watched) | CRE checks the manifest and every endpoint on every report; any option paying elsewhere is a violation; two adjacent → default; stake slashed; ERC-8004 feedback | Revenue between the switch and detection: up to one check interval (30 min) plus about a minute; the investor share of that revenue is what the stake must cover |
| Issuer shows CRE the account but customers another wallet | Guarded buyers check each offer against the manifest before signing; the bond page alerts when attributed x402 revenue collapses while CRE reports compliant | Unguarded buyers can still be misled (disclosed) |
| Issuer goes dark to CRE while charging elsewhere | A day of Unknowns defaults the bond; an hour blocks deposits; gaps in monitoring never count | Up to a day of diverted revenue. The stake covers it only if stake ≥ revenue share × diverted revenue; issuers size the stake, investors should check it against daily revenue |
| Issuer adds a paid endpoint after raising | Every same-origin endpoint the manifest lists is checked too: it must pay the account (no price floor) | Endpoints never declared in the manifest cannot be seen |
| Forged default through the permissionless forwarder | Pinned observer EIP-712 signature, freshness and per-epoch replay checks | Trust in one observer key (disclosed) |
| Milestone faked with self-paid revenue (on-chain mode) | It costs real money, a share of which goes to investors; strict issuers choose the signed, wash-adjusted mode | By design; disclosed in the terms |
| Micro-payments rounding investors to zero | A rounding carry in the account's split | — |

- Foundry: 66 tests, including fuzz and an accounting invariant suite (`forge test` in `contracts/`).
- TypeScript: tests for scoring, observer, worker, agent and web (`pnpm -r test`).

## Limits, stated plainly

- **Testnet only.** All demo activity comes from team-controlled wallets. The organic and wash cohorts
  differ only in who funded them, which is exactly what the wash detector looks at.
- **CRE runs as a simulation** that broadcasts real reports, not a deployed DON: a small server runs the
  observer and `cre workflow simulate --broadcast` every 30 minutes ([`ops/covenant-server`](ops/covenant-server)).
  The observer is a single disclosed signer.
- **Native trust is a disclosed reviewer, applied once per template.** A contract can't verify arbitrary
  bytecode, so the reviewer approves a template's creation-code hash; the factory then enforces that a
  project is exactly that code, pointed at its own account. Revoking a template revokes every project
  built from it. Custom contracts still need an individual review.
- **Nansen** covers Monad mainnet, not testnet. Our fresh demo payers come back unlabelled.

## Architecture

```
                    ┌────────────── Monad testnet ──────────────┐
 payers ──────────► │ SliceAccount ──share──► SliceBond ◄── investors (deposit, redeem)
 (Native: collect/  │      │ rest                 │ claims (ERC-20) ──► Kuru order book + vault
  settleOut;        │      ▼                      ▲
  x402: transfer    │   business           SliceFactory (accounts, bonds, activation, releases)
  + sweep)          │                             ▲
                    │                     SliceCovenant ◄── Chainlink CRE report (Watched only)
                    └──────────────┬──────────────┘                ▲
                                   │ events                        │ signed observation
                         Envio HyperIndex ──► web app      observer ── unpaid GET ──► agent's 402 offer
```

- **Contracts** hold the money and the rules: accounts split each payment, bonds hold investor capital and
  repayments, the factory gates issuance (minimum history, review, CRE health), the covenant records
  observations and defaults.
- **Off-chain services** never hold funds. Envio indexes events for the app (and flags payers funded by
  the business); the observer and CRE prove that a Watched business still pays its account; the web app
  reads the indexer and the chain, and writes through the user's wallet.

## Tech stack

| Layer | Technology |
|---|---|
| Chain | Monad testnet (chain 10143) |
| Contracts | Solidity 0.8, Foundry, OpenZeppelin Contracts |
| Indexing | Envio HyperIndex (Envio Cloud) |
| Covenant checks | Chainlink CRE (TypeScript SDK, simulate + broadcast), observer service (Node, viem) |
| Payments | x402 (`@x402/core`, `@x402/evm`), EIP-3009 USDC, EIP-2612 permits |
| Market | Kuru order book and AMM vault (Kuru SDK) |
| Identity | ERC-8004 identity and reputation registries |
| Web | Next.js 16, React 19, Tailwind CSS v4, wagmi, viem, Fumadocs, Mera passkeys |
| Demo agent | Next.js on Vercel, Upstash Redis, Groq-hosted open model |

## Run it yourself

Requirements: Node 22, pnpm 10, [Foundry](https://getfoundry.sh), and for the CRE workflow
[Bun](https://bun.sh) and the [CRE CLI](https://docs.chain.link/cre).

```bash
git clone https://github.com/calledAdo/slice && cd slice
pnpm install
forge test --root contracts        # contract tests (fuzz + invariants)
pnpm -r test                       # TypeScript tests
```

Local chain, end to end:

```bash
anvil                                                       # terminal 1
SLICE_CHAIN_ID=31337 pnpm tsx scripts/deploy.ts             # deploys MockUSDC + the protocol
SLICE_CHAIN_ID=31337 pnpm tsx demo/scripts/setup-demo.ts pumplab
SLICE_CHAIN_ID=31337 pnpm tsx demo/scripts/traffic-launchpad.ts pumplab organic 1
SLICE_CHAIN_ID=31337 pnpm tsx demo/scripts/setup-demo.ts pumplab   # creates the bond (clock is advanced locally)
SLICE_CHAIN_ID=31337 pnpm tsx scripts/dev-indexer.ts        # terminal 2: stands in for Envio on :8546
```

Then the app (terminal 3), with the addresses `deploy.ts` wrote to `docs/deployments/31337.json`:

```bash
cd apps/web
NEXT_PUBLIC_CHAIN_ID=31337 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 \
NEXT_PUBLIC_INDEXER_URL=http://127.0.0.1:8546 \
NEXT_PUBLIC_USDC_ADDRESS=<asset> NEXT_PUBLIC_FACTORY_ADDRESS=<factory> pnpm dev
```

Testnet: `pnpm tsx scripts/deploy.ts` (deployer key in `~/.slice`, see [`scripts/lib.ts`](scripts/lib.ts)),
then the same demo scripts without `SLICE_CHAIN_ID`, waiting `minHistory` (10 minutes) between the two
`setup-demo.ts` runs. Test USDC comes from Circle's faucet; the app's drip only sends gas (MON).
The indexer config is generated with `node indexer/gen-config.mjs 10143`; the CRE reporter setup is in
[`ops/covenant-server`](ops/covenant-server).

## Repository

```
contracts/src     PROTOCOL  SliceFactory, SliceAccount, SliceBond, SliceCovenant, SliceEarner
packages/sdk      PRODUCT   @slice/sdk: ABIs, client, permit, x402 handler and guard, revenue data
packages/scoring  PRODUCT   revenue scoring, Envio and Nansen clients
apps/web          PRODUCT   site, docs, markets, bond and account pages, portfolio, issuer console
services/         PRODUCT   observer (signs payTo observations), worker (sweeps, closes)
cre/              PRODUCT   Chainlink CRE covenant workflow
indexer/          PRODUCT   Envio HyperIndex
scripts/          PRODUCT   protocol deploy, local dev indexer
ops/              PRODUCT   covenant reporter server (systemd)
demo/             DEMO      contracts (PumpLab), agent (Oracle Agent), scripts
```

## Notices

- **Testnet only; not an offer.** Claim tokens are testnet demonstrations of a revenue-bond design. Nothing
  here is an offer or solicitation of securities or investment, and nothing is issued, endorsed or
  approved by the Monad Foundation or any sponsor.
- **Simulated traffic.** Every payer, trade and payment on testnet comes from team-controlled wallets.
  The "wash" cohort is a deliberate, labelled simulation of an attack that Slice's indexer detects and
  excludes; none of it is presented as real volume or traction.

## Build history and AI disclosure

- All work was done during the Metropolis hackathon period (from 1 September 2026). The project began
  as **Zeitgeist**, an attention-markets product, and pivoted to Slice, a finance primitive. Slice is a
  new codebase; it shares no code with Zeitgeist, only a testnet deployer wallet.
- The history starts on 9 October 2026 because work before then (in AI coding sessions) was imported as
  snapshots: the first commits are named "Snapshot of Codex's … build".
- **AI tools:** built with AI pair-programming, first OpenAI Codex, then Claude Code (Anthropic). The AI
  wrote most of the code under the author's direction; design decisions, review, testing and deployments
  were directed and checked by the author.

## Attribution

Built on open-source work, used under their licenses:
[OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) (MIT),
[Foundry](https://github.com/foundry-rs/foundry), [viem](https://github.com/wevm/viem) and
[wagmi](https://github.com/wevm/wagmi) (MIT), [Next.js](https://github.com/vercel/next.js) (MIT),
[Fumadocs](https://github.com/fuma-nama/fumadocs) (MIT), [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) (MIT),
[lucide](https://github.com/lucide-icons/lucide) (ISC), [Geist font](https://github.com/vercel/geist-font) (OFL),
[Envio HyperIndex](https://github.com/enviodev/hyperindex), [Chainlink CRE SDK](https://docs.chain.link/cre),
[x402](https://github.com/coinbase/x402) (Apache 2.0), [Kuru SDK](https://www.npmjs.com/package/@kuru-labs/kuru-sdk),
[Mera](https://www.npmjs.com/package/@category-labs/mera), and the Monad and ERC-8004 registries on testnet.
The web design takes cues from the Kokonut UI design system; no assets were copied.

Built by calledAdo. MIT licensed (see [`LICENSE`](LICENSE)).
