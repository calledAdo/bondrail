# Slice amendment: testnet first and staged capital release

User steering, 9 October 2026: why not use testnet, and add capital release in two portions such as 25/75 or 50/50. This amendment takes precedence over the initial plan's mainnet-first demonstration and full-principal-at-activation assumptions. Detailed financial policy below is a recommendation to freeze before implementation, not implemented behavior.

## Network strategy

Develop contracts locally, integrate the product on Monad testnet, and target a testnet demonstration unless exact hackathon/bounty terms or a necessary integration require a narrow mainnet proof. Earlier mainnet scope came from the user's initial specification, not a verified event requirement. Do not spend real funds merely to make the demo look credible.

Use separate deployment manifests, provider configuration, chain IDs, token addresses, wallets and report-signature domains. Testnet chain ID is 10143. Mainnet is 143. Test token addresses must be verified against the actual facilitator and each integration: the supplied testnet USDC and the Kuru documentation's testnet USDC differ. A generic six-decimal mock does not automatically implement EIP-3009 or work with x402.

Evidence already collected: the facilitator advertises v2 exact on testnet and mainnet; Kuru docs list testnet deployments; CRE CLI source lists a Monad testnet simulation forwarder; ERC-8004 reference lists testnet registries. These are prerequisites, not tested end-to-end support. Prove actual token compatibility, Envio testnet ingestion (HyperSync if available, otherwise supported RPC), market creation/custody, report delivery and identity calls.

Nansen's documented Monad support concerns its supported network/data product; do not infer it indexes Monad testnet. Core funding-edge scoring can run on our indexed testnet events. Provider enrichment must be unavailable when unsupported, or demonstrated separately against real mainnet addresses with their actual network visibly identified. Never attach unrelated mainnet labels to testnet wallets. A separate provider demonstration may not satisfy a bounty requiring core product use; verify its exact wording.

Test tokens and faucet gas generally remove real principal/stake/trading-capital expenditure but can have faucet/rate limits. Kimi inference, API credits, hosting, storage and worker costs remain unless covered by free tiers/credits. Testnet CRE simulation still needs application-level authentication: free tokens do not make forged-default behavior acceptable evidence of a working design.

## Product: two-stage drawdown

Call this **staged capital release** or **two-stage drawdown**, to distinguish it from senior/junior investor tranches with different loss priority. Keep one fungible token class and one investor pool.

Recommended initial choices: 50/50 as default; 25/75 as another immutable issuance setting. Percentage is fixed before deposits. Two releases are sufficient for this version; four releases add accounting/UX without yet establishing a useful additional gate.

At full funding/activation, release only the first portion to the snapshotted issuer recipient, start revenue collection, and retain the balance in principal escrow. Mint tokens against the full funded amount, exactly as for a filled primary raise; no additional mint occurs on the second release. Investor rights transfer with tokens, including rights to any later refund of unreleased escrow. No early token burn.

The second release is a separate transaction, available only after immutable release conditions are satisfied. Neither the issuer nor an offchain worker can bypass the conditions by choosing when to call. No arbitrary owner unlock function.

### Proposed gate

Freeze `secondReleaseNotBefore`, `secondReleaseDeadline` (strictly before earliest maturity), a minimum observed operating interval, required source-health policy, and a milestone/evidence-policy hash. Use `notBefore <= now < deadline` for release, and `now >= deadline` for anyone to expire the undrawn commitment. Default or collection close also permanently disables release.

For the first demo, a clear performance gate can be “a minimum amount of reconciled eligible service revenue since activation, over a minimum interval, with the committed route healthy.” The dollar threshold and interval must be set for the business, not presented as validated underwriting. A code-shipping milestone is a different policy requiring named evaluator authority; a contract cannot independently decide an arbitrary deliverable is useful.

If the gate uses related-party exclusions, Nansen or API-service attribution, the Solidity contract cannot independently read Envio/HTTP evidence. Add an immutable, domain-separated milestone-attestation verifier binding chain, bond, policy, canonical data cutoff/hash, period, eligible amount, expiry and one-use release authorization. A reviewed scoring/evidence service supplies that attestation; CRE can transport/check the specified evidence but does not make the scoring judgment trustless. Explain the attestor role. Immutable policy, bounded expiry, signature checks and current onchain health/default state govern actual release.

Simpler alternative: a purely onchain threshold on actual Router collections plus minimum time and a Locked guard invariant. This is easier to verify but counts self-funding/donations and is explicitly not wash-resistant. Do not describe it as verified customer revenue. Choose one policy; do not let build agents independently mix these models.

