# Bondrail: execution strategy after submission

Research date: 13 October 2026. Scope: source inspection and public primary-source research; this is a
product and architecture proposal, not a security audit, production readiness certification, or a set of
implemented features. No contracts, financial positions, or deployed application behavior changed during this review.

## Recommendation

Make Bondrail the place where an onchain business builds a financing record that investors can verify
and the business can reuse on its next raise.

The product remains **revenue bonds for onchain businesses**. Its advantage should come from the quality
of the entire financing lifecycle: connecting real revenue, explaining suitable terms, protecting
unreleased capital, servicing investors, recording outcomes, and supporting responsible repeat issuance.

A competitor can copy a bond contract or a reputation badge. It is harder to reproduce useful payment
integrations, comparable financing histories, a reliable servicing operation, relationships with issuers,
and investors who have already received distributions. Those advantages must be earned through actual
usage; the controlled testnet activity does not establish them yet.

Start with one narrow customer segment: small onchain software businesses with recurring, observable
stablecoin revenue and identifiable operators. Use reviewed Native sources first for the strongest
routing guarantees; paid APIs are a promising second integration with a different trust boundary. Avoid
using speculative trading volume alone as evidence of a sustainable business.

## Where the product is today

| Area | Implemented evidence | Gap that matters |
|---|---|---|
| Revenue connection | `SliceAccount` collects Native fees, splits revenue, and books incoming transfers | Connected flows are not necessarily the business's entire revenue; API settlement and collection are separate |
| Financing lifecycle | Factory/bond contracts support funding withdrawals, two releases, milestones, caps, maturity and recovery | The instrument's economics need clearer investor reporting; early redemption burns future rights |
| Revenue evidence | Envio Payment, Receipt, Split, FundingEdge, DailyRevenue and PayerTotal entities | Direct funding links do not establish beneficial ownership; no-link does not mean independent customer |
| Underwriting | SDK raise estimate; separate scoring package with completeness and concentration checks | Different calculation paths are not a unified underwriting policy; factory does not enforce the advisory estimate |
| Issuer history | Revenue account persists; its bonds remain indexed | No business-level identity continuity, outcome classification, or repeat-issuer eligibility policy |
| Covenant monitoring | Signed observations, fresh activation checks, adjacent-violation default, Unknown handling | Current CRE simulation and single observer remain trust dependencies; monitoring failures and unknown offers need distinct presentation |
| Trading | Kuru listing, simulated quotes, minimum output and quote refresh | Listing does not create investor demand, fair pricing or reliable liquidity |
| Agent reputation | ERC-8004 registration/feedback script | Scripted negative feedback is not a production reputation pipeline or quality evaluation |
| Operations | Collection/lifecycle worker, observer persistence, existing unit/fuzz/invariant tests | Need measured liveness, reconciliation, incident handling and independent review before real capital |

Code reviewed: `contracts/src/{SliceAccount,SliceBond,SliceFactory,SliceCovenant}.sol`,
`indexer/schema.graphql`, `indexer/src/handlers/slice.ts`, `packages/scoring/src/{index,envio}.ts`,
`packages/sdk/src/credit.ts`, `apps/web/src/lib/{protocol,profile}.ts`,
`apps/web/src/components/app/{details,bond-actions}.tsx`, `services/worker/src/plan.ts`,
`cre/slice-covenant/src/workflow.ts`, and `demo/scripts/erc8004.ts`.

These are source-level findings, not fresh verification that every configured service is running.

## What the research changes

