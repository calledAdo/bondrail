# Bondrail Credit vault — Task 06b

**Not yet deployed.** One exact-transfer, non-rebasing asset (such as USDC), one
disclosed curator, transferable ERC-4626 shares, no upgrade proxy. Deposits and
minting remain open throughout the bond lifecycle. This replaces Task 06's
automatic deposit windows and realized-only NAV.

## Accounting and the repayment ceiling

`costBasis[bond]` records assets paid by the vault. Funding allocations add cost;
Funding withdrawals remove cost pro rata to claims burned. Cancelled refunds and
Closed collections burn the whole position and clear its cost/tracking. Gifts of
claims do not add cost. Untracked gifts never create a holding.

For the vault's current `n` claims of current supply `S`, all ratios round down:

- `realized = n` in Funding/Cancelled; otherwise `floor(n * pool / S)`.
- `recovered = floor(n * (totalRevenueCollected + principalRecovery + stakeRecovery) / S)`.
- `unrecovered = max(0, costBasis - recovered)`.

These are existing bond views; **BondrailBond is unchanged**. Recovered is the current
claims' share of cumulative pool inflows, not just revenue, and is not reduced by
other holders' redemptions. Other holders can burn early, changing `S`; this is a
current-position accounting convention, not historical cash received by the vault.
The vault itself never burns claims before Closed/Cancelled.

The **total effective repayment ceiling** for an Active position is:

```
floor(n * (effectiveRevenueCap + undrawnPrincipal + principalRecovery
           + stakeRecovery - totalRedeemed) / S)
```

`effectiveRevenueCap()` only covers revenue on **released** principal. Separately
refundable undrawn principal and credited principal/stake recoveries must also be
included. For a 100 asset raise with a 120 repay cap and 50% first release, the
ceiling is 60 revenue + 50 undrawn = 110, allowing the original cost of 100 to be
carried at activation. Using the revenue cap alone would cap this at 60 and retain
the rejected activation markdown. Recovering undrawn principal moves it between
the two terms without double counting; releasing it replaces refundable backing
with a larger effective revenue cap. `totalRedeemed` subtracts receipts already
paid to earlier holders before apportioning the remainder over current supply.
Unslashed issuer stake and unsolicited tokens at the bond are excluded.

## Carrying values and impairment

| Phase / condition | Entry carrying value | Exit carrying value |
| --- | --- | --- |
| Funding or Cancelled | realized (1:1) | realized (1:1) |
| Active, healthy, before maturity | realized + unrecovered | realized + unrecovered |
| Active, performance trigger on | realized + unrecovered | realized + floor(unrecovered / 2) |
| Active, defaulted or past maturity | realized + unrecovered | realized + floor(unrecovered × remaining / 30 days) |
| Closing or Closed | realized only | realized only |

Both Active values are capped by the total effective repayment ceiling above.
For the linear writedown, `remaining = max(0, 30 days - elapsed)`. Start at
`defaultedAt`, or maturity if maturity occurs first without settlement. A default
recorded after maturity cannot restart the clock. The default/maturity rule takes
precedence over the performance trigger; it begins with a zero time-based haircut.
Consequently switching from a triggered position to a fresh default can initially
increase its carrying value, including the additional principal/stake recoveries.
This follows the specified separate rules; it is not a monotonic risk score.

Recovery is recalculated on every read. Healthy repayments replace unrecovered cost
with realized backing, leaving NAV flat until profit. Under impairment they shrink
the unrecovered balance and restore part of the loss automatically. Trigger recovery
also removes the 50% haircut when `checkTrigger()` clears it. A default flag does not
clear; new receipts increase realized value even after the 30-day write-off. Closing
removes all remaining carried cost immediately, including during the evidence grace.

## Income vesting

Only `max(0, realized - costBasis)` is profit. Both NAVs subtract the **same**
`unvestedIncome()` from idle plus the sum of carrying values. `holdingValue` and
`holdingEntryValue` expose gross position values **before** that vault-wide deduction;
`holdingRealizedValue` exposes funded backing.

One vault-wide linear schedule and one observed-profit watermark per holding keep
storage and loops bounded. New profit is fully excluded even in views before a
checkpoint. Permissionless `checkpointIncome()` or any successful vault money
movement observes it, adds it to the still-unvested remainder, and starts seven days
for that combined amount. A checkpoint without new profit does not restart time.
Locked amounts round up, so income never vests faster through truncation.

The bonds have no repayment timestamp history or vault notification hook. Vesting
therefore starts at **observation**, not the payment's original block. Reading NAV
does not start a schedule. Operators should checkpoint after income; a dormant vault
conservatively delays recognition. New income can extend the older remainder's tail,
but fully vested income is never relocked. Repeated small real inflows can prolong
that tail; there is no claim that each individual receipt vests within seven days
while further receipts arrive. No unbounded receipt history or keeper-only power.

Collecting a Closed bond moves its backing into idle while its unvested income
remains locked globally. Removing/reusing a holding slot cannot accelerate vesting.
Deposit/mint and withdrawal previews already exclude unseen profit, so their internal
checkpoint preserves the quoted NAV at the same timestamp.

An immediate deposit → repayment → redeem sequence captures no unvested profit
(apart from rounding); a one-second hold captures at most its linear vested share.
**Vesting is not an entitlement snapshot:** an investor who remains for seven days
participates in the income, including income paid shortly after entry. Direct asset
donations to the vault still change price immediately and are not bond profit.

## Entry and exit prices

