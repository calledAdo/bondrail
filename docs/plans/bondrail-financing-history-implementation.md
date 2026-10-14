# Bondrail financing history and repeat issuance: implementation plan

Date: 13 October 2026. Status: proposed, not implemented.

14 October research addendum: the [updated execution roadmap](../research/bondrail-execution-roadmap-2026-10-14.md)
adds a servicing prerequisite. Public finalized reads found the Watched bond's latest decisive observation
at 13 October 11:30:55 UTC and `isHealthy = false` at the 14 October snapshot. Investigate reporter liveness,
restore sustained accepted reports, and define an on-demand fresh-evidence path before activation/second
release. Missing reports do not establish issuer misconduct. Add operating-cash scenarios to phase 2;
complete a settlement/holder-proceeds demonstration before expanding integrations.

Based on [the product research](../research/bondrail-product-strategy-2026-10-13.md) and inspection of the
current contracts, indexer, app, scoring package and worker.

## Product outcome

An investor can inspect a business's previous financing, distinguish successful collections from
recoveries or breaches, understand the quality and freshness of its revenue evidence, and assess its
next raise. A returning issuer can see how its history and current revenue affect proposed terms.

For agent businesses, confirmed financing events can later become evidence-backed ERC-8004 feedback.
Business identity, financing conduct and service quality remain separate concepts.

Deliver in three releases:

- **Release A — financing history and assessment:** phases 0–4 below. Works with current deployed
  contracts; adds indexer, SDK, application and read-only assessment behavior.
- **Release B — identity continuity, servicing and reputation:** phases 5–7. Adds signed business links,
  operational visibility, and a durable publication service. Reputation publication is introduced in
  dry-run mode before any external writes.
- **Release C — enforced financing policy:** a new, separately reviewed contract version. This follows
  observed usage and economic design work; it is not required to deliver A or B.

The first meaningful release is A. Do not make it depend on new oracle access, paid APIs, a token, an
LLM inference endpoint, or production funds.

## What changes for users

| Surface | Current behavior | Planned behavior |
|---|---|---|
| Business/account page | Revenue summary, payers, advisory estimate and bond list | Financing record with per-bond outcomes, evidence links, data coverage, repayments and recoveries shown separately |
| Bond page | Terms, backing, coverage and monitoring | Explicit collection-close reason, settlement status, breach cause, complete lifecycle and source timestamps |
| Issuer console | Manual terms and its own coverage calculation | First-raise/repeat-raise preflight using the shared assessment, with reasons and comparisons to previous issuance |
| Markets | Bond cards and risk flags | First/returning issuer context, incomplete-data states and links to history; no invented rating |
| Portfolio | Holdings and current actions | Per-bond receipts and recovery breakdown, partial-read visibility, and clear distinction between cash backing and market exit value |
| Agent profile, later | Registration plus demo feedback script | Evidence-backed financing feedback with operator period, publisher provenance and corrections |
| Operations, later | Individual service logs and bounded worker jobs | Checkpoint, observation, collection and reconciliation health, with actionable incident states |

## Architecture and data ownership

Keep raw events, interpretations and decisions separate:

```
contract logs + block state
    → immutable event/receipt ledger in HyperIndex
    → versioned revenue assessments + bond outcomes
    → app, SDK and repeat-raise preflight
    → finalized publication outbox, later
    → optional ERC-8004 feedback
```

Onchain contracts remain authoritative for balances, terms and transaction permissions. HyperIndex owns
the replayable event ledger. The scoring package owns deterministic interpretation. Signed registry
records describe identity links. Assessment snapshots identify their inputs and policy version.

A cached response is not an attestation. A signed attestation is not automatically a contract-enforced
borrowing limit. The app will state which layer produced each result.

## Phase 0 — preserve and baseline the submitted experience

**Work**

- Record current deployment identifiers and the existing working-tree diff; preserve unrelated local work.
- Capture read-only reference states for current Native and Watched bonds and the existing Kuru market.
- Run the current relevant tests once to separate pre-existing failures from changes.
- Build fixtures for a closed-cap bond, maturity shortfall, cancelled raise, missed second release,
  covenant violation, sustained Unknowns, recovered stake, and missing data.
- Define a versioned feature configuration so new panels can be disabled without changing transaction flows.

**Files:** new `docs/plans/financing-history-baseline.md`; focused fixtures alongside scoring/indexer tests.
Existing technical-demo journals and recordings are reference evidence, not fixtures to mutate.

