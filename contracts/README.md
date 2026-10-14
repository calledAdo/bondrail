# Bondrail contracts

Solidity0.8.28, OpenZeppelin5.4.0 (vendored), Foundry. Prototype contracts; passing tests are not a production audit.

```
forge build --sizes
forge test --summary
```

The public schema and integration calls are in `INTERFACE.md`. Generated artifacts under `out/` are the ABI authority. No mainnet deployment path is enabled.

Deploy with `scripts/deploy.ts` at the repo root (`BONDRAIL_CHAIN_ID=31337` for a local anvil). Order:
implementations, Covenant, Factory (with `minHistory`), one-shot `Covenant.initializeFactory`. The local
deployment token MockUSDC supports EIP-2612 but not EIP-3009; the separate MockERC3009 test token
exercises real EIP-712 signatures and nonce replay protection in Foundry.

Account accounting books only actual asset receipts: `settle()` books the newly authorized value and
`sweep()` books other uncredited balances. Bond donations remain surplus.
Watched closing keeps a fixed 120-second historical-report window; each observation has 90-second
freshness and 5-second maximum clock skew. The observer and milestone signer are disclosed trusted
evaluators; forwarder delivery alone cannot forge their signatures.

Tests: 122 Foundry tests (unit, fuzz and a stateful accounting invariant), covering staged release and
cap scaling, cancellation, early redemption, signed and on-chain milestones, CRE-only observations,
adjacent violations, the closing boundary, rounding carry, Native binding and review, the minimum-history
gate, deposit health checks, accounts in any asset (an 18-decimal token without permit), payments out
through `settleOut` with no payer approval, account-mediated EIP-3009 settlement (13 tests), the fee floor, a downward-rebasing asset, and going dark (a day of Unknowns defaults; monitoring gaps and
a Compliant report restart it; an hour dark blocks deposits; never during Funding).
Trigger coverage includes validation, exact first-check eligibility, activation-day and partial-day exclusion,
both tiers, exact rounding through step-up/recovery, default/close guards, capped closure, all four
payment entrypoints and an accounting invariant with day advances and trigger checks.

Not established by these tests: live Kuru market/custody compatibility, Monad testnet USDC/facilitator support, CRE DON operation, observer honesty, external economic demand or production audit assurance. Those remain integration gates outside this contract package.

## Account-mediated x402 settlement — not yet deployed

Anyone can relay a payer-signed EIP-3009 `TransferWithAuthorization` through
`BondrailAccount.settle(from, value, validAfter, validBefore, nonce, v, r, s)`. The account supplies itself
as `to`; the token verifies the signature and consumes the nonce. The account requires a nonzero,
non-self payer, positive value, and an exact balance increase. It emits `Settled(payer, value, nonce)`
then books only `value` via `Revenue(..., collected=true)`, increments volume and proven-payer history,
and splits an Active bond's share in that same transaction, including rounding carry and cap closure.
Native accounts can also settle; the whole value is revenue, so the Native fee floor does not apply.

Pre-existing unbooked funds stay untouched by settlement. `sweep()` remains available for other
transfers, with an unproven on-chain payer (`address(0)`). A third party can front-run by submitting the
authorization directly to USDC: funds still go to the signed account, but `settle()` then reverts with
a used nonce. The account never treats a failed authorization as proof of existing funds; `sweep()`
is the fallback and does not restore proven-payer counters. Token replay protection, an exact balance
delta, and `nonReentrant` protect accounting; a proven signing address still does not prove an
independent customer or economic demand.

Use the SDK's `settleThroughAccount` or the [Bondrail-only facilitator](../services/facilitator/README.md).
The indexer correlates token and account events by chain/token/payer/nonce so each payment is attributed
once, including batches. Rebuild the indexer's data when adopting its changed authorization identities
and schema. CRE/manifest checks remain required for Watched businesses. Existing accounts are immutable
clones of their original implementation: new settlement-capable deployments are required. No deployment
JSON has been updated and live Monad/USDC settlement has not been exercised by this change.

## Performance triggers — not yet deployed

At issuance, optionally set `triggerRevenue` (asset units), `triggerWindowDays` (1–30), and `stepUpBps`
(strictly above `revenueBps`, at most 5000). All three must be zero to disable the feature, or all must
be set within these bounds. `terms().revenueBps` and `baseRevenueBps()` always expose the base share;
`revenueBps()` exposes the effective share used by the account.

Anyone can call `BondrailBond.checkTrigger()` while Active and not defaulted. With UTC day number
`today = block.timestamp / 1 days`, it sums `account.revenueByDay(day)` for
`today - triggerWindowDays <= day < today`. It requires
`today >= activationDay + 1 + triggerWindowDays`, where `activationDay = activationTime / 1 days`,
so every counted bucket has `day > activationDay`. The entire activation-day bucket is excluded,
including receipts booked before and after activation, even when activation occurs at midnight UTC.
The earliest bucket is the following UTC day; no partial-day snapshot is introduced. For a two-day
window activated on UTC day 100, the first check is at midnight starting day 103 and counts days 101
and 102. Below the floor means triggered; equality or above means recovery.
`TriggerChecked(windowRevenue, triggered)` fires on each successful check, with
`TriggerChanged(triggered)` only on a transition. `lastTriggerCheckDay` prevents a second check on the
same UTC day (`AlreadyCheckedToday`). Before eligibility it reverts `TooEarly`; disabled, defaulted or
non-Active bonds revert `InvalidState`. A default freezes the last trigger state; it does not change
the existing revenue collection/default rules.

