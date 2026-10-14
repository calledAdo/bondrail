# Slice contracts

Solidity0.8.28, OpenZeppelin5.4.0 (vendored), Foundry. Prototype contracts; passing tests are not a production audit.

```
forge build --sizes
forge test --summary
```

The public schema and integration calls are in `INTERFACE.md`. Generated artifacts under `out/` are the ABI authority. No mainnet deployment path is enabled.

Deploy with `scripts/deploy.ts` at the repo root (`SLICE_CHAIN_ID=31337` for a local anvil). Order:
implementations, Covenant, Factory (with `minHistory`), one-shot `Covenant.initializeFactory`. The local
deployment token MockUSDC supports EIP-2612 but not EIP-3009; the separate MockERC3009 test token
exercises real EIP-712 signatures and nonce replay protection in Foundry.

Account accounting books only actual asset receipts: `settle()` books the newly authorized value and
`sweep()` books other uncredited balances. Bond donations remain surplus.
Watched closing keeps a fixed 120-second historical-report window; each observation has 90-second
freshness and 5-second maximum clock skew. The observer and milestone signer are disclosed trusted
evaluators; forwarder delivery alone cannot forge their signatures.

Tests: 79 Foundry tests (unit, fuzz and a stateful accounting invariant), covering staged release and
cap scaling, cancellation, early redemption, signed and on-chain milestones, CRE-only observations,
adjacent violations, the closing boundary, rounding carry, Native binding and review, the minimum-history
gate, deposit health checks, accounts in any asset (an 18-decimal token without permit), payments out
through `settleOut` with no payer approval, account-mediated EIP-3009 settlement (13 tests), the fee floor, a downward-rebasing asset, and going dark (a day of Unknowns defaults; monitoring gaps and
a Compliant report restart it; an hour dark blocks deposits; never during Funding).

Not established by these tests: live Kuru market/custody compatibility, Monad testnet USDC/facilitator support, CRE DON operation, observer honesty, external economic demand or production audit assurance. Those remain integration gates outside this contract package.

## Account-mediated x402 settlement — not yet deployed

Anyone can relay a payer-signed EIP-3009 `TransferWithAuthorization` through
`SliceAccount.settle(from, value, validAfter, validBefore, nonce, v, r, s)`. The account supplies itself
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

Use the SDK's `settleThroughAccount` or the [Slice-only facilitator](../services/facilitator/README.md).
The indexer correlates token and account events by chain/token/payer/nonce so each payment is attributed
once, including batches. Rebuild the indexer's data when adopting its changed authorization identities
and schema. CRE/manifest checks remain required for Watched businesses. Existing accounts are immutable
clones of their original implementation: new settlement-capable deployments are required. No deployment
JSON has been updated and live Monad/USDC settlement has not been exercised by this change.