`entryAssets()` ignores trigger/default impairments. `previewDeposit` rounds shares
down at entry NAV; `previewMint` rounds assets up at entry NAV. `deposit`/`mint` use
those previews. New money cannot buy an unrealized loss at the lower exit rate.
There is no deposit window, pause condition, or Active/Closing entry restriction.
Inherited `maxDeposit`/`maxMint` return the ERC-4626 unrestricted maximum.

**`totalAssets()` returns exit NAV**, including impairment and income vesting.
`convertToAssets`, `convertToShares`, `previewWithdraw`, `previewRedeem`, `withdraw`,
`redeem` and exit maxima use that conservative rate. Integrators must use the entry
previews to quote deposits/mints; conversions are not entry quotes when impaired.
The UI shows `previewMint(one share)` and `previewRedeem(one share)`, including their
respective rounding. Both entry and exit recognize final Closing/Closed losses.
`exit NAV <= entry NAV` follows because both subtract the same locked income and
only exit applies nonnegative impairments.

OZ virtual assets/shares with `_decimalsOffset() = 6` make donation inflation costly
(USDC shares have 12 decimals). Deposits rounding to zero shares revert. Virtual
shares capture some upside and affect loss/exit rounding; transaction integrations
still need slippage protection.

## Liquidity, powers and hard limits

Withdrawals use idle assets only, without a queue or bond interaction. `maxWithdraw`
caps the holder's exit value at idle; `maxRedeem` conservatively caps shares at the
idle conversion. First exits can exhaust cash. The **20% idle buffer applies only
at allocation**, not during withdrawals, valuation changes or asset freezes.

The curator can only allocate to eligible same-asset factory bonds in Funding,
withdraw from an open Funding raise back to the vault, or collect Cancelled/Closed
claims back to the vault. Default or elapsed evidence grace never authorizes early
redemption; settlement must be finalized. No arbitrary calls, claim sale, rescue,
external sweep, or fees to owner/curator. Exact approvals are cleared after use.
All money movement and income checkpointing share the same reentrancy guard.

Allocation limits remain immutable: **25% of pre-allocation exit NAV per bond,
16 tracked bonds, and 20% exit NAV left idle**, rounded conservatively. The new
allocation plus existing destination value is checked against that NAV. Concentration
can drift after exits, losses or recoveries; no forced rebalancing or guaranteed
issuer diversification. All loops are bounded by 16 tracked positions. Empty positions
are removed; untracked claim gifts cannot be collected or expand the loops.

Factory and owner are immutable. The owner's only power is proposing/replacing a
curator, then executing the change after **two days**. Replacing a proposal restarts
the delay. No ownership transfer, upgrade, pause or limit setters.

Realized backing is not immediately collectible cash. Funding withdrawal stops at
its deadline until cancellation, Active/Closing claims remain invested, and settled
sub-unit claims may require consolidation before the bond permits redemption. No
privileged write-off or claim burn bypasses those restrictions.

## Precedents

These are accounting precedents, not imported implementations or identical policies:

- **Maple:** [LoanManager](https://github.com/maple-labs/fixed-term-loan-manager/blob/main/contracts/LoanManager.sol)
  carries principal outstanding and exposes unrealized losses through loan impairment
  before formal default. [MaplePool](https://github.com/maple-labs/pool-v2/blob/main/contracts/MaplePool.sol)
  uses `totalAssets()` for entry and subtracts `unrealizedLosses()` in exit conversions.
  This vault adopts separate rates, but deliberately makes its own `totalAssets()`
  the **exit** value for conservative integrators.
- **Goldfinch:** [Accountant.calculateWritedownForPrincipal](https://github.com/goldfinch-eng/mono/blob/main/packages/protocol/contracts/protocol/core/Accountant.sol)
  computes a linear, capped writedown from lateness;
  [SeniorPool.writedown](https://github.com/goldfinch-eng/mono/blob/main/packages/protocol/contracts/protocol/core/SeniorPool.sol)
  reapplies it and reverses losses when repayments improve the position. This vault
  uses a fixed 30-day clock from default/maturity and a shrinking unrecovered balance,
  rather than Goldfinch's interest-based lateness/grace calculation.
- **40 Acres:** [Vault.epochRewardsLocked / totalAssets](https://github.com/40-Acres/loan-contracts/blob/main/src/Vault.sol)
  subtracts linearly locked income from ERC-4626 assets;
  [ProtocolTimeLibrary](https://github.com/40-Acres/loan-contracts/blob/main/src/libraries/ProtocolTimeLibrary.sol)
  defines a seven-day week. This vault uses a seven-day observation-based schedule
  instead of epoch boundaries, so a payment observed late in a week is still fully
  locked initially. This smooths immediate income timing gains, not longer-term
  participation by newly deposited capital.

## Scope and residual risks

**Carrying at cost assumes healthy bonds keep paying. Impairment is rule-based, not
a market price.** Exit NAV is conservative relative to entry NAV, not a guaranteed
liquidation floor or principal guarantee. It can exceed current pool backing and
falls to realized value at settlement. Trigger checks and default reports inherit
the bond's availability/trust assumptions; their delay can postpone loss recognition.

Curator choice/availability, issuer correlation, reviewer/CRE trust, first-exit
liquidity, pricing around settlement or impairment recovery, and the disclosed income
checkpoint/merge timing remain risks. Asset freezes, unsupported rebases/transfer
fees, donations, rounding/virtual shares, settled dust and untracked gifts remain.
No Kuru trading, oracle price, credit-score allocation, tranches, withdrawal queue or
yield promise. `/vault` remains read-only and explicitly undeployed until configured.
