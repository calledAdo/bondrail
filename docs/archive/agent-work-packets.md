# Slice: agent work packets

> **Latest amendment:** [Testnet and staged capital release](testnet-and-staged-release.md) takes precedence over mainnet-first demonstration, full-principal-at-activation, and fixed full-raise-cap assumptions below. Default development/integration is Monad testnet. Proposed two-stage drawdown releases 50/50 or25/75 under a frozen policy; undrawn principal recovery and proportional revenue caps require the accounting changes in that amendment.

Planning artifact, 9 October 2026. Execute these only after starting a separate authorized build session. The [build plan](build-plan.md) contains proposed amendments to the user brief; freeze them in `docs/SPEC.md` before assigning implementation.

## Shared instructions for every builder

Read the frozen specification, adopted ADRs, `docs/interfaces.md`, `docs/threat-model.md`, deployment/network configuration and your immediate dependency handoff. Never independently redefine financial terms or copy unverified API snippets into core code.

Use an isolated branch/worktree. Own only the assigned paths. The integration lead owns root manifests/lockfile, shared schema versions and deployment manifests. Request an interface change with its downstream impact rather than editing another agent's files. No agent may invent provider success, make synthetic receipts appear organic, or replace failed live integrations with unlabeled fixtures.

Each handoff includes:

1. Commit/files and the completed acceptance gate.
2. Exact package/tool versions and commands run.
3. Tests/probes with outputs, fixtures, transaction hashes where actually executed, and their network.
4. Public API/event/schema changes and dependent agents affected.
5. Remaining assumptions, failures, operating cost and restart/run instructions.

Keep secrets out of messages, checked-in manifests, screenshots, test output and browser bundles. Mainnet spending/deployment requires the build session's authorization and explicit configured limits. This document does not authorize transactions merely by describing them.

## Lead — architecture, interfaces and integration

**Own:** `docs/SPEC.md`, `docs/adr/`, `docs/interfaces.md`, root workspace files, `packages/shared/`, CI orchestration, release/deployment manifests.

**First deliverable:** freeze the following decisions in one document: final-only redemption; earliest-close maturity; separate default history; cap excludes stake; principal released at activation; funding cancellation; bounded Closing evidence window before final settlement; Router/issuer credits; known-source guard eligibility; canonical-mock signed observer; tri-state evidence/epoch rules; revenue/score definitions; controlled demo disclosure.

Publish ABI/event contracts and report fixtures before parallel consumers code. Record generated artifact hashes; enforce regenerated outputs in CI. Choose one exact Router/Bond/Factory call graph and show it in the interface contract. Define decimal-string DTOs and status derivation centrally.

**Acceptance:** every contributor can answer who holds each USDC balance, who may move it, when collection ends, what evidence slashes, and which source of truth drives each screen. Two agents independently explain the same sample ledger with identical results.

## A — bond, Router and Factory economics

**Own:** `contracts/src/SliceBond.sol`, `SliceRouter.sol`, `SliceFactory.sol`, their interfaces and unit/invariant tests. Coordinate changes to generated shared files through Lead.

**Inputs:** frozen ADRs and call graph; USDC deployment identity; adapter-validation interfaces; covenant callback shape.

**Deliverables:** separated funding/pool/stake/credit ledgers; deadline-safe activation/cancellation/refunds; collection-only immutable supply; full-precision splits with carried rounding; cap and collection close; fixed Closing evidence window and permissionless final settlement; permanent default record; final redemption; Factory provenance and versioned policy snapshots.

**Acceptance:** all financial cases in build-plan §10 pass, including filled-but-unactivated cancellation, pre-activation flush, failed issuer transfer, tiny-sweep attack, delayed close, double slash, post-default cap completion, all tokens redeemed, unsolicited donations and a second issuance. Fuzz ghost balances account for every unit.

**Handoff to:** D for authenticated default callback; E for event schemas; G for transaction/state wiring; H for claim custody tests; I for deployment.

## B — FeeGuard and PumpLab source

**Own:** `contracts/src/FeeGuard.sol`, `contracts/src/demo/*`, their tests and source-policy manifest.

**Inputs:** known-source eligibility mechanism, Router atomic-sweep interface, guard/issuer bindings, allowed selector/parameter policy.

**Deliverables:** non-upgradeable fixed-supply meme token; per-token real/virtual reserve accounting; buy/sell fee handling; safe-selector guard; code/owner/recipient/floor checks; correct ownership transfer/release; source events sufficient for fee-to-receipt reconciliation.

**Acceptance:** blocked recipient/rate/ownership/upgrade/unknown selectors revert; safe name-limit update works; indirect temporary diversion is unavailable; virtual quote cannot pay an unfunded sell; one meme token cannot consume another's reserves; multi-trade rounding cannot create profit or evade fees; ownership deployment order works exactly as documented.