For Watched release, require a fresh Compliant observation and no unresolved current breach evidence or degraded monitoring under the frozen policy. This reduces risk but cannot rule out unseen diversion or all late reports. Maintain the two-strike/default rules and show that limit. If the attestor/monitor is unavailable, no second release occurs; the deadline eventually makes escrow recoverable without its cooperation.

### When release fails

- Funding never activates: cancellation refunds all deposited principal as before.
- Confirmed default while Active: permanently cancel the undrawn commitment; move unreleased principal into a distinct investor principal-recovery bucket and slash the stake once. Revenue collection may continue to the applicable cap/close.
- Second-release deadline passes, milestone is unmet, or issuer chooses to abandon the remaining draw: permanently cancel the undrawn commitment and earmark that principal for tokenholders. Missing a performance gate alone is not a routing default and does not automatically slash stake.
- Collection closes before a second release: disable drawdown and earmark all unreleased capital before entering Closing/final settlement.
- Earmarked principal is redeemed pro rata with the token at final settlement, not refunded to original subscribers after they have sold their tokens. Immediate partial payouts would reintroduce exchange-custody/dividend problems and are outside this amendment.

During Closing, historical default evidence may still add stake under the existing bounded evidence window. It can never reopen drawdown or reclaim principal already allocated to investor recovery.

## Cap and accounting recommendation

Scale the revenue cap to **capital actually released**, so the issuer is not charged a full 100-USDC financing cap after receiving only 50 USDC. Define R=funded principal, L=cumulative principal released, C=full-release revenue cap, U=unreleased principal, P=principal permanently earmarked for investor recovery.

```
effectiveRevenueCap = floor(C * L / R)
remainingRevenueCap = max(0, effectiveRevenueCap - totalRevenueCollected)
R = L + U + P                          # after successful full activation
holderFinalPool = collected revenue + principal recovery + stake recovery
```

Use full-precision integer math. Second release increases L/cap atomically only after passing the gate. Never count returned principal as revenue, score input, or revenue repayment toward the cap. Track the three components independently in events/UI even if redemption pays a combined final amount.

Reaching the current effective revenue cap closes collection and cancels any remaining draw. Therefore set the second-release gate so it is meaningfully reachable before that cap if the intended outcome is continued financing; no hidden reopening of a completed issuance. A later business need can use a new issuance. Document this rule in terms before investors fund.

Example: R=100, C=120, stake=20, first release=50. Effective revenue cap is60. If the second release succeeds, the cap becomes120. If the second release expires, 50 principal becomes investor recovery and the revenue cap stays60. If total collected revenue is10 and default occurs, eventual recovery so far is50 principal+10 revenue+20 stake=80, with future allowed revenue potentially increasing it. Recovery is not guaranteed to cover the full100.

An unreleased principal balance is **not accrued yield or a permanent backing floor**: it may still be paid to the issuer. Show escrow available for future draw, principal already committed to recovery, and collected revenue as different fields. Kuru token value includes conditional rights to undrawn funds; releasing a tranche is economically meaningful and must emit an event/update the market view.

Extend solvency invariant:

```
bond balance >= pre-activation funding escrow
             + unreleased principal
             + principal recovery pool
             + collected revenue pool
             + stake held/recovery/issuer-credit liabilities
```

Each unit belongs to one bucket only. Before activation, do not double-count principal as both funding escrow and unreleased principal; convert ledgers atomically. Deposit/mint stays1:1; release never mints/burns; cancellation before activation and recovery after activation have distinct ownership rules.

## Agent and test changes

- Lead: freeze drawdown ratio, exact gate/evaluator, deadline, proportional cap, cap-close treatment, milestone attestation and network-specific integration matrix.
- Contract agent: add unreleased/released/recovery ledgers, immutable release schedule/policy, exact-once second draw, expiry/default/close cancellation, increased effective cap and principal recovery redemption.
- Data/underwriting agent: produce reproducible milestone evidence with explicit trust/coverage; distinguish revenue, escrow movements and principal recovery.
- CRE/observer agent: pin fresh health/release evidence authorization independently from breach reports; preserve domain/nonce/expiry protections.
- UI agent: show “Raised100; released50; escrowed50,” unlock requirements, deadline, recoverable principal, effective revenue cap and one shared token class.
- Operations/integrations: deploy testnet manifests first; verify actual token/facilitator/market compatibility; use mainnet only for a narrowly justified, later authorized integration/submission need.

Required tests: ratio/rounding boundaries, double draw, exact deadline, default-before-draw/draw-before-default order, forged/stale/cross-chain attestations, Unknown monitor blocking new draw but not recovery, missed gate without slashing, cap hit before second release, collection close during pending release, transferred tokens owning principal recovery, conservation across all buckets, and no misleading backing increase when principal is merely moved between internal buckets.

No deployment, spending, or implementation was performed for this amendment.