**Done when:** baseline behavior and any existing failures are recorded; test scenarios require no
repeat transactions against submitted bonds.

## Phase 1 — complete the event ledger and expose real data health

**Files to change**

- `indexer/schema.graphql`
- `indexer/src/handlers/slice.ts`
- `indexer/gen-config.mjs` and generated configuration if event coverage requires it
- `scripts/dev-indexer.ts`, to mirror the new query shape for local development
- `packages/scoring/src/envio.ts`
- `apps/web/src/lib/protocol.ts`

**Schema additions**

Extend Bond with activation time, collection-close time/reason, settlement time, effective cap,
default time/evidence, and separate principal/stake recovery fields. Preserve event provenance for every
outcome. Add dedicated outcome evidence rows if keeping the complete history directly on Bond becomes unwieldy.

Record covenant cause from `CovenantDefault` or `DarkDefault`, correlating them with the bond's
`DefaultRecorded` log. If historical cause evidence is unavailable, show `cause_unknown`; never infer
“diverted revenue” solely from `defaultedAt`.

Add withdrawal/refund totals where needed for complete funding reconciliation. Store monetary values in
atomic-unit integer strings/BigInt with chain and asset identifiers.

**Data health**

Replace `indexedAt: now` with separate `fetchedAt`, latest event time, processed-through checkpoint,
RPC head/checkpoint, and completeness flags. The 14 October live read verified `_meta { chainId
progressBlock sourceBlock isReady startBlock endBlock }` on the deployed endpoint; see the
[saved response](../research/evidence/2026-10-14/live-meta.json). Envio documents `progressBlock` as
transactional with indexed data; `sourceBlock` and readiness fields update differently. Verify this
interface against each deployment/version, and compare checkpoints rather than treating `isReady` as
continuous liveness. The newest observed event is not proof that all blocks were processed. If a
processed-through checkpoint cannot be established, mark coverage unknown.

Use a coherent indexed snapshot: pin contract reads to a compatible block where supported, or explicitly
label different checkpoints. Do not mix live balances with older indexed totals and then claim reconciliation.
Paginate account-scoped histories, and fetch covenant observations per bond rather than relying on the
global latest 200. Preserve a row with a load error if one contract read fails.

**Migration**

Deploy the new indexer schema to a parallel endpoint where the hosting arrangement permits. Replay from
the relevant factory deployment block and verify dynamic registrations. Keep the existing endpoint
available while backfilling. If a parallel hosted instance is unavailable without cost, validate locally
and plan an explicit coordinated cutover rather than assuming a free second instance exists.

**Acceptance checks**

- Replaying the same events produces identical totals.
- Out-of-order/reorg replay does not duplicate events or preserve an invalid outcome.
- Closed, cancelled and defaulted cases have correct provenance and independent outcome dimensions.
- Indexer delay, pagination limits and one failed RPC read cannot produce a falsely complete response.
- Existing deposit, withdrawal, claim and trade screens still obtain the fields they require.

## Phase 2 — one deterministic evidence and financing assessment

**Files to change/add**

- Add `packages/scoring/src/assessment.ts`, `outcomes.ts`, `policy.ts`, and focused tests.
- Extend `packages/scoring/src/envio.ts` and package exports.
- Adapt `packages/sdk/src/credit.ts` and `data.ts` to the shared implementation; retain the old export
  as a labelled legacy preview until consumers migrate.
- Add a server-side assessment loader and `apps/web/src/app/api/assessments/route.ts`.
- Replace calculations in `apps/web/src/lib/protocol.ts`, account details and the console in later phases.

**Versioned result contract**

`Assessment` includes subject/account, chain, asset/decimals, policy version, input hash, block/hash,
observation window, generation/expiry times, completeness state, evidence confidence, raw/attributed/
excluded revenue, concentration, recent trend, linked exposure, scenario outputs and reason codes.
Use states `ready`, `preview`, `insufficient_evidence`, and `unavailable`. Keep covenant conduct and
monitoring health as separate fields. `ready` means the configured inputs are usable, not that repayment
is safe or guaranteed.

**Revenue reclassification**

Preserve original payments and append relationship evidence with its observation time and scope.
Assessments can apply a new relationship to the relevant historical window without rewriting raw receipts.
Daily and payer summaries must use the same policy and evidence version. A direct transfer is a link,
not proof of common ownership; keep the conservative exclusion rule explicit and show its reason.
Avoid unbounded rewrites of all payment history from a single event handler.

**Financing calculations**