**Handoff to:** A for guard provenance; E for Trade attribution; G for issuer guard panel; I for deployment and demo controls.

## C — x402 Oracle Agent and durable configuration

**Own:** `apps/agent/`, shared KV configuration adapter, agent-specific admin authorization/tests, registration document source.

**Inputs:** final domain, network/token/payment-policy schema, authenticated admin identity, final Router when available, provider account access.

**Deliverables:** pinned compatible x402 SDK packages; real 402 fixture; Kimi bounded request handler; request-id/payment idempotency; replica-safe dynamic payTo; authenticated audit-logged switch; registration endpoint; actual settlement reconciliation hooks.

**Acceptance:** unpaid request never calls Kimi; one budgeted payment reaches the expected Router; amount resolves to exactly 10,000 USDC base units; payTo changes on subsequent requests across replicas without deployment; invalid/expired/replayed authorization and upstream/settlement failure follow documented behavior; no secret/admin token in client bundle.

**Handoff to:** D for exact parser fixture/endpoint; E for request/settlement attribution; G for real demo control; H for registration URI.

## D — observation service, CRE workflow and receiver authentication

**Own:** `services/observer/`, `cre/slice-covenant/`, `contracts/src/SliceCovenant.sol`, vendored CRE receiver interfaces with upstream license/source hashes, covenant tests. Worker process scheduling belongs to I; provide its command/API contract.

**Inputs:** signed-observation schema/domain vectors; immutable policy registry; C's exact 402 fixture; A's activation/default interface; verified CLI/SDK versions and forwarder identity.

**Deliverables:** fetch-only signer with one persisted observation per epoch; canonical strict parser; independent CRE node-mode observation/consensus; signed-observation agreement; real runtime report/write; immutable receiver checks and frozen sample settings; tri-state monitoring and replay-safe two-strike transition, including bounded out-of-order epoch slots and pre-close evidence during Closing.

**Acceptance:** unauthorized public mock `report` and `route` paths cannot slash; forged transmitter/metadata does not authenticate; one repeated report cannot count twice; cross-chain/policy/receiver and stale/future reports fail; timeout/200/malformed/empty/mixed unsupported offer becomes Unknown; valid recipient change in two adjacent epochs slashes once; sample owner cannot reconfigure active security; collection close/final settlement/cancellation and Funding reports handled safely; delayed pre-close evidence remains eligible during Closing and no report can extend settlement.

**Trust statement:** prototype trusts the observer signing key; simulation is not production DON consensus. The workflow must still actually fetch, compare and report through CRE. If considering the custom authenticated simulation-forwarder alternative, escalate it as a versioned ADR and prove the exact CLI feature first.

**Handoff to:** A activation-readiness integration; E normalized evidence events; G health timeline; I worker command, latency/error/gas budget.

## E — Envio ledger and reconciliation

**Own:** `indexer/`, deterministic event fixtures/tests, GraphQL projections and reconciliation scripts.

**Inputs:** A/B/D ABIs; named mainnet addresses/start blocks; treasury history start; x402 attribution records from C; chain finality/rollback policy.

**Deliverables:** dynamic Router/Bond registration; documented indexed-argument filter for relevant USDC transfers; canonical receipt ledger; adapter-specific fee attribution; scoped funding edges; issuance/pool/default/close state; finality/cutoff/coverage metadata; deterministic reindex and rollback runbook.

**Acceptance:** same-block creation/events captured; duplicate/preload/replay does not double-count; Trade fee plus actual transfer yields one revenue item; unknown receipts stay separate; funding before Router creation can be backfilled; entity rollback and external cache invalidation tested; indexed totals reconcile against contract balances/ledgers at a pinned state.

**Handoff to:** F for scoring inputs/coverage; G for GraphQL; I for Cloud deployment and lag monitoring.

## F — underwriting and Nansen evidence

**Own:** scoring library/API, provider client/cache, evidence snapshots, formula tests, payer-assessment DTO implementation.

**Inputs:** E's canonical data/coverage; frozen scoring version, denominator and minimum meaningful amounts; provider account/credit budget; issuer profile snapshot.

**Deliverables:** observed/eligible/concentration-adjusted amounts; issuer/time-scoped evidence reasons; unclipped HHI; separate coverage and heuristic score; sufficient-history gate; deterministic advisory terms; Nansen top-payer enrichment with provenance, pagination, timeout and credit controls.

**Acceptance:** formula has a fixed denominator; zero/incomplete history does not gain false diversification points; 90/10 payer split at E=100 produces A=20 and HHI=0.82; donor/related/synthetic/unqueried distinctions preserved; empty Nansen labels are Unknown/no-labels; synthetic demonstration activity never powers an unlabeled real credit recommendation.

**Handoff to:** G for score/waterfall/evidence UI; I for documented account limits and reproducible issuance snapshot.

## G — investor, issuer and operator frontend

