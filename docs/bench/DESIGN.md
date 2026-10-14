# Account accounting and optimistic parallel execution

**Decision: stop after the benchmark and this design; do not ship lane accounting.** This is the task's permitted complexity/no-benefit outcome, not a measured gas-regression claim. The account's ERC-20 recipient balance remains a read/write dependency on positive-revenue `collect`, `settleOut` and `settle` payments even if every accounting counter is sharded; `sweep` reads that same balance to discover unbooked funds. Active bonds additionally require shared repayment and pool updates. Removing history conflicts would not remove that dependency chain, while introducing aggregate reads, withdrawal bookkeeping and different rounding semantics. No production contracts, interfaces, events or tests have been changed.

Baseline: `51f6a8d`, solc 0.8.28, optimizer 200, via IR, Cancun. The [passthrough](./2026-10-14T20-39-48-964Z-anvil-passthrough.md) and [active-bond](./2026-10-14T20-40-37-249Z-anvil-active.md) Anvil runs each passed 200/200 measured transactions. Anvil validates the script only; no Monad performance conclusion comes from these timings. [Two-payer state diffs](./conflicts-anvil.json) show 6 shared changed storage slots without a bond and 9 with a bond; the separate-account samples share none. These are final state changes, not complete read/write sets (idempotent writes are omitted).

## Slot audit and possible lanes

Slot numbers below are from `forge inspect --root contracts SliceAccount storageLayout --json`. “Per payment” means a nonzero booked fee/revenue: zero-fee Native calls update volume but do not book history; `sweep` without unbooked funds does not book anything. `collectWithPermit` follows `collect` after permit handling.

| State / slot | Current use | Candidate treatment |
|---|---|---|
| `cumulativeRevenue` / 8 | Every `_book`; activation snapshot and `releaseSecond` also read it | Sum fixed lanes synchronously; **not history-only and not safe to defer** |
| `cumulativeVolume` / 9 | Gross `collect`/`settleOut` and full `settle`; never `sweep` | Sum lanes, including zero-fee Native volume |
| `paymentCount`, `collectedCount`, `uniquePayers`, `firstRevenueAt` / packed slot 10 | Every booking; proven payments increment collected; first proven appearance increments unique; first timestamp set once | Lane counts; keep `isPayer` global per payer. Move first timestamp out of this hot packed slot |
| `lastRevenueAt` / 11 | Every booking, possibly writes same value within a block | Maximum lane timestamp |
| `revenueByDay[day]` / `keccak256(abi.encode(day, 12))` | Every booking that day | Sum per-day lane buckets |
| `isPayer[payer]` / mapping base 13 | First proven payment from a payer | Already independent across payers; no change needed |
| `issuerCredit` / 6 | Every booking; solvency boundary for `sweep`, withdrawal, attach, activation and close | Lane earned credit plus a withdrawal-only debit, summed by `issuerCredit()`. Withdrawal must atomically check/debit the total; `sweep` still reads all lanes |
| `splitRemainder` / 7 | Active split; reset on attach, activation settlement and detach | Keep global for exact current rounding; see below for why independent carries change payouts |
| `_status` / 0 | All `nonReentrant` entrypoints | Shared guard writes; restored after each call. A transient guard could remove persistent writes, subject to chain support/security review, but does not remove token balance dependencies |
| `activeBond` / 5 | Read on payments; written on lifecycle/cap closure | Keep lifecycle and final cap closure atomic |
| Asset's `balances[account]` | Token transfer writes it; `_pull`/`settle` read before and after to reject short delivery; `sweep` reads it | **Remains shared even with all accounting lanes**; it changes by the retained issuer share |
| Asset's `balances[project]` | Native `collect` sends net to project; `settleOut` pulls from project | Another shared token slot for Native traffic |
| Bond `totalRevenueCollected` / 28, `pool` / 32; asset's `balances[bond]` | Active payment transfers investor share and invokes `onRepayment` | **Remain shared and atomic**; the cap and live redemption pool require a consistent total |