Unify the account estimate, console coverage/cap suggestion and scoring package. Keep arithmetic in
atomic units and basis points until presentation. Use complete windows for decision-ready assessments;
short testnet history remains a labelled preview. Define an initial policy with the existing 30-day
history concept and explicit stress/concentration parameters, version it, and describe it as uncalibrated.
Do not let a testnet preview badge become a production eligibility claim.

Compute base, stress and severe-revenue-drop scenarios, including zero revenue. Show assumptions rather
than probabilities unsupported by outcome data. Prior bond count is context, not an unlimited credit bonus.
Add operating outflows, known commitments and retained operating cash to issuer scenarios, distinguishing
issuer-declared costs from evidenced costs. Do not double-count costs already netted out of observed
revenue. A revenue-based repayment share that makes continued operation cash-negative must be visible
even if the gross-revenue coverage calculation appears adequate.

**Outcome calculations**

Track economic outcome, covenant conduct, settlement finality and data confidence separately. Cancelled
funding is not repaid financing. Undrawn capital and slashed stake are not operating revenue. Matured
below-cap bonds are not automatically dishonest issuers.

At a reconciled active/closed checkpoint, the accounted investor pool obeys:

`pool + totalRedeemed = revenueCollected + principalRecovery + stakeRecovery`.

Handle funding escrow separately. Direct token donations may be surplus and do not become earned revenue.
Reject or mark incomplete any summary that cannot reconcile; do not fabricate missing values as zero.

**Acceptance checks**

- Golden fixtures produce identical results through SDK and API paths.
- Six- and eighteen-decimal assets, tiny amounts, zero denominators and large integer values are correct.
- Late relationship evidence updates daily/payer assessments consistently, with the old version inspectable.
- Incomplete, stale or truncated data cannot produce `ready`.
- Prior success cannot compensate for zero current revenue or unresolved policy failures.

## Phase 3 — financing history in the existing product

**Files to change/add**

- `apps/web/src/components/app/details.tsx`, `markets.tsx`, `portfolio.tsx`, `ui.tsx`
- Add focused components for financing history, outcome breakdown, evidence links and data health.
- Extend the existing `/accounts/[address]` and `/bonds/[address]` pages; preserve their URLs.

**User experience**

On the account page, add a “Financing history” section with capital raised/released, revenue collected,
principal returned undrawn, stake recovered, and each bond's dated lifecycle. Put evidence links next to
the relevant outcome. Include explanatory states for a new business with no completed bond.

On bond pages, distinguish “collection ended,” “settlement pending,” “cap met,” “closed below cap,” and
“covenant breach.” Show the named cause and timestamp. A historical breach remains visible after recovery.

Market cards should say “First raise” or “Returning issuer,” with enough detail to avoid treating the
number of completed bonds as a credit rating. A first issuer is not automatically disqualified.

Portfolio statements distinguish holder receipts from aggregate pool collections. Do not report investor
profit from bond-wide totals or ignore secondary-market acquisition price. Preserve the existing early
redemption acknowledgement and make the rights surrendered visible next to the action.

**Acceptance checks**

- A user can distinguish customer revenue from returned escrow and slashed stake without opening code.
- Empty, active, closing, cancelled, breached, recovered and incomplete states have clear copy.
- Desktop/mobile and light/dark layouts remain readable; tables have accessible compact layouts.
- Existing wallet transaction behavior and contract simulation remain intact.

## Phase 4 — repeat-raise preflight

**Files to change/add**

- Add `packages/scoring/src/preflight.ts` and tests.
- Export typed results through the SDK.
- Update `apps/web/src/components/app/console.tsx` and add a terms comparison/preflight component.
- Add an assessment snapshot storage adapter using the existing Redis pattern, with a development-only
  local fallback; namespace new data separately from profile/listing keys.

**Behavior**

Before creation, show proposed terms beside the shared assessment: supportable raise scenario, current
revenue compared with the preceding issuance, concentration, historical outcomes, known overlapping
commitments, unresolved breaches, and pending settlement.

Return reasoned states such as “Within the modelled range,” “Adjust proposed terms,” “Prior settlement
pending,” “Review required,” and “More evidence needed.” These are advisory product states. The existing
factory remains authoritative for what can be created; the UI must not imply protocol-wide enforcement.

Re-fetch critical chain state and re-assess changed terms before the transaction. Bind any saved snapshot
to the exact proposed terms hash, evidence block, policy version and expiry. Use a terms/account binding
before bond creation, then associate it with the actual `BondCreated` receipt.

