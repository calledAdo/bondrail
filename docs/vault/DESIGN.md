# Bondrail Credit vault — Task 06

**Not yet deployed.** One asset, one disclosed curator, transferable ERC-4626 shares.
Use a conventional, non-rebasing, exact-transfer asset such as USDC. No upgrade proxy.

## Valuation and entry

`NAV = idle asset + sum(realized value of tracked holdings)`. Funding and Cancelled
claims are refundable 1:1. Active, Closing and Closed holdings use
`floor(claims * bond.pool() / bond.totalSupply())`, matching the bond's redemption
math without the extra rounding in `backingPerToken()`. There is no oracle, future
revenue estimate, face-value mark, or credit-score mark. Issuer stake, undrawn
principal and unsolicited tokens at a bond are excluded until credited to its pool.
Activation can sharply lower NAV; share price then rises as revenue or recoveries land.

A deposit just before a repayment would otherwise acquire part of existing holders'
future revenue cheaply. **Automatic deposit windows** prevent deposit/mint whenever
any tracked, nonempty holding is Active or Closing. Entry is available with only
Funding, Cancelled or Closed holdings (or none): their backing has no future revenue
rights. Both ERC-4626 maximum-entry views and execution enforce this. This is simpler
and more effective against that timing trade than estimating a fee. Tradeoff: a
long-lived active holding can block new deposits until settlement. Funding investors
still bear the activation markdown, and secondary share transfers are unrestricted.

OZ virtual assets/shares with `_decimalsOffset() = 6` make donation inflation costly
(USDC vault shares have 12 decimals). Reject deposits that round to zero shares.
Virtual shares capture some upside and affect loss/exit rounding; they are not a
substitute for transaction slippage protection in a future deposit UI.

## Liquidity and custody

Liquidity-limited; no FIFO queue. `maxWithdraw` caps the holder's converted balance
at idle assets; `maxRedeem` conservatively caps shares at the idle conversion.
Withdrawals never invoke a bond or reserve liquidity for later users. First exits
can exhaust idle. The 20% idle buffer is an **allocation-time minimum**, not a
guarantee during withdrawals, NAV changes or token freezes.

Curator methods have fixed destinations: `allocate(bond, amount)` deposits only
during Funding; `withdrawFromRaise(bond, amount)` uses the bond's Funding withdrawal
back to the vault; `collect(bond)` refunds Cancelled claims or redeems all held claims
only in Closed. Active/Closing redemption is forbidden even after default or after
the evidence deadline: anyone must finalize settlement first. No sale of claims,
arbitrary calls, token rescue, fees to curator/owner, or sweep to an external address.

## Powers and hard limits

The factory and owner are immutable. The owner's only power is proposing/replacing
a curator, executable by the owner after a fixed two-day delay; replacing a proposal
restarts the delay. No ownership transfer, upgrade, pause or limit setters.

Each allocation requires `factory.isBond`, matching asset, `depositAllowed`, Funding,
and a nonzero amount. Fixed limits: **25% of current NAV per bond, 16 tracked bonds,
20% idle remaining**. Check the destination's existing realized value plus the new
amount against pre-allocation NAV (Funding deposits preserve NAV). Limits cannot be
relaxed. Concentrations can drift after repayments, activation, or investor exits;
these limits constrain new allocations and do not force early redemptions. They do
not guarantee independent issuers or economic diversification.

Track only curator-allocated bonds; remove them when their claims reach zero.
Loops are bounded by 16. Gifts of claims in an already tracked bond enter its value;
untracked token gifts cannot add loop entries and are not recoverable. Approve only
the exact allocation and clear allowance afterward. ERC-4626 money movement and
curator money movement share one reentrancy guard.

## Default and realizability

`SliceBond.markDefault` calls `_recoverUndrawn`, then moves `stakeHeld` into
`stakeRecovery` and `pool`. `onRepayment` also adds revenue to `pool`. Default does
not end collection or claw back released principal. NAV therefore includes the
vault's share of recovered principal + slashed stake + collected revenue, even while
Active; collection still waits for Closed. `_finishSettlement` returns only unslashed
stake to the issuer and preserves the investor pool. No existing bond changes needed.

Realized backing is distinct from immediately collectible cash: Funding withdrawal
stops at its deadline until cancellation; Active/Closing claims must be held; the
last claim cannot redeem early; a positive pool can reject a sub-unit redemption.
Fuzz checks compare NAV to actual refund/withdraw/redeem receipts where callable and
to funded pro-rata backing otherwise, then settle and collect to verify realization.
Closed sub-unit dust may occupy a slot until other holders redeem; no privileged
write-off or claim burn is added to bypass that bond rule.

## Scope and risks

No Kuru market making (price/liquidity risk), on-chain score allocation (off-chain
inputs are not trustless), tranching (separate loss waterfall), withdrawal queue,
yield promise, or deposit transactions in the web UI. The read-only page shows NAV,
share price, idle, realized holdings, fixed limits, entry state and curator.

Residual risks include curator selection and availability, issuer correlation and
losses, reviewer/CRE trust inherited from bonds, entry/exit timing, long liquidity
lockups, asset freezes, direct-donation price changes, rounding and settled dust.
This conservative NAV is an accounting floor under supported-token assumptions,
not a fair-value estimate or a promise of principal protection. Audit before use.
