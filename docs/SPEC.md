# Slice implementation specification v1

Frozen for first implementation, 9 October 2026. Product: revenue-financing marketplace for two supported demo businesses. Testnet10143 is default, local31337 supported. Mainnet143 disabled for write scripts unless a future explicit configuration/authorization changes policy.

Design references: build-plan.md and testnet-and-staged-release.md. This file resolves the implementation choices below; staged-release amendment overrides obsolete full-release language in references.

## Financial rules

- Six-decimal USDC-like asset and six-decimal ERC20 claims. Funding mint1:1; ordinary transfer disabled while Funding. No unrestricted burn. Fixed supply after activation until final redemption.
- Phase Funding, Active, Closing, Closed, Cancelled. Separate default history and close reason. FundingDeadline strict boundary: deposits/activation before; anyone cancel at/after. Refund by holder after cancellation. One reserved issuance per Router.
- Raise fully filled before issuer activates; preactivation Router receipts wholly issuer credit. Snapshot raiseRecipient. At activation release firstReleaseBps (2500 or5000); rest remains principal escrow. Full-cap scales to actual released principal by floor(fullCap*released/raise). Revenue collected starts at activation; earliest maturity-close semantics, final sweep records cutoff. No receipt timestamp fiction.
- Second draw requires immutable secondReleaseNotBefore<=now<secondReleaseDeadline<maturity, no default, active phase, healthy supported source, and milestone signature. Choose signed screened-revenue milestone mode for v1. Factory sets immutable milestoneSigner. EIP712 binds bond, policyHash, periodStart, periodEnd, eligibleRevenue, evidenceHash, expiresAt, and release nonce/unique issuance. eligibleRevenue>=terms.minRevenue; period starts at activation or later, ends<=now, covers minOperatingPeriod; expiry bounded. Onchain health rechecked. Dedicated signer is a disclosed trusted evaluator, not autonomous credit proof.
- Failed release deadline permits anyone to cancel undrawn commitment into investor principal recovery; no stake slash just for missed milestone. Default and collection close also cancel undrawn commitment. Token ownership carries principal recovery; final redemption only. Second draw never mints/burns.
- Revenue cap excludes slashed stake and recovered undrawn principal. Reaching current effective cap ends collection permanently even if second draw was pending. Set demo gates reachable before cap.
- Router computes free receipts=balance-issuerCredit; investor percentage uses carried bps numerator remainder. Credit issuer pull balance, transfer investor share, callback Bond, finish collection/detach exactly once. Router is collection coordinator; no reentrant Router→Bond→Router loop. Match expectedBond in lifecycle hooks; old finalization cannot touch new Router bond.
- Closing for observational covenant lasts120s, observation freshness90s (small skew bounded). Final sweep/detach before Closing. Admit only historical observations strictly before cutoff; then permissionless final settlement regardless monitor availability. Stake pull-credit to issuer if not slashed. Claim transfers allowed during Closing; burns/redemption disabled. Closed fixes pool; final holder takes rounding remainder, zero payout burns only if pool zero.
- Account separately fundraising escrow, released principal, undrawn principal, principalRecovery, revenue pool, stakeHeld/stakeRecovery/stakeReturnCredit, and unsolicited Bond surplus. Router donations split economically but not automatically classified as business revenue.

## Enforcement

- Factory-recognized nonupgradeable PumpLab source + authentic FeeGuard. Small allowlist initially bounded setMaxNameLength; block recipient/rate/ownership/upgrades, arbitrary calls and unknown selectors. Post-call invariants. Fee recipient set before ownership transfer. Guard release only no reserved bond.
- Watched covenant pins mock forwarder AND EIP712 observation signer; no discretionary mutable auth after initialization. Observation fields bond,policyHash,epoch,observedAt,expiresAt,result,observedPayTo,offerHash,evidenceHash. result0Unknown,1Compliant,2Violation.30s epoch,90s freshness. Domain name SliceCovenant version1,chainId,verifyingContract. Bounded slots; same epoch cannot equivocate/replay; two adjacent distinct valid Violation epochs default once, including out-of-order arrivals. Funding observations establish readiness but cannot cause Active default. No post-cutoff observation slashing.
- Observer independently fetches only allowlisted registry endpoints; no arbitrary caller URLs/verdicts. x402 single v2 exact EIP3009 offer matches token/chain/recipient/price policy. Malformed/outage Unknown. Sender==mock alone is not authentication. Actual CRE path independently checks HTTP then wraps verified observation; simulations do not imply DON security.

## Data and application

- Marketplace, issuer, bond, issue wizard and authenticated demo controls. Clear 50/50or25/75release terms, raised/released/undrawn/recovery/revenue/stake. Wagmi/viem wallet actions; transactions never fake-success. Preview has explicit synthetic-data banner and no fake wallet buttons.
- Envio receipt IDs chain:blockHash:txHash:logIndex. Trade evidence explains a transfer; never count both. Scoped funding evidence and source provenance. Scoring R recognized fees, E after mutually exclusive exclusions, A=sum(min(payerAmount,floor(E/10))), HHI before clipping.30days required for actual terms recommendation; synthetic only scenario/preview; null for incomplete live evidence. Nansen unavailable on testnet, never silently map to mainnet.
- x402 agent backed by durable config/idempotency (shared Redis REST for deployed mode; explicit local durable store for local only). Kimi key/model config; no paid answer fabricated when unavailable. Guarded admin switch. Worker loops bounded and supervised, not Vercel request loops.
- External deployment requires funded testnet wallet and provider keys. Ship environment templates and readiness diagnostics; never invent successful deployments or bounty eligibility. Exact platform bounties remain unknown behind sign-in.

## Shared boundary

Lead owns packages/shared generated ABIs/config/DTOs. Contract agent publishes its actual public API in docs/contract-interface.md or sends lead API summary promptly. Services can use viem ABI fragments and EIP712 schema confirmed with contract agent. Each package declares dependencies; lead performs workspace install. All money APIs use integer decimal strings, never floating values.