For Release A, assess account history and flag other accounts with the same issuer wallet as a disclosed
relationship. Do not silently claim these prove one unique business. Broader signed identity links arrive
in phase 5. Unknown external debt remains explicitly outside observed coverage.

Existing Watched policy construction predicts the factory's next CREATE address before approval and
submission. Another issuance can change that nonce. Add pre-send checks and verify the actual receipt/
policy binding; surface mismatches instead of presenting a bond as monitored. Full atomic prevention needs
factory design work in Release C. A preflight alone cannot eliminate this race.

**Acceptance checks**

- Clean repeat issuance, low revenue, matured shortfall, previous breach, cancelled funding, pending
  Watched settlement and unknown external exposure produce distinct explanations.
- Changing raise/share/term invalidates the saved assessment.
- No sample score or fixture can authorize a real action.
- Demonstrate the full second-raise story using isolated local/testnet scenarios.

**Release A exit:** phases 1–4 pass together, replayed live data reconciles, all existing product flows
remain usable, and old-schema responses degrade explicitly rather than breaking the submitted product.

## Phase 5 — business identity and source continuity

**Files to change/add**

- Extend `apps/web/src/lib/profile.ts` using new, versioned signed types; preserve legacy profile verification.
- Extend `apps/web/src/app/api/registry/route.ts` or split business-link handlers into a dedicated route.
- Add SDK link-verification helpers and business profile components.

Create `BusinessRecord`, `AccountLink`, `RevenueSourceLink`, `OperatorEpoch` and `AgentIdentityLink`.
Every association states who asserted it, what control proof was checked, when it was checked, and whether
it was superseded/revoked. Namespace identities by chain/registry/address or registry/token ID.

Linking an account requires its issuer's signature and proof of the business controller. Support EIP-1271
where the controller is a smart wallet; reject invalid or wrong-chain signatures. Domain control is one
signal, not a unique legal-entity check. Optional operator review is a disclosed assertion.

Wallet rotation needs old/new control proofs or an explicitly configured recovery process. Missing old
control triggers review rather than silently replacing an identity. Agent ownership transfers create a
new operator epoch and require re-verification. Historical negative outcomes cannot be deleted by unlinking
an account. Provide corrections without erasing provenance.

**Acceptance checks:** account hijacking, signature replay, expired links, agent NFT transfer, wrong registry,
revocation and legitimate operator rotation all have tested behavior. No identity record implies knowledge
of every account the business controls.

## Phase 6 — servicing and monitoring health

**Files to change/add**

- `services/worker/src/main.ts`, `plan.ts`, associated tests and configuration
- Observer/CRE reporter health output and `ops/covenant-server/` documentation
- Add a read-only health aggregator and app indicators

Reuse the existing signer lease, transaction journal and compare-and-set storage. Extend them with last
successful cycle, pending-operation age, observed balances/checkpoints, collection backlog and diagnostic
states. Keep target discovery bounded and verify factory/account relationships before enabling maintenance
for any new target. Do not automatically operate on every untrusted bond discovered in a query.

Use actual gas estimates and configured spend bounds rather than perpetuating blanket maintenance gas
limits where avoidable. Show exhausted budget or stopped workers as operational incidents. Preserve safe
reconciliation of uncertain transactions before retrying.

Distinguish missing monitor reports, observer fetch Unknown, confirmed routing violation, indexer lag and
RPC failure. Public health endpoints expose status and evidence time, not credentials or internal request
headers. Begin with an in-app/operator view; external notifications require a configured channel.

**Acceptance checks:** restart with a pending transaction, RPC timeout, gas ceiling, empty worker budget,
indexer lag, monitor outage and service recovery cannot create duplicate writes or falsely blame an issuer.

## Phase 7 — evidence-backed agent reputation

**Files to change/add**

- Add `services/reputation/` with event-to-evidence mapping, durable outbox, dry-run command and tests.
- Share financing outcome types through the SDK/scoring package.
- Update `demo/scripts/erc8004.ts` to consume typed evidence or keep it explicitly demo-only.
- Add public evidence documents/API and feedback links on agent business pages.

Publish only after the relevant event is finalized under a documented chain policy. Default causes are
precise: routing violation, sustained-unavailable condition, or unknown cause. The current blanket `-100`
feedback is replaced with explicit financing-event tags and evidence; numbers, if used, have a documented
meaning and are not a universal trust score.