**Own:** `apps/web/` presentation, wallet interactions and view-specific tests, excluding F-owned scoring modules/routes by agreed boundaries.

**Inputs:** shared ABIs/DTOs, deterministic fixtures, real deployment manifests, real indexer/provider APIs and health endpoints.

**Deliverables:** market, issuer detail, bond detail, resumable issue wizard and authenticated demo page. Explain current pool versus projected receipts versus market quote; handle Funding-filled-but-not-activated and Cancelled refunds; allow close and final redemption with Kuru withdrawal guidance.

**Acceptance:** every wallet action uses the actual chain/contract and handles rejection/revert/retry; no floating-point money; no early redemption button while collecting; default history survives Completed; Closing shows the evidence deadline and disables redemption until final settlement; lag/Unknown/no-data are visible; proposed/receipt/finalized presentation matches actual observed milestones; operator controls are authorization-protected.

**Design:** clear financial hierarchy, distinct Locked/Watched scope, accessible status states, evidence beside score, first-use clarity. Read the relevant frontend-design skill during implementation rather than copying a generic dashboard template.

## H — Kuru custody and ERC-8004

**Own:** Kuru and ERC-8004 scripts/adapters, versioned ABI fixtures, external-integration tests and documentation.

**Inputs:** one Active non-rebasing claim token; separate funded seed inventory; current Kuru market-factory/vault/margin ABIs; stable agent URI; independent-role reporter wallet.

**Deliverables:** existing-token ERC20/ERC20 market with validated precision; seed/quote/order/trade/cancel/withdraw and LP recovery; identity registration; idempotent finalized-default feedback with evidence document/hash.

**Acceptance:** actual claim withdrawal and final redemption work; no unbacked mint for market seeding; near-zero and cap-plus-stake price ranges supported; remaining exchange custody balances/approvals visible; registry owner/operator feedback restriction tested; feedback failure does not block bond settlement. Report observed market response without fabricating independent price discovery.

## I — operations, deployment and submission evidence

**Own:** `services/worker/`, deployment/runbook scripts, secrets-variable templates, transaction budget ledger, reproducible demo scripts, README evidence assembly. Lead approves manifest updates.

**Inputs:** completed contract tests, verified ABI/address fixtures, hosting/account access and authorized transaction limits.

**Deliverables:** resumable deployment; source verification; correct PumpLab feeRecipient-before-ownership-transfer order; final domain registration; frozen receiver settings; bounded traffic/keeper/CRE jobs with restart cursors; distinct role keys; protected demo command surface; monitoring; separate irreversible demo issuances; evidence map and final rehearsal checklist.

**Acceptance:** worker restarts do not duplicate payments/default feedback; no overlapping CRE epochs; only nonzero collectible Router balance is swept; estimate-derived capped gas limits; funds/key roles documented without secrets; every live claim has real transaction/source evidence; exact bounty wording is captured from authenticated platform; unknown terms stay unknown until read.

Submission is a later external action, requiring whatever authorization the build session provides. Prepare a concrete preview before asking for any approval still required. Never send sponsor/team messages merely because a task note suggests asking in Discord.

## J — independent adversarial review

**Own:** review report and exploit/regression test changes on a dedicated branch. Reviewers should not approve their own financial/receiver implementation without independent challenge.

**Inputs:** frozen final code, deployment configuration, invariants, fixtures and successful end-to-end run evidence.

**Attack objectives:** obtain/refund principal twice; strand a zero-supply pool; erase default history; divert supported source fees; reset rounding; drain another token's curve reserves; fake a guard; forge/replay mock reports; turn outages into slashes; count one fee twice; convert unknown/synthetic data into confident underwriting; trap claims in exchange custody; mutate live policy through admin paths.

**Acceptance:** every material finding has a reproduction, correction and regression test or a precise change to the promised scope. Run/triage Wake; do not use its output as a substitute for the financial invariants and authenticated report tests.

## Suggested scheduling

With an integration lead plus three concurrent specialists:

| Wave | Specialist 1 | Specialist 2 | Specialist 3 | Integration lead |
|---|---|---|---|---|
| 0 | A economic model/ABI | C x402 probe | D CRE/auth probe | Freeze decisions, bounty/access capture, shared types |
| 1 | A contracts | B guard/launchpad | C agent + D observer work sequenced | Merge interfaces, start UI/data fixtures |
| 2 | D receiver/workflow | E indexer | F scoring | G frontend and deployment readiness |
| 3 | H Kuru/identity | I operations | J independent review | G live integration and fixes |
| 4 | J regression checks | I rehearsal/evidence | Available integration fixes | Final product walkthrough and submission preview |

With more capacity, E/F/G can start fixture-based development as soon as shared schemas stabilize, while H runs access/precision probes early. Do not wait until the final wave to discover provider access is unavailable. Completion is determined by gates G0–G5 in the build plan, not by the number of agents reporting “done.”
