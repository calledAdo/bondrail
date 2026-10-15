# Bondrail x402 facilitator

Supports x402 v2 `exact` EIP-3009 payments on the configured RPC's `eip155:<chainId>`, cached at startup. `GET /supported`, `GET /health`, `POST /verify` and `POST /settle` work with the agent's `@x402/core` HTTP client. POST bodies contain `{x402Version: 2, paymentPayload, paymentRequirements}`; responses use `VerifyResponse` / `SettleResponse`.

Copy `.env.example` to `.env`, replace the placeholders, and run from this directory:

```sh
npx -y pnpm@10.32.0 exec tsx --env-file=.env src/server.ts
```

Configure a **new factory deployed with the settlement-capable account implementation**. Existing immutable clones cannot gain `settle`; simulation rejects them. Set the agent's `X402_FACILITATOR_URL` to this service's HTTPS origin. The agent's default external facilitator remains until explicitly configured. Deployment addresses are not changed here.

The operator pins the factory and token. Before serving requests, the facilitator discovers the token's EIP-712 domain via ERC-5267 `eip712Domain()`, falling back to `name()` and `version()` when that method reverts or is absent. Optional `FACILITATOR_DOMAIN_NAME` / `FACILITATOR_DOMAIN_VERSION` override those values; an overridden fallback getter is not called. ERC-5267 domains must include name, version, the RPC chain and the configured token address; optional salt is honored, and unsupported extensions fail startup. Restart after a token domain change. Both offered and accepted requirements must match the cached network and domain name/version. Verification checks signature, offer/authorization agreement, strict time window, factory registration, account asset, unused nonce, sufficient funds, and simulation of `account.settle`. Only 65-byte EOA signatures are supported by this v/r/s interface. The facilitator key pays gas; it never receives or approves payer funds. Success requires a successful transaction receipt.

Use one process per gas key and a single durable Redis namespace for that key (`REDIS_REST_URL`, `REDIS_REST_TOKEN`, `BONDRAIL_STORE_NAMESPACE`). Local tests may use explicit `BONDRAIL_ENV=local`, `BONDRAIL_STORE=local`, `BONDRAIL_DATA_DIR`. Do not share the key with scripts or another namespace. Writes are serialized and revalidated before submission.

Every settlement estimates gas, adds a 15% rounded-up margin and refuses a padded limit above `FACILITATOR_MAX_GAS` (default 500,000). Fees use the latest base fee plus 2 gwei priority, with 10% base-fee headroom and the `FACILITATOR_MAX_FEE_GWEI` ceiling (150 by default). Before any signing or journal write, the wallet must cover `gasLimit × maxFeePerGas`. Otherwise `/settle` returns `success:false`, an empty `transaction` and `errorReason:insufficient_gas_funds`, and logs the required/available wei. The authorization can retry after funding. See `.env.example` for every bound.

The service explicitly selects the latest mined wallet nonce, requiring the pending nonce to match, and durably reserves it with the signed bytes before broadcasting. The authorization journal binds its calldata to that nonce. Later payments get an empty-hash `wallet_busy` refusal while the slot is unresolved. A crash between the slot, authorization journal and send is recoverable: startup and a 15-second monitor restore the missing record and rebroadcast identical bytes. Repeated requests never allocate a second nonce for that authorization. Keep both journals and their backups.

After 30 seconds without inclusion, recovery signs a replacement with identical calldata/nonce and a greater-than-12.5% increase in both fees, subject to the same cap and affordability check. Every attempt's hash/bytes is persisted before broadcast. If the authorization is within six seconds of expiry, recovery instead sends a bounded 21,000-gas zero-value self-transfer at that nonce. A cancellation or unknown replacement never reports payment success. All known settlement hashes are checked because an earlier attempt can win the race. A revert or consumed nonce releases the slot. Exhausted funds/fee cap retain the slot and report the problem; a positive balance alone is not proof of affordability.

Each new settlement response waits at most 20 seconds for a receipt at 1.5-second polling intervals; the background monitor continues recovery without a client request. An unresolved hash returns `settlement_pending`. Legacy hash-only entries retain their original three 20-second waits and receipt-only semantics: without signed bytes/nonce they cannot safely be replaced. A foreign/pre-upgrade pending nonce returns `wallet_nonce_blocked`; investigate that nonce before using the key again. Never delete an old journal to force a fresh charge.

`GET /health` exposes balance (native and wei), estimated gas/cost, worst-case outstanding reserve, settlements remaining, latest/pending/in-flight nonce, low-balance flag and recovery error. It uses the most recent estimate, or the gas cap before the first estimate after restart. Fewer than `FACILITATOR_LOW_BALANCE_SETTLEMENTS` (default 10) remaining produces a structured error log and an optional HTTPS JSON POST to `FACILITATOR_LOW_BALANCE_WEBHOOK_URL`, at most every five minutes. The 15-second monitor checks this even without traffic; hook errors do not fail settlement. No key/signature is exposed by health or alerts.

On the October 15 next snapshot, actual warm settlements averaged **0.0284941505 MON**, with no mined reverts. A 190k estimate with this margin costs about **0.022287 MON** at 102 gwei; an RPC estimate of 279,369 costs about **0.03277005 MON** after the margin. Allow **~4 MON per 100 warm calls including reserve**, and consult `/health` before a run. Estimates may already be padded; do not promise a reduction from adding a margin. The [chain evidence and gas budget](../../docs/deployments/FACILITATOR-GAS.md) explain these numbers and the 0.075 MON absolute per-transaction commitment ceiling.

The agent returns an explicit retryable 503 for an empty-hash funding/busy/fee-cap refusal and preserves its generated result for the same signed request. An outer timeout can still leave a mined payment pending: use the [authenticated agent reconcile endpoint](../../docs/deployments/RUNBOOK.md#recovering-settlement_pending-payments) to prove a saved settlement receipt and release the cached result. A nonce already used outside the facilitator journal is refused.

Anyone can submit the signature directly to USDC first. The recipient stays fixed, but account settlement then reverts with a used nonce. These funds require `sweep()` and do not establish a proven on-chain payer. For public operation, configure HTTPS and request/gas-budget limits at the gateway: valid signed micropayments can spend facilitator gas, and simulation cannot eliminate inclusion races. Keep this key separate from issuer, observer, and milestone keys.

```sh
npx -y pnpm@10.32.0 --filter @bondrail/facilitator test
npx -y pnpm@10.32.0 --filter @bondrail/facilitator typecheck
```

Tests use real EIP-712 signatures, mocked chain clients, and the agent's actual SDK client over local HTTP. Live Monad/USDC settlement remains a check after deployment.

## Current deployment

Use `BONDRAIL_DEPLOYMENT=main pnpm tsx scripts/service.ts facilitator` from the repository root to pin the selected factory, asset, RPC and scoped gas key. The [production runbook](../../docs/deployments/RUNBOOK.md) includes funding and production systemd units. `pnpm e2e:local` exercises this server with real EIP-3009 signatures on isolated anvil.

For a separate Vercel Preview, the optional `api/[action].ts` facade and `vercel.json` forward only `/supported`, `/health`, `/verify` and `/settle` to `FACILITATOR_UPSTREAM_URL` (a dedicated HTTPS origin). Keep one persistent writer behind that origin; the Preview stores no gas key. Both raw request streams and Vercel-parsed bodies are supported. The facade has unit coverage; remote Vercel deployment is owner-run.