Each evidence record contains the source chain, bond, policy, event/log, block/hash, operator epoch,
evidence URI/hash, publisher identity, schema version and correction references. Use immutable,
content-addressed evidence with a durable retrieval location; choose existing/free hosting initially.

The outbox deduplicates source event and destination. Keep prepared/submitted/confirmed states and reconcile
nonce/receipt after uncertain sends. ERC-8004 itself may not provide an idempotency key: local journaling
and onchain reconciliation must prevent repeated feedback. Do not publish from indexer event handlers.

Check eligibility of the publishing wallet against the actual deployed registry interface and ownership
rules. A separate wallet is not automatically an independent evaluator; label it as Bondrail's reporter.
Keep public evidence free of credentials and private API request payloads.

**Acceptance checks:** duplicate event delivery, worker crash after broadcast, orphaned source event,
registry failure, changed agent ownership and corrected evidence have explicit outcomes. Start with a
preview queue and local fixtures, then a controlled testnet publication. No live judge bond is defaulted
for this demonstration.

## Release C — contract changes requiring a separate design

These changes are proposals for new deployments, not patches to existing funded instruments:

1. **Versioned issuance policy.** Enforce assessment bounds/expiry, source commitments and settlement
   eligibility in a new factory. Decide who can attest, how they rotate, and what happens during outages.
   Bind attestations to exact terms, account, chain, factory and nonce. Offchain business links alone
   cannot enforce global exposure across direct calls or other protocols.
2. **Predictable Watched policy binding.** Resolve the factory-nonce race using a deterministic, atomic
   creation/binding design. Commit to the full policy without permitting post-funding destination changes.
3. **Distributions while retaining claims.** Only after an economic specification and Kuru custody review.
   Define accrued-rights ownership on transfer, who claims for vault/margin-account balances, final burns,
   rounding and recovery allocation. Retaining accumulating claims remains a valid alternative.
4. **Explicit stale-evidence and dispute policies.** Govern new deposits/draws without blocking already
   owed withdrawals. Any grace or appeal process must exist before investors accept the new bond terms.
5. **Precise maturity and release economics.** Specify receipt-time versus collection-time treatment and
   whether meeting the first-stage cap should end the undrawn commitment.

Existing contract names, signatures, addresses, positions and repayment rights stay associated with their
version. New deployments require updated manifests/ABIs, indexer version awareness, migration documentation,
economic tests, invariant/fuzz tests and independent security review before meaningful real capital.

## Validation and rollout

Run focused package tests while building each phase, then the full relevant checks for a release:

- Indexer code generation/typecheck and replay/reconciliation fixtures.
- Scoring/SDK tests for evidence, outcome and preflight behavior.
- `pnpm check` and the web production build.
- Relevant browser flows against local contracts: funding, withdrawal, activation, repayment, early
  redemption acknowledgement, history, stale data and repeat preflight.
- Existing Foundry tests as the baseline/regression check; new Solidity tests when Release C changes contracts.

No mock histories are displayed as live product evidence. Failure scenarios use isolated deployments.
Review the new assessment in parallel with the existing display before making it the default. Deploy
indexer/schema support before consumers, then the web app behind the feature flag. Preserve endpoint and
configuration rollback. Public feedback is append-only external state and cannot be rolled back by reverting
an app deployment; use explicit correction/revocation semantics supported by the registry.

## Work packages and dependencies

| Package | Depends on | Deliverable |
|---|---|---|
| 0: Baseline | — | Current behavior and isolated evidence fixtures |
| 1: Ledger and health | 0 | Replayable outcome evidence and explicit coverage |
| 2: Assessment engine | 1 | One versioned calculation used by SDK/API |
| 3: Investor history | 1, 2 | Account/bond/market/portfolio views |
| 4: Repeat preflight | 2, 3 | Returning-issuer flow; Release A |
| 5: Identity links | 4 | Persistent business/source/operator relationships |
| 6: Servicing health | 1; integration after 4 | Reliable collection diagnostics; can be developed independently of 5 |
| 7: Agent evidence export | 2, 5, 6 | Dry-run then controlled ERC-8004 publication; Release B |
| C: Contract policy/economics | A/B feedback and design review | New version, separately tested and reviewed |

No funding, paid API key or recording is needed from the founder to start Release A locally. Future hosted
indexer capacity, production oracle access, external reviews and real market liquidity have separate costs
and prerequisites. Existing passkey access, legacy compatibility identifiers and submitted evidence remain
part of the compatibility test matrix.

This plan drafts implementation only. It does not claim approval to publish feedback, change live bond
terms, or execute new financing transactions.