Payments never evaluate the window or write trigger state. They use the latest checked share, preserve
the existing rounding carry across rate changes, and honor the unchanged cap:
`effectiveRevenueCap = repayCap × releasedPrincipal / raiseAmount`, minus collected revenue for the
remaining cap. Reaching it still closes and detaches in the payment transaction. `BondrailAccount.sol`
is unchanged. The daily loop reads at most 30 existing buckets; the new share fields and trigger state
are packed with existing terms and lifecycle fields. Without a checker, the last effective share persists.

**Issuer self-payments count.** The counter includes all booked revenue, including revenue the issuer
pays itself. Padding revenue to avoid the trigger costs real money because a share goes to investors,
but it is possible. This is not a wash-adjusted revenue oracle. Direct transfers count when `sweep()`
books them, rather than when the token transfer arrived; Native payments and `settle()` book immediately.

Worker checking is opt-in with `WORKER_CHECK_TRIGGERS=1` for targets using the new bond implementation.
The SDK regenerates the extended ABI; the console validates the optional terms, the bond page shows
base/effective shares and a Triggered badge, and the indexer tracks `TriggerChanged` on `Bond.triggered`.
Regenerate/rebuild indexer data for the added non-null flag. The SDK/web term reader also understands
original immutable bonds, returning zero trigger terms for their original ABI.

Demo setup defaults to zeros. To enable it for newly created demo bonds, set all of
`TRIGGER_REVENUE_USDC`, `TRIGGER_DAYS`, and `STEP_UP_BPS` (e.g. `10`, `2`, `4000`).
Existing clones cannot gain the feature; new bond/factory deployments are required, and the extended
`createBond` tuple changes that function's selector. No deployment files have been changed, and no
deployment or live worker transactions were performed. See [validation](../docs/bench/task05-validation.md).

## Bondrail Credit vault — not yet deployed

`BondrailVault(IERC20 asset, BondrailFactory factory, address owner, address curator)` is a standalone,
non-upgradeable ERC-4626 vault; existing bond contracts are unchanged. Choose an exact-transfer,
non-rebasing asset. Shares use asset decimals + 6 (12 for USDC), with OZ virtual shares/assets.
`holdings()`, `costBasis(bond)`, `holdingRecovered(bond)`, `holdingRealizedValue(bond)`,
`holdingValue(bond)` and `holdingEntryValue(bond)` expose the portfolio. Position carrying values
are before the vault-wide `unvestedIncome()` deduction. `totalAssets()`/conversions use exit NAV;
`entryAssets()`/`previewDeposit`/`previewMint` use entry NAV without unrealized impairment.
`maxWithdraw`/`maxRedeem` reflect idle liquidity. Deposits/mints remain open in every phase.

Only the curator can `allocate`, `withdrawFromRaise` or `collect`; payouts always go to the vault.
Only the immutable owner can `proposeCurator` and, after `CURATOR_DELAY`, `acceptCurator`.
`MAX_BOND_BPS = 2500`, `MAX_BONDS = 16`, and `MIN_IDLE_BPS = 2000` have no setters and use exit NAV.
Collection requires Closed/Cancelled. Healthy Active positions carry unrecovered cost within their
repayment ceiling, including undrawn principal; triggered positions take a 50% haircut on unrecovered
cost and default/maturity starts a 30-day writedown. Closing/Closed use realized backing only.

Permissionless `checkpointIncome()` starts seven-day vesting for newly observed realized profit;
all successful money movements checkpoint too. Unobserved profit stays fully locked in views. New
income merges with the unvested remainder, extending its schedule; collection preserves the lock.
The 36 vault tests cover valuation/pricing, vesting, limits, roles, liquidity, exact transfers,
reentrancy, donation inflation, dust and an independent realized-backing receipt oracle.
Carried NAV is not immediately realizable: healthy repayment assumptions and rule-based impairments
remain risks. See [design](../docs/vault/DESIGN.md) and [validation](../docs/vault/VALIDATION.md).
No deployment was performed.

### BondrailCreditRegistry (not deployed)

Standalone, factory-scoped credit views and EIP-712 attestations. BondrailFactory counts each successful issuance once in `bondsCreated(account)`; other issuance behavior is unchanged. Permissionless `recordBond` rejects duplicates/non-bonds and caps each account at 64. `onchainProfile` returns account counters, aggregate repayment counts/amounts, per-bond cap ratios, `bondsCreated` and `complete = (recorded count == bondsCreated)`. Display "Repayment record covers N of M bonds" and an incomplete warning, including when the 64-bond cap prevents full coverage. `attestedProfile` returns the latest payload, original signer and validity requiring the current attester plus unexpired time. Owner rotation of the attester takes two days. See [field semantics and trust](../docs/credit/DESIGN.md); coverage is scoped to this account/factory and does not prove independent customers. Stored attestations by a rotated-out signer remain visible but invalid.