| Source | Useful lesson | Application to Bondrail |
|---|---|---|
| [Stripe Capital](https://docs.stripe.com/capital/how-stripe-capital-works) | Offers are continually reconsidered using current processing, consistency, customer base and other risk inputs; payment history can contribute to a wider financial profile | Reassess each raise from current revenue and previous outcomes. Prior success alone should not unlock an arbitrary larger loan |
| [Maple defaults and impairments](https://docs.maple.finance/maple-institutional-for-lenders/defaults-and-impairments) | Distress, technical default, valuation impairment and recovery have different meanings and consequences | Separate business underperformance, covenant breach, monitoring failure and recoveries. Preserve the full outcome timeline |
| [Maple refinancing](https://docs.maple.finance/technical-resources/loans/refinancing) | Changing a financing agreement requires explicit agreement between parties | Future restructuring must be an explicit, consented flow, not an issuer changing terms after funding |
| [Centrifuge protocol](https://github.com/centrifuge/protocol) | Financial product infrastructure separates accounting, share tokens, permissions and investment/redemption flows | Keep evidence, financing policy, settlement accounting and distribution interfaces modular. Do not copy all of its complexity |
| [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) | Public identity/feedback/validation interfaces; transferable agent identity; explicit Sybil limitations | Publish specific financing events with evidence, provenance and ownership epochs; never treat an identity NFT or average rating as underwriting |
| [ERC-8183](https://eips.ethereum.org/EIPS/eip-8183) | Draft job escrow with evaluator-attested completion and refunds | Potential future adapter for agent businesses: distinguish payment for completed work from deposits that may be refunded |
| [EAS](https://github.com/ethereum-attestation-service/eas-contracts) | Structured attestations with schemas and optional resolver logic | Portable financing outcomes can use attestations, but authority, freshness and corrections still need a policy |
| [Reclaim](https://docs.reclaimprotocol.org/) | Proofs of information from authenticated web sources | Optional evidence for existing offchain revenue; evidence of a statement is not proof of independent demand or control over repayment |
| [Envio reorg support](https://docs.envio.dev/docs/HyperIndex/reorgs-support) | Indexed state can roll back; external side effects do not roll back with it | Reputation publication needs finalized evidence and an idempotent outbox outside event handlers |
| [CRE deployment](https://docs.chain.link/cre/guides/operations/deploying-workflows) | Production workflow deployment is a distinct operation and currently requires deployment access | Keep the current simulation label; verify support, access and costs before promising a DON migration |
| [Kuru liquidity risks](https://docs.kuru.io/liquidity/risks-impermanent-loss) | LP inventory, price movements and inactive ranges create real risks | Show executable exit quotes and depth; do not use a seeded AMM as proof of dependable liquidity |

These systems are comparisons and building blocks, not evidence of demand for Bondrail or a claim that
Bondrail offers equivalent protections. Stripe loan minimums and legal recovery mechanisms, for example,
are materially different from Bondrail's current capped revenue claims.

## 1. Build a business financing record

Create an issuer page that answers five investor questions:

1. Who controls this business and the revenue sources being financed?
2. What happened in its previous raises?
3. How much revenue is observed, how dependable is it, and what is excluded?
4. What capital and revenue commitments are already outstanding?
5. What changed since the last assessment?

The first version should show facts and confidence, rather than a single 0–100 score. Proposed sections:

- **Identity:** signed profile, domain-control evidence, operator wallet, revenue accounts, Native source
  addresses, and agent registry identifiers where applicable. A verified domain proves domain control,
  not legal identity or one unique business.
- **Financing history:** capital funded, actually released, returned undrawn, revenue collected, stake
  recovered, holder redemptions, collection-close reason and dates. Preserve asset units; do not add
  USDC, WETH and issuer tokens together as if they were dollars.
- **Conduct:** routing breaches, stale evidence, disputes, corrections and source changes.
- **Revenue quality:** active days, trailing windows, customer concentration, repeat payer cohorts,
  identified related inflows, refunds where observable, and data coverage.
- **Current exposure:** every known active financing linked to this business and the source each claims.
  Explicitly distinguish known exposure from a claim to know all debt on every platform.

Use multiple independent outcome labels. A bond can both breach a covenant and later recover capital.
A single final status would erase useful information.

| Event/outcome | Interpretation |
|---|---|
| Raise cancelled and refunded | No activated financing track record; not a repayment success |
| Revenue cap met | Evidence of repayment performance, with capital size, duration and source quality attached |
| Maturity below cap | Economic underperformance; not automatically dishonesty or a contractual routing breach |
| Second release expires | Undrawn capital returned; record the missed milestone without inventing a default |
| Covenant breach confirmed | Failure against a named committed rule, with the actual evidence |
| Monitoring unavailable | Evidence gap; not an issuer offense by itself |
| Subsequent recovery | Add to the historical outcome; do not erase the breach or classify recovered stake as customer revenue |

For closed bonds, reconcile original investor capital against revenue collections, principal recoveries
and stake recoveries separately. Individual investor profit additionally depends on entry price, sales,
and redemption timing; bond-wide collection totals are not investor IRR.

### Identity continuity and reputation resets

A wallet alone is insufficient. An issuer can create another wallet, domain or revenue account. Build a
`Business` record and explicit signed links to revenue sources, operator epochs and agent identities.
Require proof of control to link an account; distinguish issuer declarations from independent verification.
Rotation should append a successor relationship, with signatures/recovery rules, rather than wipe history.

ERC-8004 identity is transferable. An agent ownership transfer should trigger re-verification and label
the new operator period; it should not silently award the new owner the previous operator's credit terms.

There is no fully permissionless, free method that reliably proves all wallets belong to one real-world
business. Start curated for financing eligibility, retain open browsing/evidence, and disclose coverage.
Do not auto-merge businesses because they share an exchange, infrastructure provider or common funder.

## 2. Make repeat issuance earned and explainable

Keep the existing one-attached-bond-per-account rule initially. A business-level policy should also
consider linked accounts; otherwise an issuer can split activity and borrow against the same economic
source more than once. Exclusive rights to a registered source can be enforced within Bondrail, but do
not establish exclusivity against unknown external debt or offchain claims.

A second raise should show a preflight report:

- Previous collection and settlement are final, including the Watched evidence window.
- No unresolved confirmed covenant breach under the chosen financing policy.
- Adequate recent, complete revenue evidence and no unexplained source/operator change.
- No existing pledge of the same registered revenue source within the eligible registry.
- Proposed share, cap and funding horizon fit stressed revenue and known commitments.
- Capital increases are limited by policy and current capacity, not merely the number of past bonds.

The current account detaches when collection closes; a Watched bond can still be in its 120-second
settlement window. Existing tests deliberately allow new issuance in that interval. A trustworthy repeat
assessment should wait for finality of the old outcome rather than prematurely award a clean record.

Illustrative capacity calculation, not an empirically validated model:

```
stressed allocable revenue = eligible daily revenue × stress factor × proposed revenue share × horizon
supportable cap budget = max(0, stressed allocable revenue − known senior claims on that same budget)
proposed raise ceiling = supportable cap budget ÷ cap multiple ÷ coverage margin
```

Claims must be aligned to the same revenue budget and time horizon; do not subtract an unrelated
business's entire debt balance or double-count existing shares. Additional constraints should cover
business operating margin and the combined percentage of revenue already committed.

Example: 100 USDC/day × 0.70 × 25% × 90 days = 1,575 USDC. With a 1.2× cap and 1.2× coverage margin,
the ceiling before other constraints is 1,093.75 USDC. This is a scenario, not a promise of repayment.
Revenue can fall to zero. A previous successful 10-USDC raise should not justify a 100,000-USDC raise.

Use visible reasons: “Recent revenue is 35% lower than during your last raise” or “One payer contributes
62% of attributed revenue.” Past success can increase confidence, but cannot replace current capacity.

Initially this is advisory UI and curated eligibility. Enforcing it against direct contract calls needs
an explicit policy gate in a new factory/version. An interface warning alone does not enforce a limit.
Keep existing funded terms unchanged.

## 3. Treat evidence quality as a core product feature

Revenue analysis should expose its denominators and limitations:

- Gross transaction volume versus business fees versus actual investor allocations.
- Raw inflows versus attributed payments versus evidence-adjusted revenue.
- Customer concentration, recurring cohorts, active days, volatility and revenue trend.
- Last complete indexed block, chain head, observation window and reconciliation status.
- Proof of payment versus proof of delivery versus refund/chargeback exposure.

Two concrete implementation opportunities surfaced in inspection:

1. `protocol.ts` assigns `indexedAt: now`, which represents fetch time rather than the latest indexed
   block's time. Return and display actual source checkpoints. A refreshed page can still show stale data.
2. Funding relationships are recorded as events arrive. A newly discovered link does not automatically
   restate old daily revenue; payer aggregates and daily aggregates can consequently use different
   exclusions. Keep raw receipts immutable and derive versioned assessments that can be recomputed.

The app's seven-day raise estimate and the scoring package's complete 30-day policy should become one
versioned assessment API, with separate preview and decision-ready states. Store asset decimals and use
integer/decimal arithmetic for finance; avoid treating a display float calculation as an enforceable limit.

A repayment can be economically manufactured: the issuer may control both payer wallets and investors,
recycling some of the apparent cost. Time, number of wallets, amount repaid and stake alone do not prove
independent commerce. Increase confidence through multiple evidence types, meaningful observation
periods, credible source integrations, and disclosed review. Avoid claiming this eliminates Sybil attacks.

## 4. Make investor servicing intuitive

The current early-redemption behavior is intentional and tested: burning half the claims takes half the
current pool and relinquishes that position's future collections. The UI already asks for an acknowledgement.
This should not be reported as a discovered accounting exploit, but it is an important product choice.

For newly issued V2 bonds, evaluate a cleaner experience:

- **Claim distributions:** withdraw accrued repayments while retaining remaining economic rights.
- **Sell position:** transfer future rights through a market.
- **Final settlement:** close the position after the collection/recovery process ends.

One possible implementation is cumulative distributions per claim with transfer corrections and each
holder's withdrawn balance. Define whether accrued distributions stay with the seller, how remaining
cap rights are represented, and how burn/mint, zero supply and rounding work. Kuru custody is a critical
integration question: claims held by its margin account or vault cannot silently accrue distributions
that beneficial holders cannot retrieve. This requires a design and compatibility test, not just a new button.

An alternative is to retain accumulating claims and improve their explanation, exit quote and cashflow
statement. Choose after observing investors use the product. Do not migrate active bonds or change their
rights implicitly.

The second release also needs economic review: the current cap scales with released principal, and
reaching the first-stage cap can close collection before the second draw. Confirm this matches the
intended capital commitment experience before changing the schedule or introducing more tranches.

## 5. Turn broken commitments into useful agent reputation

Keep three dimensions separate:

- **Payment activity:** someone paid the agent.
- **Service performance:** the agent delivered an acceptable result under a defined evaluation.
- **Financing conduct:** the issuer honored a specific revenue-routing or reporting commitment.

ERC-8004 is useful for distributing structured signals. It does not establish honest reviewers, prevent
fresh identities, or define Bondrail's underwriting and slashing rules. The current specification is Draft;
pin and test the deployed registry interface rather than assuming every registry matches the newest text.

Proposed pipeline:

```
confirmed protocol event → finalized evidence record → idempotent publication queue
                       → financing history in Bondrail
                       → optional ERC-8004 feedback for the linked agent/operator epoch
```

Evidence should include chain, contract, bond, policy hash, transaction and log, event type, observation
times, report signatures where relevant, evaluator identity and version, and an accessible evidence URI
with a content hash. A hash without retrievable evidence is poor support for investor decisions.

Deduplicate by chain/contract/transaction/log and publication destination. Retry safely. Envio reorg
rollback cannot undo feedback already posted externally, so wait for the selected finality policy and
support explicit corrections. Never post feedback as an irreversible event-handler side effect.

The existing demo feedback script posts `-100` after any `defaultedAt` and describes it as revenue diversion.
But a Watched default may also arise from sustained Unknown observations. A production implementation
must preserve the actual cause and avoid equating unreachability with proven diversion. The reporter is
a separate wallet in a controlled demo, not independent institutional verification.

For dispute handling, distinguish objective contract evidence from claims about subjective output quality.
A future policy may pause new financing while uncertain evidence is reviewed. Do not retroactively add
an appeal that reverses an already executed immutable slash. A review/grace mechanism would be a new,
explicitly priced covenant policy for new bonds.

Service quality can later use paid-job receipts and evaluators. ERC-8183 offers a relevant draft escrow
pattern, but a successful evaluator decision is only as reliable as its rules and authority. Build a
narrow deterministic service evaluation first; do not ask an LLM to label arbitrary work as trustworthy.

## 6. Operational reliability is part of the financing product

Expose health for the indexer, observer, reporter and lifecycle worker. Alerts should distinguish “API
unreachable,” “payment route violated,” “indexer lagging,” and “monitor has stopped reporting.”

For a new version, consider pausing new funding and undrawn releases when mandatory evidence is too
stale, without blocking holders from claiming money already owed. Today deposits can be allowed without
a fresh compliant observation; activation and second release are stricter. Change this only as an explicit
policy decision, with tests for outages and recovery.

Add reconciliation of token balances against liabilities, idempotent worker operations, durable evidence
backups, transaction nonce/retry handling, source-specific data coverage, pagination, and error visibility.
The current app loads broad global datasets and drops failed bond reads from `Promise.allSettled` results;
partial service failure should produce an incomplete-data state rather than silently hide an investment.

For maturity, specify whether revenue belongs to the old bond based on receipt time or collection time.
Current closing books pending receipts when a transaction executes; tests intentionally include some
post-maturity/pre-close receipts. Reliable keeper execution and an explicit accounting boundary matter.

Use invariant and adversarial tests for evidence reclassification, stale reports, duplicate/out-of-order
logs, token precision, transfers/redemptions, missed milestones, repeat issuance and operator changes.
Independent contract review is a separate requirement before meaningful real capital. Open tooling is
useful on a zero budget; audits, production oracle access, infrastructure and liquidity cannot honestly be
promised free.

## 7. Additional technology, in priority order

| Technology | Decision | Reason / prerequisite |
|---|---|---|
| Existing Envio + contract events | Use now | Build outcome history, checkpoints and reconciliation on the data already present |
| Existing signed profiles + domain proofs | Extend now | Foundation for source continuity; show what is and is not verified |
| ERC-8004 | Extend after outcome schema | Useful export for agent financing conduct; not the canonical business identity for every issuer |
| EAS or a small signed attestation format | Evaluate later | Portable outcomes; use existing signed evidence first, verify Monad deployment/support before integrating |
| Production CRE | Pursue when accessible | Verify deployment access, target-chain support, receiver authentication and operating cost; decentralizing execution does not remove correlated inputs or a mandatory single signer |
| x402 buyer guard | Improve early | Customer-side enforcement reduces exposure to misleading offers, but does not cover unguarded buyers |
| ERC-8183 job adapter | Pilot only with actual demand | Completed job proceeds could provide stronger revenue context than unaudited API payment counts; exclude refundable escrow from realized revenue |
| Reclaim / authenticated web proofs | Later, optional | Helpful for pre-Bondrail financial evidence; do not infer capture of those cashflows or source honesty from a proof |
| ERC-7579 / ERC-7715 | Later, for bounded operations | Modular permissions can restrict agent actions; standards are not an audit or automatic wallet compatibility |
| ERC-4626 / asynchronous vaults | Defer | Pooled exposure adds NAV, liquidity, allocation and withdrawal complexity before individual bonds are proven |
| AI underwriting agent | Read-only analyst first | Explain evidence and draft summaries with citations; no autonomous capital allocation or slashing |

Do not add a reputation token, universal AI trust score, cross-chain expansion, an instant-liquidity
promise, or a complicated pooled vault to improve the hackathon story. Each introduces new assumptions
before the core financing lifecycle has external users.

## A realistic sequence

These are planning ranges for a solo founder with AI assistance, not delivery promises. Production
assurance and partner adoption do not follow coding time estimates.

| Phase | Scope | Exit condition |
|---|---|---|
| First 2–4 focused days | Outcome fields in indexer; complete issuer history; explicit stale/partial data; reconcile totals; clearer maturity/redemption reporting | Every displayed outcome links to evidence; existing bonds render correctly; no contract migration |
| Next 3–5 focused days | Versioned revenue assessment and repeat-raise preflight, explicit reasons, historical comparisons | Same evidence produces the same result; incomplete data cannot yield a green decision-ready state |
| Next 1–2 weeks | Business/source identity links, operator epochs, safe publication queue, ERC-8004 evidence export, servicing alerts | Rotation preserves history; duplicates/reorgs cannot produce contradictory untracked reputation actions |
| After feedback and economic design review | New-factory policy enforcement, optional distribution redesign and improved covenants | Threat model, lifecycle/invariant tests, Kuru custody compatibility and external review before real funds |
| Pilot stage | A few independent issuers and investors, narrow supported asset/source set | External revenue, observed investor understanding, reliable servicing and evidence that users return |

The strongest next demonstrable story is a complete second financing cycle: a business finishes a bond,
its profile explains the economic and covenant outcome, its next raise is assessed using current revenue
and that record, and a separate adverse scenario shows how a confirmed breach affects future eligibility.
Use isolated local/testnet fixtures for failures. Do not default the submitted live example or recycle
controlled payments into claimed traction.

Prioritize one positive loop and one failure loop over a larger feature checklist. A new UI can be added
without replacing the judge's existing flow; contract experiments should use versioned deployments.

## Adoption and defensibility

Interview roughly five relevant business operators and five potential investors as a starting target,
not claimed traction. Test concrete decisions: why capital is needed, how much revenue can be committed,
what data they will share, whether the instrument is understood, and what would prevent repeat usage.
Recruit a small, curated pilot instead of launching many empty markets. Pursue integrations where
revenue already originates; every integration should make payment collection and issuer retention easier.

Track outcomes that test the thesis:

- Time from connecting a source to a usable evidence history and first funded bond.
- Share of independently sourced revenue captured through the agreed route, where observable.
- Collection/reconciliation failures, evidence lag and incident resolution time.
- Capital released, revenue returned, shortfalls and recoveries by issuance cohort.
- External investors who return and businesses eligible for and choosing a second raise.
- Understanding of cap, maturity and early exit in usability tests.
- Executable exit prices and depth for actual order sizes, not headline trading volume.

Potential monetization is an explicit origination or servicing fee aligned with useful financing and
collections. Charging for a favorable reputation rating creates the wrong incentive. Validate willingness
to pay before adding fees to contracts.

## Research scope and source limitations

Primary sources were fetched directly from official documentation, standards and repositories. The
comparison is not an exhaustive market census and does not establish uniqueness, demand or current
commercial terms. ERC-8004, ERC-8183, ERC-7579 and ERC-7715 were marked Draft when retrieved.
Some initial documentation paths returned 404/403 or DNS errors; successful official alternatives were
used where available. No claims rely on unread pages. Goldfinch's current overview concerns Goldfinch
Prime; older Unique Identity pages were unavailable at the attempted path, so older architecture was
not treated as the verified current product.

Additional standards read: [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579),
[ERC-7715](https://eips.ethereum.org/EIPS/eip-7715), [ERC-4626](https://eips.ethereum.org/EIPS/eip-4626).
Other primary references: [CRE HTTP capability](https://docs.chain.link/cre/capabilities/http),
[Kuru Order Book SDK](https://docs.kuru.io/sdk/orderbook-sdk),
[Maple security assumptions](https://docs.maple.finance/technical-resources/security/list-of-assumptions),
[x402 repository](https://github.com/coinbase/x402),
[Goldfinch current overview](https://docs.goldfinch.finance/goldfinch).

Implementation tasks in this document are proposed; the README describes implemented functionality.