If revisited, use `uint256(uint160(payer)) % LANES`, with a fixed bounded lane count and payer-zero sweeps on lane zero. Lanes collide and addresses can deliberately choose a lane; they are not independent payer identities. Keep all getter names, arguments and ABI return widths (`uint64` for counts/timestamps, `uint256` for monetary totals), event fields/order, zero-fee behavior and proven-payer rules. A `firstRevenueAt()` minimum over nonzero lane-first timestamps can preserve the first booking meaning, or a separate singleton can be written only on the first booking. Never advance it on later payments or turn it into an activation timestamp: `minHistory` depends on it. `cumulativeRevenue()` must return the exact sum immediately so activation and `releaseSecond` see the same value as today. Do not defer these values to an off-chain indexer.

## Atomicity and rounding

The token's EIP-3009 nonce/signature validation (or authorized Native pull), exact balance delta, history, issuer liability, investor transfer and `onRepayment` belong to the **same transaction**. A failure must roll back everything. An active payment must honor the remaining cap and close/detach in that transaction when reached. Deferring investor transfers to a keeper or epoch breaks the requirement. Sweeping unknown donations must subtract all outstanding issuer credit before booking, including during lifecycle transitions; otherwise withdrawals or later activation could double-book funds.

Before a cap/reset, let `D = 10000`, rate `b`, and `R_l` be total revenue in lane `l`. The current global carry pays `floor(b × ΣR_l / D)`. Independent lane carries pay `Σ floor(b × R_l / D)`. Writing `b × R_l = D × q_l + r_l` proves:

```text
global payout − lane payouts = floor(Σr_l / D), with 0 ≤ r_l < D
0 ≤ gap ≤ LANES − 1 smallest token units
```

Fixed lanes do prevent *unbounded* rounding loss under continuing traffic: once any lane accumulates enough remainder it pays a whole unit, and indefinitely increasing revenue cannot leave every lane below that threshold. They do **not** preserve the current finite-payment guarantee. Example: with 32 lanes at 20%, four one-unit payments to each lane pay investors **0**; the current contract pays **25** units from the same 128 micro-payments. If the bond matures then, resetting those carries permanently loses the 25 units. Returning `sum(remainders) % 10000` from the old getter would hide the missing whole-unit liability. Returning the raw sum would change its range and meaning.

Closing-time reconciliation also needs real backing: the current contract credits all unpaid units to withdrawable issuer credit. A later clawback can fail after withdrawal. Reserving lane dust changes issuer availability and needs explicit liability and terminal-settlement rules. Maintaining the global carry preserves exact payouts and event amounts but keeps its conflict. Accordingly there is no lane implementation or claimed new fuzz/rounding proof here; the unchanged invariant and rounding tests pass. A future candidate must test many-payer/many-lane prefixes, abandoned lanes at maturity, reset on a second bond, withdrawals before closure, and caps, in addition to exact getter sums and the existing invariant suite.

## Why stop here

Keeping the bond pool shared is an acceptable correctness tradeoff: investors receive their share inside every payment, and redemption/cap accounting stays sound. It is not acceptable to advertise that history lanes alone make a financed business's payments independent. Even passthrough payments retain the token recipient-balance dependency demonstrated by the traces. The persistent guard is an additional shared write, although an executor may handle its unchanged final value specially; the decision does not rely on treating that guard as a mandatory re-execution trigger.

Lanes multiply cold storage initialization and make summed getters O(LANES). For example, a 32-lane getter reading one distinct cold slot per lane incurs roughly 67,200 gas in cold SLOAD charges alone under the configured EVM gas schedule, versus 2,100 for one cold slot; loops and hashing are extra. On-chain factory calls and sweep/withdraw would pay these costs. This is an analytical cost, **not a measured candidate gas result**. [Validation and baseline gas](./validation.md) distinguish successful-payment receipts from Foundry's mixed call distribution; no after measurement exists because no candidate was implemented.

A later design would need separate token custody destinations as well as history lanes, and a solution for the bond's pool and cap (for example, preallocated lane cap budgets with aggregate redemption and audited reallocation). That changes signed payment destinations, authorization, redemption and lifecycle accounting; it is broader than replacing `SliceAccount` counters. Obtain the owner-run Monad baseline first, and evaluate that architecture separately without relaxing atomic investor payment.
