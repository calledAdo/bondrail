# Slice contracts

Solidity0.8.28, OpenZeppelin5.4.0 (vendored), Foundry. Prototype contracts; passing tests are not a production audit.

```
forge build --sizes
forge test --summary
```

The public schema and integration calls are in `INTERFACE.md`. Generated artifacts under `out/` are the ABI authority. No mainnet deployment path is enabled.

Deploy with `scripts/deploy.ts` at the repo root (`SLICE_CHAIN_ID=31337` for a local anvil). Order:
implementations, Covenant, Factory (with `minHistory`), one-shot `Covenant.initializeFactory`. The local
MockUSDC supports EIP-2612 but not EIP-3009, so x402 settlement is only exercised on testnet.

Account accounting uses the account's actual free USDC balance: `sweep()` books any transfer, and only
the indexer distinguishes x402 settlements from unclassified inflows. Bond donations remain surplus.
Watched closing keeps a fixed 120-second historical-report window; each observation has 90-second
freshness and 5-second maximum clock skew. The observer and milestone signer are disclosed trusted
evaluators; forwarder delivery alone cannot forge their signatures.

Tests: 54 Foundry tests (unit, fuzz and a stateful accounting invariant), covering staged release and
cap scaling, cancellation, early redemption, signed and on-chain milestones, CRE-only observations,
adjacent violations, the closing boundary, rounding carry, Native binding and review, the minimum-history
gate, deposit health checks, accounts in any asset (an 18-decimal token without permit), payments out
through `settleOut` with no payer approval, the fee floor and a downward-rebasing asset.

Not established by these tests: live Kuru market/custody compatibility, Monad testnet USDC/facilitator support, CRE DON operation, observer honesty, external economic demand or production audit assurance. Those remain integration gates outside this contract package.
