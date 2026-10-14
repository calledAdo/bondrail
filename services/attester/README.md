# Credit attester

Not deployed. Computes the same lifetime payer attribution and seven-day credit inputs as the web through `indexedCreditMetrics` in `@bondrail/sdk/credit`. This is an attestation of indexer data and policy, not proof of independent customers, business revenue, indexer completeness or future repayment. Daily verified totals reflect classification when each payment was indexed; a payer subsequently flagged related is excluded from lifetime payer totals, while past daily buckets retain the existing web/indexer semantics.

Load environment variables from `.env.example` into your shell (the CLI does not load dotenv). `ATTESTER_PRIVATE_KEY` is optional for unsigned dry-run and required for signing/relay. Leave `ATTESTATION_NONCE` blank for a random nonce, or set an unsigned decimal integer. A nonce is scoped to an account and cannot be reused even after rotation. Choose expiry deliberately (default 24h).

```sh
npx -y pnpm@10.32.0 --filter @bondrail/attester start --fixture test/fixtures/mixed.json
npx -y pnpm@10.32.0 --filter @bondrail/attester start
# Explicitly publish only after deploying/configuring a registry and its attester:
npx -y pnpm@10.32.0 --filter @bondrail/attester start --relay
```

Dry-run never submits a transaction. Fixture mode never contacts RPC or indexer and cannot relay. Live mode validates RPC chain ID, paginates payer totals (fails at 100k instead of silently truncating), reconciles payer totals to indexed revenue, and requires two equal aggregate snapshots. The indexer is still trusted for completeness and classification; matching reads do not prove a finalized chain snapshot. Confirm its sync/coverage operationally before issuing. Registry simulation enforces account membership, nonce, period and signer checks on relay.

Evidence is always written to `docs/credit/evidence/<keccak>.json` before signing/relay. Hash is keccak256 of exact UTF-8 bytes: sorted keys, normalized addresses, sorted payer/day rows, integer times, decimal-string amounts/policy constants, no whitespace/newline. It includes input aggregates, attribution reasons, default SDK terms, versioned policy and signing times/nonce. Save or publish this file for consumers; the contract does not host it. File content may describe business revenues. Dry-run signatures are live authorizations if the domain/chain/address are deployed and the signer is authorized; keep them private until intended publication.

Amounts and the credit line are asset base units. Concentration bps round up. The SDK computes a linear credit coefficient with its default terms, floors that coefficient to 12 decimals, then multiplies integer revenue; this avoids lossy floating-point conversion of large token balances and rounds the recommendation down. For six-decimal fixtures it matches the web estimate to less than one base unit. Re-run underwriting when periodEnd advances; same-period corrections need a later issuedAt.
