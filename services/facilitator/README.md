# Bondrail x402 facilitator

**Not yet deployed.** Supports x402 v2 `exact` EIP-3009 payments on the configured RPC's `eip155:<chainId>`, cached at startup. `GET /supported`, `POST /verify` and `POST /settle` work with the agent's `@x402/core` HTTP client. POST bodies contain `{x402Version: 2, paymentPayload, paymentRequirements}`; responses use `VerifyResponse` / `SettleResponse`.

Copy `.env.example` to `.env`, replace the placeholders, and run from this directory:

```sh
npx -y pnpm@10.32.0 exec tsx --env-file=.env src/server.ts
```

Configure a **new factory deployed with the settlement-capable account implementation**. Existing immutable clones cannot gain `settle`; simulation rejects them. Set the agent's `X402_FACILITATOR_URL` to this service's HTTPS origin. The agent's default external facilitator remains until explicitly configured. Deployment addresses are not changed here.

The operator pins the factory and token. Before serving requests, the facilitator discovers the token's EIP-712 domain via ERC-5267 `eip712Domain()`, falling back to `name()` and `version()` when that method reverts or is absent. Optional `FACILITATOR_DOMAIN_NAME` / `FACILITATOR_DOMAIN_VERSION` override those values; an overridden fallback getter is not called. ERC-5267 domains must include name, version, the RPC chain and the configured token address; optional salt is honored, and unsupported extensions fail startup. Restart after a token domain change. Both offered and accepted requirements must match the cached network and domain name/version. Verification checks signature, offer/authorization agreement, strict time window, factory registration, account asset, unused nonce, sufficient funds, and simulation of `account.settle`. Only 65-byte EOA signatures are supported by this v/r/s interface. The facilitator key pays gas; it never receives or approves payer funds. Success requires a successful transaction receipt.

Use one process per gas key and configure durable Redis via `REDIS_REST_URL`, `REDIS_REST_TOKEN`, and a deployment-specific `BONDRAIL_STORE_NAMESPACE`. Local tests may use explicit `BONDRAIL_ENV=local`, `BONDRAIL_STORE=local`, `BONDRAIL_DATA_DIR`. Writes are serialized and revalidated before submission. The service prepares/signs locally, then atomically journals the hash under chain/token/payer/authorization nonce **before** broadcasting. Repeated `/settle` requests and restarts only poll that hash, including if the original send response was lost; they never sign or broadcast a replacement. Retain this journal and its backups. A crash between journaling and sending deliberately requires operator investigation; do not delete the entry to force a retry.

Receipt recovery makes up to three waits of 20 seconds, with 1.5-second polling and jitter between transient failures. RPC attempts use the shared paced transport. Only a successful receipt for the original hash can report success; replacement/cancellation scanning is disabled. An unresolved hash returns `settlement_pending`. The SDK HTTP client allows 90 seconds for the facilitator; an outer timeout can still leave the agent pending. Use the [authenticated agent reconcile endpoint](../../docs/deployments/NEXT-RUNBOOK.md#recovering-settlement_pending-payments) to confirm a mined payment and release its cached result. A nonce already used outside the facilitator journal is refused.

Anyone can submit the signature directly to USDC first. The recipient stays fixed, but account settlement then reverts with a used nonce. These funds require `sweep()` and do not establish a proven on-chain payer. For public operation, configure HTTPS and request/gas-budget limits at the gateway: valid signed micropayments can spend facilitator gas, and simulation cannot eliminate inclusion races. Keep this key separate from issuer, observer, and milestone keys.

```sh
npx -y pnpm@10.32.0 --filter @bondrail/facilitator test
npx -y pnpm@10.32.0 --filter @bondrail/facilitator typecheck
```

Tests use real EIP-712 signatures, mocked chain clients, and the agent's actual SDK client over local HTTP. Live Monad/USDC settlement remains a check after deployment.

## Independent next deployment

Use `BONDRAIL_DEPLOYMENT=next pnpm tsx scripts/service.ts facilitator` from the repository root to pin the selected factory, asset, RPC and scoped gas key. The [next runbook](../../docs/deployments/NEXT-RUNBOOK.md) includes funding and independent systemd units. `pnpm e2e:local` exercises this server with real EIP-3009 signatures on isolated anvil.

For a separate Vercel Preview, the optional `api/[action].ts` facade and `vercel.json` forward only `/supported`, `/verify` and `/settle` to `FACILITATOR_UPSTREAM_URL` (a dedicated HTTPS origin). Keep one persistent writer behind that origin; the Preview stores no gas key. Both raw request streams and Vercel-parsed bodies are supported. The facade has unit coverage; remote Vercel deployment is owner-run.
