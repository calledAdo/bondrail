# Slice: verification register

> **Latest amendment:** [Testnet and staged capital release](testnet-and-staged-release.md) takes precedence over mainnet-first demonstration, full-principal-at-activation, and fixed full-raise-cap assumptions below. Default development/integration is Monad testnet. Proposed two-stage drawdown releases 50/50 or25/75 under a frozen policy; undrawn principal recovery and proportional revenue caps require the accounting changes in that amendment.

Research date: 9 October 2026. This register distinguishes primary documentation, live read-only probes, user-supplied information, and unperformed implementation tests. Local `sources/` preserves successful retrievals and some failed/outdated paths; a downloaded 404 is not evidence of capability.

## What changed since the earlier Metropolis dossier

Direct outbound retrieval worked in this session. Earlier sponsor-coverage unknowns can therefore be narrowed. The original reports remain historical; this register and the current plan state the new evidence.

| Claim | Evidence actually inspected | Status / remaining boundary |
|---|---|---|
| Event deadline and deliverables | [Official Metropolis page](https://monad.xyz/developers/hackathons/metropolis); retained `monad-event.html` and `.txt` | Page says 13 Oct, demo + short write-up + code link in public profile; existing projects may submit new work; open source encouraged, not required. Exact cutoff time/timezone and platform rules remain unverified. User supplies 2026 and 12 Oct target. |
| Sponsor titles/prize amounts in supplied map | Same official page lists Envio $1k, CRE $3k, Kuru new assets $5k, Nansen $5k and grand champion $25k | Public titles/amounts confirmed; complete requirements/stacking/judging weight require authenticated platform. Kimi credits bounty also appears, but do not add a claim without its exact terms. |
| Full bounty requirements | [Hackathon platform](https://hackathon.monad.xyz), retained `hackathon-platform.html`/`.txt` | Public response is sign-in/intake page. Exact bounty texts were **not** retrieved. Do not manufacture `docs/bounties.md` requirements from headline titles. |
| Chainlink simulation allowed by sponsor | User-supplied email confirmation in specification | Treat as supplied authorization/evidence claim; attach the actual relevant correspondence to the team's private verification record or quote with permission in submission. No email was accessed or sent here. |
| Mock forwarder is unsafe as sole authorization | [Official MockKeystoneForwarder source](https://github.com/smartcontractkit/chainlink-evm/blob/develop/contracts/cre/src/dev/MockKeystoneForwarder.sol), retained `MockKeystoneForwarder.sol.txt` | Source explicitly makes reporting permissionless and skips production signature/config validation; public route can supply transmitter/metadata. This is a design blocker for unguarded slashing. Deployed bytecode equivalence is still a probe. |
| Sample receiver has mutable security controls | [ReceiverTemplate.sol](https://docs.chain.link/samples/CRE/ReceiverTemplate.sol), retained source | Owner can change forwarder/metadata checks, including disabling forwarder check with zero. `onReport` and setters are non-virtual. Also requires `IERC165.sol` alongside `IReceiver.sol`. |
| Monad mainnet simulation forwarder address | [CRE CLI supported chains source](https://github.com/smartcontractkit/cre-cli/blob/main/cmd/workflow/simulate/chain/evm/supported_chains.go) | Current source maps mainnet to supplied `0x9eF6468C5f37b976E57d52054c693269479A784d`. Installed CLI release, deployed code and a broadcast remain to verify. Production address not independently verified. |
| Alternative custom simulation forwarder | [CRE CLI chain resolver](https://github.com/smartcontractkit/cre-cli/blob/main/cmd/workflow/simulate/chain/evm/chaintype.go) | Current source supports experimental-chain override for an existing selector. This could authenticate a dedicated simulation broadcaster, but exact released CLI behavior/ABI needs proof. Canonical-mock + signed observer remains the proposed default. |
| x402 v2 402 shape | [V2 protocol spec](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md), retained `x402-v2.md` | `PAYMENT-REQUIRED` header, base64 JSON with `x402Version`, `resource`, `accepts`. A fixture from the actual app is still required. |
| Monad USDC exact settlement supported | [x402 network/token support](https://docs.x402.org/core-concepts/network-and-token-support), [exact EVM spec](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md) | Documentation lists `eip155:143`, supplied USDC, 6 decimals, EIP-3009. Token signatures do not automatically bind arbitrary HTTP resource/body fields. |
| Facilitator currently advertises Monad | Live read-only [GET /supported](https://x402-facilitator.molandak.org/supported), retained `molandak-supported.json` | Returned v2 exact for chain 143 and 10143. No paid call, gas sponsorship, verify/settle success or uptime was tested. |
| Runtime `withX402` configuration | Protocol/guide material only; no SDK execution in this planning session | **Open:** pin compatible SDK versions and prove per-request dynamic recipient across replicas. |
| Kuru two-ERC20 existing-token market | [Deploy market](https://docs.kuru.io/sdk/deploy-market.md), [Router](https://docs.kuru.io/contracts/Router.md) | Explicit `ParamCreator.deployMarket`, existing base/quote addresses, `0 = NO_NATIVE`, vault seed example. Actual six-decimal bond market deployment/withdrawal/redemption remains untested. |
| Kuru mainnet Router and MarginAccount | [Contract addresses](https://docs.kuru.io/contracts/Contract-addresses.md) | Both match user spec. Deployed Router returns code in live read probe; ABI/permissions/upgrade state not established by code existence. |
| ERC-8004 mainnet identity/reputation | [Reference repository README](https://github.com/erc-8004/erc-8004-contracts), retained `erc8004-readme.md` | Monad mainnet section lists both supplied addresses. Live RPC returns code at both; implementations/interface behavior not exercised. |
| `giveFeedback` ABI and self-feedback restriction | [ReputationRegistryUpgradeable source](https://github.com/erc-8004/erc-8004-contracts/blob/master/contracts/ReputationRegistryUpgradeable.sol) | Signature matches supplied parameters; owner/authorized operator cannot self-rate. Actual deployed implementation/read-write probe remains required. |
| Kimi model/base URL | [Current official quickstart](https://platform.moonshot.ai/docs/guide/quickstart.md), retained `kimi-quickstart.md`; redirected platform page also retrieved | Explicit `kimi-k3`, `https://api.moonshot.ai/v1`. Account access, available model list, latency and per-answer costs remain untested. Initial `docs.moonshot.ai` lookup failed. |
| Envio dynamic registration | [Dynamic contracts](https://docs.envio.dev/docs/HyperIndex/dynamic-contracts.md) | `contractRegister` and same-block capture documented, including earlier same-block events. Actual generated handler types/version need integration fixture. |
| Dynamic USDC destination filtering | [Wildcard indexing](https://docs.envio.dev/docs/HyperIndex/wildcard-indexing.md) | Documented filtering against dynamically registered contract addresses. This should be the default probe before an all-USDC handler scan. Treasury prehistory needs explicit backfill. |
| Envio preload/reorg behavior | [Handlers](https://docs.envio.dev/docs/HyperIndex/event-handlers.md), [reorgs](https://docs.envio.dev/docs/HyperIndex/reorgs-support.md), [effects](https://docs.envio.dev/docs/HyperIndex/effect-api.md) | Preload can invoke handlers twice; default managed rollback does not undo arbitrary external effects/caches. Explicit fields needed for transaction data; replay/reorg tests required. |
| Nansen Monad coverage | [Data coverage](https://docs.nansen.ai/api/data-coverage.md), endpoint schemas below | Documentation lists Monad history from 14 May 2025; all three inspected profiler chain enums include `monad`. Account-specific access not tested. |
| Related-wallets schema | [Reference](https://docs.nansen.ai/api/profiler/address-related-wallets.md) | `wallet_address`, chain, pagination; current relationship data, not historical time travel. Common counterparty does not necessarily mean same owner. |
| Counterparties schema | [Reference](https://docs.nansen.ai/api/profiler/address-counterparties.md) | Method-specific `address`, chain/date/grouping/pagination; caches and window limits require explicit API policy. |
| Labels schema/credits | [Reference](https://docs.nansen.ai/api/profiler/address-labels.md) | Current labels; empty result can reflect absent labels, premium exclusion or pagination. Documented nonempty standard/premium costs need account-budget validation. |
| Monad reserve rule | [Reserve-balance docs](https://docs.monad.xyz/developer-essentials/reserve-balance) via retained extracted source/source manifest | 10 MON is a protocol reserve parameter, not a universal minimum account balance. Undelegated emptying exceptions and sponsored zero-balance flows matter. Verify transaction-sender needs instead of funding every x402 payer with 10 MON. |
| Monad gas/latency headline | [Monad for developers](https://docs.monad.xyz/developer-essentials/summary), retained `monad-summary-extracted.txt` | Current docs state 300 ms blocks and consensus Finalized after two blocks (~600 ms), matching the supplied timing. Verified execution/state-root agreement arrives three blocks later (T+5 from proposal). Measure app receipt, sweep, Finalized/Verified and indexing latency separately; do not label all of them 600 ms. |

## Actual read-only Monad RPC probe

A single batch POST to `https://rpc.monad.xyz` was executed without credentials, signing or transactions. Raw result: [monad-read-probe.json](sources/monad-read-probe.json).

| Method | Target | Result |
|---|---|---|
| `eth_chainId` | RPC | `0x8f` = 143 |
| `eth_call decimals()` at `finalized` | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | 6 |
| `eth_getCode` at `finalized` | Identity Registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | Nonempty, 130 bytes |
| `eth_getCode` at `finalized` | Reputation Registry `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | Nonempty, 130 bytes |
| `eth_getCode` at `finalized` | Kuru Router `0xd651346d7c789536ebf06dc72aE3C8502cd695CC` | Nonempty, 141 bytes |

Nonempty code is not source/implementation verification. The returned small proxy code sizes do not establish the implementation behind a proxy, governance permissions, correct ABIs or operational readiness. These calls used `finalized` independently, not one recorded block-hash snapshot; do not present them as a reproducible historical financial reconciliation.

## Build probes, evidence and go/no-go conditions

| ID | Owner | Real probe required | Pass evidence | Failure response |
|---|---|---|---|---|
| V01 | Lead | Read authenticated bounty/platform rules | Exact text, date/URL, rule IDs, deadline timezone, stacking and submission fields | Continue engineering against known scope; do not claim unknown bounty eligibility |
| V02 | C | Deploy unpaid x402 route, flip shared payTo across replicas | Saved 402 headers/JSON fixtures, config revisions | Fix dynamic wrapper/KV behavior before Watched demo |
| V03 | C/I | One permitted small paid call | Settlement success, real USDC transfer to Router, request ID and bounded Kimi response | Fix scheme/token/facilitator account path; no fabricated traffic history |
| V04 | D | CRE compile/simulate/broadcast and malicious relay tests | Installed version ledger, authenticated receiver event/tx, arbitrary mock route rejected | Do not expose a slashing receiver secured only by the mock |
| V05 | A/B | Full lifecycle and guard/curve test/fork suite | Reproducible commands and financial invariant results | Block deployed funding until corrected |
| V06 | E | Envio dynamic registration/filter/reorg replay | Same-block fixture, reconciliation, finality/lag evidence | Repair ingestion; broad bounded scan only with measured cost |
| V07 | F | Authenticated Nansen calls on Monad | Sanitized request/response fixtures, credits, pagination, coverage | Preserve deterministic core; label provider unavailable and remove unsupported claim |
| V08 | H | Existing bond-token Kuru market and full custody exit | Market/vault addresses, seed/trade/cancel/withdraw/redeem txs | Keep primary financing; do not claim completed Kuru integration |
| V09 | H | ERC-8004 register/read/feedback restriction | Agent ID/URI, reporter ownership checks, feedback tx and evidence | Keep feedback optional and independent from enforcement |
| V10 | I/G | Real timing/gas/spend/restart rehearsal | Measured detection latency, state milestones, worker cursors and budget | Correct marketing and polling/gas settings; stop unbounded loops |

No V02–V10 success is claimed by this planning document. Unit-level analytical examples in the plan are design checks, not deployed integration evidence.
